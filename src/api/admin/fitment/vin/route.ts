import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../../modules/fitment"
import FitmentModuleService from "../../../../modules/fitment/service"

type NHTSAResult = {
  Variable: string
  Value: string | null
}

type NHTSAResponse = {
  Results: NHTSAResult[]
}

function extractValue(results: NHTSAResult[], variable: string): string | null {
  const result = results.find((r) => r.Variable === variable)
  return result?.Value?.trim() || null
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const vin = (req.body as { vin?: string }).vin?.trim().toUpperCase()

  if (!vin) {
    res.status(400).json({ message: "vin is required" })
    return
  }

  if (vin.length !== 17) {
    res.status(400).json({ message: "VIN must be exactly 17 characters" })
    return
  }

  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    res.status(400).json({ message: "VIN contains invalid characters" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const cached = await fitmentModuleService.getCachedVinDecode(vin)
  if (cached) {
    res.json({ decoded: cached, cached: true })
    return
  }

  let nhtsaData: NHTSAResponse
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`,
      { signal: controller.signal }
    )
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`NHTSA API returned ${response.status}`)
    }
    nhtsaData = await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === "AbortError") {
      console.error("NHTSA API timeout")
      res.status(504).json({ message: "VIN decode timed out" })
      return
    }
    console.error("NHTSA API error:", error)
    res.status(502).json({ message: "Failed to decode VIN from NHTSA" })
    return
  }

  const results = nhtsaData.Results ?? []
  if (!results.length) {
    res.status(404).json({ message: "No decode results for VIN" })
    return
  }

  const make = extractValue(results, "Make")
  const model = extractValue(results, "Model")
  const yearStr = extractValue(results, "ModelYear")
  const year = yearStr ? parseInt(yearStr, 10) : null
  const displacement = extractValue(results, "DisplacementL")
  const cylinders = extractValue(results, "EngineCylinders")
  const trim = extractValue(results, "Trim")

  let engine: string | null = null
  if (displacement || cylinders) {
    const parts: string[] = []
    if (displacement) {
      parts.push(`${displacement}L`)
    }
    if (cylinders) {
      parts.push(`${cylinders}-cyl`)
    }
    engine = parts.join(" ")
  }

  if (!make || !model || !year || isNaN(year)) {
    res.status(422).json({
      message: "VIN decode incomplete - missing make, model, or year",
      partial: { make, model, year, engine, trim },
    })
    return
  }

  const decoded = { make, model, year, engine, trim }

  await fitmentModuleService.cacheVinDecode(vin, decoded)

  res.json({ decoded, cached: false })
}
