import { ExecArgs } from "@medusajs/framework/types"
import { downloadCSV, reloadTaxRates, getTaxRateStats } from "../lib/tax-rates"

/**
 * One-time setup script to download the US ZIP code tax rates CSV.
 *
 * Usage: npx medusa exec src/scripts/download-tax-csv.ts
 */
export default async function downloadTaxCSV({ container }: ExecArgs) {
  const logger = container.resolve("logger") as any

  logger.info("[download-tax-csv] Downloading US ZIP code tax rates...")

  await downloadCSV()

  await reloadTaxRates()

  const stats = await getTaxRateStats()

  logger.info(
    `[download-tax-csv] Done! Loaded ${stats.zipCount} ZIP codes across ${stats.stateCount} states.`
  )
  logger.info(
    `[download-tax-csv] Next steps:\n` +
      `  1. Build: npm run build\n` +
      `  2. Restart: sudo systemctl restart medusa-backend\n` +
      `  3. In Medusa Admin: Settings → Tax Regions → US → set provider to "zip-tax"\n` +
      `  4. Test with a known ZIP (e.g., 90001 CA should show ~9.5%)`
  )
}
