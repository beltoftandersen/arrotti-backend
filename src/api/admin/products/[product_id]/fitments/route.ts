import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import FitmentModuleService from "../../../../../modules/fitment/service"
import { FITMENT_MODULE } from "../../../../../modules/fitment"
import { updateMeiliVehicleIdsForProduct } from "../../../../../modules/fitment/services/meili-fitment"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )

  const { data: links } = await query.graph({
    entity: "product_fitment",
    fields: [
      "product_id",
      "fitment_id",
      "fitment.id",
      "fitment.vehicle_id",
      "fitment.submodels",
      "fitment.conditions",
      "fitment.notes",
    ],
    filters: {
      product_id: productId,
    },
  })

  const fitments = (links ?? [])
    .map((link: any) => link.fitment)
    .filter((fitment: any) => fitment?.id)

  const vehicleIds = Array.from(
    new Set(
      fitments
        .map((fitment: any) => fitment.vehicle_id)
        .filter((id: string | undefined) => id)
    )
  )

  const vehicles = vehicleIds.length
    ? await fitmentModuleService.listVehicles({ id: vehicleIds })
    : []

  const makeIds = Array.from(
    new Set(vehicles.map((vehicle) => vehicle.make_id).filter(Boolean))
  )
  const modelIds = Array.from(
    new Set(vehicles.map((vehicle) => vehicle.model_id).filter(Boolean))
  )

  const [makes, models] = await Promise.all([
    makeIds.length
      ? fitmentModuleService.listVehicleMakes({ id: makeIds })
      : Promise.resolve([]),
    modelIds.length
      ? fitmentModuleService.listVehicleModels({ id: modelIds })
      : Promise.resolve([]),
  ])

  const makeMap = new Map(makes.map((make) => [make.id, make]))
  const modelMap = new Map(models.map((model) => [model.id, model]))
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]))

  const response = fitments.map((fitment: any) => {
    const vehicle = vehicleMap.get(fitment.vehicle_id)
    const make = vehicle ? makeMap.get(vehicle.make_id) : undefined
    const model = vehicle ? modelMap.get(vehicle.model_id) : undefined

    return {
      id: fitment.id,
      submodels: fitment.submodels ?? [],
      conditions: fitment.conditions ?? "",
      notes: fitment.notes,
      vehicle: vehicle
        ? {
            id: vehicle.id,
            year_start: vehicle.year_start,
            year_end: vehicle.year_end,
            make_id: vehicle.make_id,
            model_id: vehicle.model_id,
            make_name: make?.name,
            model_name: model?.name,
          }
        : null,
    }
  })

  res.json({ fitments: response })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params
  const body = req.body as {
    vehicle_id?: string
    make_id?: string
    model_id?: string
    year_start?: number | string
    year_end?: number | string
    submodels?: string[]
    conditions?: string | null
    notes?: string | null
  }

  const vehicle_id = body.vehicle_id?.trim()
  const make_id = body.make_id?.trim()
  const model_id = body.model_id?.trim()
  const submodels = Array.isArray(body.submodels) ? body.submodels.filter(s => s?.trim()) : []
  const conditions = body.conditions?.trim() || null
  const notes = body.notes?.trim() || null

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  // Parse years
  const parseYear = (value: number | string | undefined): number | undefined => {
    if (value === undefined || value === "") return undefined
    const num = typeof value === "string" ? Number(value) : value
    return Number.isNaN(num) ? undefined : num
  }

  const parsedYearStart = parseYear(body.year_start)
  const parsedYearEnd = parseYear(body.year_end) ?? parsedYearStart

  if (notes && notes.length > 500) {
    res.status(400).json({ message: "notes must be 500 characters or less" })
    return
  }

  const fitmentModuleService: FitmentModuleService = req.scope.resolve(
    FITMENT_MODULE
  )
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve vehicle_id if not provided directly
  let resolvedVehicleId = vehicle_id

  if (!resolvedVehicleId) {
    if (!make_id || !model_id || !parsedYearStart) {
      res.status(400).json({ message: "vehicle_id or (make_id, model_id, year_start) are required" })
      return
    }

    // Validate year range
    if (parsedYearStart < 1900 || parsedYearStart > 2100) {
      res.status(400).json({ message: "year_start must be between 1900 and 2100" })
      return
    }
    if (parsedYearEnd && (parsedYearEnd < 1900 || parsedYearEnd > 2100)) {
      res.status(400).json({ message: "year_end must be between 1900 and 2100" })
      return
    }
    if (parsedYearEnd && parsedYearStart > parsedYearEnd) {
      res.status(400).json({ message: "year_start must be less than or equal to year_end" })
      return
    }

    // Find or create vehicle
    const existingVehicles = await fitmentModuleService.listVehicles({
      make_id,
      model_id,
      year_start: parsedYearStart,
      year_end: parsedYearEnd,
    })

    if (existingVehicles[0]) {
      resolvedVehicleId = existingVehicles[0].id
    } else {
      const vehicle = await fitmentModuleService.createVehicles({
        make_id,
        model_id,
        year_start: parsedYearStart,
        year_end: parsedYearEnd!,
      })
      resolvedVehicleId = vehicle.id
    }
  }

  // Check if fitment already exists for this vehicle+submodels+conditions combination
  const { data: existingLinks } = await query.graph({
    entity: "product_fitment",
    fields: ["fitment.id", "fitment.vehicle_id", "fitment.submodels", "fitment.conditions"],
    filters: {
      product_id: productId,
    },
  })

  const existingFitment = (existingLinks ?? []).find((linkEntry: any) => {
    const f = linkEntry.fitment
    if (f?.vehicle_id !== resolvedVehicleId) return false

    // Check if submodels match
    const existingSubmodels = f.submodels ?? []
    const submodelsMatch =
      existingSubmodels.length === submodels.length &&
      existingSubmodels.every((s: string) => submodels.includes(s))

    // Check if conditions match (string comparison)
    const existingConditions = f.conditions?.trim() || null
    const conditionsMatch = existingConditions === conditions

    return submodelsMatch && conditionsMatch
  })

  if (existingFitment) {
    res.status(409).json({ message: "Fitment with same vehicle, submodels, and conditions already exists" })
    return
  }

  // Create fitment with submodels and conditions
  const fitment = await fitmentModuleService.createFitments({
    vehicle_id: resolvedVehicleId,
    submodels: submodels as unknown as Record<string, unknown>,
    conditions,
    notes,
  })

  try {
    await link.create({
      [Modules.PRODUCT]: { product_id: productId },
      fitment: { fitment_id: fitment.id },
    })
  } catch (error) {
    await fitmentModuleService.deleteFitments(fitment.id)
    throw error
  }

  try {
    await updateMeiliVehicleIdsForProduct(req.scope, productId)
  } catch (error) {
    console.error("Failed to update Meilisearch vehicle_ids", error)
  }

  res.status(201).json({ fitment })
}
