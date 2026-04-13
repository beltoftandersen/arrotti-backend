/**
 * QuickBooks Payment Subscriber
 * Records payments in QuickBooks when payments are captured in Medusa
 */

import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { QboClient } from "../lib/qbo-client"
import { getInvoice } from "../lib/qbo-invoice"
import { createPayment, paymentExistsForInvoice } from "../lib/qbo-payment"
import { findAccountByName } from "../lib/qbo-accounts"
import { QBO_CONNECTION_MODULE } from "../modules/qbo-connection"
import QboConnectionService from "../modules/qbo-connection/service"

/**
 * QBO deposit account name - payments will be deposited here
 * Set to null to use QBO's default "Undeposited Funds"
 */
const QBO_DEPOSIT_ACCOUNT = "Checking"

type PaymentCapturedData = {
  id: string
}

export default async function qboPaymentHandler({
  event: { data },
  container,
}: SubscriberArgs<PaymentCapturedData>) {
  const logger = container.resolve("logger")

  try {
    // Get QBO connection service
    const qboConnectionService: QboConnectionService = container.resolve(QBO_CONNECTION_MODULE)

    // Check if we have an active QBO connection
    const isConnected = await qboConnectionService.isConnected()
    if (!isConnected) {
      return
    }

    // Get payment details with order
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: [payment] } = await query.graph({
      entity: "payment",
      fields: [
        "id",
        "amount",
        "currency_code",
        "captured_at",
        "provider_id",
        "payment_collection.order.id",
        "payment_collection.order.display_id",
        "payment_collection.order.metadata",
        "payment_collection.order.sales_channel.name",
      ],
      filters: { id: data.id },
    })

    if (!payment) {
      logger.debug(`[QBO Payment] Payment ${data.id} not found`)
      return
    }

    // Get order from payment collection
    const order = (payment as any).payment_collection?.order
    if (!order) {
      logger.debug(`[QBO Payment] Payment ${data.id} has no associated order`)
      return
    }

    const orderNumber = order.display_id?.toString() || order.id

    // Resolve the QBO invoice via the id stored on the order when we created it
    const qboInvoiceId = order.metadata?.qbo_invoice?.invoice_id as string | undefined
    if (!qboInvoiceId) {
      logger.debug(`[QBO Payment] No QBO invoice id on order ${orderNumber} metadata, skipping`)
      return
    }

    const client = new QboClient(qboConnectionService)

    let invoice
    try {
      invoice = await getInvoice(client, qboInvoiceId)
    } catch (err) {
      logger.warn(`[QBO Payment] Stored invoice ${qboInvoiceId} for order ${orderNumber} not retrievable from QBO: ${(err as Error).message}`)
      return
    }

    // Check if invoice is already paid (Balance = 0)
    const balance = Number(invoice.Balance) || 0
    if (balance <= 0) {
      logger.info(`[QBO Payment] Invoice ${invoice.DocNumber} already paid, skipping`)
      return
    }

    // Check if we've already recorded a payment for this invoice in QBO (prevent duplicates)
    const alreadyExists = await paymentExistsForInvoice(client, invoice.Id)
    if (alreadyExists) {
      logger.info(`[QBO Payment] Payment for invoice ${invoice.DocNumber} already exists in QBO, skipping`)
      return
    }

    // Medusa v2 stores amounts in currency units (dollars), not cents
    const paymentAmount = Number(payment.amount)

    // Don't overpay - cap at invoice balance
    const amountToApply = Math.min(paymentAmount, balance)

    // Create payment in QBO
    // Ensure paymentDate is a string (captured_at may be Date object)
    const capturedAt = (payment as any).captured_at
    const paymentDateStr = capturedAt
      ? (typeof capturedAt === "string" ? capturedAt : new Date(capturedAt).toISOString())
      : new Date().toISOString()

    // Build note similar to invoice format: "{Sales Channel} Payment: {order number}"
    const salesChannelName = order.sales_channel?.name || "Online"
    const paymentNote = `${salesChannelName} Payment: ${orderNumber}`

    // Look up deposit account
    let depositAccountRef: { value: string; name: string } | undefined
    if (QBO_DEPOSIT_ACCOUNT) {
      depositAccountRef = await findAccountByName(client, QBO_DEPOSIT_ACCOUNT) || undefined
      if (depositAccountRef) {
        logger.info(`[QBO Payment] Depositing to account "${QBO_DEPOSIT_ACCOUNT}"`)
      }
    }

    const qboPayment = await createPayment(client, {
      customerId: invoice.CustomerRef.value,
      customerName: invoice.CustomerRef.name,
      invoiceId: invoice.Id,
      amount: amountToApply,
      paymentDate: paymentDateStr,
      paymentReference: `Order ${orderNumber}`,
      paymentMethod: (payment as any).provider_id || "stripe",
      note: paymentNote,
      depositAccountRef,
    })

    logger.info(
      `[QBO Payment] Recorded payment ${qboPayment.Id} for $${amountToApply.toFixed(2)} against invoice ${invoice.DocNumber} (order ${orderNumber})`
    )
  } catch (error) {
    logger.error(`[QBO Payment] Error recording payment: ${(error as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "payment.captured",
}
