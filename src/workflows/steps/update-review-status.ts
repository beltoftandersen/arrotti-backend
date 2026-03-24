import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PRODUCT_REVIEW_MODULE } from "../../modules/product-review"
import ProductReviewModuleService from "../../modules/product-review/service"

type UpdateReviewStatusInput = {
  id: string
  status: "pending" | "approved" | "rejected"
}

export const updateReviewStatusStep = createStep(
  "update-review-status-step",
  async (input: UpdateReviewStatusInput, { container }) => {
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)

    // Get current status for compensation
    const [existingReview] = await reviewService.listReviews(
      { id: input.id },
      { select: ["id", "status"] }
    )

    const previousStatus = existingReview?.status

    // Update the status
    const review = await reviewService.updateReviews({
      id: input.id,
      status: input.status,
    })

    return new StepResponse(review, { id: input.id, previousStatus })
  },
  async (data: { id: string; previousStatus: string }, { container }) => {
    // Compensation: revert to previous status
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)

    await reviewService.updateReviews({
      id: data.id,
      status: data.previousStatus as "pending" | "approved" | "rejected",
    })
  }
)
