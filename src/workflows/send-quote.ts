import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { updateQuoteStep } from "./steps/update-quote"

type SendQuoteInput = {
  id: string
  quoted_price: number
  currency_code?: string
  expires_at?: string
  admin_notes?: string
}

export const sendQuoteWorkflow = createWorkflow(
  "send-quote",
  (input: SendQuoteInput) => {
    const quote = updateQuoteStep({
      id: input.id,
      status: "quoted",
      quoted_price: input.quoted_price,
      currency_code: input.currency_code,
      admin_notes: input.admin_notes,
      expires_at: input.expires_at,
    })

    return new WorkflowResponse({ quote })
  }
)
