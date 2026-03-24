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

  // Check if model exists
  const models = await fitmentModuleService.listVehicleModels({ id })
  if (!models.length) {
    res.status(404).json({ message: "Model not found" })
    return
  }

  // Check if there are vehicles using this model
  const vehicles = await fitmentModuleService.listVehicles({ model_id: id })
  if (vehicles.length > 0) {
    res.status(400).json({
      message: `Cannot delete model with ${vehicles.length} vehicle(s) in use.`
    })
    return
  }

  await fitmentModuleService.deleteVehicleModels(id)

  res.status(200).json({ deleted: true, id })
}
