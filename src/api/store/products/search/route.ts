import type { MedusaStoreRequest, MedusaResponse } from "@medusajs/framework/http"
import { prepareListQuery } from "@medusajs/framework"
import { QueryContext, getVariantAvailability } from "@medusajs/framework/utils"
import { validateId, safeFilterEq, escapeFilterValue } from "../../../../lib/meilisearch-filter"

/**
 * Detect if a query looks like a part number (OEM, partslink, SKU).
 * True if single word, 5+ chars, alphanumeric with hyphens/dots allowed.
 */
function looksLikePartNumber(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed || trimmed.includes(" ")) return false
  if (trimmed.length < 5) return false
  return /^[a-zA-Z0-9._-]+$/.test(trimmed)
}

const FILTERABLE_ATTRIBUTES = [
  "vehicle_ids",
  "category_id",
  "collection_id",
  "brand_id",
  "id",
  "sales_channel_ids",
  "submodels",
  "conditions",
  "price_cents",
  "avg_rating",
  "is_quote_only",
  "oem_number",
  "partslink_no",
  "variant_skus",
] as const
let filterableAttributesReady = false

const ensureFilterableAttributes = async (
  meilisearchService: any,
  indexes: string[]
) => {
  if (filterableAttributesReady) {
    return
  }

  await Promise.all(
    indexes.map(async (indexKey) => {
      const index = meilisearchService.getIndex(indexKey)
      const settings = await index.getSettings()
      const filterable = new Set<string>(settings.filterableAttributes ?? [])
      let updated = false

      for (const attribute of FILTERABLE_ATTRIBUTES) {
        if (!filterable.has(attribute)) {
          filterable.add(attribute)
          updated = true
        }
      }

      if (updated) {
        const task = await index.updateFilterableAttributes(
          Array.from(filterable)
        )
        if (task?.waitTask) {
          await task.waitTask()
        } else if (task?.taskUid && index?.waitForTask) {
          await index.waitForTask(task.taskUid)
        } else if (task?.uid && index?.waitForTask) {
          await index.waitForTask(task.uid)
        }
      }
    })
  )

  filterableAttributesReady = true
}

export async function GET(req: MedusaStoreRequest, res: MedusaResponse) {
  const startTime = performance.now()
  const timings: Record<string, number> = {}

  const {
    q,
    query,
    limit = "12",
    offset = "0",
    vehicle_id,
    vehicle_ids,
    category_id,
    collection_id,
    brand_id,
    id,
    region_id,
    currency_code,
    fields,
    facets,
    submodel: submodelParam,
    conditions: conditionsParam,
    order,
    sort,
    price_min,
    price_max,
    min_rating,
  } = req.query as Record<string, string | string[] | undefined>

  const normalizeQuery = (value?: string | string[]) =>
    Array.isArray(value) ? value.join(" ") : value ?? ""
  const searchQuery = normalizeQuery(q) || normalizeQuery(query)
  // Allow limit=0 for facet-only requests (no products returned, just counts)
  // Note: Must check for undefined/empty explicitly since Number("0") is falsy
  const parsedLimit = limit !== undefined && limit !== "" ? Number(limit) : 12
  const limitNumber = Math.min(Math.max(isNaN(parsedLimit) ? 12 : parsedLimit, 0), 50)
  const offsetNumber = Math.min(Math.max(Number(offset) || 0, 0), 5000)

  // Resolve meilisearch service first (doesn't trigger pricing)
  const meilisearchService = req.scope.resolve("meilisearch")

  // For facet-only requests, do an early Meilisearch query and return without DB
  if (limitNumber === 0) {
    const indexes = await meilisearchService.getIndexesByType("products")
    await ensureFilterableAttributes(meilisearchService, indexes)

    // Build filter for facet query
    const toArray = (value?: string | string[]) =>
      Array.isArray(value) ? value : value ? [value] : []
    const toList = (value?: string | string[]) =>
      toArray(value)
        .flatMap((entry) => entry.split(","))
        .map((entry) => entry.trim())
        .filter(Boolean)

    const filterParts: string[] = []
    // Validate and filter vehicle IDs
    const vehicleIdsList = Array.from(new Set([...toList(vehicle_id), ...toList(vehicle_ids)]))
      .map(validateId)
      .filter((v): v is string => v !== null)
    if (vehicleIdsList.length) {
      const vf = vehicleIdsList.map((v) => safeFilterEq("vehicle_ids", v)).join(" OR ")
      filterParts.push(vehicleIdsList.length > 1 ? `(${vf})` : vf)
    }
    // Validate and filter category IDs
    const categoryIdsList = toList(category_id)
      .map(validateId)
      .filter((v): v is string => v !== null)
    if (categoryIdsList.length) {
      const cf = categoryIdsList.map((c) => safeFilterEq("category_id", c)).join(" OR ")
      filterParts.push(categoryIdsList.length > 1 ? `(${cf})` : cf)
    }
    // Validate and filter brand IDs
    const brandIdsList = toArray(brand_id)
      .map(validateId)
      .filter((v): v is string => v !== null)
    if (brandIdsList.length) {
      const bf = brandIdsList.map((b) => safeFilterEq("brand_id", b)).join(" OR ")
      filterParts.push(brandIdsList.length > 1 ? `(${bf})` : bf)
    }
    // Sales channel filter (from server context, already trusted)
    const salesChannelIds = req.publishable_key_context?.sales_channel_ids
    if (salesChannelIds?.length) {
      const scf = salesChannelIds.map((s) => safeFilterEq("sales_channel_ids", s)).join(" OR ")
      filterParts.push(`(sales_channel_ids IS EMPTY OR ${scf})`)
    }

    // Filter by submodel (indexed as array in Meilisearch)
    // User-provided value - must be escaped
    const submodelFilter = typeof submodelParam === "string" ? submodelParam.trim() : ""
    if (submodelFilter) {
      if (submodelFilter === "All Trims") {
        filterParts.push(`submodels IS EMPTY`)
      } else {
        filterParts.push(safeFilterEq("submodels", submodelFilter))
      }
    }

    // Filter by conditions (indexed as array of strings in Meilisearch)
    // User-provided value - must be escaped
    const conditionsFilter = typeof conditionsParam === "string" ? conditionsParam.trim() : ""
    if (conditionsFilter) {
      filterParts.push(safeFilterEq("conditions", conditionsFilter))
    }

    const facetsList = Array.isArray(facets)
      ? facets
      : facets?.split(",").map((f) => f.trim()).filter(Boolean) ?? []

    const facetOptions: Record<string, any> = {
      paginationOptions: { limit: 0, offset: 0 },
      additionalOptions: { facets: facetsList },
    }
    if (filterParts.length) {
      facetOptions.filter = filterParts.join(" AND ")
    }

    const results = await Promise.all(
      indexes.map((indexKey: string) =>
        meilisearchService.search(indexKey, searchQuery, facetOptions)
      )
    )

    const merged = results.reduce((acc: any, result: any) => {
      const nextDist = { ...(acc.facetDistribution ?? {}) }
      for (const [facet, values] of Object.entries(result.facetDistribution ?? {})) {
        if (!nextDist[facet]) {
          nextDist[facet] = { ...(values as Record<string, number>) }
        } else {
          for (const [val, cnt] of Object.entries(values as Record<string, number>)) {
            nextDist[facet][val] = (nextDist[facet][val] ?? 0) + cnt
          }
        }
      }
      return {
        estimatedTotalHits: (acc.estimatedTotalHits ?? 0) + (result.estimatedTotalHits ?? 0),
        facetDistribution: nextDist,
        facetStats: result.facetStats ?? acc.facetStats ?? {},
      }
    }, { estimatedTotalHits: 0, facetDistribution: {}, facetStats: {} })

    const elapsed = performance.now() - startTime
    console.log(`[products/search] facet-only q="${searchQuery}" ${elapsed.toFixed(1)}ms`)
    res.json({
      products: [],
      count: merged.estimatedTotalHits ?? 0,
      limit: 0,
      offset: offsetNumber,
      facet_distribution: merged.facetDistribution ?? {},
      facet_stats: merged.facetStats ?? {},
    })
    return
  }

  // Regular search - resolve query service (may set up pricing context)
  const queryService = req.scope.resolve("query")

  const fieldsValue = Array.isArray(fields) ? fields.join(",") : fields
  // Use limit matching the page size but offset=0 for the DB query.
  // Pagination is handled by Meilisearch - the DB query just looks up
  // the specific product IDs returned by Meilisearch.
  const queryConfig = prepareListQuery(
    { fields: fieldsValue, limit: limitNumber, offset: 0 },
    {
      defaults: [
        "id",
        "title",
        "handle",
        "status",
        "thumbnail",
        "metadata",
        "*images",
        "*options",
        "*variants",
        "*variants.calculated_price",
        "*variants.options",
        "*brand",
      ],
      isList: true,
    }
  )

  const indexes = await meilisearchService.getIndexesByType("products")
  await ensureFilterableAttributes(meilisearchService, indexes)

  const searchOptions: Record<string, any> = {
    paginationOptions: {
      limit: limitNumber,
      offset: offsetNumber,
    },
    additionalOptions: {
      // Require all search terms to match (e.g., "Honda Accord 2015" won't match "2024 Honda Accord")
      matchingStrategy: "all",
    },
  }
  if (facets) {
    const list = Array.isArray(facets)
      ? facets
      : facets
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
    if (list.length) {
      searchOptions.additionalOptions = {
        ...(searchOptions.additionalOptions ?? {}),
        facets: list,
      }
    }
  }

  const toArray = (value?: string | string[]) =>
    Array.isArray(value) ? value : value ? [value] : []
  const toList = (value?: string | string[]) =>
    toArray(value)
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter(Boolean)

  const filterParts: string[] = []

  // Validate and filter vehicle IDs
  const vehicleIds = Array.from(
    new Set([...toList(vehicle_id), ...toList(vehicle_ids)])
  )
    .map(validateId)
    .filter((v): v is string => v !== null)
  if (vehicleIds.length) {
    const vehicleFilter = vehicleIds
      .map((value) => safeFilterEq("vehicle_ids", value))
      .join(" OR ")
    filterParts.push(
      vehicleIds.length > 1 ? `(${vehicleFilter})` : vehicleFilter
    )
  }

  // Validate and filter category IDs
  const categoryIds = toList(category_id)
    .map(validateId)
    .filter((v): v is string => v !== null)
  if (categoryIds.length) {
    const categoryFilter = categoryIds
      .map((value) => safeFilterEq("category_id", value))
      .join(" OR ")
    filterParts.push(
      categoryIds.length > 1 ? `(${categoryFilter})` : categoryFilter
    )
  }

  // Validate and filter collection IDs
  const collectionIds = toArray(collection_id)
    .map(validateId)
    .filter((v): v is string => v !== null)
  if (collectionIds.length) {
    const collectionFilter = collectionIds
      .map((value) => safeFilterEq("collection_id", value))
      .join(" OR ")
    filterParts.push(
      collectionIds.length > 1 ? `(${collectionFilter})` : collectionFilter
    )
  }

  // Validate and filter brand IDs
  const brandIds = toArray(brand_id)
    .map(validateId)
    .filter((v): v is string => v !== null)
  if (brandIds.length) {
    const brandFilter = brandIds
      .map((value) => safeFilterEq("brand_id", value))
      .join(" OR ")
    filterParts.push(
      brandIds.length > 1 ? `(${brandFilter})` : brandFilter
    )
  }

  // Validate and filter product IDs
  const ids = toArray(id)
    .map(validateId)
    .filter((v): v is string => v !== null)
  if (ids.length) {
    const idFilter = ids.map((value) => safeFilterEq("id", value)).join(" OR ")
    filterParts.push(ids.length > 1 ? `(${idFilter})` : idFilter)
  }

  // Filter by sales channel from publishable API key (server context - trusted)
  // Products with empty sales_channel_ids are unrestricted (visible everywhere)
  // Products with sales_channel_ids must match the publishable key's channels
  const salesChannelIds = req.publishable_key_context?.sales_channel_ids
  if (salesChannelIds?.length) {
    const matchesChannel = salesChannelIds
      .map((value) => safeFilterEq("sales_channel_ids", value))
      .join(" OR ")
    // Show products that are either unrestricted (empty) OR in the specified channels
    filterParts.push(
      `(sales_channel_ids IS EMPTY OR ${matchesChannel})`
    )
  }

  // Filter by submodel (indexed as array in Meilisearch)
  // User-provided value - must be escaped
  const submodelFilter = typeof submodelParam === "string" ? submodelParam.trim() : ""
  if (submodelFilter) {
    if (submodelFilter === "All Trims") {
      // "All Trims" means products with empty submodels array
      filterParts.push(`submodels IS EMPTY`)
    } else {
      // Filter by specific submodel - escape to prevent injection
      filterParts.push(safeFilterEq("submodels", submodelFilter))
    }
  }

  // Filter by conditions (indexed as array of strings in Meilisearch)
  // User-provided value - must be escaped
  const conditionsFilter = typeof conditionsParam === "string" ? conditionsParam.trim() : ""
  if (conditionsFilter) {
    filterParts.push(safeFilterEq("conditions", conditionsFilter))
  }

  // Filter by price range (price_cents is integer, in cents)
  const priceMinValue = typeof price_min === "string" ? parseInt(price_min, 10) : NaN
  const priceMaxValue = typeof price_max === "string" ? parseInt(price_max, 10) : NaN
  if (!isNaN(priceMinValue)) {
    filterParts.push(`price_cents >= ${priceMinValue}`)
  }
  if (!isNaN(priceMaxValue)) {
    filterParts.push(`price_cents <= ${priceMaxValue}`)
  }

  // Filter by minimum rating (avg_rating is float 0-5)
  const minRatingValue = typeof min_rating === "string" ? parseInt(min_rating, 10) : NaN
  if (!isNaN(minRatingValue) && minRatingValue >= 1 && minRatingValue <= 5) {
    filterParts.push(`avg_rating >= ${minRatingValue}`)
  }

  // Handle sorting - support both 'order' and 'sort' parameters
  // Format: "created_at" or "created_at:desc" or "title:asc"
  const sortParam = (typeof order === "string" ? order : typeof sort === "string" ? sort : "").trim()
  if (sortParam) {
    // Map common sort options to Meilisearch format
    const sortMapping: Record<string, string> = {
      "created_at": "created_at:desc",
      "-created_at": "created_at:asc",
      "title": "title:asc",
      "-title": "title:desc",
      "price_asc": "price_cents:asc",
      "price_desc": "price_cents:desc",
    }
    const sortValue = sortMapping[sortParam] || sortParam
    // Only apply sort if it's a valid format (contains : or is in mapping)
    if (sortValue.includes(":")) {
      // Price sorts: prefix with is_quote_only:asc so Meilisearch ranks
      // priced items (is_quote_only=false) globally before quote-only
      // items (is_quote_only=true) in BOTH directions — quotes always
      // at the end. Without this, pagination ships a page full of
      // quote-only items first when they outnumber priced items.
      const sortArray =
        sortParam === "price_asc" || sortParam === "price_desc"
          ? ["is_quote_only:asc", sortValue]
          : [sortValue]
      searchOptions.additionalOptions = {
        ...(searchOptions.additionalOptions ?? {}),
        sort: sortArray,
      }
    }
  }

  // When sorting by price, hide products with no real price data so
  // truly unpriced items don't dominate the top of the asc list — but
  // keep quote-only products visible, since they intentionally have no
  // price_cents and should still appear in sorted results.
  if (sortParam === "price_asc" || sortParam === "price_desc") {
    filterParts.push("(price_cents > 0 OR is_quote_only = true)")
  }

  if (filterParts.length) {
    searchOptions.filter = filterParts.join(" AND ")
  }

  // --- Exact match phase for part-number-like queries ---
  let exactMatchUsed = false
  let results: any[]

  if (searchQuery && looksLikePartNumber(searchQuery)) {
    const escaped = escapeFilterValue(searchQuery)
    const partFilter = `oem_number = "${escaped}" OR partslink_no = "${escaped}" OR variant_skus = "${escaped}"`
    const exactFilter = filterParts.length
      ? `(${partFilter}) AND ${filterParts.join(" AND ")}`
      : partFilter

    const exactOptions = {
      ...searchOptions,
      filter: exactFilter,
    }

    const exactStart = performance.now()
    const exactResults = await Promise.all(
      indexes.map((indexKey: string) =>
        meilisearchService.search(indexKey, "", exactOptions)
      )
    )
    timings.exactMatch = performance.now() - exactStart

    const totalExactHits = exactResults.reduce(
      (sum: number, r: any) => sum + (r.estimatedTotalHits || r.hits?.length || 0),
      0
    )

    if (totalExactHits > 0) {
      exactMatchUsed = true
      results = exactResults
      console.log(`[products/search] exact match for "${searchQuery}" found ${totalExactHits} hits`)
    } else {
      // Fall through to fuzzy search
      const searchStart = performance.now()
      results = await Promise.all(
        indexes.map((indexKey: string) =>
          meilisearchService.search(indexKey, searchQuery, searchOptions)
        )
      )
      timings.meilisearch = performance.now() - searchStart
    }
  } else {
    const searchStart = performance.now()
    results = await Promise.all(
      indexes.map((indexKey: string) =>
        meilisearchService.search(indexKey, searchQuery, searchOptions)
      )
    )
    timings.meilisearch = performance.now() - searchStart
  }

  const mergedResults = results.reduce(
    (acc: any, result: any) => {
      const nextFacetDistribution = { ...(acc.facetDistribution ?? {}) }
      const resultFacets = result.facetDistribution ?? {}
      for (const [facet, values] of Object.entries(resultFacets)) {
        const existing = (nextFacetDistribution as Record<string, any>)[facet]
        if (!existing) {
          ;(nextFacetDistribution as Record<string, any>)[facet] = {
            ...(values as Record<string, number>),
          }
          continue
        }

        for (const [value, count] of Object.entries(
          values as Record<string, number>
        )) {
          existing[value] = (existing[value] ?? 0) + (count ?? 0)
        }
      }

      return {
        hits: [...acc.hits, ...result.hits],
        estimatedTotalHits:
          (acc.estimatedTotalHits || 0) + (result.estimatedTotalHits || 0),
        processingTimeMs: Math.max(
          acc.processingTimeMs,
          result.processingTimeMs
        ),
        query: result.query,
        facetDistribution: nextFacetDistribution,
      }
    },
    {
      hits: [],
      estimatedTotalHits: 0,
      processingTimeMs: 0,
      query: searchQuery,
      facetDistribution: {},
    }
  )

  // Re-sort merged hits across indexes. Each Meilisearch index returns
  // its own sorted slice, but the reduce above simply concatenates
  // them — without this pass, items from a later index always appear
  // after all items from an earlier index regardless of the sort key.
  if (sortParam === "price_asc" || sortParam === "price_desc") {
    const dir = sortParam === "price_asc" ? 1 : -1
    mergedResults.hits.sort((a: any, b: any) => {
      // Quote-only items always sort to the end — they don't compete
      // with priced items on price, regardless of direction.
      const qa = a.is_quote_only === true
      const qb = b.is_quote_only === true
      if (qa !== qb) return qa ? 1 : -1

      const pa = typeof a.price_cents === "number" ? a.price_cents : null
      const pb = typeof b.price_cents === "number" ? b.price_cents : null
      // Null / missing price also goes to the end among each tier.
      if (pa === null && pb === null) return 0
      if (pa === null) return 1
      if (pb === null) return -1
      return (pa - pb) * dir
    })
  } else if (sortParam === "title" || sortParam === "-title") {
    const dir = sortParam === "title" ? 1 : -1
    mergedResults.hits.sort((a: any, b: any) => {
      const ta = String(a.title ?? "")
      const tb = String(b.title ?? "")
      return ta.localeCompare(tb) * dir
    })
  } else if (sortParam === "created_at" || sortParam === "-created_at") {
    const dir = sortParam === "-created_at" ? 1 : -1 // "created_at" maps to DESC (newest first)
    mergedResults.hits.sort((a: any, b: any) => {
      const ca = typeof a.created_at === "number" ? a.created_at : 0
      const cb = typeof b.created_at === "number" ? b.created_at : 0
      return (ca - cb) * dir
    })
  }

  // Submodel/conditions filtering is now done in Meilisearch (no more post-filtering)
  const productIds = mergedResults.hits.map((hit: any) => hit.id)

  if (!productIds.length) {
    timings.total = performance.now() - startTime
    console.log(
      `[products/search] q="${searchQuery}" products=0 ` +
      `meilisearch=${timings.meilisearch?.toFixed(1)}ms ` +
      `total=${timings.total.toFixed(1)}ms`
    )
    res.json({
      products: [],
      count: 0,
      limit: limitNumber,
      offset: offsetNumber,
      facet_distribution: mergedResults.facetDistribution ?? {},
      facet_stats: {},
    })
    return
  }

  const filters = {
    id: { $in: productIds },
  }

  // Build pricing context from region_id and currency_code
  const context: Record<string, any> = {}
  if (region_id || currency_code) {
    context.variants = {
      calculated_price: QueryContext({
        region_id: region_id as string | undefined,
        currency_code: currency_code as string | undefined
      }),
    }
  }

  const dbStart = performance.now()
  const { data: products } = await queryService.graph({
    entity: "product",
    ...queryConfig.remoteQueryConfig,
    filters,
    ...(Object.keys(context).length ? { context } : {}),
  })
  timings.database = performance.now() - dbStart

  // Get inventory availability using sales channel from publishable API key
  if (salesChannelIds?.length) {
    const variantIds = products.flatMap((p: any) =>
      (p.variants || []).map((v: any) => v.id)
    ).filter(Boolean)

    if (variantIds.length) {
      const inventoryStart = performance.now()
      const availability = await getVariantAvailability(queryService, {
        variant_ids: variantIds,
        sales_channel_id: salesChannelIds[0],
      })
      timings.inventory = performance.now() - inventoryStart

      // Attach inventory_quantity to each variant
      for (const product of products) {
        for (const variant of product.variants || []) {
          const variantAvailability = availability[variant.id]
          if (variantAvailability) {
            ;(variant as any).inventory_quantity = variantAvailability.availability ?? 0
          }
        }
      }
    }
  }

  // Create maps of product ID to Meilisearch data
  const meilisearchDataMap = new Map<string, Record<string, any>>()
  for (const hit of mergedResults.hits) {
    if (hit.id) {
      meilisearchDataMap.set(hit.id, {
        vehicle_ids: hit.vehicle_ids || [],
        variant_skus: hit.variant_skus || [],
        fitment_text: hit.fitment_text || [],
        conditions: hit.conditions || [],
        fitments: hit.fitments || [],
        oem_number: hit.oem_number || null,
        partslink_no: hit.partslink_no || null,
      })
    }
  }
  // Sort products and attach Meilisearch data
  const orderedProducts = products
    .sort((a: any, b: any) => {
      const aIndex = productIds.indexOf(a.id)
      const bIndex = productIds.indexOf(b.id)
      return aIndex - bIndex
    })
    .map((product: any) => ({
      ...product,
      ...(meilisearchDataMap.get(product.id) || {
        vehicle_ids: [],
        variant_skus: [],
        fitment_text: [],
        conditions: [],
        fitments: [],
        oem_number: null,
        partslink_no: null,
      }),
    }))

  timings.total = performance.now() - startTime
  console.log(
    `[products/search] q="${searchQuery}" products=${orderedProducts.length} ` +
    `meilisearch=${timings.meilisearch?.toFixed(1)}ms ` +
    `db=${timings.database?.toFixed(1)}ms ` +
    `inventory=${timings.inventory?.toFixed(1) ?? "n/a"}ms ` +
    `total=${timings.total.toFixed(1)}ms`
  )

  // Merge facetStats from all results (for numeric facets like price_cents, avg_rating)
  const mergedFacetStats = results.reduce((acc: any, result: any) => {
    const stats = result.facetStats ?? {}
    for (const [field, values] of Object.entries(stats as Record<string, { min: number; max: number }>)) {
      if (!acc[field]) {
        acc[field] = { min: values.min, max: values.max }
      } else {
        acc[field].min = Math.min(acc[field].min, values.min)
        acc[field].max = Math.max(acc[field].max, values.max)
      }
    }
    return acc
  }, {})

  res.json({
    products: orderedProducts,
    count: mergedResults.estimatedTotalHits ?? orderedProducts.length,
    limit: limitNumber,
    offset: offsetNumber,
    facet_distribution: mergedResults.facetDistribution ?? {},
    facet_stats: mergedFacetStats,
  })
}
