/**
 * Import products from the import_ready table (ksi_data database)
 *
 * This table merges Partslink catalog data (master) with KSI supplier pricing/stock.
 * Products without KSI data are imported as quote-only (price = 0).
 *
 * Supports incremental updates: if a product already exists (by handle),
 * updates variants' prices, inventory, and supplier links instead of creating.
 * Fitments are only created for NEW products.
 *
 * Uses direct module service calls (not workflows) for speed.
 * Runs Meilisearch reindex at the end.
 *
 * Prerequisites:
 *   1. import_ready table exists in ksi_data database
 *   2. KSI supplier exists in Medusa (or will be created)
 *   3. At least one stock location exists
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
import { calculateSellPrice } from "../services/auto-pricing"
import { deleteProductsWorkflow, deleteProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { execSync } from "child_process"
import pg from "pg"

const { Pool } = pg

// ============================================================
// CONFIG
// ============================================================
const TEST_LIMIT = 0   // Set to 0 for full import
const TEST_PLINKS: string[] = []  // Empty for all, or specific base_plinks to test
const BATCH_SIZE = 50   // Products per batch for createProducts

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
  origin: string | null
  neworreblt: string | null
  mfg: string | null
  oeprice: number | null
  cost_price: string   // '0.00' when no KSI
  ksi_no: string | null
  ksi_qty: string       // '0', '1', '5+' etc
  ksi_district_qty: string
  has_ksi: boolean
  is_quote_only: boolean
  partslink_id: number | null
  source: string
  is_generated: boolean
}

interface GroupedProduct {
  base_plink: string
  pname: string
  ptype: string
  ctype: string
  origin: string | null
  cert: string | null
  neworreblt: string | null
  supersede: string | null
  oem: string | null
  long_oem: string | null
  hollander_no: string | null
  partslink_id: number | null
  variants: Array<{
    plink: string
    link_suffix: string | null
    cost_price: string
    ksi_no: string | null
    ksi_qty: string
    ksi_district_qty: string
    has_ksi: boolean
    is_quote_only: boolean
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
 * Parse quantity strings like '0', '1', '5+', '10+' into integers.
 */
function parseQty(qty: string, districtQty?: string): number {
  const q = parseSingleQty(qty)
  const d = districtQty ? parseSingleQty(districtQty) : 0
  return q + d
}

function parseSingleQty(qty: string): number {
  if (!qty || qty === '0') return 0
  const cleaned = qty.replace('+', '').trim()
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? 0 : num
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
  const inventoryService = container.resolve(Modules.INVENTORY)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)

  logger.info("=== Import from import_ready ===")
  if (TEST_LIMIT > 0) logger.info(`TEST MODE: ${TEST_LIMIT} products`)

  // ============================================================
  // Connect to ksi_data (source) and medusa (for direct SQL updates)
  // ============================================================
  const pool = new Pool({
    database: "ksi_data",
    user: "medusa",
    password: "medusa123",
    host: "localhost",
  })

  const medusaPool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://medusa:medusa123@localhost/medusa-my-medusa-store",
  })

  // ============================================================
  // Stats counters
  // ============================================================
  let createdProducts = 0
  let updatedProducts = 0
  let createdVariants = 0
  let updatedVariants = 0
  let createdFitments = 0
  let updatedFitments = 0
  let deletedFitments = 0
  let deletedProducts = 0
  let deletedVariants = 0
  let deletedCategories = 0
  let createdInventoryItems = 0
  let updatedInventoryLevels = 0
  let supplierLinks = 0
  let quoteOnlyVariants = 0
  let errors = 0

  // Fitment skip tracking
  let fitmentSkips = { noMake: 0, noModel: 0, noVehicle: 0, invalidYear: 0, duplicate: 0 }
  const fitmentSkipLogs = { noMake: [] as string[], noModel: [] as string[], noVehicle: [] as string[], invalidYear: [] as string[] }
  const SKIP_LOG_LIMIT = 20

  // ============================================================
  // Step 1: Resolve stock location
  // ============================================================
  logger.info("\n--- Step 1: Stock location ---")

  const stockLocations = await stockLocationService.listStockLocations({})
  if (!stockLocations || stockLocations.length === 0) {
    throw new Error("No stock location found. Create one before importing.")
  }
  const stockLocationId = stockLocations[0].id
  logger.info(`  Stock location: ${stockLocationId}`)

  // ============================================================
  // Step 2: Create categories from pl_r_ctype / pl_r_ptype
  // ============================================================
  logger.info("\n--- Step 2: Categories ---")

  const ctypeResult = await pool.query(
    "SELECT DISTINCT ctype, cname FROM pl_r_ctype ORDER BY ctype"
  )
  const ptypeResult = await pool.query(`
    SELECT DISTINCT pt.ptype, pt.pname, pt.ctype, ct.cname
    FROM pl_r_ptype pt
    JOIN pl_r_ctype ct ON pt.ctype = ct.ctype
    WHERE pt.ptype IN (SELECT DISTINCT ptype FROM import_ready)
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
  // Step 3: Load supporting data
  // ============================================================
  logger.info("\n--- Step 3: Supporting data ---")

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

  const markup = (ksiSupplier as any).default_markup || 20

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
  // Step 4: Load existing products by handle for incremental updates
  // ============================================================
  logger.info("\n--- Step 4: Loading existing products ---")

  const existingProductMap = new Map<string, any>() // handle -> product (with variants)

  let existingOffset = 0
  const EXISTING_PAGE_SIZE = 500
  let totalExistingLoaded = 0

  while (true) {
    const { data: existingProducts } = await query.graph({
      entity: "product",
      fields: [
        "id", "handle", "title", "metadata",
        "categories.id",
        "variants.id", "variants.sku", "variants.title", "variants.metadata",
        "variants.manage_inventory", "variants.allow_backorder",
      ],
      pagination: { skip: existingOffset, take: EXISTING_PAGE_SIZE },
    })

    if (!existingProducts || existingProducts.length === 0) break

    for (const p of existingProducts) {
      if ((p as any).handle) {
        existingProductMap.set((p as any).handle, p)
      }
    }
    totalExistingLoaded += existingProducts.length
    existingOffset += EXISTING_PAGE_SIZE

    if (existingProducts.length < EXISTING_PAGE_SIZE) break
  }

  logger.info(`  Loaded ${totalExistingLoaded} existing products (${existingProductMap.size} unique handles)`)

  // ============================================================
  // Step 5: Load and group import data
  // ============================================================
  logger.info("\n--- Step 5: Loading import data ---")

  let importResult
  if (TEST_PLINKS.length > 0) {
    importResult = await pool.query<ImportRow>(`
        SELECT * FROM import_ready
        WHERE base_plink = ANY($1)
        ORDER BY base_plink, link_suffix NULLS FIRST
      `, [TEST_PLINKS])
  } else if (TEST_LIMIT > 0) {
    importResult = await pool.query<ImportRow>(`
        WITH random_products AS (
          SELECT base_plink FROM (
            SELECT DISTINCT base_plink FROM import_ready
          ) sub
          ORDER BY RANDOM()
          LIMIT ${TEST_LIMIT}
        )
        SELECT ip.* FROM import_ready ip
        JOIN random_products rp ON ip.base_plink = rp.base_plink
        ORDER BY ip.base_plink, ip.link_suffix NULLS FIRST
      `)
  } else {
    importResult = await pool.query<ImportRow>(`
        SELECT * FROM import_ready
        ORDER BY base_plink, link_suffix NULLS FIRST
      `)
  }

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
        neworreblt: row.neworreblt,
        supersede: row.supersede,
        oem: row.oem,
        long_oem: row.long_oem,
        hollander_no: row.hollander_no,
        partslink_id: row.partslink_id,
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
        ksi_district_qty: row.ksi_district_qty,
        has_ksi: row.has_ksi,
        is_quote_only: row.is_quote_only,
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

  logger.info(`  ${productEntries.length} unique products to import/update`)
  logger.info(`  Total variants: ${productEntries.reduce((s, [, g]) => s + g.variants.length, 0)}`)
  logger.info(`  Total fitments: ${productEntries.reduce((s, [, g]) => s + g.fitments.length, 0)}`)

  // ============================================================
  // Step 6: Pre-create all vehicles (makes, models, vehicles)
  // ============================================================
  logger.info("\n--- Step 6: Pre-creating vehicles ---")

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
  // Step 7: Import/update products in batches
  // ============================================================
  logger.info("\n--- Step 7: Importing/updating products ---")

  const startTime = Date.now()

  for (let batchStart = 0; batchStart < productEntries.length; batchStart += BATCH_SIZE) {
    const batch = productEntries.slice(batchStart, batchStart + BATCH_SIZE)

    // Separate new vs existing products
    const newProductDefs: any[] = []
    const newBatchGroups: GroupedProduct[] = []
    const existingBatchEntries: Array<{ product: any; group: GroupedProduct }> = []

    for (const [basePlink, group] of batch) {
      const handle = basePlink.toLowerCase().replace(/[^a-z0-9]+/g, "-")
      const existingProduct = existingProductMap.get(handle)

      if (existingProduct) {
        existingBatchEntries.push({ product: existingProduct, group })
      } else {
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

          if (v.is_quote_only) quoteOnlyVariants++

          variantDefs.push({
            title: variantTitle,
            sku: v.plink,
            options: { Certification: variantTitle },
            manage_inventory: true,
            allow_backorder: false,
            metadata: {
              ksi_no: v.ksi_no,
              hollander_no: group.hollander_no,
            },
          })
        }

        newProductDefs.push({
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
            neworreblt: group.neworreblt,
            ptype: group.ptype,
            partslink_id: group.partslink_id,
            is_quote_only: group.variants.every(v => v.is_quote_only) || undefined,
          },
          categories: [{ id: categoryId }],
          shipping_profile_id: shippingProfile.id,
          options: optionValues.length > 0
            ? [{ title: "Certification", values: optionValues }]
            : [{ title: "Certification", values: ["Standard"] }],
          variants: variantDefs,
        })
        newBatchGroups.push(group)
      }
    }

    // ---- Handle NEW products ----
    if (newProductDefs.length > 0) {
      try {
        const products = await productModuleService.createProducts(newProductDefs)

        for (let i = 0; i < products.length; i++) {
          const product = products[i]
          const group = newBatchGroups[i]

          createdProducts++
          createdVariants += product.variants?.length || 0

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

          // Link shipping profile (createProducts doesn't do this automatically)
          try {
            await medusaPool.query(
              `INSERT INTO product_shipping_profile (product_id, shipping_profile_id, id, created_at, updated_at)
               VALUES ($1, $2, 'psp_' || substr(md5(random()::text || $1), 1, 26), NOW(), NOW())
               ON CONFLICT (product_id, shipping_profile_id) DO NOTHING`,
              [product.id, shippingProfile.id]
            )
          } catch {
            // May already exist
          }

          // Create prices, inventory, and supplier links for each variant
          if (product.variants?.length) {
            for (const variant of product.variants) {
              const sourceVariant = group.variants.find((v) => v.plink === variant.sku)
              if (!sourceVariant) continue

              const costPrice = parseFloat(sourceVariant.cost_price) || 0
              const sellPrice = sourceVariant.is_quote_only ? 0 : (costPrice > 0 ? calculateSellPrice(costPrice, markup) : 0)

              // Create price set and link to variant
              try {
                const priceSet = await pricingModuleService.createPriceSets({
                  prices: [{ currency_code: "usd", amount: sellPrice }],
                })
                await remoteLink.create({
                  [Modules.PRODUCT]: { variant_id: variant.id },
                  [Modules.PRICING]: { price_set_id: priceSet.id },
                })
              } catch (err: any) {
                if (errors < 5) logger.warn(`  Price error ${variant.sku}: ${err.message}`)
                errors++
              }

              // Create inventory item (or find existing by SKU), link to variant, set level
              try {
                let invItem
                const existingInvItems = await inventoryService.listInventoryItems({ sku: variant.sku as string })
                if (existingInvItems.length > 0) {
                  invItem = existingInvItems[0]
                } else {
                  invItem = await inventoryService.createInventoryItems({
                    sku: variant.sku,
                    title: variant.title,
                  })
                }

                await remoteLink.create({
                  [Modules.PRODUCT]: { variant_id: variant.id },
                  [Modules.INVENTORY]: { inventory_item_id: invItem.id },
                })

                const qty = parseQty(sourceVariant.ksi_qty, sourceVariant.ksi_district_qty)
                await inventoryService.createInventoryLevels([{
                  inventory_item_id: invItem.id,
                  location_id: stockLocationId,
                  stocked_quantity: qty,
                }])

                createdInventoryItems++
              } catch (err: any) {
                if (errors < 5) logger.warn(`  Inventory error ${variant.sku}: ${err.message}`)
                errors++
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
                      stock_qty: parseQty(sourceVariant.ksi_qty, sourceVariant.ksi_district_qty),
                      is_primary: true,
                    },
                  })
                  supplierLinks++
                } catch (err: any) {
                  if (!err.message?.includes("already exists") && !err.message?.includes("duplicate")) {
                    if (errors < 5) logger.warn(`  Supplier link error ${variant.id}: ${err.message}`)
                    errors++
                  }
                }
              }
            }
          }

          // Create fitments for NEW products only
          for (const f of group.fitments) {
            const makeUpper = f.make.toUpperCase()
            const modelUpper = f.model.toUpperCase()
            const makeId = makeNameMap.get(makeUpper)

            if (!makeId) {
              fitmentSkips.noMake++
              if (fitmentSkipLogs.noMake.length < SKIP_LOG_LIMIT) {
                fitmentSkipLogs.noMake.push(`${group.base_plink}: make "${f.make}" not found`)
              }
              continue
            }

            const modelKey = `${makeId}|${modelUpper}`
            const modelId = modelKeyMap.get(modelKey)
            if (!modelId) {
              fitmentSkips.noModel++
              if (fitmentSkipLogs.noModel.length < SKIP_LOG_LIMIT) {
                fitmentSkipLogs.noModel.push(`${group.base_plink}: model "${f.model}" (make: ${f.make}) not found`)
              }
              continue
            }

            const yearStart = parseInt(f.y1)
            const yearEnd = parseInt(f.y2)
            if (isNaN(yearStart) || isNaN(yearEnd)) {
              fitmentSkips.invalidYear++
              if (fitmentSkipLogs.invalidYear.length < SKIP_LOG_LIMIT) {
                fitmentSkipLogs.invalidYear.push(`${group.base_plink}: invalid years y1="${f.y1}" y2="${f.y2}"`)
              }
              continue
            }

            const vehicleKey = `${makeId}|${modelId}|${yearStart}|${yearEnd}`
            const vehicleId = vehicleKeyMap.get(vehicleKey)
            if (!vehicleId) {
              fitmentSkips.noVehicle++
              if (fitmentSkipLogs.noVehicle.length < SKIP_LOG_LIMIT) {
                fitmentSkipLogs.noVehicle.push(`${group.base_plink}: vehicle ${f.make} ${f.model} ${f.y1}-${f.y2} not found`)
              }
              continue
            }

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
              if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
                fitmentSkips.duplicate++
              } else {
                if (errors < 10) logger.warn(`  Fitment error ${group.base_plink}: ${err.message}`)
                errors++
              }
            }
          }
        }
      } catch (err: any) {
        logger.error(`  Batch create error at ${batchStart}: ${err.message}`)
        errors++
        if (errors >= 100) {
          logger.error(`  Too many errors (${errors}), stopping.`)
          break
        }
      }
    }

    // ---- Handle EXISTING products (update variants) ----
    for (const { product: existingProduct, group } of existingBatchEntries) {
      try {
        updatedProducts++

        // Update product title, metadata, category
        try {
          const categoryId = subCatMap.get(group.ptype)
          const allQuoteOnly = group.variants.every(v => v.is_quote_only)
          const newMetadata: any = {
            partslink_no: group.base_plink,
            oem: group.oem,
            long_oem: group.long_oem,
            hollander_no: group.hollander_no,
            supersede: group.supersede,
            cert: group.cert,
            neworreblt: group.neworreblt,
            ptype: group.ptype,
            partslink_id: group.partslink_id,
          }
          if (allQuoteOnly) {
            newMetadata.is_quote_only = true
          } else {
            newMetadata.is_quote_only = ""  // empty string removes the key in Medusa
          }

          const updatePayload: any = {
            title: group.pname,
            metadata: newMetadata,
            origin_country: group.origin || undefined,
          }

          if (categoryId) {
            const existingCatIds = (existingProduct.categories || []).map((c: any) => c.id)
            if (!existingCatIds.includes(categoryId)) {
              updatePayload.categories = [{ id: categoryId }]
            }
          }

          await productModuleService.updateProducts(existingProduct.id, updatePayload)
        } catch (err: any) {
          if (errors < 5) logger.warn(`  Product update error ${group.base_plink}: ${err.message}`)
          errors++
        }

        for (const sourceVariant of group.variants) {
          // Find the existing variant by SKU
          const matchedVariant = existingProduct.variants?.find(
            (v: any) => v.sku === sourceVariant.plink
          )

          if (!matchedVariant) {
            // New variant — create it on this existing product
            try {
              let variantTitle = "Standard"
              if (sourceVariant.link_suffix === "C") variantTitle = "CAPA Certified"
              else if (sourceVariant.link_suffix === "N") variantTitle = "NSF Certified"
              else if (sourceVariant.link_suffix === "P") variantTitle = "Steel"
              else if (sourceVariant.link_suffix === "T") variantTitle = "Tier 1 Verified"
              else if (sourceVariant.link_suffix === "B") variantTitle = "CAPA + Tier 1"

              const [newVariant] = await productModuleService.createProductVariants([{
                product_id: existingProduct.id,
                title: variantTitle,
                sku: sourceVariant.plink,
                manage_inventory: true,
                allow_backorder: false,
                metadata: {
                  ksi_no: sourceVariant.ksi_no,
                  hollander_no: group.hollander_no,
                },
              }])

              createdVariants++

              // Create price for new variant
              const costPrice = parseFloat(sourceVariant.cost_price) || 0
              const sellPrice = sourceVariant.is_quote_only ? 0 : (costPrice > 0 ? calculateSellPrice(costPrice, markup) : 0)
              if (sourceVariant.is_quote_only) quoteOnlyVariants++

              const priceSet = await pricingModuleService.createPriceSets({
                prices: [{ currency_code: "usd", amount: sellPrice }],
              })
              await remoteLink.create({
                [Modules.PRODUCT]: { variant_id: newVariant.id },
                [Modules.PRICING]: { price_set_id: priceSet.id },
              })

              // Create inventory item for new variant
              let invItem
              const existingInvItems = await inventoryService.listInventoryItems({ sku: newVariant.sku as string })
              if (existingInvItems.length > 0) {
                invItem = existingInvItems[0]
              } else {
                invItem = await inventoryService.createInventoryItems({
                  sku: newVariant.sku,
                  title: variantTitle,
                })
              }

              try {
                await remoteLink.create({
                  [Modules.PRODUCT]: { variant_id: newVariant.id },
                  [Modules.INVENTORY]: { inventory_item_id: invItem.id },
                })
              } catch { /* link may exist */ }

              const qty = parseQty(sourceVariant.ksi_qty, sourceVariant.ksi_district_qty)
              const lvls = await inventoryService.listInventoryLevels({
                inventory_item_id: invItem.id,
                location_id: stockLocationId,
              })
              if (lvls && lvls.length > 0) {
                await inventoryService.updateInventoryLevels([{
                  id: lvls[0].id,
                  inventory_item_id: invItem.id,
                  location_id: stockLocationId,
                  stocked_quantity: qty,
                }])
              } else {
                await inventoryService.createInventoryLevels([{
                  inventory_item_id: invItem.id,
                  location_id: stockLocationId,
                  stocked_quantity: qty,
                }])
              }
              createdInventoryItems++

              // Create supplier link for new variant
              if (sourceVariant.has_ksi && sourceVariant.ksi_no) {
                try {
                  await link.create({
                    [Modules.PRODUCT]: { product_variant_id: newVariant.id },
                    supplier: { supplier_id: ksiSupplier.id },
                    data: {
                      partslink_no: group.base_plink,
                      supplier_sku: sourceVariant.ksi_no,
                      oem_number: sourceVariant.oem,
                      cost_price: costPrice > 0 ? costPrice : null,
                      stock_qty: qty,
                      is_primary: true,
                    },
                  })
                  supplierLinks++
                } catch { /* may exist */ }
              }
            } catch (err: any) {
              if (errors < 5) logger.warn(`  New variant error ${sourceVariant.plink}: ${err.message}`)
              errors++
            }
            continue
          }

          updatedVariants++

          // Update variant metadata and flags
          try {
            await productModuleService.updateProductVariants(matchedVariant.id, {
              metadata: {
                ...(matchedVariant.metadata || {}),
                ksi_no: sourceVariant.ksi_no,
                hollander_no: group.hollander_no,
              },
              manage_inventory: true,
              allow_backorder: false,
            })
          } catch (err: any) {
            if (errors < 5) logger.warn(`  Variant metadata update error ${sourceVariant.plink}: ${err.message}`)
            errors++
          }

          const costPrice = parseFloat(sourceVariant.cost_price) || 0
          const sellPrice = sourceVariant.is_quote_only ? 0 : (costPrice > 0 ? calculateSellPrice(costPrice, markup) : 0)
          if (sourceVariant.is_quote_only) quoteOnlyVariants++

          // Update price
          try {
            const { data: variantPriceSets } = await query.graph({
              entity: "product_variant_price_set",
              fields: ["variant_id", "price_set_id"],
              filters: { variant_id: matchedVariant.id },
            })

            if (variantPriceSets && variantPriceSets.length > 0) {
              const priceSetId = (variantPriceSets[0] as any).price_set_id

              const { data: existingPrices } = await query.graph({
                entity: "price",
                fields: ["id", "currency_code", "amount"],
                filters: { price_set_id: priceSetId, currency_code: "usd" },
              })

              if (existingPrices && existingPrices.length > 0) {
                await (pricingModuleService as any).updatePrices([{
                  id: (existingPrices[0] as any).id,
                  amount: sellPrice,
                }])
              } else {
                await pricingModuleService.addPrices({
                  priceSetId,
                  prices: [{ currency_code: "usd", amount: sellPrice }],
                })
              }
            } else {
              // No price set exists - create one
              const priceSet = await pricingModuleService.createPriceSets({
                prices: [{ currency_code: "usd", amount: sellPrice }],
              })
              await remoteLink.create({
                [Modules.PRODUCT]: { variant_id: matchedVariant.id },
                [Modules.PRICING]: { price_set_id: priceSet.id },
              })
            }
          } catch (err: any) {
            if (errors < 5) logger.warn(`  Price update error ${sourceVariant.plink}: ${err.message}`)
            errors++
          }

          // Update inventory
          try {
            const { data: variantData } = await query.graph({
              entity: "product_variant",
              fields: ["id", "inventory_items.inventory_item_id"],
              filters: { id: matchedVariant.id },
            })

            const variantRecord = (variantData[0] as any)
            const inventoryItems = variantRecord?.inventory_items || []
            const qty = parseQty(sourceVariant.ksi_qty, sourceVariant.ksi_district_qty)

            if (inventoryItems.length > 0 && inventoryItems[0]?.inventory_item_id) {
              const inventoryItemId = inventoryItems[0].inventory_item_id

              // Check if level exists
              const existingLevels = await inventoryService.listInventoryLevels({
                inventory_item_id: inventoryItemId,
                location_id: stockLocationId,
              })

              if (existingLevels && existingLevels.length > 0) {
                await inventoryService.updateInventoryLevels([{
                  id: existingLevels[0].id,
                  inventory_item_id: inventoryItemId,
                  location_id: stockLocationId,
                  stocked_quantity: qty,
                }])
              } else {
                await inventoryService.createInventoryLevels([{
                  inventory_item_id: inventoryItemId,
                  location_id: stockLocationId,
                  stocked_quantity: qty,
                }])
              }
              updatedInventoryLevels++
            } else {
              // No inventory item linked - find existing by SKU or create
              let invItem
              const existingInvItems = await inventoryService.listInventoryItems({ sku: matchedVariant.sku })
              if (existingInvItems.length > 0) {
                invItem = existingInvItems[0]
              } else {
                invItem = await inventoryService.createInventoryItems({
                  sku: matchedVariant.sku,
                  title: matchedVariant.title || sourceVariant.plink,
                })
              }

              try {
                await remoteLink.create({
                  [Modules.PRODUCT]: { variant_id: matchedVariant.id },
                  [Modules.INVENTORY]: { inventory_item_id: invItem.id },
                })
              } catch {
                // Link may already exist
              }

              // Check if level exists before creating
              const lvls = await inventoryService.listInventoryLevels({
                inventory_item_id: invItem.id,
                location_id: stockLocationId,
              })
              if (lvls && lvls.length > 0) {
                await inventoryService.updateInventoryLevels([{
                  id: lvls[0].id,
                  inventory_item_id: invItem.id,
                  location_id: stockLocationId,
                  stocked_quantity: qty,
                }])
              } else {
                await inventoryService.createInventoryLevels([{
                  inventory_item_id: invItem.id,
                  location_id: stockLocationId,
                  stocked_quantity: qty,
                }])
              }
              createdInventoryItems++
            }
          } catch (err: any) {
            if (errors < 5) logger.warn(`  Inventory update error ${sourceVariant.plink}: ${err.message}`)
            errors++
          }

          // Update supplier link (direct SQL for existing, link.create for new)
          if (sourceVariant.has_ksi) {
            const qty = parseQty(sourceVariant.ksi_qty, sourceVariant.ksi_district_qty)
            try {
              const updateResult = await medusaPool.query(
                `UPDATE variant_supplier SET cost_price = $1, stock_qty = $2, supplier_sku = $3, updated_at = NOW()
                 WHERE product_variant_id = $4 AND supplier_id = $5`,
                [costPrice, qty, sourceVariant.ksi_no, matchedVariant.id, ksiSupplier.id]
              )

              if (updateResult.rowCount === 0) {
                // Link doesn't exist yet, create it
                await link.create({
                  [Modules.PRODUCT]: { product_variant_id: matchedVariant.id },
                  supplier: { supplier_id: ksiSupplier.id },
                  data: {
                    partslink_no: group.base_plink,
                    supplier_sku: sourceVariant.ksi_no,
                    oem_number: sourceVariant.oem,
                    cost_price: costPrice,
                    stock_qty: qty,
                    is_primary: true,
                  },
                })
              }
              supplierLinks++
            } catch (err: any) {
              if (!err.message?.includes("already exists") && !err.message?.includes("duplicate")) {
                if (errors < 5) logger.warn(`  Supplier link update error ${matchedVariant.id}: ${err.message}`)
                errors++
              }
            }
          }
        }

        // Delete stale variants (exist in Medusa but not in import data)
        const importSkus = new Set(group.variants.map(v => v.plink))
        const staleVariants = (existingProduct.variants || []).filter(
          (v: any) => v.sku && !importSkus.has(v.sku)
        )
        if (staleVariants.length > 0) {
          try {
            await deleteProductVariantsWorkflow(container).run({
              input: { ids: staleVariants.map((v: any) => v.id) },
            })
            deletedVariants += staleVariants.length
          } catch (err: any) {
            if (errors < 10) logger.warn(`  Stale variant delete error ${group.base_plink}: ${err.message}`)
            errors++
          }
        }

        // Full fitment sync — add new, update changed, delete removed
        try {
          // Load all existing fitments for this product
          const { data: existingFitmentLinks } = await query.graph({
            entity: "product_fitment",
            fields: [
              "fitment_id",
              "fitment.id",
              "fitment.vehicle_id",
              "fitment.conditions",
              "fitment.notes",
              "fitment.has_notes_notice",
            ],
            filters: { product_id: existingProduct.id },
          })

          // Build map of existing fitments keyed by vehicle_id|conditions
          const existingFitmentMap = new Map<string, any>()
          for (const link of (existingFitmentLinks ?? [])) {
            const l = link as any
            const f = l.fitment
            const fitmentId = l.fitment_id || f?.id
            if (!fitmentId || !f?.vehicle_id) continue
            const key = `${f.vehicle_id}|${f.conditions || ""}`
            existingFitmentMap.set(key, {
              fitment_id: fitmentId,
              vehicle_id: f.vehicle_id,
              conditions: f.conditions || null,
              notes: f.notes || null,
              has_notes_notice: f.has_notes_notice || false,
            })
          }

          // Build map of desired fitments from import data
          const desiredFitmentMap = new Map<string, any>()
          for (const f of group.fitments) {
            const makeId = makeNameMap.get(f.make.toUpperCase())
            if (!makeId) {
              fitmentSkips.noMake++
              if (fitmentSkips.noMake <= SKIP_LOG_LIMIT) {
                logger.warn(`  Fitment skip (make not found): ${f.make} for ${group.base_plink}`)
              }
              continue
            }

            const modelKey = `${makeId}|${f.model.toUpperCase()}`
            const modelId = modelKeyMap.get(modelKey)
            if (!modelId) {
              fitmentSkips.noModel++
              if (fitmentSkips.noModel <= SKIP_LOG_LIMIT) {
                logger.warn(`  Fitment skip (model not found): ${f.make} ${f.model} for ${group.base_plink}`)
              }
              continue
            }

            const yearStart = parseInt(f.y1)
            const yearEnd = parseInt(f.y2)
            if (isNaN(yearStart) || isNaN(yearEnd)) {
              fitmentSkips.invalidYear++
              if (fitmentSkips.invalidYear <= SKIP_LOG_LIMIT) {
                logger.warn(`  Fitment skip (invalid year): ${f.y1}-${f.y2} for ${group.base_plink}`)
              }
              continue
            }

            const vehicleKey = `${makeId}|${modelId}|${yearStart}|${yearEnd}`
            const vehicleId = vehicleKeyMap.get(vehicleKey)
            if (!vehicleId) {
              fitmentSkips.noVehicle++
              if (fitmentSkips.noVehicle <= SKIP_LOG_LIMIT) {
                logger.warn(`  Fitment skip (vehicle not found): ${f.make} ${f.model} ${f.y1}-${f.y2} for ${group.base_plink}`)
              }
              continue
            }

            const conditions = f.variables ? titleCase(f.variables) : null
            const key = `${vehicleId}|${conditions || ""}`
            desiredFitmentMap.set(key, {
              vehicle_id: vehicleId,
              conditions,
              notes: f.notes || null,
              has_notes: f.has_notes,
            })
          }

          // Add new fitments (in desired but not existing)
          for (const [key, desired] of desiredFitmentMap) {
            if (!existingFitmentMap.has(key)) {
              try {
                const fitment = await fitmentService.createFitments({
                  vehicle_id: desired.vehicle_id,
                  submodels: [] as unknown as Record<string, unknown>,
                  conditions: desired.conditions,
                  notes: desired.notes,
                  has_notes_notice: desired.has_notes,
                })

                await link.create({
                  [Modules.PRODUCT]: { product_id: existingProduct.id },
                  fitment: { fitment_id: fitment.id },
                })

                createdFitments++
              } catch (err: any) {
                if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
                  fitmentSkips.duplicate++
                } else {
                  if (errors < 10) logger.warn(`  Fitment create error ${group.base_plink}: ${err.message}`)
                  errors++
                }
              }
            }
          }

          // Update changed fitments (same key but different notes/has_notes_notice)
          for (const [key, desired] of desiredFitmentMap) {
            const existing = existingFitmentMap.get(key)
            if (!existing) continue

            const notesChanged = (existing.notes || "") !== (desired.notes || "")
            const hasNotesChanged = existing.has_notes_notice !== desired.has_notes

            if (notesChanged || hasNotesChanged) {
              try {
                await fitmentService.updateFitments({
                  id: existing.fitment_id,
                  notes: desired.notes,
                  has_notes_notice: desired.has_notes,
                })
                updatedFitments++
              } catch (err: any) {
                if (errors < 10) logger.warn(`  Fitment update error ${group.base_plink}: ${err.message}`)
                errors++
              }
            } else {
              fitmentSkips.duplicate++
            }
          }

          // Delete removed fitments (in existing but not desired)
          for (const [key, existing] of existingFitmentMap) {
            if (!desiredFitmentMap.has(key)) {
              try {
                // Remove the product-fitment link
                await link.dismiss({
                  [Modules.PRODUCT]: { product_id: existingProduct.id },
                  fitment: { fitment_id: existing.fitment_id },
                })
                // Delete the fitment itself
                await fitmentService.deleteFitments(existing.fitment_id)
                deletedFitments++
              } catch (err: any) {
                if (errors < 10) logger.warn(`  Fitment delete error ${group.base_plink}: ${err.message}`)
                errors++
              }
            }
          }
        } catch (err: any) {
          if (errors < 5) logger.warn(`  Fitment sync error ${group.base_plink}: ${err.message}`)
          errors++
        }
      } catch (err: any) {
        logger.error(`  Update error for ${group.base_plink}: ${err.message}`)
        errors++
      }
    }

    // Progress every 500 products
    const totalProcessed = createdProducts + updatedProducts
    if (totalProcessed > 0 && totalProcessed % 500 < BATCH_SIZE) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      const rate = (totalProcessed / ((Date.now() - startTime) / 1000)).toFixed(1)
      const remaining = productEntries.length - (batchStart + batch.length)
      const eta = (remaining / parseFloat(rate) / 60).toFixed(1)
      logger.info(
        `  Progress: ${totalProcessed}/${productEntries.length} (${rate}/s, ETA ${eta}m) | new: ${createdProducts} | updated: ${updatedProducts} | variants: ${createdVariants}+${updatedVariants} | fitments: ${createdFitments} | errors: ${errors}`
      )
    }

    if (errors >= 100) {
      logger.error(`  Too many errors (${errors}), stopping.`)
      break
    }
  }

  // ============================================================
  // Step 9: Delete products not in import_ready
  // ============================================================
  logger.info("\n--- Step 9: Cleanup — delete products not in import data ---")

  // Build set of all handles from import_ready
  const importHandles = new Set(
    productEntries.map(([basePlink]) => basePlink.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
  )

  // Only run full cleanup when not in test mode
  if (TEST_LIMIT === 0 && TEST_PLINKS.length === 0) {
    // Find products in Medusa not in import data
    const productsToDelete: string[] = []
    for (const [handle, product] of existingProductMap) {
      if (!importHandles.has(handle)) {
        productsToDelete.push(product.id)
      }
    }

    if (productsToDelete.length > 0) {
      logger.info(`  Found ${productsToDelete.length} products to delete (not in import data)`)

      // Delete in batches of 50
      const DELETE_BATCH = 50
      for (let i = 0; i < productsToDelete.length; i += DELETE_BATCH) {
        const batch = productsToDelete.slice(i, i + DELETE_BATCH)
        try {
          await deleteProductsWorkflow(container).run({
            input: { ids: batch },
          })
          deletedProducts += batch.length
        } catch (err: any) {
          logger.error(`  Delete batch error: ${err.message}`)
          errors++
        }
      }
      logger.info(`  Deleted ${deletedProducts} products`)

      // Clean up orphaned custom link data
      logger.info("  Cleaning up orphaned fitments and supplier links...")
      const orphanCleanup = await medusaPool.query(`
        -- Delete orphaned product-fitment links
        DELETE FROM product_product_fitment_fitment
        WHERE product_id NOT IN (SELECT id FROM product WHERE deleted_at IS NULL);

        -- Delete orphaned variant-supplier links
        DELETE FROM variant_supplier
        WHERE product_variant_id NOT IN (SELECT id FROM product_variant WHERE deleted_at IS NULL);

        -- Delete orphaned fitment records (not linked to any product)
        DELETE FROM fitment
        WHERE id NOT IN (SELECT fitment_id FROM product_product_fitment_fitment);
      `)
      logger.info("  Orphaned data cleaned up")
    } else {
      logger.info(`  No products to delete`)
    }

    // Delete empty categories (subcategories with no products)
    logger.info("  Checking for empty categories...")
    const { data: allCategories } = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "handle", "parent_category_id", "products.id"],
      pagination: { take: null as any },
    })

    // Delete empty subcategories first, then empty parents
    const emptySubCats = (allCategories as any[]).filter(
      (c) => c.parent_category_id && (!c.products || c.products.length === 0)
    )
    if (emptySubCats.length > 0) {
      for (const cat of emptySubCats) {
        try {
          await productModuleService.deleteProductCategories(cat.id)
          deletedCategories++
        } catch (err: any) {
          if (errors < 10) logger.warn(`  Category delete error ${cat.name}: ${err.message}`)
          errors++
        }
      }
      logger.info(`  Deleted ${deletedCategories} empty subcategories`)
    }

    // Now check parents
    const { data: remainingCats } = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "parent_category_id", "category_children.id"],
      filters: { parent_category_id: null as any },
      pagination: { take: null as any },
    })
    const emptyParents = (remainingCats as any[]).filter(
      (c) => !c.category_children || c.category_children.length === 0
    )
    if (emptyParents.length > 0) {
      for (const cat of emptyParents) {
        try {
          await productModuleService.deleteProductCategories(cat.id)
          deletedCategories++
        } catch (err: any) {
          if (errors < 10) logger.warn(`  Parent category delete error ${cat.name}: ${err.message}`)
          errors++
        }
      }
      logger.info(`  Deleted ${emptyParents.length} empty parent categories`)
    }
  } else {
    logger.info("  Skipping cleanup (test mode)")
  }

  // ============================================================
  // Cleanup DB connections
  // ============================================================
  await pool.end()
  await medusaPool.end()

  // ============================================================
  // Fitment skip summary
  // ============================================================
  logger.info("\n--- Fitment Skip Details ---")

  if (fitmentSkipLogs.noMake.length > 0) {
    logger.info(`\n  Skipped (make not found) - first ${Math.min(fitmentSkipLogs.noMake.length, SKIP_LOG_LIMIT)}:`)
    for (const msg of fitmentSkipLogs.noMake) logger.info(`    ${msg}`)
  }
  if (fitmentSkipLogs.noModel.length > 0) {
    logger.info(`\n  Skipped (model not found) - first ${Math.min(fitmentSkipLogs.noModel.length, SKIP_LOG_LIMIT)}:`)
    for (const msg of fitmentSkipLogs.noModel) logger.info(`    ${msg}`)
  }
  if (fitmentSkipLogs.noVehicle.length > 0) {
    logger.info(`\n  Skipped (vehicle not found) - first ${Math.min(fitmentSkipLogs.noVehicle.length, SKIP_LOG_LIMIT)}:`)
    for (const msg of fitmentSkipLogs.noVehicle) logger.info(`    ${msg}`)
  }
  if (fitmentSkipLogs.invalidYear.length > 0) {
    logger.info(`\n  Skipped (invalid year) - first ${Math.min(fitmentSkipLogs.invalidYear.length, SKIP_LOG_LIMIT)}:`)
    for (const msg of fitmentSkipLogs.invalidYear) logger.info(`    ${msg}`)
  }

  logger.info("\n--- Fitment Skip Summary ---")
  logger.info(`  No make found:    ${fitmentSkips.noMake}`)
  logger.info(`  No model found:   ${fitmentSkips.noModel}`)
  logger.info(`  No vehicle found: ${fitmentSkips.noVehicle}`)
  logger.info(`  Invalid year:     ${fitmentSkips.invalidYear}`)
  logger.info(`  Duplicate:        ${fitmentSkips.duplicate}`)
  logger.info(`  Total skipped:    ${fitmentSkips.noMake + fitmentSkips.noModel + fitmentSkips.noVehicle + fitmentSkips.invalidYear + fitmentSkips.duplicate}`)

  // ============================================================
  // Final summary
  // ============================================================
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  logger.info("\n=== Import Complete ===")
  logger.info(`Time:                ${totalTime} minutes`)
  logger.info(`Products created:    ${createdProducts}`)
  logger.info(`Products updated:    ${updatedProducts}`)
  logger.info(`Variants created:    ${createdVariants}`)
  logger.info(`Variants updated:    ${updatedVariants}`)
  logger.info(`Quote-only variants: ${quoteOnlyVariants}`)
  logger.info(`Inventory created:   ${createdInventoryItems}`)
  logger.info(`Inventory updated:   ${updatedInventoryLevels}`)
  logger.info(`Supplier links:      ${supplierLinks}`)
  logger.info(`Fitments created:    ${createdFitments}`)
  logger.info(`Fitments updated:    ${updatedFitments}`)
  logger.info(`Fitments deleted:    ${deletedFitments}`)
  logger.info(`Variants deleted:    ${deletedVariants}`)
  logger.info(`Products deleted:    ${deletedProducts}`)
  logger.info(`Categories deleted:  ${deletedCategories}`)
  logger.info(`Errors:              ${errors}`)

  // ============================================================
  // Set CAPA Certified variants to rank first
  // ============================================================
  logger.info("\n--- Setting CAPA variant rank ---")
  try {
    const rankResult = await medusaPool.query(`
      UPDATE product_variant pv
      SET variant_rank = 1
      FROM product_variant_option pvo
      JOIN product_option_value pov ON pov.id = pvo.option_value_id
      JOIN product_option po ON po.id = pov.option_id
      WHERE pvo.variant_id = pv.id
        AND po.title = 'Certification'
        AND pov.value = 'CAPA Certified'
        AND (pv.variant_rank IS NULL OR pv.variant_rank != 1)
    `)
    logger.info(`  Updated ${rankResult.rowCount} CAPA variants to rank 1`)
  } catch (err: any) {
    logger.error(`  CAPA rank update failed: ${err.message}`)
    errors++
  }

  // ============================================================
  // Reindex Meilisearch
  // ============================================================
  logger.info("\n--- Reindexing Meilisearch ---")
  try {
    execSync("npm run reindex", {
      cwd: "/var/www/arrotti/my-medusa-store",
      stdio: "inherit",
    })
    logger.info("  Meilisearch reindex complete.")
  } catch (err: any) {
    logger.error(`  Meilisearch reindex failed: ${err.message}`)
  }

  logger.info("\n=== Done ===")
}
