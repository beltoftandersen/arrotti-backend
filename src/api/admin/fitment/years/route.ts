import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const makeId = req.query.make as string | undefined
  const modelId = req.query.model as string | undefined

  if (!makeId || !modelId) {
    res.status(400).json({ message: "make and model are required" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const vehicles = await fitmentModuleService.listVehicles({
    make_id: makeId,
    model_id: modelId,
  })

  // Collect all years from year_start and year_end ranges
  const yearsSet = new Set<number>()
  for (const vehicle of vehicles) {
    const start = vehicle.year_start
    const end = vehicle.year_end
    for (let year = start; year <= end; year++) {
      yearsSet.add(year)
    }
  }

  const years = Array.from(yearsSet).sort((a, b) => a - b)

  res.json({ years })
}
