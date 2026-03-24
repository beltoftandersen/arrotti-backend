/**
 * Seed US tax regions with state-level sales tax rates.
 *
 * Data source: publicly available US state sales tax rates (as of 2025).
 * These are STATE-LEVEL rates only. County/city/special district taxes
 * vary by jurisdiction and would require a tax provider (e.g., Avalara)
 * for real-time calculation.
 *
 * Usage:
 *   npx medusa exec src/scripts/seed-tax-regions.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

// US state sales tax rates (state-level only, as of 2025)
// States with 0% have no state sales tax
// Source: Tax Foundation, state revenue department publications
// Province codes use ISO 3166-2 subdivision format (lowercase, no country prefix)
// to match Medusa's address.province_code values (e.g., "ca", "ny").
const US_STATE_TAX_RATES: Record<string, { name: string; rate: number }> = {
  al: { name: "Alabama", rate: 4 },
  ak: { name: "Alaska", rate: 0 },
  az: { name: "Arizona", rate: 5.6 },
  ar: { name: "Arkansas", rate: 6.5 },
  ca: { name: "California", rate: 7.25 },
  co: { name: "Colorado", rate: 2.9 },
  ct: { name: "Connecticut", rate: 6.35 },
  de: { name: "Delaware", rate: 0 },
  fl: { name: "Florida", rate: 6 },
  ga: { name: "Georgia", rate: 4 },
  hi: { name: "Hawaii", rate: 4 },
  id: { name: "Idaho", rate: 6 },
  il: { name: "Illinois", rate: 6.25 },
  in: { name: "Indiana", rate: 7 },
  ia: { name: "Iowa", rate: 6 },
  ks: { name: "Kansas", rate: 6.5 },
  ky: { name: "Kentucky", rate: 6 },
  la: { name: "Louisiana", rate: 4.45 },
  me: { name: "Maine", rate: 5.5 },
  md: { name: "Maryland", rate: 6 },
  ma: { name: "Massachusetts", rate: 6.25 },
  mi: { name: "Michigan", rate: 6 },
  mn: { name: "Minnesota", rate: 6.875 },
  ms: { name: "Mississippi", rate: 7 },
  mo: { name: "Missouri", rate: 4.225 },
  mt: { name: "Montana", rate: 0 },
  ne: { name: "Nebraska", rate: 5.5 },
  nv: { name: "Nevada", rate: 6.85 },
  nh: { name: "New Hampshire", rate: 0 },
  nj: { name: "New Jersey", rate: 6.625 },
  nm: { name: "New Mexico", rate: 5.125 },
  ny: { name: "New York", rate: 4 },
  nc: { name: "North Carolina", rate: 4.75 },
  nd: { name: "North Dakota", rate: 5 },
  oh: { name: "Ohio", rate: 5.75 },
  ok: { name: "Oklahoma", rate: 4.5 },
  or: { name: "Oregon", rate: 0 },
  pa: { name: "Pennsylvania", rate: 6 },
  ri: { name: "Rhode Island", rate: 7 },
  sc: { name: "South Carolina", rate: 6 },
  sd: { name: "South Dakota", rate: 4.5 },
  tn: { name: "Tennessee", rate: 7 },
  tx: { name: "Texas", rate: 6.25 },
  ut: { name: "Utah", rate: 6.1 },
  vt: { name: "Vermont", rate: 6 },
  va: { name: "Virginia", rate: 5.3 },
  wa: { name: "Washington", rate: 6.5 },
  wv: { name: "West Virginia", rate: 6 },
  wi: { name: "Wisconsin", rate: 5 },
  wy: { name: "Wyoming", rate: 4 },
  dc: { name: "District of Columbia", rate: 6 },
}

export default async function seedTaxRegions({ container }: ExecArgs) {
  const taxService = container.resolve(Modules.TAX)
  const logger = container.resolve("logger")

  logger.info("Starting US tax region seed...")

  // Check for existing US tax region
  const existing = await taxService.listTaxRegions({
    country_code: "us",
    parent_id: null as any,
  })

  let usRegion: any

  if (existing.length > 0) {
    usRegion = existing[0]
    logger.info(`US parent tax region already exists: ${usRegion.id}`)
  } else {
    // Create the parent US tax region (0% at country level — rates are at state level)
    usRegion = await taxService.createTaxRegions({
      country_code: "us",
    })
    logger.info(`Created US parent tax region: ${usRegion.id}`)
  }

  // Get existing sublevel regions
  const existingSublevels = await taxService.listTaxRegions({
    parent_id: usRegion.id,
  })
  // Normalize existing province codes to bare state format (handle legacy "us-ca" → "ca")
  const existingProvinceCodes = new Set(
    existingSublevels.map((r: any) => {
      const code = r.province_code as string
      return code?.startsWith("us-") ? code.slice(3) : code
    })
  )

  let created = 0
  let skipped = 0

  for (const [provinceCode, { name, rate }] of Object.entries(US_STATE_TAX_RATES)) {
    if (existingProvinceCodes.has(provinceCode)) {
      skipped++
      continue
    }

    await taxService.createTaxRegions({
      country_code: "us",
      province_code: provinceCode,
      parent_id: usRegion.id,
      default_tax_rate: {
        name: `${name} State Tax`,
        rate,
        code: `${provinceCode.toUpperCase()}-STATE`,
      },
    })
    created++
  }

  logger.info(
    `Tax region seed complete: ${created} states created, ${skipped} skipped (already exist). ` +
    `Total: ${Object.keys(US_STATE_TAX_RATES).length} US states + DC.`
  )

  logger.info(
    "\nNote: These are STATE-LEVEL rates only. For county/city/special district taxes,\n" +
    "consider integrating a tax provider like Avalara or TaxJar."
  )
}
