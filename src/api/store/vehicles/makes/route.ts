import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const year = req.query.year ? Number(req.query.year) : undefined

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  if (year && !Number.isNaN(year)) {
    // Use raw SQL to efficiently get makes for a specific year
    const pgConnection = req.scope.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    )

    const result = await pgConnection.raw(`
      SELECT DISTINCT m.id, m.name
      FROM vehicle_make m
      JOIN vehicle v ON v.make_id = m.id
      JOIN fitment f ON f.vehicle_id = v.id
      WHERE v.year_start <= ? AND v.year_end >= ?
      ORDER BY m.name ASC
    `, [year, year])

    res.json({ makes: result.rows || [] })
    return
  }

  // No year filter - return all makes
  const makes = await fitmentModuleService.listVehicleMakes(
    {},
    { order: { name: "ASC" } }
  )

  res.json({ makes })
}
