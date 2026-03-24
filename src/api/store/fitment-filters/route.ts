import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { FITMENT_MODULE } from "../../../modules/fitment"
import FitmentModuleService from "../../../modules/fitment/service"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validateId, safeFilterOr } from "../../../lib/meilisearch-filter"

/**
 * GET /store/fitment-filters
 *
 * Get available submodels and conditions for products that fit the specified vehicle(s).
 * Can be filtered by category, brand, or search query.
 *
 * Query params:
 * - vehicle_id: Single vehicle ID (required, or use vehicle_ids)
 * - vehicle_ids: Comma-separated vehicle IDs
 * - category_id: Optional category filter
 * - brand_id: Optional brand filter
 * - query: Optional search query filter (searches Meilisearch)
 * - sales_channel_id: Optional sales channel filter (for multi-channel visibility)
 *
 * Returns:
 * - submodels: string[] - All available submodels/trims
 * - conditionsBySubmodel: { [submodel: string]: string[] } - Condition strings for each submodel
 * - allConditions: string[] - All conditions (for when no submodel is selected)
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const vehicleId = req.query.vehicle_id as string | undefined
  const vehicleIdsParam = req.query.vehicle_ids as string | undefined
  const categoryId = req.query.category_id as string | undefined
  const brandId = req.query.brand_id as string | undefined
  const searchQuery = req.query.query as string | undefined
  const salesChannelId = req.query.sales_channel_id as string | undefined

  // Parse and validate vehicle IDs
  let vehicleIds: string[] = []
  if (vehicleId) {
    vehicleIds = [vehicleId]
  } else if (vehicleIdsParam) {
    vehicleIds = vehicleIdsParam.split(",").map(id => id.trim()).filter(Boolean)
  }

  // Validate all vehicle IDs to prevent injection
  vehicleIds = vehicleIds
    .map(validateId)
    .filter((v): v is string => v !== null)

  if (!vehicleIds.length) {
    return res.status(400).json({
      message: "vehicle_id or vehicle_ids is required",
    })
  }

  const fitmentService: FitmentModuleService = req.scope.resolve(FITMENT_MODULE)

  // Step 1: Get fitments that match the vehicle IDs
  const fitments = await fitmentService.listFitments(
    { vehicle_id: vehicleIds },
    { select: ["id", "vehicle_id", "submodels", "conditions"] }
  )

  if (!fitments?.length) {
    return res.json({
      submodels: [],
      conditionsBySubmodel: {},
      allConditions: [],
    })
  }

  const fitmentIds = fitments.map(f => f.id)

  // Step 2: Get product IDs from optional filters (category, brand, search)
  let productIdFilter: string[] | null = null

  const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  if (categoryId) {
    // Get product IDs for this category AND all its child categories
    // (products are assigned to leaf categories, not parents)
    // Also filter by sales channel if provided
    const catQuery = salesChannelId
      ? `
        SELECT DISTINCT pcp.product_id
        FROM product_category_product pcp
        JOIN product_sales_channel psc ON psc.product_id = pcp.product_id AND psc.deleted_at IS NULL
        WHERE (pcp.product_category_id = ?
           OR pcp.product_category_id IN (
             SELECT id FROM product_category
             WHERE parent_category_id = ? AND deleted_at IS NULL
           ))
          AND psc.sales_channel_id = ?
      `
      : `
        SELECT DISTINCT pcp.product_id
        FROM product_category_product pcp
        WHERE pcp.product_category_id = ?
           OR pcp.product_category_id IN (
             SELECT id FROM product_category
             WHERE parent_category_id = ? AND deleted_at IS NULL
           )
      `
    const catParams = salesChannelId
      ? [categoryId, categoryId, salesChannelId]
      : [categoryId, categoryId]
    const catResult = await pgConnection.raw(catQuery, catParams)
    productIdFilter = (catResult.rows ?? []).map((r: any) => r.product_id)

    if (!productIdFilter || !productIdFilter.length) {
      return res.json({
        submodels: [],
        conditionsBySubmodel: {},
        allConditions: [],
      })
    }
  } else if (brandId) {
    // Use raw SQL for brand product lookup, with optional sales channel filter
    const brandQuery = salesChannelId
      ? `
        SELECT pb.product_id FROM product_brand pb
        JOIN product_sales_channel psc ON psc.product_id = pb.product_id AND psc.deleted_at IS NULL
        WHERE pb.brand_id = ? AND psc.sales_channel_id = ?
      `
      : `
        SELECT product_id FROM product_brand
        WHERE brand_id = ?
      `
    const brandParams = salesChannelId ? [brandId, salesChannelId] : [brandId]
    const brandResult = await pgConnection.raw(brandQuery, brandParams)
    productIdFilter = (brandResult.rows ?? []).map((r: any) => r.product_id)

    if (!productIdFilter || !productIdFilter.length) {
      return res.json({
        submodels: [],
        conditionsBySubmodel: {},
        allConditions: [],
      })
    }
  } else if (searchQuery) {
    // Filter by search query using Meilisearch
    const meilisearchService = req.scope.resolve("meilisearch")
    const indexes = await meilisearchService.getIndexesByType("products")

    const searchOptions: Record<string, any> = {
      paginationOptions: {
        limit: 1000,
        offset: 0,
      },
      additionalOptions: {
        matchingStrategy: "all",
      },
    }

    // Build filter: vehicle + optional sales channel
    const filters: string[] = []
    const vehicleFilter = safeFilterOr("vehicle_ids", vehicleIds, { validateIds: false })
    if (vehicleFilter) {
      filters.push(vehicleFilter)
    }
    if (salesChannelId) {
      const validatedChannelId = validateId(salesChannelId)
      if (validatedChannelId) {
        filters.push(`sales_channel_ids = "${validatedChannelId}"`)
      }
    }
    if (filters.length > 0) {
      searchOptions.filter = filters.join(" AND ")
    }

    const results = await Promise.all(
      indexes.map((indexKey: string) =>
        meilisearchService.search(indexKey, searchQuery, searchOptions)
      )
    )

    const hits = results.flatMap((r: any) => r.hits || [])
    productIdFilter = hits.map((h: any) => h.id)

    if (!productIdFilter.length) {
      return res.json({
        submodels: [],
        conditionsBySubmodel: {},
        allConditions: [],
      })
    }
  }

  // Step 3: Get product_fitment links for our fitments using raw SQL
  let productFitments: { product_id: string; fitment_id: string }[]

  if (productIdFilter) {
    // Filter by both fitment IDs and product IDs (sales channel already applied in productIdFilter)
    const pfResult = await pgConnection.raw(`
      SELECT product_id, fitment_id
      FROM product_product_fitment_fitment
      WHERE fitment_id = ANY(?) AND product_id = ANY(?)
        AND deleted_at IS NULL
    `, [fitmentIds, productIdFilter])
    productFitments = pfResult.rows ?? []
  } else if (salesChannelId) {
    // Filter by fitment IDs and sales channel
    const pfResult = await pgConnection.raw(`
      SELECT pf.product_id, pf.fitment_id
      FROM product_product_fitment_fitment pf
      JOIN product_sales_channel psc ON psc.product_id = pf.product_id AND psc.deleted_at IS NULL
      WHERE pf.fitment_id = ANY(?)
        AND pf.deleted_at IS NULL
        AND psc.sales_channel_id = ?
    `, [fitmentIds, salesChannelId])
    productFitments = pfResult.rows ?? []
  } else {
    // Filter by fitment IDs only (no sales channel filter)
    const pfResult = await pgConnection.raw(`
      SELECT product_id, fitment_id
      FROM product_product_fitment_fitment
      WHERE fitment_id = ANY(?)
        AND deleted_at IS NULL
    `, [fitmentIds])
    productFitments = pfResult.rows ?? []
  }

  if (!productFitments.length) {
    return res.json({
      submodels: [],
      conditionsBySubmodel: {},
      allConditions: [],
    })
  }

  // Build a map of fitment_id to fitment data for quick lookup
  const fitmentMap = new Map(fitments.map(f => [f.id, f]))

  // Aggregate submodels and track conditions per submodel
  const submodelsSet = new Set<string>()
  const allConditionsSet = new Set<string>()
  const conditionsBySubmodel: Record<string, Set<string>> = {}

  // Track which fitments are used (linked to products that match our filters)
  const usedFitmentIds = new Set(productFitments.map((pf: any) => pf.fitment_id))

  for (const fitmentId of usedFitmentIds) {
    const fitment = fitmentMap.get(fitmentId)
    if (!fitment) continue

    const fitmentSubmodels = fitment.submodels as unknown as string[]
    const fitmentConditions = fitment.conditions

    // Collect conditions if present
    if (fitmentConditions && typeof fitmentConditions === "string" && fitmentConditions.trim()) {
      allConditionsSet.add(fitmentConditions.trim())
    }

    // Aggregate submodels and map conditions to each submodel
    if (Array.isArray(fitmentSubmodels) && fitmentSubmodels.length > 0) {
      for (const s of fitmentSubmodels) {
        if (typeof s === "string" && s.trim()) {
          const submodel = s.trim()
          submodelsSet.add(submodel)

          // Map conditions to this submodel
          if (!conditionsBySubmodel[submodel]) {
            conditionsBySubmodel[submodel] = new Set()
          }
          if (fitmentConditions && typeof fitmentConditions === "string" && fitmentConditions.trim()) {
            conditionsBySubmodel[submodel].add(fitmentConditions.trim())
          }
        }
      }
    } else {
      // No submodel - product fits all trims, but may have conditions
      if (!conditionsBySubmodel["All Trims"]) {
        conditionsBySubmodel["All Trims"] = new Set()
      }
      if (fitmentConditions && typeof fitmentConditions === "string" && fitmentConditions.trim()) {
        conditionsBySubmodel["All Trims"].add(fitmentConditions.trim())
        submodelsSet.add("All Trims")
      }
    }
  }

  // Sort and convert Sets to arrays
  const submodels = Array.from(submodelsSet).sort((a, b) => {
    // Put "All Trims" first
    if (a === "All Trims") return -1
    if (b === "All Trims") return 1
    return a.localeCompare(b)
  })
  const allConditions = Array.from(allConditionsSet).sort()

  const conditionsBySubmodelSorted: Record<string, string[]> = {}
  for (const [submodel, conditionsSet] of Object.entries(conditionsBySubmodel)) {
    conditionsBySubmodelSorted[submodel] = Array.from(conditionsSet).sort()
  }

  res.json({
    submodels,
    conditionsBySubmodel: conditionsBySubmodelSorted,
    allConditions,
  })
}
