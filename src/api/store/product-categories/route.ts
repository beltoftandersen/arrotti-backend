/**
 * Override: GET /store/product-categories
 *
 * Identical to the default Medusa route, but with query-level caching enabled.
 * Categories rarely change, so caching the query.graph() result in Redis
 * avoids repeated DB queries for the category tree on every page load.
 *
 * The caching module handles automatic invalidation when categories are
 * created, updated, or deleted.
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: product_categories, metadata } = await query.graph(
    {
      entity: "product_category",
      fields: (req as any).queryConfig.fields,
      filters: (req as any).filterableFields,
      pagination: (req as any).queryConfig.pagination,
    },
    {
      locale: (req as any).locale,
      cache: {
        enable: true,
        ttl: 300, // 5 minutes
      },
    }
  )

  res.json({
    product_categories,
    count: (metadata as any)?.count,
    offset: (metadata as any)?.skip,
    limit: (metadata as any)?.take,
  })
}
