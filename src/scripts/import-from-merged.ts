/**
 * Import products from the import_product_v2 table (ksi_data database)
 *
 * This table combines ALL partslink reference products with KSI supplier pricing.
 * Products without KSI data are imported as quote-only (no price, "Request Quote").
 *
 * Uses direct module service calls (not workflows) for speed.
 * Run `npm run reindex` after import to populate Meilisearch.
 *
 * Prerequisites:
 *   1. import_product_v2 table exists in ksi_data database
 *   2. KSI supplier exists in Medusa
 *
 * Usage: npx medusa exec ./src/scripts/import-from-merged.ts
 *
 * Set TEST_LIMIT to limit number of unique products (0 = full import)
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../modules/fitment"
import FitmentModuleService from "../modules/fitment/service"
import { SUPPLIER_MODULE } from "../modules/supplier"
import SupplierModuleService from "../modules/supplier/service"
import pg from "pg"

const { Pool } = pg

// ============================================================
// CONFIG
// ============================================================
const TEST_LIMIT = 0  // Set to 0 for full import
const BATCH_SIZE = 50 // Products per batch for createProducts

// ============================================================
// Types
// ============================================================
interface ImportRow {
  base_plink: string
  plink: string
  link_suffix: string | null
  pname: string
  ptype: string
  ctype: string
  make: string
  model: string
  y1: string
  y2: string
  variables: string | null
  notes: string | null
  has_notes: boolean
  oem: string | null
  long_oem: string | null
  hollander_no: string | null
  supersede: string | null
  cert: string | null
  pl_status: string | null
  origin: string | null
  neworreblt: string | null
  cost_price: number | null
  ksi_no: string | null
  ksi_qty: number | null
  has_ksi: boolean
  is_quote_only: boolean
  partslink_id: number | null
}

interface GroupedProduct {
  base_plink: string
  pname: string
  ptype: string
  ctype: string
  origin: string | null
  cert: string | null
  pl_status: string | null
  neworreblt: string | null
  supersede: string | null
  oem: string | null
  long_oem: string | null
  hollander_no: string | null
  partslink_id: number | null
  is_quote_only: boolean
  variants: Array<{
    plink: string
    link_suffix: string | null
    cost_price: number | null
    ksi_no: string | null
    ksi_qty: number | null
    has_ksi: boolean
    oem: string | null
  }>
  fitments: Array<{
    make: string
    model: string
    y1: string
    y2: string
    variables: string | null
    notes: string | null
    has_notes: boolean
  }>
}

/**
 * Title-case a string: capitalize the first letter of each word.
 * Preserves uppercase abbreviations (e.g. PTM, LED, RH, LH, H/B, A/T).
 * Only lowercases words that are fully lowercase, then capitalizes first letter.
 */
function titleCase(str: string): string {
  return str
    .replace(/\b([a-z])([a-z]*)\b/g, (_, first, rest) => {
      return first.toUpperCase() + rest
    })
    // Keep w/o and w/ lowercase (standard automotive abbreviation)
    .replace(/\bW\/O\b/g, "w/o")
    .replace(/\bW\/(?!O)/g, "w/")
}

export default async function importFromMerged({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fitmentService: FitmentModuleService = container.resolve(FITMENT_MODULE)
  const supplierService: SupplierModuleService = container.resolve(SUPPLIER_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productModuleService = container.resolve(Modules.PRODUCT)
  const pricingModuleService = container.resolve(Modules.PRICING)
  const remoteLink = container.resolve(ContainerRegistrationKeys.REMOTE_LINK)

  logger.info("=== Import from Merged Table ===")
  if (TEST_LIMIT > 0) logger.info(`TEST MODE: ${TEST_LIMIT} products`)

  // ============================================================
  // Connect to ksi_data
  // ============================================================
  const pool = new Pool({
    database: "ksi_data",
    user: "medusa",
    password: "medusa123",
    host: "localhost",
  })

  // ============================================================
  // Step 1: Create categories from CTYPE/PTYPE
  // ============================================================
  logger.info("\n--- Step 1: Categories ---")

  const ctypeResult = await pool.query(
    "SELECT DISTINCT ctype, cname FROM partslink_ctype ORDER BY ctype"
  )
  const ptypeResult = await pool.query(`
    SELECT DISTINCT pt.ptype, pt.pname, pt.ctype, ct.cname
    FROM partslink_ptype pt
    JOIN partslink_ctype ct ON pt.ctype = ct.ctype
    WHERE pt.ptype IN (SELECT DISTINCT ptype FROM import_product_v2)
    ORDER BY pt.ctype, pt.ptype
  `)

  const parentCatMap = new Map<string, string>()
  const usedCtypes = new Set(ptypeResult.rows.map((r: any) => r.ctype))

  for (const row of ctypeResult.rows) {
    if (!usedCtypes.has(row.ctype)) continue

    const name = row.cname
      .split(" ")
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ")
      .replace(/ & /g, " & ")
    const handle = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")

    try {
      const created = await productModuleService.createProductCategories({
        name,
        handle,
        is_active: true,
        is_internal: false,
      })
      parentCatMap.set(row.ctype, created.id)
      logger.info(`  Parent: ${name} -> ${created.id}`)
    } catch (err: any) {
      const { data: existing } = await query.graph({
        entity: "product_category",
        fields: ["id", "handle"],
        filters: { handle },
      })
      if (existing?.[0]) {
        parentCatMap.set(row.ctype, (existing[0] as any).id)
        logger.info(`  Parent (exists): ${name} -> ${(existing[0] as any).id}`)
      } else {
        logger.error(`  Parent ERROR: ${name} - ${err.message}`)
      }
    }
  }

  const subCatMap = new Map<string, string>()

  for (const row of ptypeResult.rows) {
    const parentId = parentCatMap.get(row.ctype)
    if (!parentId) continue

    const name = row.pname
    const handle = `${row.ctype}-${row.ptype}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`

    try {
      const created = await productModuleService.createProductCategories({
        name,
        handle,
        parent_category_id: parentId,
        is_active: true,
        is_internal: false,
      })
      subCatMap.set(row.ptype, created.id)
    } catch (err: any) {
      const { data: existing } = await query.graph({
        entity: "product_category",
        fields: ["id", "handle"],
        filters: { handle },
      })
      if (existing?.[0]) {
        subCatMap.set(row.ptype, (existing[0] as any).id)
      } else {
        logger.error(`  Sub ERROR: ${name} - ${err.message}`)
      }
    }
  }

  logger.info(`  Created ${parentCatMap.size} parents, ${subCatMap.size} subcategories`)

  // ============================================================
  // Step 2: Load supporting data
  // ============================================================
  logger.info("\n--- Step 2: Supporting data ---")

  let ksiSupplier = (await supplierService.listSuppliers({ code: "KSI" }))[0]
  if (!ksiSupplier) {
    ksiSupplier = await supplierService.createSuppliers({
      name: "KSI Auto Parts",
      code: "KSI",
    })
    logger.info(`  Created KSI supplier: ${ksiSupplier.id}`)
  } else {
    logger.info(`  KSI supplier: ${ksiSupplier.id}`)
  }

  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const salesChannels = await salesChannelService.listSalesChannels({ is_disabled: false })
  const salesChannelIds = salesChannels.map((sc: any) => sc.id)
  logger.info(`  Sales channels: ${salesChannelIds.length}`)

  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const [shippingProfile] = await fulfillmentService.listShippingProfiles({})
  if (!shippingProfile) {
    throw new Error("No shipping profile found")
  }
  logger.info(`  Shipping profile: ${shippingProfile.id}`)

  // Vehicle lookup maps
  const makeNameMap = new Map<string, string>()
  const modelKeyMap = new Map<string, string>()
  const vehicleKeyMap = new Map<string, string>()

  // ============================================================
  // Step 3: Load and group import data
  // ============================================================
  logger.info("\n--- Step 3: Loading import data ---")

  const importResult = TEST_LIMIT > 0
    ? await pool.query<ImportRow>(`
        WITH random_products AS (
          SELECT base_plink FROM (
            SELECT DISTINCT base_plink FROM import_product_v2
          ) sub
          ORDER BY RANDOM()
          LIMIT ${TEST_LIMIT}
        )
        SELECT ip.* FROM import_product_v2 ip
        JOIN random_products rp ON ip.base_plink = rp.base_plink
        ORDER BY ip.base_plink, ip.link_suffix NULLS FIRST
      `)
    : await pool.query<ImportRow>(`
        SELECT * FROM import_product_v2
        ORDER BY base_plink, link_suffix NULLS FIRST
      `)

  // Group rows by base_plink
  const grouped = new Map<string, GroupedProduct>()

  for (const row of importResult.rows) {
    if (!grouped.has(row.base_plink)) {
      grouped.set(row.base_plink, {
        base_plink: row.base_plink,
        pname: row.pname,
        ptype: row.ptype,
        ctype: row.ctype,
        origin: row.origin,
        cert: row.cert,
        pl_status: row.pl_status,
        neworreblt: row.neworreblt,
        supersede: row.supersede,
        oem: row.oem,
        long_oem: row.long_oem,
        hollander_no: row.hollander_no,
        partslink_id: row.partslink_id,
        is_quote_only: row.is_quote_only,
        variants: [],
        fitments: [],
      })
    }

    const group = grouped.get(row.base_plink)!

    const variantExists = group.variants.some((v) => v.plink === row.plink)
    if (!variantExists) {
      group.variants.push({
        plink: row.plink,
        link_suffix: row.link_suffix,
        cost_price: row.cost_price,
        ksi_no: row.ksi_no,
        ksi_qty: row.ksi_qty,
        has_ksi: row.has_ksi,
        oem: row.oem,
      })
    }

    const fitmentKey = `${row.make}|${row.model}|${row.y1}|${row.y2}|${row.variables || ""}`
    const fitmentExists = group.fitments.some(
      (f) => `${f.make}|${f.model}|${f.y1}|${f.y2}|${f.variables || ""}` === fitmentKey
    )
    if (!fitmentExists && row.make && row.model && row.y1 && row.y2) {
      group.fitments.push({
        make: row.make,
        model: row.model,
        y1: row.y1,
        y2: row.y2,
        variables: row.variables,
        notes: row.notes,
        has_notes: row.has_notes,
      })
    }
  }

  const productEntries = Array.from(grouped.entries())

  logger.info(`  ${productEntries.length} unique products to import`)
  logger.info(`  Total variants: ${productEntries.reduce((s, [, g]) => s + g.variants.length, 0)}`)
  logger.info(`  Total fitments: ${productEntries.reduce((s, [, g]) => s + g.fitments.length, 0)}`)

  // ============================================================
  // Step 4: Pre-create all vehicles (makes, models, vehicles)
  // ============================================================
  logger.info("\n--- Step 4: Pre-creating vehicles ---")

  // Collect all unique makes, models, vehicles from fitments
  const allMakes = new Set<string>()
  const allModels = new Set<string>() // "MAKE|MODEL"
  const allVehicles = new Set<string>() // "MAKE|MODEL|Y1|Y2"

  for (const [, group] of productEntries) {
    for (const f of group.fitments) {
      allMakes.add(f.make.toUpperCase())
      allModels.add(`${f.make.toUpperCase()}|${f.model.toUpperCase()}`)
      allVehicles.add(`${f.make.toUpperCase()}|${f.model.toUpperCase()}|${f.y1}|${f.y2}`)
    }
  }

  logger.info(`  Unique makes: ${allMakes.size}, models: ${allModels.size}, vehicles: ${allVehicles.size}`)

  // Create all makes
  for (const makeName of allMakes) {
    try {
      const make = await fitmentService.createVehicleMakes({ name: makeName })
      makeNameMap.set(makeName, make.id)
    } catch {
      const makes = await fitmentService.listVehicleMakes()
      const found = makes.find((m) => m.name.toUpperCase() === makeName)
      if (found) makeNameMap.set(makeName, found.id)
    }
  }
  logger.info(`  Makes created/found: ${makeNameMap.size}`)

  // Create all models
  for (const modelStr of allModels) {
    const [makeName, modelName] = modelStr.split("|")
    const makeId = makeNameMap.get(makeName)
    if (!makeId) continue

    const modelKey = `${makeId}|${modelName}`
    try {
      const model = await fitmentService.createVehicleModels({ name: modelName, make_id: makeId })
      modelKeyMap.set(modelKey, model.id)
    } catch {
      const models = await fitmentService.listVehicleModels({ make_id: makeId })
      const found = models.find((m) => m.name.toUpperCase() === modelName)
      if (found) modelKeyMap.set(modelKey, found.id)
    }
  }
  logger.info(`  Models created/found: ${modelKeyMap.size}`)

  // Create all vehicles
  for (const vehicleStr of allVehicles) {
    const [makeName, modelName, y1, y2] = vehicleStr.split("|")
    const makeId = makeNameMap.get(makeName)
    if (!makeId) continue
    const modelKey = `${makeId}|${modelName}`
    const modelId = modelKeyMap.get(modelKey)
    if (!modelId) continue

    const yearStart = parseInt(y1)
    const yearEnd = parseInt(y2)
    if (isNaN(yearStart) || isNaN(yearEnd)) continue

    const vehicleKey = `${makeId}|${modelId}|${yearStart}|${yearEnd}`
    try {
      const vehicle = await fitmentService.createVehicles({
        make_id: makeId,
        model_id: modelId,
        year_start: yearStart,
        year_end: yearEnd,
      })
      vehicleKeyMap.set(vehicleKey, vehicle.id)
    } catch {
      const vehicles = await fitmentService.listVehicles({
        make_id: makeId,
        model_id: modelId,
        year_start: yearStart,
        year_end: yearEnd,
      })
      if (vehicles[0]) vehicleKeyMap.set(vehicleKey, vehicles[0].id)
    }
  }
  logger.info(`  Vehicles created/found: ${vehicleKeyMap.size}`)

  // ============================================================
  // Step 5: Import products in batches (direct module service)
  // ============================================================
  logger.info("\n--- Step 5: Importing products ---")

  let createdProducts = 0
  let createdVariants = 0
  let createdFitments = 0
  let quoteOnlyProducts = 0
  let supplierLinks = 0
  let errors = 0
  const startTime = Date.now()

  // Process in batches
  for (let batchStart = 0; batchStart < productEntries.length; batchStart += BATCH_SIZE) {
    const batch = productEntries.slice(batchStart, batchStart + BATCH_SIZE)

    // Build product definitions for this batch
    const productDefs: any[] = []
    const batchGroups: GroupedProduct[] = []

    for (const [basePlink, group] of batch) {
      const categoryId = subCatMap.get(group.ptype)
      if (!categoryId) {
        errors++
        continue
      }

      const optionValues: string[] = []
      const variantDefs: any[] = []

      for (const v of group.variants) {
        let variantTitle = "Standard"
        if (v.link_suffix === "C") variantTitle = "CAPA Certified"
        else if (v.link_suffix === "N") variantTitle = "NSF Certified"
        else if (v.link_suffix === "P") variantTitle = "Steel"

        if (!optionValues.includes(variantTitle)) optionValues.push(variantTitle)

        variantDefs.push({
          title: variantTitle,
          sku: v.plink,
          options: { Certification: variantTitle },
          manage_inventory: !group.is_quote_only,
          allow_backorder: !group.is_quote_only,
          metadata: {
            ksi_no: v.ksi_no,
            hollander_no: group.hollander_no,
          },
        })
      }

      const handle = basePlink.toLowerCase().replace(/[^a-z0-9]+/g, "-")

      productDefs.push({
        title: group.pname,
        handle,
        status: ProductStatus.PUBLISHED,
        origin_country: group.origin || undefined,
        metadata: {
          partslink_no: basePlink,
          oem: group.oem,
          long_oem: group.long_oem,
          hollander_no: group.hollander_no,
          supersede: group.supersede,
          cert: group.cert,
          pl_status: group.pl_status,
          neworreblt: group.neworreblt,
          ptype: group.ptype,
          partslink_id: group.partslink_id,
          ...(group.is_quote_only ? { is_quote_only: true } : {}),
        },
        categories: [{ id: categoryId }],
        shipping_profile_id: shippingProfile.id,
        options: optionValues.length > 0
          ? [{ title: "Certification", values: optionValues }]
          : [{ title: "Certification", values: ["Standard"] }],
        variants: variantDefs,
      })
      batchGroups.push(group)
    }

    if (productDefs.length === 0) continue

    try {
      // Create products in batch (direct module call, no events)
      const products = await productModuleService.createProducts(productDefs)

      for (let i = 0; i < products.length; i++) {
        const product = products[i]
        const group = batchGroups[i]

        createdProducts++
        createdVariants += product.variants?.length || 0
        if (group.is_quote_only) quoteOnlyProducts++

        // Link to sales channels
        const scLinks = salesChannelIds.map((scId: string) => ({
          [Modules.PRODUCT]: { product_id: product.id },
          [Modules.SALES_CHANNEL]: { sales_channel_id: scId },
        }))
        try {
          await link.create(scLinks)
        } catch {
          // May already exist
        }

        // Create prices for non-quote-only products
        if (!group.is_quote_only && product.variants?.length) {
          for (const variant of product.variants) {
            const sourceVariant = group.variants.find((v) => v.plink === variant.sku)
            if (!sourceVariant) continue

            const costPrice = sourceVariant.cost_price && sourceVariant.cost_price > 0 ? sourceVariant.cost_price : null
            const markup = (ksiSupplier as any).default_markup || 30
            const sellPrice = costPrice ? costPrice * (1 + markup / 100) : 99.99

            try {
              // Create price set and link to variant
              const priceSet = await pricingModuleService.createPriceSets({
                prices: [{ currency_code: "usd", amount: sellPrice }],
              })
              await remoteLink.create({
                [Modules.PRODUCT]: { variant_id: variant.id },
                [Modules.PRICING]: { price_set_id: priceSet.id },
              })
            } catch (err: any) {
              if (errors < 5) logger.warn(`  Price error ${variant.sku}: ${err.message}`)
            }

            // Create supplier link
            if (sourceVariant.has_ksi) {
              try {
                await link.create({
                  [Modules.PRODUCT]: { product_variant_id: variant.id },
                  supplier: { supplier_id: ksiSupplier.id },
                  data: {
                    partslink_no: group.base_plink,
                    supplier_sku: sourceVariant.ksi_no,
                    oem_number: sourceVariant.oem,
                    cost_price: costPrice,
                    stock_qty: sourceVariant.ksi_qty || 0,
                    is_primary: true,
                  },
                })
                supplierLinks++
              } catch (err: any) {
                if (!err.message?.includes("already exists") && !err.message?.includes("duplicate")) {
                  if (errors < 5) logger.warn(`  Supplier link error ${variant.id}: ${err.message}`)
                }
              }
            }
          }
        }

        // Create fitments and link to product
        for (const f of group.fitments) {
          const makeId = makeNameMap.get(f.make.toUpperCase())
          if (!makeId) continue
          const modelKey = `${makeId}|${f.model.toUpperCase()}`
          const modelId = modelKeyMap.get(modelKey)
          if (!modelId) continue

          const yearStart = parseInt(f.y1)
          const yearEnd = parseInt(f.y2)
          if (isNaN(yearStart) || isNaN(yearEnd)) continue

          const vehicleKey = `${makeId}|${modelId}|${yearStart}|${yearEnd}`
          const vehicleId = vehicleKeyMap.get(vehicleKey)
          if (!vehicleId) continue

          try {
            const fitment = await fitmentService.createFitments({
              vehicle_id: vehicleId,
              submodels: [] as unknown as Record<string, unknown>,
              conditions: f.variables ? titleCase(f.variables) : null,
              notes: f.notes || null,
              has_notes_notice: f.has_notes,
            })

            await link.create({
              [Modules.PRODUCT]: { product_id: product.id },
              fitment: { fitment_id: fitment.id },
            })

            createdFitments++
          } catch (err: any) {
            if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
              if (errors < 10) logger.warn(`  Fitment error ${group.base_plink}: ${err.message}`)
              errors++
            }
          }
        }
      }
    } catch (err: any) {
      logger.error(`  Batch error at ${batchStart}: ${err.message}`)
      errors++
      if (errors >= 100) {
        logger.error(`  Too many errors (${errors}), stopping.`)
        break
      }
    }

    // Progress every 500 products
    if (createdProducts > 0 && createdProducts % 500 < BATCH_SIZE) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      const rate = (createdProducts / ((Date.now() - startTime) / 1000)).toFixed(1)
      const eta = (((productEntries.length - createdProducts) / parseFloat(rate)) / 60).toFixed(1)
      logger.info(
        `  Progress: ${createdProducts}/${productEntries.length} (${rate}/s, ETA ${eta}m) | variants: ${createdVariants} | fitments: ${createdFitments} | errors: ${errors}`
      )
    }
  }

  await pool.end()

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  logger.info("\n=== Import Complete ===")
  logger.info(`Time:          ${totalTime} minutes`)
  logger.info(`Products:      ${createdProducts}`)
  logger.info(`  With price:  ${createdProducts - quoteOnlyProducts}`)
  logger.info(`  Quote-only:  ${quoteOnlyProducts}`)
  logger.info(`Variants:      ${createdVariants}`)
  logger.info(`Supplier links: ${supplierLinks}`)
  logger.info(`Fitments:      ${createdFitments}`)
  logger.info(`Errors:        ${errors}`)
  logger.info(`\nRun 'npm run reindex' to update Meilisearch index.`)
}
