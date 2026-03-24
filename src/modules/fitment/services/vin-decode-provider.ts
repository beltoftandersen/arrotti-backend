type VinDecodeResult = {
  make: string
  model: string
  year: number
  trim?: string
  engine?: string
  raw?: unknown
}

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/

const createError = (message: string, status: number) => {
  const error = new Error(message) as Error & { status?: number }
  error.status = status
  return error
}

const parseYear = (value: string | undefined) => {
  const year = Number(value)
  return Number.isFinite(year) ? year : undefined
}

export const decodeVin = async (vin: string): Promise<VinDecodeResult> => {
  const normalized = vin.trim().toUpperCase()

  if (!normalized) {
    throw createError("VIN is required", 400)
  }

  if (!VIN_REGEX.test(normalized)) {
    throw createError("VIN must be 17 characters and not include I, O, or Q", 400)
  }

  const response = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${normalized}?format=json`
  )

  if (!response.ok) {
    throw createError("VIN provider unavailable", 502)
  }

  const payload = (await response.json()) as {
    Results?: Array<Record<string, string>>
  }

  const result = payload.Results?.[0]

  if (!result) {
    throw createError("VIN decode failed", 502)
  }

  const make = result.Make?.trim()
  const model = result.Model?.trim()
  const year = parseYear(result.ModelYear)

  if (!make || !model || !year) {
    const message =
      result.ErrorText?.trim() || "VIN decode returned incomplete data"
    throw createError(message, 422)
  }

  const trim = result.Trim?.trim() || result.Trim2?.trim() || undefined
  const engine =
    result.EngineModel?.trim() ||
    result.EngineConfiguration?.trim() ||
    undefined

  return {
    make,
    model,
    year,
    trim,
    engine,
    raw: result,
  }
}
