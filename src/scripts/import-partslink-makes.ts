/**
 * Import makes and models from Partslink MAKE.DBF
 *
 * Prerequisites: Run this Python command first to export the DBF to JSON:
 *   python3 -c "import json; from dbfread import DBF; ..." > /tmp/partslink-makes.json
 *
 * Usage: npx medusa exec ./src/scripts/import-partslink-makes.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { FITMENT_MODULE } from "../modules/fitment"
import FitmentModuleService from "../modules/fitment/service"
import * as fs from "fs"

export default async function importPartslinkMakes({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const fitmentService: FitmentModuleService = container.resolve(FITMENT_MODULE)

  logger.info("Starting Partslink makes/models import...")

  // Read from pre-generated JSON file
  const jsonPath = "/tmp/partslink-makes.json"

  if (!fs.existsSync(jsonPath)) {
    logger.error(`JSON file not found at ${jsonPath}. Please run the Python export script first.`)
    throw new Error(`File not found: ${jsonPath}`)
  }

  let data: { makes: string[]; models: { make: string; model: string }[] }

  try {
    const content = fs.readFileSync(jsonPath, "utf-8")
    data = JSON.parse(content)
  } catch (error) {
    logger.error("Failed to read JSON file:", error)
    throw error
  }

  logger.info(`Found ${data.makes.length} unique makes and ${data.models.length} make/model combinations`)

  // Create makes
  const makeIdMap = new Map<string, string>()

  logger.info("Creating makes...")
  for (const makeName of data.makes) {
    try {
      const make = await fitmentService.createVehicleMakes({ name: makeName })
      makeIdMap.set(makeName, make.id)
    } catch (error: any) {
      // If duplicate, try to find existing
      if (error.message?.includes("unique") || error.message?.includes("duplicate")) {
        const existing = await fitmentService.listVehicleMakes({ name: makeName })
        if (existing[0]) {
          makeIdMap.set(makeName, existing[0].id)
        }
      } else {
        logger.warn(`Failed to create make "${makeName}": ${error.message}`)
      }
    }
  }

  logger.info(`Created/found ${makeIdMap.size} makes`)

  // Create models (already deduplicated in JSON)
  logger.info(`Creating ${data.models.length} models...`)

  let createdCount = 0
  let skippedCount = 0

  for (const item of data.models) {
    const makeId = makeIdMap.get(item.make)
    if (!makeId) {
      logger.warn(`Make not found for model "${item.model}": ${item.make}`)
      skippedCount++
      continue
    }

    try {
      await fitmentService.createVehicleModels({
        name: item.model,
        make_id: makeId,
      })
      createdCount++
    } catch (error: any) {
      if (error.message?.includes("unique") || error.message?.includes("duplicate")) {
        skippedCount++
      } else {
        logger.warn(`Failed to create model "${item.model}" for ${item.make}: ${error.message}`)
        skippedCount++
      }
    }
  }

  logger.info(`Import complete!`)
  logger.info(`  Makes: ${makeIdMap.size}`)
  logger.info(`  Models created: ${createdCount}`)
  logger.info(`  Models skipped: ${skippedCount}`)
}
