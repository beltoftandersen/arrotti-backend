import * as fs from "fs"
import * as path from "path"
import { MedusaContainer } from "@medusajs/framework"
import { downloadCSV, reloadTaxRates, getTaxRateStats } from "../lib/tax-rates"

const CSV_PATH = path.join(process.cwd(), "data", "tax-rates.csv")

export default async function refreshTaxRatesJob(
  container: MedusaContainer
) {
  const logger = container.resolve("logger") as any

  logger.info("[refresh-tax-rates] Starting weekly tax rate refresh...")

  try {
    // Log current file stats
    let beforeSize = 0
    if (fs.existsSync(CSV_PATH)) {
      beforeSize = fs.statSync(CSV_PATH).size
    }

    const beforeStats = await getTaxRateStats()

    // Download fresh CSV
    await downloadCSV()

    const afterSize = fs.existsSync(CSV_PATH) ? fs.statSync(CSV_PATH).size : 0

    // Reload in-memory maps
    await reloadTaxRates()

    const afterStats = await getTaxRateStats()

    logger.info(
      `[refresh-tax-rates] Updated tax rates: ` +
        `file ${Math.round(beforeSize / 1024)}KB → ${Math.round(afterSize / 1024)}KB, ` +
        `${beforeStats.zipCount} → ${afterStats.zipCount} ZIPs, ` +
        `${beforeStats.stateCount} → ${afterStats.stateCount} states`
    )
  } catch (error) {
    logger.error(
      `[refresh-tax-rates] Failed to refresh tax rates: ${(error as Error).message}. ` +
        `Keeping existing data.`
    )
  }
}

export const config = {
  name: "refresh-tax-rates",
  // Every Sunday at 3 AM
  schedule: "0 3 * * 0",
}
