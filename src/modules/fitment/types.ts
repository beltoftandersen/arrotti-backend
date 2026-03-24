export type VehicleMake = {
  id: string
  name: string
}

export type VehicleModel = {
  id: string
  make_id: string
  name: string
}

export type Vehicle = {
  id: string
  make_id: string
  model_id: string
  year_start: number
  year_end: number
  make_name?: string
  model_name?: string
}

export type Fitment = {
  id: string
  vehicle_id: string
  submodels: string[]
  features: string[]
  notes: string | null
  vehicle: Vehicle | null
}

export type VinDecodeResult = {
  make: string | null
  model: string | null
  year: number | null
}

export type VinDecodeCacheEntry = {
  id: string
  vin: string
  provider: string
  decoded_json: VinDecodeResult
}
