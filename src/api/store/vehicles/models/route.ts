import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const makeId = req.query.make as string | undefined
  const year = req.query.year ? Number(req.query.year) : undefined

  if (!makeId) {
    res.status(400).json({ message: "make is required" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  if (year && !Number.isNaN(year)) {
    // Use raw SQL to efficiently get models for a make + year
    const pgConnection = req.scope.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    )

    const result = await pgConnection.raw(`
      SELECT DISTINCT mo.id, mo.name
      FROM vehicle_model mo
      JOIN vehicle v ON v.model_id = mo.id
      JOIN fitment f ON f.vehicle_id = v.id
      WHERE v.make_id = ? AND v.year_start <= ? AND v.year_end >= ?
      ORDER BY mo.name ASC
    `, [makeId, year, year])

    res.json({ models: result.rows || [] })
    return
  }

  // No year filter - return all models for the make
  const models = await fitmentModuleService.listVehicleModels(
    { make_id: makeId },
    { order: { name: "ASC" } }
  )

  res.json({ models })
}
