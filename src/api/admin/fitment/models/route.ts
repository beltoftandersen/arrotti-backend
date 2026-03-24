import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const makeId = req.query.make as string | undefined

  if (!makeId) {
    res.status(400).json({ message: "make is required" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const models = await fitmentModuleService.listVehicleModels(
    {
      make_id: makeId,
    },
    {
      order: {
        name: "ASC",
      },
    }
  )

  res.json({ models })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as { name?: string; make_id?: string }
  const name = body.name?.trim()
  const make_id = body.make_id?.trim()

  if (!name || !make_id) {
    res.status(400).json({ message: "name and make_id are required" })
    return
  }

  if (name.length > 100) {
    res.status(400).json({ message: "name must be 100 characters or less" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const model = await fitmentModuleService.createVehicleModels({
    name,
    make_id,
  })

  res.status(201).json({ model })
}
