import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const makes = await fitmentModuleService.listVehicleMakes(
    {},
    {
      order: {
        name: "ASC",
      },
    }
  )

  res.json({ makes })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const rawName = (req.body as { name?: string }).name
  const name = rawName?.trim()

  if (!name) {
    res.status(400).json({ message: "name is required" })
    return
  }

  if (name.length > 100) {
    res.status(400).json({ message: "name must be 100 characters or less" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const make = await fitmentModuleService.createVehicleMakes({ name })

  res.status(201).json({ make })
}
