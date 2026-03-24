import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import FitmentModuleService from "../../../../../modules/fitment/service"
import { FITMENT_MODULE } from "../../../../../modules/fitment"
import { decodeVin } from "../../../../../modules/fitment/services/vin-decode-provider"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { vin } = req.body as { vin?: string }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const normalizedVin = vin?.trim().toUpperCase() ?? ""

  if (!normalizedVin) {
    res.status(400).json({ message: "VIN is required" })
    return
  }

  try {
    const cached = await fitmentModuleService.listVinDecodeCaches({
      vin: normalizedVin,
    })

    let decoded = cached[0]?.decoded_json as
      | {
          make: string
          model: string
          year: number
          raw?: Record<string, string>
        }
      | undefined

    if (!decoded) {
      const decodedResult = await decodeVin(normalizedVin)
      decoded = {
        make: decodedResult.make,
        model: decodedResult.model,
        year: decodedResult.year,
        raw: decodedResult.raw as Record<string, string> | undefined,
      }

      await fitmentModuleService.createVinDecodeCaches({
        vin: normalizedVin,
        decoded_json: decodedResult,
        provider: "vpic",
      })
    }

    // Resolve or create the vehicle (with year_start = year_end for single-year VIN decode)
    const resolved = await fitmentModuleService.resolveVehicleFromDecodedMMY({
      make: decoded.make,
      model: decoded.model,
      year: decoded.year,
    })

    res.json({
      vehicle_id: resolved.vehicle_id,
      make: decoded.make,
      model: decoded.model,
      year: decoded.year,
    })
  } catch (error) {
    const status = (error as Error & { status?: number }).status
    res.status(status ?? 500).json({ message: (error as Error).message })
  }
}
