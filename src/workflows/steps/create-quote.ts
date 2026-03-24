import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { QUOTE_MODULE } from "../../modules/quote"
import QuoteModuleService from "../../modules/quote/service"

type CreateQuoteInput = {
  product_id: string
  variant_id?: string
  customer_id: string
  quantity: number
  notes?: string
}

export const createQuoteStep = createStep(
  "create-quote-step",
  async (input: CreateQuoteInput, { container }) => {
    const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)

    const quote = await quoteService.createQuotes(input)

    return new StepResponse(quote, quote.id)
  },
  async (quoteId: string, { container }) => {
    const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)

    await quoteService.deleteQuotes(quoteId)
  }
)
