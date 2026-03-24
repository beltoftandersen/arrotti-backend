import {
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { respondToQuoteStep } from "./steps/respond-to-quote"

type RespondToQuoteInput = {
  id: string
  action: "accept" | "reject"
}

export const respondToQuoteWorkflow = createWorkflow(
  "respond-to-quote",
  (input: RespondToQuoteInput) => {
    const quote = respondToQuoteStep(input)

    return new WorkflowResponse({ quote })
  }
)
