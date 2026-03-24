import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  if (!id) {
    res.status(400).json({ message: "id is required" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const vehicles = await fitmentModuleService.listVehicles({ id })
  const vehicle = vehicles[0]

  if (!vehicle) {
    res.status(404).json({ message: "Vehicle not found" })
    return
  }

  const [make, model] = await Promise.all([
    vehicle.make_id
      ? fitmentModuleService.listVehicleMakes({ id: vehicle.make_id })
      : [],
    vehicle.model_id
      ? fitmentModuleService.listVehicleModels({ id: vehicle.model_id })
      : [],
  ])

  res.json({
    vehicle_id: vehicle.id,
    make: make[0]?.name ?? null,
    model: model[0]?.name ?? null,
    year_start: vehicle.year_start ?? null,
    year_end: vehicle.year_end ?? null,
  })
}
