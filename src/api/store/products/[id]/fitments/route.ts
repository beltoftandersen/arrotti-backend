import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../../../../../modules/fitment"
import FitmentModuleService from "../../../../../modules/fitment/service"

/**
 * Get fitments for a product
 *
 * Returns all fitments linked to a product, optionally filtered by vehicle_id.
 * Includes vehicle details (make/model names) and fitment notes.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id: productId } = req.params
  const vehicleIdParam = req.query.vehicle_id

  if (!productId) {
    res.status(400).json({ message: "Product ID is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const fitmentService: FitmentModuleService = req.scope.resolve(FITMENT_MODULE)

  // Get fitments linked to this product
  const { data: productFitments } = await query.graph({
    entity: "product",
    fields: ["fitments.*"],
    filters: { id: productId },
  })

  if (!productFitments?.[0]?.fitments?.length) {
    res.json({ fitments: [], has_notes_notice: false, notes: [] })
    return
  }

  const fitments = productFitments[0].fitments

  // Optionally filter by vehicle_id
  const vehicleId = typeof vehicleIdParam === "string" ? vehicleIdParam : undefined
  const filteredFitments = vehicleId
    ? fitments.filter((f: any) => f.vehicle_id === vehicleId)
    : fitments

  // Get vehicle details for each fitment
  const vehicleIds = [...new Set(filteredFitments.map((f: any) => f.vehicle_id))]
  const vehicleDetails = new Map<string, any>()

  for (const vId of vehicleIds) {
    const vehicles = await fitmentService.listVehicles({ id: vId })
    if (vehicles[0]) {
      const v = vehicles[0]
      // Get make and model names
      const makes = await fitmentService.listVehicleMakes({ id: v.make_id })
      const models = await fitmentService.listVehicleModels({ id: v.model_id })
      vehicleDetails.set(vId, {
        id: v.id,
        year_start: v.year_start,
        year_end: v.year_end,
        make_name: makes[0]?.name || "Unknown",
        model_name: models[0]?.name || "Unknown",
      })
    }
  }

  // Build response with enriched fitment data
  const enrichedFitments = filteredFitments.map((f: any) => {
    const vehicle = vehicleDetails.get(f.vehicle_id)
    return {
      id: f.id,
      vehicle_id: f.vehicle_id,
      vehicle: vehicle || null,
      submodels: f.submodels || [],
      conditions: f.conditions,
      has_notes_notice: f.has_notes_notice || false,
      notes: f.notes,
      variables_raw: f.variables_raw,
    }
  })

  // Check if any fitment has notes_notice
  const hasNotesNotice = enrichedFitments.some((f: any) => f.has_notes_notice)

  // Collect all unique notes
  const allNotes = [...new Set(
    enrichedFitments
      .map((f: any) => f.notes)
      .filter((n: string | null) => n && n.trim())
  )]

  res.json({
    fitments: enrichedFitments,
    has_notes_notice: hasNotesNotice,
    notes: allNotes,
  })
}
