import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from ".."
import FitmentModuleService from "../service"

/**
 * Update Meilisearch index with fitment data for a product.
 * Updates: vehicle_ids, fitment_text, submodels, conditions
 */
export const updateMeiliVehicleIdsForProduct = async (
  container: any,
  productId: string
) => {
  const meilisearchService = container.resolve("meilisearch")
  const fitmentModuleService: FitmentModuleService = container.resolve(
    FITMENT_MODULE
  )
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Get product-fitment links with fitment data
  const { data: productFitments } = await query.graph({
    entity: "product_fitment",
    fields: [
      "fitment.id",
      "fitment.vehicle_id",
      "fitment.submodels",
      "fitment.conditions",
    ],
    filters: {
      product_id: productId,
    },
  })

  // Extract vehicle_ids, submodels, and conditions from fitments
  const vehicleIdsSet = new Set<string>()
  const submodelsSet = new Set<string>()
  const conditionsSet = new Set<string>()

  for (const pf of productFitments ?? []) {
    const fitment = (pf as any).fitment
    if (!fitment) continue

    if (fitment.vehicle_id) {
      vehicleIdsSet.add(fitment.vehicle_id)
    }
    if (Array.isArray(fitment.submodels)) {
      for (const s of fitment.submodels) {
        if (typeof s === "string" && s.trim()) {
          submodelsSet.add(s.trim())
        }
      }
    }
    if (typeof fitment.conditions === "string" && fitment.conditions.trim()) {
      conditionsSet.add(fitment.conditions.trim())
    }
  }

  const vehicleIds = Array.from(vehicleIdsSet)
  const submodels = Array.from(submodelsSet)
  const conditions = Array.from(conditionsSet)

  // Get fitment text for search
  const fitmentText =
    await fitmentModuleService.listFitmentSearchTextForProduct(productId, query)

  const indexes = await meilisearchService.getIndexesByType("products")

  await Promise.all(
    indexes.map((indexKey: string) =>
      meilisearchService.addDocuments(indexKey, [
        {
          id: productId,
          vehicle_ids: vehicleIds,
          fitment_text: fitmentText,
          submodels: submodels,
          conditions: conditions,
        },
      ])
    )
  )
}
