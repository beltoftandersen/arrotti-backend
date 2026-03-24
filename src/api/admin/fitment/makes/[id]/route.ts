import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../../modules/fitment"
import FitmentModuleService from "../../../../../modules/fitment/service"

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  if (!id) {
    res.status(400).json({ message: "id is required" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  // Check if make exists
  const makes = await fitmentModuleService.listVehicleMakes({ id })
  if (!makes.length) {
    res.status(404).json({ message: "Make not found" })
    return
  }

  // Check if there are models using this make
  const models = await fitmentModuleService.listVehicleModels({ make_id: id })
  if (models.length > 0) {
    res.status(400).json({
      message: `Cannot delete make with ${models.length} model(s). Delete the models first.`
    })
    return
  }

  // Check if there are vehicles using this make
  const vehicles = await fitmentModuleService.listVehicles({ make_id: id })
  if (vehicles.length > 0) {
    res.status(400).json({
      message: `Cannot delete make with ${vehicles.length} vehicle(s) in use.`
    })
    return
  }

  await fitmentModuleService.deleteVehicleMakes(id)

  res.status(200).json({ deleted: true, id })
}
