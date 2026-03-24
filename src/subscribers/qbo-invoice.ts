/**
 * QuickBooks Invoice Subscriber
 * Creates invoices in QuickBooks when orders are placed (if enabled)
 */

import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { QBO_CONNECTION_MODULE } from "../modules/qbo-connection"
import QboConnectionService from "../modules/qbo-connection/service"
import { createQboInvoiceForOrder } from "../lib/qbo-invoice-creator"

type OrderEventData = {
  id: string
}

/**
 * Handler for order.placed event
 */
export default async function qboInvoiceOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderEventData>) {
  const logger = container.resolve("logger")

  try {
    // Get QBO connection service
    const qboConnectionService: QboConnectionService = container.resolve(QBO_CONNECTION_MODULE)

    // Check if we have an active QBO connection
    const isConnected = await qboConnectionService.isConnected()
    if (!isConnected) {
      return
    }

    // Check if auto invoice is enabled
    const autoInvoiceEnabled = await qboConnectionService.isAutoInvoiceEnabled()
    if (!autoInvoiceEnabled) {
      logger.debug(`[QBO Invoice] Auto invoice disabled, skipping order ${data.id}`)
      return
    }

    // Create the invoice
    await createQboInvoiceForOrder(data.id, container)
  } catch (error) {
    logger.error(`[QBO Invoice] Error on order placed: ${(error as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
