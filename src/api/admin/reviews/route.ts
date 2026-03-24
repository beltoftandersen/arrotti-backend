import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/reviews
 *
 * List all reviews (admin can see all statuses)
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const limit = parseInt(req.query.limit as string) || 20
  const offset = parseInt(req.query.offset as string) || 0
  const status = req.query.status as string | undefined
  const product_id = req.query.product_id as string | undefined

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Build filters
  const filters: Record<string, any> = {}
  if (status) {
    filters.status = status
  }
  if (product_id) {
    filters.product_id = product_id
  }

  const { data: reviews } = await query.graph({
    entity: "review",
    fields: [
      "id",
      "title",
      "content",
      "rating",
      "first_name",
      "last_name",
      "status",
      "product_id",
      "customer_id",
      "created_at",
      "updated_at",
    ],
    filters,
    pagination: {
      skip: offset,
      take: limit,
      order: { created_at: "DESC" },
    },
  })

  // Get total count
  const { data: allReviews } = await query.graph({
    entity: "review",
    fields: ["id"],
    filters,
  })

  res.json({
    reviews,
    count: allReviews?.length ?? 0,
    limit,
    offset,
  })
}
