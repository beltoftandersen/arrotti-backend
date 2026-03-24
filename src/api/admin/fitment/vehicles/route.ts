import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as {
    make_id?: string
    model_id?: string
    year_start?: number | string
    year_end?: number | string
  }

  const make_id = body.make_id?.trim()
  const model_id = body.model_id?.trim()

  const parseYear = (value: number | string | undefined): number | undefined => {
    if (value === undefined || value === "") return undefined
    const num = typeof value === "string" ? Number(value) : value
    return Number.isNaN(num) ? undefined : num
  }

  const yearStart = parseYear(body.year_start)
  const yearEnd = parseYear(body.year_end) ?? yearStart

  if (!make_id || !model_id || !yearStart) {
    res.status(400).json({ message: "make_id, model_id, and year_start are required" })
    return
  }

  if (yearStart < 1900 || yearStart > 2100) {
    res.status(400).json({ message: "year_start must be between 1900 and 2100" })
    return
  }

  if (yearEnd && (yearEnd < 1900 || yearEnd > 2100)) {
    res.status(400).json({ message: "year_end must be between 1900 and 2100" })
    return
  }

  if (yearEnd && yearStart > yearEnd) {
    res.status(400).json({ message: "year_start must be less than or equal to year_end" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const existing = await fitmentModuleService.listVehicles({
    make_id,
    model_id,
    year_start: yearStart,
    year_end: yearEnd,
  })

  if (existing[0]) {
    res.json({ vehicle: existing[0], created: false })
    return
  }

  const vehicle = await fitmentModuleService.createVehicles({
    make_id,
    model_id,
    year_start: yearStart,
    year_end: yearEnd,
  })

  res.status(201).json({ vehicle, created: true })
}
