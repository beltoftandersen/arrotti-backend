import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { QUOTE_MODULE } from "../modules/quote"
import QuoteModuleService from "../modules/quote/service"

type QuoteEventData = {
  id: string
}

const STOCK_LOCATION_ID = "sloc_01KF3BBD2JWJGFJ26R65FSVKHA"

export default async function quoteInventoryHandler({
  event: { data, name },
  container,
}: SubscriberArgs<QuoteEventData>) {
  const logger = container.resolve("logger")
  const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventoryService = container.resolve(Modules.INVENTORY) as any

  try {
    const [quote] = await quoteService.listQuotes(
      { id: data.id },
      { select: ["id", "variant_id", "quantity", "status", "accepted_at"] }
    )

    if (!quote) {
      logger.warn(`[Quote Inventory] Quote ${data.id} not found`)
      return
    }

    if (!quote.variant_id) {
      logger.warn(`[Quote Inventory] Quote ${data.id} has no variant_id, skipping inventory adjustment`)
      return
    }

    // Look up inventory item for the variant
    const { data: links } = await query.graph({
      entity: "product_variant_inventory_item",
      fields: ["inventory_item_id"],
      filters: { variant_id: quote.variant_id },
    })

    const inventoryItemId = links?.[0]?.inventory_item_id

    if (!inventoryItemId) {
      logger.warn(
        `[Quote Inventory] No inventory item found for variant ${quote.variant_id} (quote ${data.id})`
      )
      return
    }

    if (name === "quote.accepted") {
      // Add the quoted quantity to stock so the order can be fulfilled
      await inventoryService.adjustInventory(inventoryItemId, STOCK_LOCATION_ID, quote.quantity)
      logger.info(
        `[Quote Inventory] Added ${quote.quantity} units to inventory item ${inventoryItemId} for accepted quote ${data.id}`
      )
    }

    if (name === "quote.expired") {
      // Only remove inventory if the quote was previously accepted
      // (accepted_at is set when status transitions to "accepted")
      if (!quote.accepted_at) {
        logger.info(
          `[Quote Inventory] Quote ${data.id} expired without being accepted — no inventory adjustment needed`
        )
        return
      }

      await inventoryService.adjustInventory(inventoryItemId, STOCK_LOCATION_ID, -quote.quantity)
      logger.info(
        `[Quote Inventory] Removed ${quote.quantity} units from inventory item ${inventoryItemId} for expired-after-accepted quote ${data.id}`
      )
    }
  } catch (error) {
    logger.error(
      `[Quote Inventory] Error processing ${name} for quote ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["quote.accepted", "quote.expired"],
}
