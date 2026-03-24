import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCT_REVIEW_MODULE } from "../../../../../modules/product-review"
import ProductReviewModuleService from "../../../../../modules/product-review/service"

/**
 * GET /store/products/:id/reviews
 *
 * Get approved reviews for a product with average rating and distribution
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const limit = parseInt(req.query.limit as string) || 10
  const offset = parseInt(req.query.offset as string) || 0

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const reviewService: ProductReviewModuleService =
    req.scope.resolve(PRODUCT_REVIEW_MODULE)

  // Get approved reviews for this product
  const { data: reviews } = await query.graph({
    entity: "review",
    fields: [
      "id",
      "title",
      "content",
      "rating",
      "first_name",
      "last_name",
      "created_at",
    ],
    filters: {
      product_id: id,
      status: "approved",
    },
    pagination: {
      skip: offset,
      take: limit,
      order: { created_at: "DESC" },
    },
  })

  // Get stats in parallel
  const [average_rating, review_count, rating_distribution] = await Promise.all(
    [
      reviewService.getAverageRating(id),
      reviewService.getReviewCount(id),
      reviewService.getRatingDistribution(id),
    ]
  )

  res.json({
    reviews,
    average_rating,
    review_count,
    rating_distribution,
    limit,
    offset,
  })
}
