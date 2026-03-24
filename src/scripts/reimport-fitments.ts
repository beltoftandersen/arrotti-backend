/**
 * Re-import fitments with correct VARIABLES parsing
 *
 * This script:
 * 1. Deletes all existing fitments
 * 2. Re-parses VARIABLES from Partslink DBF
 * 3. Creates fitments with correct submodels[] and conditions
 *
 * Prerequisites: Export products JSON first:
 *   python3 -c "
 *   import json
 *   from dbfread import DBF
 *   db = DBF('/root/Partslink Sample Database/NEW/US/DBF/2107NEWA.DBF', encoding='latin-1')
 *   records = [dict(r) for r in db]
 *   print(json.dumps(records))
 *   " > /tmp/partslink-products.json
 *
 * Usage: npx medusa exec ./src/scripts/reimport-fitments.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../modules/fitment"
import FitmentModuleService from "../modules/fitment/service"
import * as fs from "fs"

// Known trim/submodel values
const KNOWN_TRIMS = new Set([
  'L', 'LE', 'SE', 'XLE', 'XSE', 'XLS',
  'HYBRID', 'HYBRID L', 'HYBRID LE', 'HYBRID SE', 'HYBRID XLE', 'HYBRID XSE',
  'TRD', 'SPECIAL EDITION', 'SE NIGHTSHADE'
])

type PartslinkRecord = {
  MAKE: string
  MODEL: string
  Y1: string
  Y2: string
  VARIABLES: string
  PNAME: string
  PLINK: string
  OEM: string
  NOTES: string
}

/**
 * Parse VARIABLES field into submodels and conditions
 *
 * Logic:
 * - Split by semicolon (;) to get segments (AND conditions)
 * - Each segment can have pipe (|) options (OR within segment)
 * - Identify trim segments (all options are known trims)
 * - Combine multiple trim segments (HYBRID; LE|XLE → HYBRID LE, HYBRID XLE)
 * - Non-trim segments become the conditions string
 * - Track if "see notes" is present (to show notice on frontend)
 */
function parseVariables(variables: string): {
  submodels: string[]
  conditions: string
  variablesRaw: string
  hasNotesNotice: boolean
} {
  const variablesRaw = variables?.trim() || ""

  if (!variablesRaw) {
    return { submodels: [], conditions: "", variablesRaw: "", hasNotesNotice: false }
  }

  // Check if "see notes" is present anywhere in the VARIABLES string
  const hasNotesNotice = /see\s*notes/i.test(variablesRaw)

  const segments = variablesRaw.split(";").map((s) => s.trim()).filter(Boolean)

  if (segments.length === 0) {
    return { submodels: [], conditions: "", variablesRaw, hasNotesNotice }
  }

  const trimSegments: string[][] = []
  const conditionSegments: string[] = []

  for (const segment of segments) {
    const options = segment.split("|").map((o) => o.trim()).filter(Boolean)

    // Check if ALL options in this segment are known trims
    const allTrims = options.every((opt) => KNOWN_TRIMS.has(opt))

    if (allTrims && options.length > 0) {
      trimSegments.push(options)
    } else {
      // Clean up "see notes" from conditions - it's not a filter option
      const cleanSegment = segment.replace(/;\s*see notes\s*$/i, "").trim()
      if (cleanSegment && cleanSegment.toLowerCase() !== "see notes") {
        conditionSegments.push(cleanSegment)
      }
    }
  }

  // Combine trim segments using cartesian product
  // e.g., [["HYBRID"], ["LE", "XLE"]] → ["HYBRID LE", "HYBRID XLE"]
  let submodels: string[] = []

  if (trimSegments.length === 0) {
    submodels = []
  } else if (trimSegments.length === 1) {
    submodels = trimSegments[0]
  } else {
    // Cartesian product of all trim segments
    submodels = trimSegments.reduce((acc, segment) => {
      if (acc.length === 0) return segment
      const result: string[] = []
      for (const a of acc) {
        for (const b of segment) {
          result.push(`${a} ${b}`)
        }
      }
      return result
    }, [] as string[])
  }

  // Join condition segments
  const conditions = conditionSegments.join("; ")

  return { submodels, conditions, variablesRaw, hasNotesNotice }
}

export default async function reimportFitments({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const fitmentService: FitmentModuleService = container.resolve(FITMENT_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  logger.info("Starting fitment re-import with correct VARIABLES parsing...")

  // Read from pre-generated JSON file
  const jsonPath = "/tmp/partslink-products.json"

  if (!fs.existsSync(jsonPath)) {
    logger.error(`JSON file not found at ${jsonPath}. Please run the Python export script first.`)
    throw new Error(`File not found: ${jsonPath}`)
  }

  const records: PartslinkRecord[] = JSON.parse(fs.readFileSync(jsonPath, "utf-8"))
  logger.info(`Loaded ${records.length} records from Partslink`)

  // Step 1: Delete all existing fitments and their links
  logger.info("Deleting existing fitments...")

  const { data: existingFitments } = await query.graph({
    entity: "fitment",
    fields: ["id"],
  })

  logger.info(`Found ${existingFitments.length} existing fitments to delete`)

  for (const fitment of existingFitments) {
    try {
      // Delete links first
      await link.dismiss({
        [Modules.PRODUCT]: { product_id: "*" },
        fitment: { fitment_id: (fitment as any).id },
      })
    } catch (err) {
      // Ignore link errors
    }

    try {
      await fitmentService.deleteFitments((fitment as any).id)
    } catch (err: any) {
      logger.warn(`Failed to delete fitment ${(fitment as any).id}: ${err.message}`)
    }
  }

  logger.info("Deleted existing fitments")

  // Step 2: Load makes, models, vehicles for lookup
  const existingMakes = await fitmentService.listVehicleMakes()
  const makeNameMap = new Map<string, string>()
  for (const make of existingMakes) {
    makeNameMap.set(make.name.toLowerCase(), make.id)
  }

  const existingModels = await fitmentService.listVehicleModels()
  const modelKeyMap = new Map<string, string>()
  for (const model of existingModels) {
    modelKeyMap.set(`${model.make_id}|${model.name.toLowerCase()}`, model.id)
  }

  // Load existing products by partslink_no
  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "metadata"],
  })

  const productByPlink = new Map<string, string>()
  for (const product of existingProducts) {
    const plink = (product as any).metadata?.partslink_no
    if (plink) {
      productByPlink.set(plink, (product as any).id)
    }
  }

  logger.info(`Found ${productByPlink.size} products with partslink_no`)

  // Step 3: Create new fitments with correct parsing
  let createdFitments = 0
  let createdVehicles = 0
  let skippedNoProduct = 0
  let skippedNoMake = 0
  let errors = 0

  // Group records by PLINK
  const recordsByPlink = new Map<string, PartslinkRecord[]>()
  for (const record of records) {
    const plink = record.PLINK?.trim()
    if (!plink) continue
    if (!recordsByPlink.has(plink)) {
      recordsByPlink.set(plink, [])
    }
    recordsByPlink.get(plink)!.push(record)
  }

  let processed = 0
  for (const [plink, plinkRecords] of recordsByPlink) {
    processed++
    if (processed % 50 === 0) {
      logger.info(`Processing ${processed}/${recordsByPlink.size}...`)
    }

    const productId = productByPlink.get(plink)
    if (!productId) {
      skippedNoProduct++
      continue
    }

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
        skippedNoMake++
        continue
      }

      // Find model
      const modelKey = `${makeId}|${modelName.toLowerCase()}`
      const modelId = modelKeyMap.get(modelKey)
      if (!modelId) {
        continue
      }

      // Find or create vehicle
      let existingVehicles = await fitmentService.listVehicles({
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
            existingVehicles = await fitmentService.listVehicles({
              make_id: makeId,
              model_id: modelId,
              year_start: yearStart,
              year_end: yearEnd,
            })
            if (existingVehicles[0]) {
              vehicleId = existingVehicles[0].id
            } else {
              continue
            }
          } else {
            continue
          }
        }
      }

      // Parse VARIABLES with correct logic
      const { submodels, conditions, variablesRaw, hasNotesNotice } = parseVariables(record.VARIABLES)

      // Create fitment
      try {
        const fitment = await fitmentService.createFitments({
          vehicle_id: vehicleId,
          variables_raw: variablesRaw,
          submodels: submodels as unknown as Record<string, unknown>,
          conditions: conditions || null,
          has_notes_notice: hasNotesNotice,
          notes: record.NOTES?.trim() || null,
        })

        // Link fitment to product
        await link.create({
          [Modules.PRODUCT]: { product_id: productId },
          fitment: { fitment_id: fitment.id },
        })

        createdFitments++
      } catch (err: any) {
        if (!err.message?.includes("unique") && !err.message?.includes("duplicate")) {
          logger.warn(`Failed to create fitment for ${plink}: ${err.message}`)
          errors++
        }
      }
    }
  }

  logger.info("\n=== Re-import Complete ===")
  logger.info(`Fitments created: ${createdFitments}`)
  logger.info(`Vehicles created: ${createdVehicles}`)
  logger.info(`Skipped (no product): ${skippedNoProduct}`)
  logger.info(`Skipped (no make): ${skippedNoMake}`)
  logger.info(`Errors: ${errors}`)
}
