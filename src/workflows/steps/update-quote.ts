import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { QUOTE_MODULE } from "../../modules/quote"
import QuoteModuleService from "../../modules/quote/service"

type QuoteStatus = "pending" | "quoted" | "accepted" | "rejected" | "expired" | "ordered"

export type UpdateQuoteStepInput = {
  id: string
  status?: QuoteStatus
  quoted_price?: number | null
  currency_code?: string | null
  admin_notes?: string | null
  expires_at?: string | null
  accepted_at?: string | null
}

export const updateQuoteStep = createStep(
  "update-quote-step",
  async (input: UpdateQuoteStepInput, { container }) => {
    const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)

    // Get current state for compensation
    const [existing] = await quoteService.listQuotes(
      { id: input.id },
      {
        select: [
          "id",
          "status",
          "quoted_price",
          "currency_code",
          "admin_notes",
          "expires_at",
          "accepted_at",
        ],
      }
    )

    const previousState: UpdateQuoteStepInput = {
      id: existing.id,
      status: existing.status as QuoteStatus,
      quoted_price: existing.quoted_price,
      currency_code: existing.currency_code,
      admin_notes: existing.admin_notes,
      expires_at: existing.expires_at ? String(existing.expires_at) : null,
      accepted_at: existing.accepted_at ? String(existing.accepted_at) : null,
    }

    // Build update data, converting string dates to Date objects
    const updateData: Record<string, any> = { id: input.id }
    if (input.status !== undefined) updateData.status = input.status
    if (input.quoted_price !== undefined) updateData.quoted_price = input.quoted_price
    if (input.currency_code !== undefined) updateData.currency_code = input.currency_code
    if (input.admin_notes !== undefined) updateData.admin_notes = input.admin_notes
    if (input.expires_at !== undefined) {
      updateData.expires_at = input.expires_at ? new Date(input.expires_at) : null
    }
    if (input.accepted_at !== undefined) {
      updateData.accepted_at = input.accepted_at ? new Date(input.accepted_at) : null
    }

    const quote = await quoteService.updateQuotes(updateData as any)

    return new StepResponse(quote, previousState)
  },
  async (previousState: UpdateQuoteStepInput, { container }) => {
    const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)

    const revertData: Record<string, any> = { id: previousState.id }
    if (previousState.status !== undefined) revertData.status = previousState.status
    if (previousState.quoted_price !== undefined) revertData.quoted_price = previousState.quoted_price
    if (previousState.currency_code !== undefined) revertData.currency_code = previousState.currency_code
    if (previousState.admin_notes !== undefined) revertData.admin_notes = previousState.admin_notes
    if (previousState.expires_at !== undefined) {
      revertData.expires_at = previousState.expires_at ? new Date(previousState.expires_at) : null
    }
    if (previousState.accepted_at !== undefined) {
      revertData.accepted_at = previousState.accepted_at ? new Date(previousState.accepted_at) : null
    }

    await quoteService.updateQuotes(revertData as any)
  }
)
