import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { GARAGE_MODULE } from "../../../../modules/garage"
import GarageModuleService from "../../../../modules/garage/service"

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

export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const { vehicle_id } = req.body as { vehicle_id?: string }

  if (!vehicle_id) {
    res.status(400).json({ message: "vehicle_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const garageService: GarageModuleService = req.scope.resolve(GARAGE_MODULE)

  // Get linked garage vehicle IDs for this customer
  const garageVehicleIds = await getLinkedGarageVehicleIds(query, customerId)

  // Find the garage vehicle with this vehicle_id
  const existing = await garageService.findByVehicleIdInList(
    garageVehicleIds,
    vehicle_id
  )

  if (existing) {
    // Update last_used_at
    await garageService.updateVehicle(existing.id, {
      last_used_at: new Date(),
    })
  } else {
    // Create new and link (auto-add when touching)
    const created = await garageService.createVehicle({
      vehicle_id,
    })

    await link.create({
      [Modules.CUSTOMER]: { customer_id: customerId },
      [GARAGE_MODULE]: { garage_vehicle_id: created.id },
    })

    // Update last_used_at
    await garageService.updateVehicle(created.id, {
      last_used_at: new Date(),
    })
  }

  res.status(204).send()
}
