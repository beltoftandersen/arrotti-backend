import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { vehicle_id: vehicleId } = req.params

  if (!vehicleId) {
    res.status(400).json({ message: "vehicle_id is required" })
    return
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50)
  const offset = Math.max(Number(req.query.offset) || 0, 0)
  const idsParam = req.query.ids
  const ids = Array.isArray(idsParam)
    ? idsParam
    : typeof idsParam === "string"
      ? idsParam.split(",").map((id) => id.trim()).filter(Boolean)
      : []

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Step 1: Fetch only product IDs from fitments (lightweight)
  const { data: fitments } = await query.graph({
    entity: "fitment",
    fields: ["id", "vehicle_id", "product.id"],
    filters: {
      vehicle_id: vehicleId,
    },
  })

  // Deduplicate product IDs
  const productIdSet = new Set<string>()
  for (const fitment of fitments || []) {
    if (fitment.product?.id) {
      productIdSet.add(fitment.product.id)
    }
  }

  let allProductIds = Array.from(productIdSet)

  // Filter by requested IDs if provided
  if (ids.length) {
    const idSet = new Set(ids)
    allProductIds = allProductIds.filter((id) => idSet.has(id))
  }

  const count = allProductIds.length

  // Step 2: Paginate the ID list, then load only those products
  const pageIds = allProductIds.slice(offset, offset + limit)

  if (!pageIds.length) {
    res.json({ products: [], count, limit, offset })
    return
  }

  // Step 3: Load minimal product data for just this page
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "thumbnail",
      "status",
      "*variants.calculated_price",
      "+variants.inventory_quantity",
    ],
    filters: {
      id: pageIds,
    },
  })

  // Preserve page order
  const productMap = new Map(products.map((p: any) => [p.id, p]))
  const ordered = pageIds.map((id) => productMap.get(id)).filter(Boolean)

  res.json({
    products: ordered,
    count,
    limit,
    offset,
  })
}
