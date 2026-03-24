import { MedusaService } from "@medusajs/framework/utils"
import GarageVehicle from "./models/garage-vehicle"

type GarageVehicleInput = {
  vehicle_id: string
  label?: string | null
  make?: string | null
  model?: string | null
  year?: number | null
  engine?: string | null
  trim?: string | null
}

class GarageModuleService extends MedusaService({
  GarageVehicle,
}) {
  /**
   * Find a garage vehicle by its ID
   */
  async findById(garageVehicleId: string) {
    const [vehicle] = await this.listGarageVehicles({
      id: garageVehicleId,
    })
    return vehicle ?? null
  }

  /**
   * Find a garage vehicle by vehicle_id within a list of garage vehicle IDs
   */
  async findByVehicleIdInList(garageVehicleIds: string[], vehicleId: string) {
    if (!garageVehicleIds.length) return null

    const vehicles = await this.listGarageVehicles({
      id: garageVehicleIds,
      vehicle_id: vehicleId,
    })
    return vehicles[0] ?? null
  }

  /**
   * List garage vehicles by IDs
   */
  async listByIds(garageVehicleIds: string[]) {
    if (!garageVehicleIds.length) return []

    const vehicles = await this.listGarageVehicles({
      id: garageVehicleIds,
    })

    // Sort: default first, then by last_used_at, then by created_at
    return vehicles.sort((a: any, b: any) => {
      if (a.is_default !== b.is_default) {
        return a.is_default ? -1 : 1
      }

      const aUsed = a.last_used_at ? new Date(a.last_used_at).getTime() : 0
      const bUsed = b.last_used_at ? new Date(b.last_used_at).getTime() : 0

      if (aUsed !== bUsed) {
        return bUsed - aUsed
      }

      const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0
      const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0
      return bCreated - aCreated
    })
  }

  /**
   * Create a new garage vehicle
   */
  async createVehicle(input: GarageVehicleInput) {
    return this.createGarageVehicles({
      vehicle_id: input.vehicle_id,
      make: input.make ?? null,
      model: input.model ?? null,
      year: input.year ?? null,
      engine: input.engine ?? null,
      trim: input.trim ?? null,
      label: input.label ?? null,
      is_default: false,
    })
  }

  /**
   * Update a garage vehicle
   */
  async updateVehicle(
    garageVehicleId: string,
    updates: Partial<GarageVehicleInput> & { is_default?: boolean; last_used_at?: Date }
  ) {
    const data: Record<string, unknown> = {}
    if (updates.label !== undefined) data.label = updates.label
    if (updates.make !== undefined) data.make = updates.make
    if (updates.model !== undefined) data.model = updates.model
    if (updates.year !== undefined) data.year = updates.year
    if (updates.engine !== undefined) data.engine = updates.engine
    if (updates.trim !== undefined) data.trim = updates.trim
    if (updates.is_default !== undefined) data.is_default = updates.is_default
    if (updates.last_used_at !== undefined) data.last_used_at = updates.last_used_at

    if (!Object.keys(data).length) return null

    return this.updateGarageVehicles({
      selector: { id: garageVehicleId },
      data,
    })
  }

  /**
   * Delete a garage vehicle
   */
  async deleteVehicle(garageVehicleId: string) {
    await this.deleteGarageVehicles(garageVehicleId)
  }

  /**
   * Clear default flag on all vehicles in the list
   */
  async clearDefaultInList(garageVehicleIds: string[]) {
    if (!garageVehicleIds.length) return

    await this.updateGarageVehicles({
      selector: { id: garageVehicleIds },
      data: { is_default: false },
    })
  }

  /**
   * Set a vehicle as default (also clears other defaults)
   */
  async setDefaultInList(garageVehicleIds: string[], garageVehicleId: string) {
    // Clear all defaults first
    await this.clearDefaultInList(garageVehicleIds)

    // Set the new default
    return this.updateGarageVehicles({
      selector: { id: garageVehicleId },
      data: { is_default: true },
    })
  }
}

export default GarageModuleService
