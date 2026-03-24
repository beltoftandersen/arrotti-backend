import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../../../../../../modules/fitment"
import FitmentModuleService from "../../../../../../modules/fitment/service"
import { updateMeiliVehicleIdsForProduct } from "../../../../../../modules/fitment/services/meili-fitment"

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId, fitment_id: fitmentId } = req.params

  if (!productId || !fitmentId) {
    res.status(400).json({ message: "product_id and fitment_id are required" })
    return
  }

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  await link.dismiss({
    [Modules.PRODUCT]: { product_id: productId },
    fitment: { fitment_id: fitmentId },
  })

  await fitmentModuleService.deleteFitments(fitmentId)

  try {
    await updateMeiliVehicleIdsForProduct(req.scope, productId)
  } catch (error) {
    console.error("Failed to update Meilisearch vehicle_ids", error)
  }

  res.status(204).send()
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId, fitment_id: fitmentId } = req.params
  const body = req.body as {
    make_id?: string
    model_id?: string
    year_start?: number | string
    year_end?: number | string
    submodels?: string[]
    conditions?: string | null
    notes?: string | null
  }

  const make_id = body.make_id?.trim()
  const model_id = body.model_id?.trim()
  const submodels = body.submodels !== undefined ? (Array.isArray(body.submodels) ? body.submodels.filter(s => s?.trim()) : []) : undefined
  const conditions = body.conditions !== undefined ? (body.conditions?.trim() || null) : undefined
  const notes = body.notes !== undefined ? (body.notes?.trim() || null) : undefined

  if (!productId || !fitmentId) {
    res.status(400).json({ message: "product_id and fitment_id are required" })
    return
  }

  // Parse years
  const parseYear = (value: number | string | undefined): number | undefined => {
    if (value === undefined || value === "") return undefined
    const num = typeof value === "string" ? Number(value) : value
    return Number.isNaN(num) ? undefined : num
  }

  const parsedYearStart = parseYear(body.year_start)
  const parsedYearEnd = parseYear(body.year_end)

  if (parsedYearStart !== undefined && (parsedYearStart < 1900 || parsedYearStart > 2100)) {
    res.status(400).json({ message: "year_start must be between 1900 and 2100" })
    return
  }

  if (parsedYearEnd !== undefined && (parsedYearEnd < 1900 || parsedYearEnd > 2100)) {
    res.status(400).json({ message: "year_end must be between 1900 and 2100" })
    return
  }

  if (notes !== undefined && notes !== null && notes.length > 500) {
    res.status(400).json({ message: "notes must be 500 characters or less" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const { data: links } = await query.graph({
    entity: "product_fitment",
    fields: ["fitment.id"],
    filters: {
      product_id: productId,
      fitment_id: fitmentId,
    },
  })

  if (!links?.length) {
    res.status(404).json({ message: "Fitment not found for product" })
    return
  }

  const existingFitment = await fitmentModuleService.retrieveFitment(fitmentId)
  const [existingVehicle] = await fitmentModuleService.listVehicles({
    id: existingFitment.vehicle_id,
  })

  const wantsVehicleUpdate =
    !!make_id ||
    !!model_id ||
    parsedYearStart !== undefined ||
    parsedYearEnd !== undefined

  let targetVehicleId = existingFitment.vehicle_id

  if (wantsVehicleUpdate) {
    if (!existingVehicle && (!make_id || !model_id || parsedYearStart === undefined)) {
      res.status(400).json({
        message: "make_id, model_id, and year_start are required to change vehicle",
      })
      return
    }

    const vehicleMakeId = make_id ?? existingVehicle?.make_id
    const vehicleModelId = model_id ?? existingVehicle?.model_id
    const vehicleYearStart = parsedYearStart ?? existingVehicle?.year_start
    const vehicleYearEnd = parsedYearEnd ?? parsedYearStart ?? existingVehicle?.year_end

    if (!vehicleMakeId || !vehicleModelId || !vehicleYearStart) {
      res.status(400).json({
        message: "make_id, model_id, and year_start are required to change vehicle",
      })
      return
    }

    if (vehicleYearEnd && vehicleYearStart > vehicleYearEnd) {
      res.status(400).json({ message: "year_start must be less than or equal to year_end" })
      return
    }

    const existingVehicles = await fitmentModuleService.listVehicles({
      make_id: vehicleMakeId,
      model_id: vehicleModelId,
      year_start: vehicleYearStart,
      year_end: vehicleYearEnd ?? vehicleYearStart,
    })

    if (existingVehicles[0]) {
      targetVehicleId = existingVehicles[0].id
    } else {
      try {
        const createdVehicle = await fitmentModuleService.createVehicles({
          make_id: vehicleMakeId,
          model_id: vehicleModelId,
          year_start: vehicleYearStart,
          year_end: vehicleYearEnd ?? vehicleYearStart,
        })
        targetVehicleId = Array.isArray(createdVehicle)
          ? createdVehicle[0].id
          : createdVehicle.id
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.toLowerCase().includes("unique constraint") ||
            error.message.toLowerCase().includes("duplicate key"))
        ) {
          const vehicles = await fitmentModuleService.listVehicles({
            make_id: vehicleMakeId,
            model_id: vehicleModelId,
            year_start: vehicleYearStart,
            year_end: vehicleYearEnd ?? vehicleYearStart,
          })
          if (!vehicles[0]) {
            throw new Error("Failed to resolve vehicle")
          }
          targetVehicleId = vehicles[0].id
        } else {
          throw error
        }
      }
    }
  }

  const updateData: {
    id: string
    vehicle_id: string
    submodels?: Record<string, unknown>
    conditions?: string | null
    notes?: string | null
  } = {
    id: fitmentId,
    vehicle_id: targetVehicleId,
  }

  if (submodels !== undefined) {
    updateData.submodels = submodels as unknown as Record<string, unknown>
  }
  if (conditions !== undefined) {
    updateData.conditions = conditions
  }
  if (notes !== undefined) {
    updateData.notes = notes
  } else if (existingFitment.notes !== undefined) {
    updateData.notes = existingFitment.notes
  }

  const updatedFitment = await fitmentModuleService.updateFitments(updateData)

  try {
    await updateMeiliVehicleIdsForProduct(req.scope, productId)
  } catch (error) {
    console.error("Failed to update Meilisearch vehicle_ids", error)
  }

  res.json({ fitment: updatedFitment })
}
