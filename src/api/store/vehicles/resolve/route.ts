import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const makeId = req.query.make as string | undefined
  const modelId = req.query.model as string | undefined
  const year = Number(req.query.year)

  if (!makeId || !modelId || Number.isNaN(year)) {
    res.status(400).json({ message: "make, model, and year are required" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  // Run all three lookups in parallel
  const [vehicles, [make], [model]] = await Promise.all([
    fitmentModuleService.listVehicles({ make_id: makeId, model_id: modelId }),
    fitmentModuleService.listVehicleMakes({ id: makeId }),
    fitmentModuleService.listVehicleModels({ id: modelId }),
  ])

  // Find ALL vehicles where the selected year falls within the range
  const matchingVehicles = vehicles.filter(
    (vehicle) => vehicle.year_start <= year && vehicle.year_end >= year
  )

  if (matchingVehicles.length > 0) {
    const primary = matchingVehicles[0]
    res.json({
      vehicle_id: primary.id,
      vehicle_ids: matchingVehicles.map((v) => v.id),
      make: make?.name ?? "",
      model: model?.name ?? "",
      year,
      year_start: primary.year_start,
      year_end: primary.year_end,
      created: false,
    })
    return
  }

  // No matching vehicle found - create one with year_start = year_end = selected year
  const createdVehicle = await fitmentModuleService.createVehicles({
    make_id: makeId,
    model_id: modelId,
    year_start: year,
    year_end: year,
  })

  res.json({
    vehicle_id: createdVehicle.id,
    make: make?.name ?? "",
    model: model?.name ?? "",
    year,
    year_start: createdVehicle.year_start,
    year_end: createdVehicle.year_end,
    created: true,
  })
}
