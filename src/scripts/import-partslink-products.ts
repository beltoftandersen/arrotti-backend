/**
 * Import products from Partslink DBF file
 *
 * Prerequisites: Run this Python command first to export the DBF to JSON:
 *   python3 -c "
 *   import json
 *   from dbfread import DBF
 *   db = DBF('/root/Partslink Sample Database/NEW/US/DBF/2107NEWA.DBF')
 *   records = [dict(r) for r in db]
 *   print(json.dumps(records))
 *   " > /tmp/partslink-products.json
 *
 * Usage: npx medusa exec ./src/scripts/import-partslink-products.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { FITMENT_MODULE } from "../modules/fitment"
import FitmentModuleService from "../modules/fitment/service"
import * as fs from "fs"

type PartslinkRecord = {
  MAKE: string
  MODEL: string
  Y1: string
  Y2: string
  VARIABLES: string
  PNAME: string
  PLINK: string
  OEM: string
  PTYPE: string
  NOTES: string
  MFG: string
}

/**
 * Parse VARIABLES field into submodels and features
 * Format: "XLE|HYBRID XLE; w/Parking Sensors; prime"
 * - Pipe-separated values before first semicolon = submodels
 * - Semicolon-separated values after = features
 */
function parseVariables(variables: string): { submodels: string[]; features: string[] } {
  if (!variables || !variables.trim()) {
    return { submodels: [], features: [] }
  }

  const parts = variables.split(";").map((p) => p.trim()).filter(Boolean)

  if (parts.length === 0) {
    return { submodels: [], features: [] }
  }

  // First part contains submodels (pipe-separated)
  const submodels = parts[0].split("|").map((s) => s.trim()).filter(Boolean)

  // Remaining parts are features
  const features = parts.slice(1).map((f) => f.trim()).filter(Boolean)

  return { submodels, features }
}

export default async function importPartslinkProducts({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fitmentService: FitmentModuleService = container.resolve(FITMENT_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  // Get product module service for creating products
  const productModuleService = container.resolve(Modules.PRODUCT)
  const categoryService = container.resolve(Modules.PRODUCT)

  logger.info("Starting Partslink products import...")

  // Read from pre-generated JSON file
  const jsonPath = "/tmp/partslink-products.json"

  if (!fs.existsSync(jsonPath)) {
    logger.error(`JSON file not found at ${jsonPath}. Please run the Python export script first.`)
    logger.info(`Run: python3 -c "import json; from dbfread import DBF; db = DBF('/root/Partslink Sample Database/NEW/US/DBF/2107NEWA.DBF'); records = [dict(r) for r in db]; print(json.dumps(records))" > /tmp/partslink-products.json`)
    throw new Error(`File not found: ${jsonPath}`)
  }

  let records: PartslinkRecord[]

  try {
    const content = fs.readFileSync(jsonPath, "utf-8")
    records = JSON.parse(content)
  } catch (error) {
    logger.error("Failed to read JSON file:", error)
    throw error
  }

  logger.info(`Found ${records.length} records to import`)

  // Load existing makes and models into maps for quick lookup
  const existingMakes = await fitmentService.listVehicleMakes()
  const makeNameMap = new Map<string, string>() // name (lowercase) -> id
  for (const make of existingMakes) {
    makeNameMap.set(make.name.toLowerCase(), make.id)
  }

  const existingModels = await fitmentService.listVehicleModels()
  const modelKeyMap = new Map<string, string>() // "make_id|model_name (lowercase)" -> id
  for (const model of existingModels) {
    modelKeyMap.set(`${model.make_id}|${model.name.toLowerCase()}`, model.id)
  }

  // Cache for categories by PTYPE
  const categoryMap = new Map<string, string>() // ptype -> category_id

  // Load existing categories
  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "metadata"],
  })

  for (const cat of existingCategories || []) {
    const ptype = (cat as any).metadata?.ptype
    if (ptype) {
      categoryMap.set(ptype, (cat as any).id)
    }
  }

  // Get default sales channel
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const [defaultSalesChannel] = await salesChannelService.listSalesChannels({
    is_disabled: false,
  })
  const defaultSalesChannelId = defaultSalesChannel?.id

  // Get shipping profile
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const [shippingProfile] = await fulfillmentService.listShippingProfiles({})

  if (!shippingProfile) {
    logger.error("No shipping profile found. Please create one first.")
    throw new Error("No shipping profile found")
  }

  // Track stats
  let createdProducts = 0
  let createdFitments = 0
  let createdVehicles = 0
  let createdCategories = 0
  let skippedDuplicates = 0
  let errors = 0

  // Group records by PLINK (partslink number) to avoid duplicate products
  const recordsByPlink = new Map<string, PartslinkRecord[]>()
  for (const record of records) {
    const plink = record.PLINK?.trim()
    if (!plink) continue

    if (!recordsByPlink.has(plink)) {
      recordsByPlink.set(plink, [])
    }
    recordsByPlink.get(plink)!.push(record)
  }

  logger.info(`Found ${recordsByPlink.size} unique products (by PLINK)`)

  // Process each unique product
  let processed = 0
  for (const [plink, plinkRecords] of recordsByPlink) {
    processed++
    if (processed % 100 === 0) {
      logger.info(`Processing ${processed}/${recordsByPlink.size}...`)
    }

    try {
      const firstRecord = plinkRecords[0]

      // Get or create category based on PTYPE
      const ptype = firstRecord.PTYPE?.trim()
      let categoryId: string | undefined

      if (ptype && !categoryMap.has(ptype)) {
        // Create category with PTYPE as handle and PNAME as initial name
        // Note: Multiple PTYPEs might have different PNAMEs, we use the first one
        try {
          const category = await productModuleService.createProductCategories({
            name: firstRecord.PNAME?.trim() || `Category ${ptype}`,
            handle: `ptype-${ptype}`,
            is_active: true,
            metadata: { ptype },
          })
          categoryMap.set(ptype, category.id)
          categoryId = category.id
          createdCategories++
        } catch (err: any) {
          // Category might already exist
          if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
            const { data: cats } = await query.graph({
              entity: "product_category",
              fields: ["id"],
              filters: { handle: `ptype-${ptype}` },
            })
            if (cats?.[0]) {
              categoryMap.set(ptype, (cats[0] as any).id)
              categoryId = (cats[0] as any).id
            }
          }
        }
      } else if (ptype) {
        categoryId = categoryMap.get(ptype)
      }

      // Create the product using workflow
      const { result: products } = await createProductsWorkflow(container).run({
        input: {
          products: [{
            title: firstRecord.PNAME?.trim() || plink,
            handle: plink.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            status: ProductStatus.PUBLISHED,
            metadata: {
              partslink_no: plink,
              oem_number: firstRecord.OEM?.trim() || null,
            },
            category_ids: categoryId ? [categoryId] : [],
            shipping_profile_id: shippingProfile.id,
            options: [{ title: "Default", values: ["Standard"] }],
            variants: [{
              title: "Standard",
              sku: plink,
              options: { Default: "Standard" },
              manage_inventory: false,
              prices: [
                { currency_code: "usd", amount: 9999 }, // $99.99
                { currency_code: "eur", amount: 9499 }, // €94.99
              ],
            }],
          }],
        },
      })
      const product = products[0]

      createdProducts++

      // Add to default sales channel if available
      if (defaultSalesChannelId) {
        try {
          await link.create({
            [Modules.PRODUCT]: { product_id: product.id },
            [Modules.SALES_CHANNEL]: { sales_channel_id: defaultSalesChannelId },
          })
        } catch (err) {
          // Ignore if link already exists
        }
      }

      // Create fitments for each record with this PLINK
      for (const record of plinkRecords) {
        const makeName = record.MAKE?.trim()
        const modelName = record.MODEL?.trim()
        const yearStart = parseInt(record.Y1, 10)
        const yearEnd = parseInt(record.Y2, 10) || yearStart

        if (!makeName || !modelName || isNaN(yearStart)) {
          continue
        }

        // Find make
        const makeId = makeNameMap.get(makeName.toLowerCase())
        if (!makeId) {
          logger.warn(`Make not found: ${makeName}`)
          continue
        }

        // Find or create model
        const modelKey = `${makeId}|${modelName.toLowerCase()}`
        let modelId = modelKeyMap.get(modelKey)

        if (!modelId) {
          try {
            const model = await fitmentService.createVehicleModels({
              name: modelName,
              make_id: makeId,
            })
            modelId = model.id
            modelKeyMap.set(modelKey, modelId)
          } catch (err: any) {
            if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
              const models = await fitmentService.listVehicleModels({ make_id: makeId })
              const found = models.find((m) => m.name.toLowerCase() === modelName.toLowerCase())
              if (found) {
                modelId = found.id
                modelKeyMap.set(modelKey, modelId)
              }
            }
            if (!modelId) {
              logger.warn(`Failed to create model: ${modelName} for ${makeName}`)
              continue
            }
          }
        }

        // Find or create vehicle
        const existingVehicles = await fitmentService.listVehicles({
          make_id: makeId,
          model_id: modelId,
          year_start: yearStart,
          year_end: yearEnd,
        })

        let vehicleId: string
        if (existingVehicles[0]) {
          vehicleId = existingVehicles[0].id
        } else {
          try {
            const vehicle = await fitmentService.createVehicles({
              make_id: makeId,
              model_id: modelId,
              year_start: yearStart,
              year_end: yearEnd,
            })
            vehicleId = vehicle.id
            createdVehicles++
          } catch (err: any) {
            if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
              const vehicles = await fitmentService.listVehicles({
                make_id: makeId,
                model_id: modelId,
                year_start: yearStart,
                year_end: yearEnd,
              })
              if (vehicles[0]) {
                vehicleId = vehicles[0].id
              } else {
                continue
              }
            } else {
              continue
            }
          }
        }

        // Parse VARIABLES into submodels and conditions (features)
        const { submodels, features } = parseVariables(record.VARIABLES)
        // Convert features array to conditions string (joined with "; ")
        const conditions = features.length > 0 ? features.join("; ") : null

        // Create fitment
        try {
          const fitment = await fitmentService.createFitments({
            vehicle_id: vehicleId,
            submodels: submodels as unknown as Record<string, unknown>,
            conditions,
            variables_raw: record.VARIABLES?.trim() || null,
            notes: record.NOTES?.trim() || null,
          })

          // Link fitment to product
          await link.create({
            [Modules.PRODUCT]: { product_id: product.id },
            fitment: { fitment_id: fitment.id },
          })

          createdFitments++
        } catch (err: any) {
          if (err.message?.includes("unique") || err.message?.includes("duplicate")) {
            skippedDuplicates++
          } else {
            logger.warn(`Failed to create fitment for ${plink}: ${err.message}`)
            errors++
          }
        }
      }
    } catch (err: any) {
      logger.error(`Error processing PLINK ${plink}: ${err.message}`)
      errors++
    }
  }

  logger.info("Import complete!")
  logger.info(`  Products created: ${createdProducts}`)
  logger.info(`  Categories created: ${createdCategories}`)
  logger.info(`  Vehicles created: ${createdVehicles}`)
  logger.info(`  Fitments created: ${createdFitments}`)
  logger.info(`  Duplicates skipped: ${skippedDuplicates}`)
  logger.info(`  Errors: ${errors}`)
}
