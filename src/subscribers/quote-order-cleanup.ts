import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { QUOTE_MODULE } from "../modules/quote"
import QuoteModuleService from "../modules/quote/service"

type OrderPlacedData = {
  id: string
}

/**
 * When an order is placed, check if any line items have quote_id metadata.
 * If so, mark the corresponding quotes as "ordered".
 */
export default async function quoteOrderCleanupHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedData>) {
  const logger = container.resolve("logger")
  const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)

  try {
    // Load order with line items via the quote-aware query
    // Use the order module directly to get items with metadata
    const orderModule = container.resolve("order") as any
    const order = await orderModule.retrieveOrder(data.id, {
      relations: ["items"],
    })

    if (!order || !order.customer_id) return

    const customerId = order.customer_id
    const lineItems = order.items || []

    if (lineItems.length === 0) return

    // Match line items to quotes via metadata (set by add-to-cart endpoint)
    const quoteIds = lineItems
      .map((item: any) => item.metadata?.quote_id)
      .filter(Boolean) as string[]

    if (quoteIds.length === 0) {
      // No quote metadata on any line items — nothing to do
      return
    }

    // De-duplicate
    const uniqueQuoteIds = [...new Set(quoteIds)]

    for (const quoteId of uniqueQuoteIds) {
      try {
        const [quote] = await quoteService.listQuotes(
          { id: quoteId },
          { select: ["id", "status", "customer_id"] }
        )

        if (!quote) {
          logger.warn(
            `[Quote Order Cleanup] Quote ${quoteId} not found (referenced in order ${data.id})`
          )
          continue
        }

        if (quote.customer_id !== customerId) {
          logger.warn(
            `[Quote Order Cleanup] Quote ${quoteId} belongs to different customer, skipping`
          )
          continue
        }

        if (quote.status !== "accepted") {
          logger.warn(
            `[Quote Order Cleanup] Quote ${quoteId} has status "${quote.status}", expected "accepted"`
          )
          continue
        }

        await quoteService.updateQuotes({
          id: quoteId,
          status: "ordered",
          ordered_at: new Date(),
          order_id: data.id,
        } as any)

        logger.info(
          `[Quote Order Cleanup] Quote ${quoteId} marked as ordered (order: ${data.id})`
        )
      } catch (err: any) {
        logger.error(
          `[Quote Order Cleanup] Failed to process quote ${quoteId}: ${err.message}`
        )
      }
    }
  } catch (error) {
    logger.error(
      `[Quote Order Cleanup] Error processing order ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
