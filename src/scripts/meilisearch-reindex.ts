import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../modules/fitment"
import FitmentModuleService from "../modules/fitment/service"
import { PRODUCT_REVIEW_MODULE } from "../modules/product-review"
import ProductReviewModuleService from "../modules/product-review/service"

type IndexedProduct = {
  id: string
  title?: string | null
  description?: string | null
  handle?: string | null
  thumbnail?: string | null
  collection_id?: string | null
  categories?: { id: string }[] | null
  metadata?: Record<string, string> | null
  created_at?: string | Date | null
}

const FILTERABLE_ATTRIBUTES = [
  "id",
  "handle",
  "vehicle_ids",
  "category_id",
  "collection_id",
  "brand_id",
  "sales_channel_ids",
  "submodels",
  "conditions",
  "price_cents",
  "avg_rating",
  "is_quote_only",
]

const SORTABLE_ATTRIBUTES = [
  "created_at",
  "title",
  "price_cents",
  "avg_rating",
  "vehicle_token_count",
  "primary_category_handle",
  // Used as a primary sort key so quote-only items rank after all
  // priced items when the user sorts by price.
  "is_quote_only",
]

// Tiebreakers appended after Meilisearch defaults:
// - vehicle_token_count:asc — shorter vehicle strings win equal-score ties
// - primary_category_handle:asc — Partslink numeric prefixes make "main"
//   categories (e.g. 1000-1000-front-bumper-cover) sort before supportive
//   ones (1000-1031-front-bumper-cover-retainer), clustering same-category
//   products together
const RANKING_RULES = [
  "sort",
  "words",
  "typo",
  "proximity",
  "attribute",
  "exactness",
  "vehicle_token_count:asc",
  "primary_category_handle:asc",
]

// Searchable attributes — order matters. Earlier = more weight in Meilisearch's
// `attribute` ranking rule. `vehicle` is above `fitment_text` so exact model
// matches (one entry per fitment) win over year-expanded fitment_text matches
// (one entry per year) when the query includes a vehicle model name.
const SEARCHABLE_ATTRIBUTES = [
  "title",
  "vehicle",
  "description",
  "ksi_part_desc",
  "fitment_text",
  "oem_number",
  "partslink_no",
  "variant_skus",
  "submodels",
  "conditions",
]

export default async function meilisearchReindex({
  container,
}: {
  container: any
}) {
  const meilisearchService = container.resolve("meilisearch")
  const productModuleService = container.resolve(Modules.PRODUCT)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fitmentModuleService: FitmentModuleService =
    container.resolve(FITMENT_MODULE)
  const productReviewService: ProductReviewModuleService =
    container.resolve(PRODUCT_REVIEW_MODULE)

  console.log("[reindex] Starting Meilisearch reindex...")
  const startTime = performance.now()

  // Ensure filterable attributes are set
  const indexes = await meilisearchService.getIndexesByType("products")

  await Promise.all(
    indexes.map(async (indexKey: string) => {
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
        }
      }

      // Ensure sortable attributes
      const sortable = new Set<string>(settings.sortableAttributes ?? [])
      let sortableUpdated = false
      for (const attribute of SORTABLE_ATTRIBUTES) {
        if (!sortable.has(attribute)) {
          sortable.add(attribute)
          sortableUpdated = true
        }
      }
      if (sortableUpdated) {
        const task = await index.updateSortableAttributes(Array.from(sortable))
        if (task?.waitTask) {
          await task.waitTask()
        }
      }

      // Ensure searchable attributes match (order matters — this overrides)
      const currentSearchable = settings.searchableAttributes ?? []
      const searchableMatch =
        currentSearchable.length === SEARCHABLE_ATTRIBUTES.length &&
        currentSearchable.every((attr: string, idx: number) => attr === SEARCHABLE_ATTRIBUTES[idx])
      if (!searchableMatch) {
        const task = await index.updateSearchableAttributes(SEARCHABLE_ATTRIBUTES)
        if (task?.waitTask) {
          await task.waitTask()
        }
      }

      // Ensure ranking rules match (order matters)
      const currentRules = settings.rankingRules ?? []
      const rulesMatch =
        currentRules.length === RANKING_RULES.length &&
        currentRules.every((rule: string, idx: number) => rule === RANKING_RULES[idx])
      if (!rulesMatch) {
        const task = await index.updateRankingRules(RANKING_RULES)
        if (task?.waitTask) {
          await task.waitTask()
        }
      }

      // Ensure maxTotalHits is high enough for our product count
      const paginationSettings = settings.pagination ?? {}
      if (!paginationSettings.maxTotalHits || paginationSettings.maxTotalHits < 200000) {
        const task = await index.updatePagination({ maxTotalHits: 200000 })
        if (task?.waitTask) {
          await task.waitTask()
        }
      }
    })
  )

  // === PHASE 1: Batch load ALL related data upfront ===
  console.log("[reindex] Loading all fitment data...")
  const fitmentStart = performance.now()

  // Load ALL product_fitment links with fitment details
  const { data: allProductFitments } = await query.graph({
    entity: "product_fitment",
    fields: [
      "product_id",
      "fitment.id",
      "fitment.vehicle_id",
      "fitment.submodels",
      "fitment.conditions",
      "fitment.notes",
      "fitment.has_notes_notice",
    ],
  })
  console.log(`[reindex] Loaded ${allProductFitments?.length ?? 0} product-fitment links`)

  // Build lookup maps: productId -> individual fitment records
  // Each fitment record links a vehicle_id to its specific submodels and conditions
  type FitmentRecord = {
    vehicle_id: string
    submodels: string[]
    conditions: string
    notes: string | null
    has_notes_notice: boolean
  }
  const fitmentByProduct = new Map<string, FitmentRecord[]>()

  for (const pf of allProductFitments ?? []) {
    const productId = (pf as any).product_id
    const fitment = (pf as any).fitment
    if (!productId || !fitment?.vehicle_id) continue

    if (!fitmentByProduct.has(productId)) {
      fitmentByProduct.set(productId, [])
    }

    const submodels: string[] = []
    if (Array.isArray(fitment.submodels)) {
      for (const s of fitment.submodels) {
        if (typeof s === "string" && s.trim()) {
          submodels.push(s.trim())
        }
      }
    }

    const conditions = (typeof fitment.conditions === "string" && fitment.conditions.trim())
      ? fitment.conditions.trim()
      : ""

    fitmentByProduct.get(productId)!.push({
      vehicle_id: fitment.vehicle_id,
      submodels,
      conditions,
      notes: fitment.notes || null,
      has_notes_notice: fitment.has_notes_notice || false,
    })
  }
  console.log(`[reindex] Built fitment map for ${fitmentByProduct.size} products (${(performance.now() - fitmentStart).toFixed(0)}ms)`)

  // Load ALL vehicles for generating fitment_text
  console.log("[reindex] Loading all vehicles for fitment text...")
  const vehicleStart = performance.now()
  const allVehicles = await fitmentModuleService.listVehicles({})
  const allMakes = await fitmentModuleService.listVehicleMakes({})
  const allModels = await fitmentModuleService.listVehicleModels({})

  // Build lookup maps for vehicle text generation
  const makeById = new Map(allMakes.map((m) => [m.id, m.name]))
  const modelById = new Map(allModels.map((m) => [m.id, m.name]))
  // Map vehicle ID to an ARRAY of text strings (one for each year in range)
  const vehicleTextsById = new Map<string, string[]>()
  // Map vehicle ID to structured info for the fitments array
  const vehicleInfoById = new Map<string, { make: string; model: string; year_start: number; year_end: number }>()

  for (const vehicle of allVehicles) {
    const makeName = makeById.get(vehicle.make_id) ?? "Unknown"
    const modelName = modelById.get(vehicle.model_id) ?? "Unknown"
    // Generate text for EACH year in range so search can find "2016" in a 2015-2018 range
    const texts: string[] = []
    for (let year = vehicle.year_start; year <= vehicle.year_end; year++) {
      texts.push(`${year} ${makeName} ${modelName}`)
    }
    vehicleTextsById.set(vehicle.id, texts)
    vehicleInfoById.set(vehicle.id, {
      make: makeName,
      model: modelName,
      year_start: vehicle.year_start,
      year_end: vehicle.year_end,
    })
  }
  console.log(`[reindex] Built vehicle text/info maps for ${vehicleTextsById.size} vehicles (${(performance.now() - vehicleStart).toFixed(0)}ms)`)

  // Load ALL product_brand links
  console.log("[reindex] Loading all brand links...")
  const brandStart = performance.now()
  const { data: allBrandLinks } = await query.graph({
    entity: "product_brand",
    fields: ["product_id", "brand_id"],
  })
  const brandByProduct = new Map<string, string>()
  for (const link of allBrandLinks ?? []) {
    const productId = (link as any).product_id
    const brandId = (link as any).brand_id
    if (productId && brandId) {
      brandByProduct.set(productId, brandId)
    }
  }
  console.log(`[reindex] Built brand map for ${brandByProduct.size} products (${(performance.now() - brandStart).toFixed(0)}ms)`)

  // Load ALL product_sales_channel links
  console.log("[reindex] Loading all sales channel links...")
  const scStart = performance.now()
  const { data: allSalesChannelLinks } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id", "sales_channel_id"],
  })
  const salesChannelsByProduct = new Map<string, string[]>()
  for (const link of allSalesChannelLinks ?? []) {
    const productId = (link as any).product_id
    const salesChannelId = (link as any).sales_channel_id
    if (productId && salesChannelId) {
      if (!salesChannelsByProduct.has(productId)) {
        salesChannelsByProduct.set(productId, [])
      }
      salesChannelsByProduct.get(productId)!.push(salesChannelId)
    }
  }
  console.log(`[reindex] Built sales channel map for ${salesChannelsByProduct.size} products (${(performance.now() - scStart).toFixed(0)}ms)`)

  // Load ALL categories to build ancestor map
  console.log("[reindex] Loading all categories for hierarchy...")
  const categoryStart = performance.now()
  const { data: allCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "parent_category_id"],
  })

  // Build map: categoryId -> all ancestor category IDs (including self)
  const categoryAncestors = new Map<string, Set<string>>()
  const parentMap = new Map<string, string | null>()
  for (const cat of allCategories ?? []) {
    parentMap.set((cat as any).id, (cat as any).parent_category_id ?? null)
  }

  // For each category, walk up the tree and collect all ancestors
  for (const cat of allCategories ?? []) {
    const catId = (cat as any).id
    const ancestors = new Set<string>()
    let current: string | null = catId
    while (current) {
      ancestors.add(current)
      current = parentMap.get(current) ?? null
    }
    categoryAncestors.set(catId, ancestors)
  }
  console.log(`[reindex] Built category ancestor map for ${categoryAncestors.size} categories (${(performance.now() - categoryStart).toFixed(0)}ms)`)

  // Load ALL variant prices (min USD price per product)
  console.log("[reindex] Loading all variant prices...")
  const priceStart = performance.now()
  const priceByProduct = new Map<string, number>()
  try {
    // Medusa v2 pricing: product_variant -> product_variant_price_set -> price
    // price.amount is in dollars (e.g., 54.5 = $54.50), convert to cents for integer filtering
    const db = container.resolve("__pg_connection__")
    const priceRows = await db.raw(
      `SELECT pv.product_id, MIN(p.amount) FILTER (WHERE p.amount > 0) as min_price
       FROM product_variant pv
       JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id AND pvps.deleted_at IS NULL
       JOIN price p ON p.price_set_id = pvps.price_set_id AND p.deleted_at IS NULL
       WHERE p.currency_code = 'usd'
         AND pv.deleted_at IS NULL
       GROUP BY pv.product_id`
    )
    for (const row of priceRows?.rows ?? priceRows ?? []) {
      if (row.product_id && row.min_price != null) {
        // Convert dollars to cents (round to avoid floating point issues)
        priceByProduct.set(row.product_id, Math.round(Number(row.min_price) * 100))
      }
    }
  } catch (e) {
    console.warn(`[reindex] Could not load prices: ${e}`)
  }
  console.log(`[reindex] Built price map for ${priceByProduct.size} products (${(performance.now() - priceStart).toFixed(0)}ms)`)

  // Load ALL average ratings
  console.log("[reindex] Loading all average ratings...")
  const ratingStart = performance.now()
  const ratingByProduct = await productReviewService.getAllAverageRatings()
  console.log(`[reindex] Built rating map for ${ratingByProduct.size} products (${(performance.now() - ratingStart).toFixed(0)}ms)`)

  // Load ALL variant SKUs + ksi_part_desc
  console.log("[reindex] Loading all variant SKUs and ksi_part_desc...")
  const skuStart = performance.now()
  const skusByProduct = new Map<string, string[]>()
  const ksiPartDescsByProduct = new Map<string, Set<string>>()
  try {
    const db = container.resolve("__pg_connection__")
    const skuRows = await db.raw(
      `SELECT product_id, sku, metadata->>'ksi_part_desc' AS ksi_part_desc
       FROM product_variant
       WHERE deleted_at IS NULL`
    )
    for (const row of skuRows?.rows ?? skuRows ?? []) {
      if (!row.product_id) continue
      if (row.sku) {
        if (!skusByProduct.has(row.product_id)) {
          skusByProduct.set(row.product_id, [])
        }
        skusByProduct.get(row.product_id)!.push(row.sku)
      }
      if (row.ksi_part_desc) {
        if (!ksiPartDescsByProduct.has(row.product_id)) {
          ksiPartDescsByProduct.set(row.product_id, new Set())
        }
        ksiPartDescsByProduct.get(row.product_id)!.add(row.ksi_part_desc)
      }
    }
  } catch (e) {
    console.warn(`[reindex] Could not load variant SKUs/ksi_part_desc: ${e}`)
  }
  console.log(`[reindex] Built SKU map for ${skusByProduct.size} products, ksi_part_desc map for ${ksiPartDescsByProduct.size} products (${(performance.now() - skuStart).toFixed(0)}ms)`)

  // === PHASE 2: Process products in batches ===
  console.log("[reindex] Processing products...")
  const batchSize = 200
  let offset = 0
  let totalProducts = 0

  while (true) {
    const products = await productModuleService.listProducts(
      { status: "published" },
      {
        select: [
          "id",
          "title",
          "description",
          "handle",
          "thumbnail",
          "collection_id",
          "metadata",
          "created_at",
        ],
        relations: ["categories"],
        skip: offset,
        take: batchSize,
      }
    )

    if (!products?.length) {
      break
    }

    // Build documents using pre-loaded lookup maps (no per-product queries!)
    const docs = (products as IndexedProduct[]).map((product) => {
      const fitmentRecords = fitmentByProduct.get(product.id) ?? []

      // Derive flat arrays for filtering/search (backward compat)
      const vehicleIdSet = new Set<string>()
      const submodelSet = new Set<string>()
      const conditionSet = new Set<string>()
      for (const rec of fitmentRecords) {
        vehicleIdSet.add(rec.vehicle_id)
        for (const s of rec.submodels) submodelSet.add(s)
        if (rec.conditions) conditionSet.add(rec.conditions)
      }
      const vehicleIds = Array.from(vehicleIdSet)
      const submodels = Array.from(submodelSet)
      const conditions = Array.from(conditionSet)

      // Generate fitment_text from vehicle IDs - flatten arrays since each vehicle has multiple year texts
      const fitmentText = vehicleIds
        .flatMap((vid) => vehicleTextsById.get(vid) ?? [])
        .filter(Boolean)

      // Build structured fitments array: group fitment records by vehicle_id,
      // merge conditions for same vehicle
      const byVehicle = new Map<string, { submodels: Set<string>; conditions: Set<string>; notes: Set<string>; has_notes_notice: boolean }>()
      for (const rec of fitmentRecords) {
        if (!byVehicle.has(rec.vehicle_id)) {
          byVehicle.set(rec.vehicle_id, { submodels: new Set(), conditions: new Set(), notes: new Set(), has_notes_notice: false })
        }
        const entry = byVehicle.get(rec.vehicle_id)!
        for (const s of rec.submodels) entry.submodels.add(s)
        if (rec.conditions) entry.conditions.add(rec.conditions)
        if (rec.notes) rec.notes.split("/").forEach(n => n.trim() && entry.notes.add(n.trim()))
        if (rec.has_notes_notice) entry.has_notes_notice = true
      }

      const structuredFitments = Array.from(byVehicle.entries()).map(([vid, data]) => {
        const vInfo = vehicleInfoById.get(vid)
        const years = vInfo
          ? (vInfo.year_start === vInfo.year_end ? `${vInfo.year_start}` : `${vInfo.year_start}-${vInfo.year_end}`)
          : ""
        return {
          vehicle_id: vid,
          vehicle: vInfo ? `${years} ${vInfo.make} ${vInfo.model}` : vid,
          years,
          make: vInfo?.make ?? "",
          model: vInfo?.model ?? "",
          submodels: Array.from(data.submodels),
          conditions: Array.from(data.conditions),
          notes: Array.from(data.notes),
          has_notes_notice: data.has_notes_notice,
        }
      })

      // Searchable vehicle strings: one entry per fitment (not year-expanded)
      const vehicleStrings = structuredFitments
        .map((f) => f.vehicle)
        .filter((v): v is string => !!v && v !== "")
      // Min token count across fitments — tiebreaker for equal-score ties
      const vehicleTokenCount = vehicleStrings.length > 0
        ? Math.min(
            ...vehicleStrings.map(
              (v) => v.split(/[\s-]+/).filter(Boolean).length
            )
          )
        : 0

      // Get all category IDs including ancestors (so product in "Front Bumpers" also appears in "Bumpers")
      const directCategoryIds = Array.isArray(product.categories)
        ? product.categories.map((category) => category?.id).filter(Boolean)
        : []
      const categoryIds = Array.from(
        new Set(
          directCategoryIds.flatMap((catId) =>
            Array.from(categoryAncestors.get(catId) ?? [catId])
          )
        )
      )

      // Leaf category handle — min across directly-assigned categories.
      // Partslink-style numeric prefixes make "main" categories sort before
      // supportive ones naturally.
      const directCategoryHandles = Array.isArray(product.categories)
        ? (product.categories as any[])
            .map((c) => c?.handle as string | undefined)
            .filter((h): h is string => !!h)
        : []
      const primaryCategoryHandle = directCategoryHandles.length > 0
        ? [...directCategoryHandles].sort()[0]
        : null

      const brandId = brandByProduct.get(product.id) ?? null
      const salesChannelIds = salesChannelsByProduct.get(product.id) ?? []

      // Extract part numbers from metadata
      const metadata = product.metadata as Record<string, string> | undefined
      const oemNumber = metadata?.oem ?? null
      const partslinkNo = metadata?.partslink_no ?? null

      // Convert created_at to Unix timestamp for sorting
      const createdAtTimestamp = product.created_at
        ? Math.floor(new Date(product.created_at as string).getTime() / 1000)
        : 0

      const priceCents = priceByProduct.get(product.id) ?? null
      const avgRating = ratingByProduct.get(product.id) ?? 0
      const variantSkus = skusByProduct.get(product.id) ?? []
      const ksiPartDesc = Array.from(ksiPartDescsByProduct.get(product.id) ?? [])

      return {
        id: product.id,
        title: product.title ?? null,
        description: product.description ?? null,
        handle: product.handle ?? null,
        thumbnail: product.thumbnail ?? null,
        collection_id: product.collection_id ?? null,
        category_id: categoryIds.length ? categoryIds : null,
        primary_category_handle: primaryCategoryHandle,
        vehicle_ids: vehicleIds,
        vehicle: vehicleStrings,
        vehicle_token_count: vehicleTokenCount,
        fitment_text: fitmentText,
        submodels: submodels,
        conditions: conditions,
        fitments: structuredFitments,
        brand_id: brandId,
        sales_channel_ids: salesChannelIds,
        oem_number: oemNumber,
        partslink_no: partslinkNo,
        variant_skus: variantSkus,
        ksi_part_desc: ksiPartDesc,
        created_at: createdAtTimestamp,
        price_cents: priceCents,
        avg_rating: avgRating,
        is_quote_only: !!(product.metadata as any)?.is_quote_only,
      }
    })

    await Promise.all(
      indexes.map((indexKey: string) => {
        const index = meilisearchService.getIndex(indexKey)
        return index.addDocuments(docs, { primaryKey: "id" })
      })
    )

    totalProducts += products.length
    offset += batchSize

    if (totalProducts % 1000 === 0) {
      console.log(`[reindex] Processed ${totalProducts} products...`)
    }
  }

  const totalTime = (performance.now() - startTime) / 1000
  console.log(`[reindex] Complete! Indexed ${totalProducts} products in ${totalTime.toFixed(1)}s`)
}
