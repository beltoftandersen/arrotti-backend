import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { createQuoteStep } from "./steps/create-quote"

type CreateQuoteInput = {
  product_id: string
  variant_id?: string
  customer_id: string
  quantity: number
  notes?: string
}

export const createQuoteWorkflow = createWorkflow(
  "create-quote",
  (input: CreateQuoteInput) => {
    const quote = createQuoteStep(input)

    return new WorkflowResponse({ quote })
  }
)
