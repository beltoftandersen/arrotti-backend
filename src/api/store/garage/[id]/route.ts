import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { GARAGE_MODULE } from "../../../../modules/garage"
import GarageModuleService from "../../../../modules/garage/service"

const buildResponse = (vehicles: any[]) => ({
  vehicles: vehicles.map((vehicle) => ({
    id: vehicle.id,
    vehicle_id: vehicle.vehicle_id,
    make: vehicle.make ?? null,
    model: vehicle.model ?? null,
    year: vehicle.year ?? null,
    engine: vehicle.engine ?? null,
    trim: vehicle.trim ?? null,
    label: vehicle.label,
    is_default: vehicle.is_default,
    last_used_at: vehicle.last_used_at,
    created_at: vehicle.created_at,
  })),
  default_vehicle_id:
    vehicles.find((vehicle) => vehicle.is_default)?.vehicle_id ?? null,
})

/**
 * Get garage vehicle IDs linked to a customer using the query service
 */
async function getLinkedGarageVehicleIds(
  query: any,
  customerId: string
): Promise<string[]> {
  const { data: links } = await query.graph({
    entity: "customer_garage_vehicle",
    fields: ["garage_vehicle_id"],
    filters: {
      customer_id: customerId,
    },
  })

  return (links ?? [])
    .map((link: any) => link.garage_vehicle_id)
    .filter((id: any) => id)
}

export async function PATCH(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const { id } = req.params
  if (!id) {
    res.status(400).json({ message: "id is required" })
    return
  }

  const { label, is_default } = req.body as {
    label?: string
    is_default?: boolean
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const garageService: GarageModuleService = req.scope.resolve(GARAGE_MODULE)

  // Get linked garage vehicle IDs for this customer
  const garageVehicleIds = await getLinkedGarageVehicleIds(query, customerId)

  // Verify this vehicle belongs to the customer
  if (!garageVehicleIds.includes(id)) {
    res.status(404).json({ message: "Garage vehicle not found" })
    return
  }

  if (label !== undefined) {
    await garageService.updateVehicle(id, { label })
  }

  if (is_default === true) {
    await garageService.setDefaultInList(garageVehicleIds, id)
  }

  if (is_default === false) {
    await garageService.clearDefaultInList(garageVehicleIds)
  }

  const vehicles = await garageService.listByIds(garageVehicleIds)
  res.json(buildResponse(vehicles))
}

export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const { id } = req.params
  if (!id) {
    res.status(400).json({ message: "id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const garageService: GarageModuleService = req.scope.resolve(GARAGE_MODULE)

  // Get linked garage vehicle IDs for this customer
  const garageVehicleIds = await getLinkedGarageVehicleIds(query, customerId)

  // Verify this vehicle belongs to the customer
  if (!garageVehicleIds.includes(id)) {
    res.status(404).json({ message: "Garage vehicle not found" })
    return
  }

  // Check if it was default before removing
  const vehicle = await garageService.findById(id)
  const wasDefault = vehicle?.is_default

  // Remove the link
  await link.dismiss({
    [Modules.CUSTOMER]: { customer_id: customerId },
    [GARAGE_MODULE]: { garage_vehicle_id: id },
  })

  // Delete the garage vehicle
  await garageService.deleteVehicle(id)

  // Get remaining linked vehicles
  const remainingIds = garageVehicleIds.filter((gid) => gid !== id)

  // If removed vehicle was default, clear defaults
  if (wasDefault && remainingIds.length > 0) {
    await garageService.clearDefaultInList(remainingIds)
  }

  const vehicles = await garageService.listByIds(remainingIds)
  res.json(buildResponse(vehicles))
}
