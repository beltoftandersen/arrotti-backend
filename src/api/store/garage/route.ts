import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { GARAGE_MODULE } from "../../../modules/garage"
import GarageModuleService from "../../../modules/garage/service"

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

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const garageService: GarageModuleService = req.scope.resolve(GARAGE_MODULE)

  const garageVehicleIds = await getLinkedGarageVehicleIds(query, customerId)
  const vehicles = await garageService.listByIds(garageVehicleIds)

  res.json(buildResponse(vehicles))
}

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const { vehicle_id, label, set_default, make, model, year, engine, trim } =
    req.body as {
    vehicle_id?: string
    label?: string
    set_default?: boolean
    make?: string | null
    model?: string | null
    year?: number | null
    engine?: string | null
    trim?: string | null
  }

  if (!vehicle_id) {
    res.status(400).json({ message: "vehicle_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const garageService: GarageModuleService = req.scope.resolve(GARAGE_MODULE)

  // Get existing linked garage vehicle IDs
  const garageVehicleIds = await getLinkedGarageVehicleIds(query, customerId)

  // Check if this vehicle_id already exists in customer's garage
  const existing = await garageService.findByVehicleIdInList(
    garageVehicleIds,
    vehicle_id
  )

  let added: any
  if (existing) {
    // Update existing
    await garageService.updateVehicle(existing.id, {
      label,
      make,
      model,
      year,
      engine,
      trim,
    })
    added = existing
  } else {
    // Create new and link
    added = await garageService.createVehicle({
      vehicle_id,
      label,
      make,
      model,
      year,
      engine,
      trim,
    })

    await link.create({
      [Modules.CUSTOMER]: { customer_id: customerId },
      [GARAGE_MODULE]: { garage_vehicle_id: added.id },
    })
  }

  // Set default if requested
  if (set_default && added?.id) {
    const updatedIds = existing
      ? garageVehicleIds
      : [...garageVehicleIds, added.id]
    await garageService.setDefaultInList(updatedIds, added.id)
  }

  // Fetch updated list
  const finalIds = existing
    ? garageVehicleIds
    : [...garageVehicleIds, added.id]
  const vehicles = await garageService.listByIds(finalIds)

  res.status(201).json(buildResponse(vehicles))
}
