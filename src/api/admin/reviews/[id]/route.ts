import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCT_REVIEW_MODULE } from "../../../../modules/product-review"
import ProductReviewModuleService from "../../../../modules/product-review/service"
import { updateReviewStatusWorkflow } from "../../../../workflows/update-review-status"

/**
 * GET /admin/reviews/:id
 *
 * Get a single review by ID
 */
export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

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
    filters: { id },
  })

  if (!reviews?.length) {
    res.status(404).json({ message: "Review not found" })
    return
  }

  res.json({ review: reviews[0] })
}

/**
 * POST /admin/reviews/:id
 *
 * Update review status (approve/reject)
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const { status } = req.body as { status: "pending" | "approved" | "rejected" }

  if (!status || !["pending", "approved", "rejected"].includes(status)) {
    res.status(400).json({
      message: "Status must be one of: pending, approved, rejected",
    })
    return
  }

  try {
    const { result } = await updateReviewStatusWorkflow(req.scope).run({
      input: { id, status },
    })

    res.json({ review: result.review })
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      res.status(404).json({ message: "Review not found" })
      return
    }
    throw error
  }
}

/**
 * DELETE /admin/reviews/:id
 *
 * Delete a review
 */
export async function DELETE(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { id } = req.params
  const reviewService: ProductReviewModuleService =
    req.scope.resolve(PRODUCT_REVIEW_MODULE)

  try {
    await reviewService.deleteReviews(id)
    res.status(200).json({ id, deleted: true })
  } catch (error: any) {
    res.status(404).json({ message: "Review not found" })
  }
}
