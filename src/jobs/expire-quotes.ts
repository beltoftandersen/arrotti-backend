import { MedusaContainer } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { QUOTE_MODULE } from "../modules/quote"
import QuoteModuleService from "../modules/quote/service"

export default async function expireQuotesJob(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)
  const eventBus = container.resolve(Modules.EVENT_BUS)

  try {
    const expiredQuotes = await quoteService.getExpiredQuotes()

    if (expiredQuotes.length === 0) {
      return
    }

    logger.info(
      `[expire-quotes] Found ${expiredQuotes.length} expired quotes, updating status...`
    )

    for (const quote of expiredQuotes) {
      await quoteService.updateQuotes({
        id: quote.id,
        status: "expired",
      })

      // Emit event for notification
      await eventBus.emit({
        name: "quote.expired",
        data: { id: quote.id },
      })
    }

    logger.info(
      `[expire-quotes] Updated ${expiredQuotes.length} quotes to "expired" status`
    )
  } catch (error) {
    logger.error(
      `[expire-quotes] Failed to expire quotes: ${(error as Error).message}`
    )
  }
}

export const config = {
  name: "expire-quotes",
  // Every hour
  schedule: "0 * * * *",
}
