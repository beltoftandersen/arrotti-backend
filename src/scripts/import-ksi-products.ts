/**
 * Import products from KSI PostgreSQL database (ksi_data.ksi_product)
 *
 * Prerequisites:
 *   1. Run the Python conversion script to populate ksi_product table
 *   2. Ensure categories exist in Medusa (run import-categories.ts first)
 *   3. Ensure KSI supplier exists with default_markup set (e.g., 30%)
 *
 * Usage: npx medusa exec ./src/scripts/import-ksi-products.ts
 *
 * Features:
 * - Reads directly from PostgreSQL ksi_product table
 * - Uses category_handle for direct category assignment
 * - Handles CAPA variants (is_capa flag) as product variants
 * - Creates vehicles and fitments with submodels/conditions
 * - Links products to default sales channel
 * - Creates variant-supplier links with:
 *   - cost_price: from KSI price field
 *   - stock_qty: from KSI qty field (supplier's available stock)
 *   - partslink_no, supplier_sku (ksi_no)
 * - Auto-pricing: Selling price = cost_price × (1 + supplier markup%)
 *
 * NOTE: Medusa inventory is NOT set during import. The stock_qty on
 * variant_supplier is the supplier's stock level (used for supplier
 * selection logic when multiple suppliers exist). Medusa inventory
 * should be managed separately when stock is received at your warehouse.
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { FITMENT_MODULE } from "../modules/fitment"
import FitmentModuleService from "../modules/fitment/service"
import { SUPPLIER_MODULE } from "../modules/supplier"
import SupplierModuleService from "../modules/supplier/service"
import { recalculateVariantPrice } from "../services/auto-pricing"
import pg from "pg"
import * as fs from "fs"

const { Pool } = pg

// KSI product row from PostgreSQL
interface KSIProductRow {
  id: number
  ksi_no: string
  link_no: string
  hollander_no: string | null
  ptype: string | null
  title_raw: string | null
  title: string
  is_capa: boolean
  price: number
  qty: number
  district_quantity: number
  make_raw: string | null
  make_name: string | null
  model_raw: string | null
  model_name: string | null
  submodel: string | null
  year_start: number | null
  year_end: number | null
  category_handle: string | null
  conditions: string | null
}

// Grouped product with variants
interface GroupedProduct {
  base_link_no: string
  standard: KSIProductRow | null
  capa: KSIProductRow | null
  fitments: Array<{
    make_name: string
    model_name: string
    year_start: number
    year_end: number
    submodel: string | null
    conditions: string | null
  }>
}

export default async function importKSIProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fitmentService: FitmentModuleService = container.resolve(FITMENT_MODULE)
  const supplierService: SupplierModuleService = container.resolve(SUPPLIER_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productModuleService = container.resolve(Modules.PRODUCT)

  logger.info("=== KSI Product Import (PostgreSQL) ===\n")

  // Connect to KSI database
  const pool = new Pool({
    database: "ksi_data",
    user: "medusa",
    password: "medusa123",
    host: "localhost",
  })

  // Get total count
  const countResult = await pool.query("SELECT COUNT(*) FROM ksi_product")
  const totalRows = parseInt(countResult.rows[0].count)
  logger.info(`Total rows in ksi_product: ${totalRows.toLocaleString()}`)

  // Load category handle to ID mapping from JSON file (has flat handles)
  logger.info("\nLoading category mappings...")
  const handleMappingPath = "/root/data/handle_to_category_id.json"
  const handleMappingData = fs.readFileSync(handleMappingPath, "utf-8")
  const handleMappingJson = JSON.parse(handleMappingData) as Record<string, string>

  const categoryHandleToId = new Map<string, string>()
  for (const [handle, id] of Object.entries(handleMappingJson)) {
    categoryHandleToId.set(handle, id)
  }
  logger.info(`  ${categoryHandleToId.size} categories loaded from ${handleMappingPath}`)

  // Get or create KSI supplier
  let ksiSupplier = (await supplierService.listSuppliers({ code: "KSI" }))[0]
  if (!ksiSupplier) {
    ksiSupplier = await supplierService.createSuppliers({
      name: "KSI Auto Parts",
      code: "KSI",
    })
    logger.info(`Created KSI supplier: ${ksiSupplier.id}`)
  }

  // Load existing makes and models for quick lookup
  logger.info("\nLoading existing vehicle data...")
  const existingMakes = await fitmentService.listVehicleMakes()
  const makeNameMap = new Map<string, string>()
  for (const make of existingMakes) {
    makeNameMap.set(make.name.toUpperCase(), make.id)
  }
  logger.info(`  ${makeNameMap.size} makes loaded`)

  const existingModels = await fitmentService.listVehicleModels()
  const modelKeyMap = new Map<string, string>()
  for (const model of existingModels) {
    const key = `${model.make_id}|${model.name.toUpperCase()}`
    modelKeyMap.set(key, model.id)
  }
  logger.info(`  ${modelKeyMap.size} models loaded`)

  // Load existing vehicles
  const existingVehicles = await fitmentService.listVehicles({})
  const vehicleKeyMap = new Map<string, string>()
  for (const v of existingVehicles) {
    const key = `${v.make_id}|${v.model_id}|${v.year_start}|${v.year_end}`
    vehicleKeyMap.set(key, v.id)
  }
  logger.info(`  ${vehicleKeyMap.size} vehicles loaded`)

  // Get default sales channel
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const [defaultSalesChannel] = await salesChannelService.listSalesChannels({ is_disabled: false })
  const defaultSalesChannelId = defaultSalesChannel?.id
  logger.info(`  Default sales channel: ${defaultSalesChannelId || "none"}`)

  // Get shipping profile
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const [shippingProfile] = await fulfillmentService.listShippingProfiles({})
  if (!shippingProfile) {
    logger.error("No shipping profile found. Please create one first.")
    await pool.end()
    throw new Error("No shipping profile found")
  }

  // NOTE: Medusa inventory is NOT set during import
  // Supplier stock is tracked via variant_supplier.stock_qty for auto-pricing selection
  // Medusa inventory should be managed separately when stock is received at warehouse

  // Track stats
  let createdProducts = 0
  let createdVariants = 0
  let createdMakes = 0
  let createdModels = 0
  let createdVehicles = 0
  let createdFitments = 0
  let skippedNoCategory = 0
  let skippedNoMakeModel = 0
  let errors = 0

  // Query products and group by base link_no
  // TEST MODE: Set to 0 for full import, or a number to limit unique products
  const TEST_LIMIT = 0

  logger.info("\nLoading and grouping products...")
  if (TEST_LIMIT > 0) {
    logger.info(`  TEST MODE: Limiting to ~${TEST_LIMIT} unique products`)
  }

  const productsResult = await pool.query<KSIProductRow>(`
    SELECT * FROM ksi_product
    WHERE category_handle IS NOT NULL
      AND make_name IS NOT NULL
      AND model_name IS NOT NULL
      AND link_no IS NOT NULL
    ORDER BY link_no
    ${TEST_LIMIT > 0 ? `LIMIT ${TEST_LIMIT * 3}` : ''}
  `)

  const rows = productsResult.rows
  logger.info(`  ${rows.length.toLocaleString()} rows with category and make/model`)

  // Group by base link_no (remove trailing 'C' for CAPA)
  const groupedProducts = new Map<string, GroupedProduct>()

  for (const row of rows) {
    // Determine base link_no (strip 'C' suffix if CAPA)
    const baseLink = row.is_capa && row.link_no.endsWith("C")
      ? row.link_no.slice(0, -1)
      : row.link_no

    if (!groupedProducts.has(baseLink)) {
      groupedProducts.set(baseLink, {
        base_link_no: baseLink,
        standard: null,
        capa: null,
        fitments: [],
      })
    }

    const group = groupedProducts.get(baseLink)!

    if (row.is_capa) {
      group.capa = row
    } else {
      group.standard = row
    }

    // Add fitment data if not already present
    if (row.make_name && row.model_name && row.year_start && row.year_end) {
      const fitmentKey = `${row.make_name}|${row.model_name}|${row.year_start}|${row.year_end}|${row.submodel || ""}|${row.conditions || ""}`
      const existingFitment = group.fitments.find(f =>
        `${f.make_name}|${f.model_name}|${f.year_start}|${f.year_end}|${f.submodel || ""}|${f.conditions || ""}` === fitmentKey
      )
      if (!existingFitment) {
        group.fitments.push({
          make_name: row.make_name,
          model_name: row.model_name,
          year_start: row.year_start,
          year_end: row.year_end,
          submodel: row.submodel,
          conditions: row.conditions,
        })
      }
    }
  }

  logger.info(`  ${groupedProducts.size.toLocaleString()} unique products (grouped)`)
  logger.info("\nStarting import...\n")

  let processed = 0
  const batchSize = 500

  for (const [baseLink, group] of groupedProducts) {
    // Test mode: stop after limit
    if (TEST_LIMIT > 0 && createdProducts >= TEST_LIMIT) {
      logger.info(`\nTest limit reached (${TEST_LIMIT} products). Stopping.`)
      break
    }

    processed++
    if (processed % batchSize === 0) {
      logger.info(`Progress: ${processed.toLocaleString()}/${groupedProducts.size.toLocaleString()} (${Math.round(processed / groupedProducts.size * 100)}%)`)
    }

    try {
      // Use standard variant as base, or CAPA if no standard exists
      const baseProduct = group.standard || group.capa
      if (!baseProduct) continue

      // Get category ID from handle
      const categoryId = categoryHandleToId.get(baseProduct.category_handle!)
      if (!categoryId) {
        skippedNoCategory++
        continue
      }

      // Build variants array
      const variants: Array<{
        title: string
        sku: string
        options: Record<string, string>
        manage_inventory: boolean
        prices: Array<{ currency_code: string; amount: number }>
        metadata: Record<string, unknown>
      }> = []

      // Add standard variant if exists
      if (group.standard) {
        const price = group.standard.price || 0
        variants.push({
          title: "Standard",
          sku: group.standard.link_no,
          options: { Certification: "Standard" },
          manage_inventory: true,
          prices: [
            { currency_code: "usd", amount: price > 0 ? price : 99.99 },
          ],
          metadata: {
            ksi_no: group.standard.ksi_no,
            hollander_no: group.standard.hollander_no,
          },
        })
      }

      // Add CAPA variant if exists
      if (group.capa) {
        const price = group.capa.price || 0
        variants.push({
          title: "CAPA Certified",
          sku: group.capa.link_no,
          options: { Certification: "CAPA Certified" },
          manage_inventory: true,
          prices: [
            { currency_code: "usd", amount: price > 0 ? price : 99.99 },
          ],
          metadata: {
            ksi_no: group.capa.ksi_no,
            hollander_no: group.capa.hollander_no,
            capa: true,
          },
        })
        if (group.standard) createdVariants++ // Count as extra variant only if standard also exists
      }

      // Create product handle from partslink
      const handle = baseLink.toLowerCase().replace(/[^a-z0-9]+/g, "-")

      // Create the product
      const { result: createdProductsResult } = await createProductsWorkflow(container).run({
        input: {
          products: [{
            title: baseProduct.title,
            handle,
            status: ProductStatus.PUBLISHED,
            metadata: {
              partslink_no: baseLink,
              hollander_no: baseProduct.hollander_no,
              ptype: baseProduct.ptype,
              ksi_no: baseProduct.ksi_no,
              conditions: baseProduct.conditions,
              title_raw: baseProduct.title_raw,
            },
            category_ids: [categoryId],
            shipping_profile_id: shippingProfile.id,
            options: variants.length > 1 || group.capa
              ? [{ title: "Certification", values: ["Standard", "CAPA Certified"] }]
              : [{ title: "Certification", values: ["Standard"] }],
            variants,
          }],
        },
      })

      const product = createdProductsResult[0]
      createdProducts++

      // NOTE: Supplier stock is tracked via variant_supplier.stock_qty
      // Medusa inventory levels are NOT set during import - they should be
      // managed separately when stock is actually received at your warehouse

      // Link to sales channel
      if (defaultSalesChannelId) {
        try {
          await link.create({
            [Modules.PRODUCT]: { product_id: product.id },
            [Modules.SALES_CHANNEL]: { sales_channel_id: defaultSalesChannelId },
          })
        } catch {
          // Link might already exist
        }
      }

      // Link each variant to KSI supplier with cost and stock data
      for (const variant of product.variants || []) {
        try {
          // Find the matching source variant data to get cost and qty
          const sourceVariant = group.standard?.link_no === variant.sku
            ? group.standard
            : group.capa?.link_no === variant.sku
              ? group.capa
              : null

          if (!sourceVariant) continue

          // KSI price is the cost price, stock is supplier's available qty
          const costPrice = sourceVariant.price || 0
          const stockQty = sourceVariant.qty || 0

          // Create variant-supplier link with cost and stock data
          await link.create({
            [Modules.PRODUCT]: { product_variant_id: variant.id },
            supplier: { supplier_id: ksiSupplier.id },
            data: {
              partslink_no: baseLink,
              supplier_sku: sourceVariant.ksi_no,
              cost_price: costPrice > 0 ? costPrice : null,
              stock_qty: stockQty,
              is_primary: true,
            },
          })

          // Auto-calculate selling price from cost + supplier markup
          if (costPrice > 0) {
            await recalculateVariantPrice(container, variant.id, "usd")
          }
        } catch (linkErr: any) {
          if (!linkErr.message?.includes("already exists") && !linkErr.message?.includes("duplicate")) {
            logger.warn(`Variant supplier link error for ${variant.id}: ${linkErr.message}`)
          }
        }
      }

      // Create fitments
      for (const fitmentData of group.fitments) {
        try {
          // Find or create make
          let makeId = makeNameMap.get(fitmentData.make_name.toUpperCase())
          if (!makeId) {
            try {
              const make = await fitmentService.createVehicleMakes({ name: fitmentData.make_name })
              makeId = make.id
              makeNameMap.set(fitmentData.make_name.toUpperCase(), makeId)
              createdMakes++
            } catch (err: any) {
              if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
                const makes = await fitmentService.listVehicleMakes()
                const found = makes.find(m => m.name.toUpperCase() === fitmentData.make_name.toUpperCase())
                if (found) {
                  makeId = found.id
                  makeNameMap.set(fitmentData.make_name.toUpperCase(), makeId)
                }
              }
              if (!makeId) continue
            }
          }

          // Find or create model
          const modelKey = `${makeId}|${fitmentData.model_name.toUpperCase()}`
          let modelId = modelKeyMap.get(modelKey)
          if (!modelId) {
            try {
              const model = await fitmentService.createVehicleModels({
                name: fitmentData.model_name,
                make_id: makeId,
              })
              modelId = model.id
              modelKeyMap.set(modelKey, modelId)
              createdModels++
            } catch (err: any) {
              if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
                const models = await fitmentService.listVehicleModels({ make_id: makeId })
                const found = models.find(m => m.name.toUpperCase() === fitmentData.model_name.toUpperCase())
                if (found) {
                  modelId = found.id
                  modelKeyMap.set(modelKey, modelId)
                }
              }
              if (!modelId) continue
            }
          }

          // Find or create vehicle
          const vehicleKey = `${makeId}|${modelId}|${fitmentData.year_start}|${fitmentData.year_end}`
          let vehicleId = vehicleKeyMap.get(vehicleKey)
          if (!vehicleId) {
            try {
              const vehicle = await fitmentService.createVehicles({
                make_id: makeId,
                model_id: modelId,
                year_start: fitmentData.year_start,
                year_end: fitmentData.year_end,
              })
              vehicleId = vehicle.id
              vehicleKeyMap.set(vehicleKey, vehicleId)
              createdVehicles++
            } catch (err: any) {
              if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
                const vehicles = await fitmentService.listVehicles({
                  make_id: makeId,
                  model_id: modelId,
                  year_start: fitmentData.year_start,
                  year_end: fitmentData.year_end,
                })
                if (vehicles[0]) {
                  vehicleId = vehicles[0].id
                  vehicleKeyMap.set(vehicleKey, vehicleId)
                }
              }
              if (!vehicleId) continue
            }
          }

          // Parse submodels into array
          const submodelsArray = fitmentData.submodel
            ? fitmentData.submodel.split(";").map(s => s.trim()).filter(Boolean)
            : []

          // Create fitment
          const fitment = await fitmentService.createFitments({
            vehicle_id: vehicleId,
            submodels: submodelsArray as unknown as Record<string, unknown>,
            conditions: fitmentData.conditions,
            has_notes_notice: false,
            notes: null,
          })

          // Link fitment to product
          await link.create({
            [Modules.PRODUCT]: { product_id: product.id },
            fitment: { fitment_id: fitment.id },
          })

          createdFitments++
        } catch (err: any) {
          if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
            if (errors < 10) {
              logger.warn(`Fitment error for ${baseLink}: ${err.message}`)
            }
            errors++
          }
        }
      }
    } catch (err: any) {
      if (errors < 10) {
        logger.error(`Error processing ${baseLink}: ${err.message}`)
      }
      errors++
    }
  }

  await pool.end()

  logger.info("\n=== Import Complete ===")
  logger.info(`Products created: ${createdProducts.toLocaleString()}`)
  logger.info(`CAPA variants added: ${createdVariants.toLocaleString()}`)
  logger.info(`Makes created: ${createdMakes.toLocaleString()}`)
  logger.info(`Models created: ${createdModels.toLocaleString()}`)
  logger.info(`Vehicles created: ${createdVehicles.toLocaleString()}`)
  logger.info(`Fitments created: ${createdFitments.toLocaleString()}`)
  logger.info(`Skipped (no category): ${skippedNoCategory.toLocaleString()}`)
  logger.info(`Skipped (no make/model): ${skippedNoMakeModel.toLocaleString()}`)
  logger.info(`Errors: ${errors.toLocaleString()}`)

  return {
    createdProducts,
    createdVariants,
    createdMakes,
    createdModels,
    createdVehicles,
    createdFitments,
    skippedNoCategory,
    errors,
  }
}
