import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { updateReviewStatusStep } from "./steps/update-review-status"

type UpdateReviewStatusInput = {
  id: string
  status: "pending" | "approved" | "rejected"
}

export const updateReviewStatusWorkflow = createWorkflow(
  "update-review-status",
  (input: UpdateReviewStatusInput) => {
    const review = updateReviewStatusStep(input)

    return new WorkflowResponse({ review })
  }
)
