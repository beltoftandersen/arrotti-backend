/**
 * QuickBooks Refund Subscriber
 * Creates a refund receipt in QuickBooks when a payment is refunded
 */

import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { QboClient } from "../lib/qbo-client"
import { findCustomerByEmail } from "../lib/qbo-customer"
import { createSimpleRefund } from "../lib/qbo-refund"
import { QBO_CONNECTION_MODULE } from "../modules/qbo-connection"
import QboConnectionService from "../modules/qbo-connection/service"

type PaymentRefundedData = {
  id: string
}

export default async function qboRefundHandler({
  event: { data },
  container,
}: SubscriberArgs<PaymentRefundedData>) {
  const logger = container.resolve("logger")

  try {
    // Get QBO connection service
    const qboConnectionService: QboConnectionService = container.resolve(QBO_CONNECTION_MODULE)

    // Check if we have an active QBO connection
    const isConnected = await qboConnectionService.isConnected()
    if (!isConnected) {
      logger.debug(`[QBO Refund] No active QuickBooks connection, skipping`)
      return
    }

    // Get payment/refund details
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [payment] } = await query.graph({
      entity: "payment",
      fields: [
        "id",
        "amount",
        "currency_code",
        "refunds.*",
        "payment_collection.order.id",
        "payment_collection.order.display_id",
        "payment_collection.order.email",
      ],
      filters: {
        id: data.id,
      },
    })

    if (!payment) {
      logger.warn(`[QBO Refund] Payment ${data.id} not found`)
      return
    }

    // Get order from payment collection
    const order = payment.payment_collection?.order
    if (!order) {
      logger.warn(`[QBO Refund] Payment ${data.id} has no associated order`)
      return
    }

    if (!order.email) {
      logger.warn(`[QBO Refund] Order has no email, cannot find customer in QBO`)
      return
    }

    const orderNumber = order.display_id?.toString() || order.id

    // Create QBO client
    const client = new QboClient(qboConnectionService)

    // Find customer in QBO
    const customer = await findCustomerByEmail(client, order.email)
    if (!customer) {
      logger.warn(`[QBO Refund] Customer not found in QuickBooks for email ${order.email}`)
      return
    }

    // Get the refund amount - use the most recent refund or full payment amount
    const refunds = payment.refunds || []
    const latestRefund = refunds[refunds.length - 1]
    const refundAmount = latestRefund ? toNumber(latestRefund.amount) : toNumber(payment.amount)

    // Create refund receipt in QBO
    const refundReceipt = await createSimpleRefund(
      client,
      customer.Id,
      customer.DisplayName,
      refundAmount,
      orderNumber,
      latestRefund?.note || "Customer refund"
    )

    logger.info(
      `[QBO Refund] Created refund receipt (ID: ${refundReceipt.Id}) of ${refundAmount} for order ${orderNumber}`
    )
  } catch (error) {
    logger.error(
      `[QBO Refund] Error creating refund for payment ${data.id}: ${(error as Error).message}`
    )
    // Don't rethrow - we don't want to break the refund flow if QBO sync fails
  }
}

function toNumber(value: any): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
