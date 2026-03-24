import { MedusaService } from "@medusajs/framework/utils"
import Fitment from "./models/fitment"
import Vehicle from "./models/vehicle"
import VehicleMake from "./models/vehicle-make"
import VehicleModel from "./models/vehicle-model"
import VinDecodeCache from "./models/vin-decode-cache"

class FitmentModuleService extends MedusaService({
  VehicleMake,
  VehicleModel,
  Vehicle,
  Fitment,
  VinDecodeCache,
}) {
  /**
   * Normalize a name for comparison: lowercase, trim, collapse whitespace.
   */
  private normalizeName(value: string) {
    return value.trim().replace(/\s+/g, " ").toLowerCase()
  }

  /**
   * Find a make by normalized name.
   * Loads all makes (~69) and matches in JS — no raw SQL needed.
   */
  private async findMakeByNormalizedName(
    normalizedName: string
  ): Promise<{ id: string; name: string } | null> {
    const makes = await this.listVehicleMakes({}, { take: null as any })
    const match = makes.find(
      (m) => this.normalizeName(m.name) === normalizedName
    )
    return match ? { id: match.id, name: match.name } : null
  }

  /**
   * Find a model by normalized name and make_id.
   * Loads models for the given make and matches in JS.
   */
  private async findModelByNormalizedName(
    makeId: string,
    normalizedName: string
  ): Promise<{ id: string; name: string; make_id: string } | null> {
    const models = await this.listVehicleModels(
      { make_id: makeId },
      { take: null as any }
    )
    const match = models.find(
      (m) => this.normalizeName(m.name) === normalizedName
    )
    return match
      ? { id: match.id, name: match.name, make_id: match.make_id }
      : null
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase()
      return (
        message.includes("unique constraint") ||
        message.includes("duplicate key") ||
        message.includes("already exists")
      )
    }
    return false
  }

  /**
   * Resolve or create a vehicle from make/model/year data.
   * For collision parts, year_start and year_end are the same when coming from VIN decode.
   *
   * Uses optimized SQL lookups instead of loading all makes/models into memory.
   */
  async resolveVehicleFromDecodedMMY(input: {
    make: string
    model: string
    year: number
    year_end?: number
  }): Promise<{ vehicle_id: string; make_id: string; model_id: string }> {
    const makeNormalized = this.normalizeName(input.make)
    const modelNormalized = this.normalizeName(input.model)
    const year = input.year

    // Lookup only — never create
    const make = await this.findMakeByNormalizedName(makeNormalized)
    if (!make) {
      const err = new Error(`We don't carry parts for ${input.make} vehicles yet`) as Error & { status: number }
      err.status = 404
      throw err
    }

    const vehicleModel = await this.findModelByNormalizedName(make.id, modelNormalized)
    if (!vehicleModel) {
      const err = new Error(`We don't carry parts for the ${input.make} ${input.model} yet`) as Error & { status: number }
      err.status = 404
      throw err
    }

    // Find a vehicle where the year falls within its range
    const vehicles = await this.listVehicles(
      { make_id: make.id, model_id: vehicleModel.id },
      { take: null as any }
    )
    const vehicle = vehicles.find(
      (v) => v.year_start <= year && v.year_end >= year
    )

    if (!vehicle) {
      const err = new Error(`We don't carry parts for the ${year} ${input.make} ${input.model} yet`) as Error & { status: number }
      err.status = 404
      throw err
    }

    return {
      vehicle_id: vehicle.id,
      make_id: make.id,
      model_id: vehicleModel.id,
    }
  }

  async listVehicleIdsForProduct(
    productId: string,
    query: { graph: (input: Record<string, any>) => Promise<any> }
  ): Promise<string[]> {
    const { data } = await query.graph({
      entity: "product_fitment",
      fields: ["fitment.vehicle_id"],
      filters: {
        product_id: productId,
      },
    })

    const vehicleIds = (data ?? [])
      .map((link: any) => link.fitment?.vehicle_id)
      .filter(Boolean)

    return Array.from(new Set(vehicleIds))
  }

  /**
   * Generate fitment search text for indexing.
   * Returns strings like "2018-2021 Toyota Camry" for each vehicle.
   */
  async listFitmentSearchTextForProduct(
    productId: string,
    query: { graph: (input: Record<string, any>) => Promise<any> }
  ): Promise<string[]> {
    const vehicleIds = await this.listVehicleIdsForProduct(productId, query)

    if (!vehicleIds.length) {
      return []
    }

    const vehicles = await this.listVehicles({ id: vehicleIds })
    const makeIds = Array.from(
      new Set(vehicles.map((vehicle) => vehicle.make_id).filter(Boolean))
    )
    const modelIds = Array.from(
      new Set(vehicles.map((vehicle) => vehicle.model_id).filter(Boolean))
    )

    const [makes, models] = await Promise.all([
      makeIds.length ? this.listVehicleMakes({ id: makeIds }) : [],
      modelIds.length ? this.listVehicleModels({ id: modelIds }) : [],
    ])

    const makeMap = new Map<string, string>(
      makes.map((make) => [make.id, make.name] as [string, string])
    )
    const modelMap = new Map<string, string>(
      models.map((model) => [model.id, model.name] as [string, string])
    )

    const fitmentText = vehicles
      .map((vehicle) => {
        const make = makeMap.get(vehicle.make_id) ?? ""
        const model = modelMap.get(vehicle.model_id) ?? ""
        const yearStart = vehicle.year_start ? String(vehicle.year_start) : ""
        const yearEnd = vehicle.year_end ? String(vehicle.year_end) : ""

        // Format year range: "2018-2021" or just "2018" if same year
        const yearRange = yearStart === yearEnd
          ? yearStart
          : `${yearStart}-${yearEnd}`

        return [yearRange, make, model]
          .filter((value) => value && String(value).trim())
          .join(" ")
      })
      .filter(Boolean)

    return Array.from(new Set(fitmentText))
  }

  async getCachedVinDecode(
    vin: string
  ): Promise<{
    make: string | null
    model: string | null
    year: number | null
  } | null> {
    const normalizedVin = vin.trim().toUpperCase()
    const cached = await this.listVinDecodeCaches({ vin: normalizedVin })
    if (!cached[0]) {
      return null
    }
    const decoded = cached[0].decoded_json as Record<string, unknown>
    return {
      make: (decoded.make as string) ?? null,
      model: (decoded.model as string) ?? null,
      year: (decoded.year as number) ?? null,
    }
  }

  async cacheVinDecode(
    vin: string,
    result: { make: string | null; model: string | null; year: number | null }
  ): Promise<void> {
    const normalizedVin = vin.trim().toUpperCase()
    try {
      await this.createVinDecodeCaches({
        vin: normalizedVin,
        provider: "vpic",
        decoded_json: result,
      })
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error
      }
    }
  }
}

export default FitmentModuleService
