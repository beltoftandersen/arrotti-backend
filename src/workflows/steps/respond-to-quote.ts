import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { QUOTE_MODULE } from "../../modules/quote"
import QuoteModuleService from "../../modules/quote/service"

type RespondToQuoteInput = {
  id: string
  action: "accept" | "reject"
}

export const respondToQuoteStep = createStep(
  "respond-to-quote-step",
  async (input: RespondToQuoteInput, { container }) => {
    const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)

    // Get current state for compensation
    const [existing] = await quoteService.listQuotes(
      { id: input.id },
      { select: ["id", "status", "accepted_at"] }
    )

    const previousStatus = existing.status
    const previousAcceptedAt = existing.accepted_at

    const updateData: Record<string, any> = {
      id: input.id,
      status: input.action === "accept" ? "accepted" : "rejected",
    }

    if (input.action === "accept") {
      updateData.accepted_at = new Date()
    }

    const quote = await quoteService.updateQuotes(updateData as any)

    return new StepResponse(quote, {
      id: input.id,
      previousStatus,
      previousAcceptedAt,
    })
  },
  async (
    data: { id: string; previousStatus: string; previousAcceptedAt: any },
    { container }
  ) => {
    const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)

    await quoteService.updateQuotes({
      id: data.id,
      status: data.previousStatus,
      accepted_at: data.previousAcceptedAt,
    } as any)
  }
)
