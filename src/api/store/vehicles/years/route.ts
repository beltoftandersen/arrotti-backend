import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /store/vehicles/years
 *
 * Returns all years that have products with fitments.
 * Uses raw SQL to get min/max years efficiently.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const pgConnection = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  )

  // Single query: get min/max year from vehicles that have fitments
  const result = await pgConnection.raw(`
    SELECT MIN(v.year_start) as min_year, MAX(v.year_end) as max_year
    FROM vehicle v
    WHERE EXISTS (SELECT 1 FROM fitment f WHERE f.vehicle_id = v.id)
  `)

  const row = result.rows?.[0]
  const minYear = row?.min_year
  const maxYear = row?.max_year

  if (!minYear || !maxYear) {
    res.json({ years: [] })
    return
  }

  // Generate year range (newest first)
  const years: number[] = []
  for (let year = maxYear; year >= minYear; year--) {
    years.push(year)
  }

  res.json({ years })
}
