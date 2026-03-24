import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PRODUCT_REVIEW_MODULE } from "../../modules/product-review"
import ProductReviewModuleService from "../../modules/product-review/service"

type CreateReviewInput = {
  title?: string
  content: string
  rating: number
  product_id: string
  customer_id?: string
  first_name: string
  last_name: string
  status?: "pending" | "approved" | "rejected"
}

export const createReviewStep = createStep(
  "create-review-step",
  async (input: CreateReviewInput, { container }) => {
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)

    const review = await reviewService.createReviews(input)

    return new StepResponse(review, review.id)
  },
  async (reviewId: string, { container }) => {
    // Compensation: delete the review if workflow fails
    const reviewService: ProductReviewModuleService =
      container.resolve(PRODUCT_REVIEW_MODULE)

    await reviewService.deleteReviews(reviewId)
  }
)
