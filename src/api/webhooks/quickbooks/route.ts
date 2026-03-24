/**
 * QuickBooks Webhook Endpoint
 *
 * POST /webhooks/quickbooks
 *
 * Handles webhook notifications from QuickBooks Online.
 * When a payment is recorded in QBO, this marks the corresponding Medusa order as paid.
 * When a refund is created in QBO, this creates a refund in Medusa.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { markPaymentCollectionAsPaid, refundPaymentWorkflow } from "@medusajs/medusa/core-flows"
import {
  verifyWebhookSignature,
  getWebhookVerifierToken,
  parseWebhookPayload,
  extractPaymentEvents,
  extractRefundEvents,
} from "../../../lib/qbo-webhook"
import { QboClient } from "../../../lib/qbo-client"
import { getPayment, getLinkedInvoiceIds } from "../../../lib/qbo-payment"
import { getInvoice } from "../../../lib/qbo-invoice"
import { getRefundReceipt, extractOrderNumberFromRefund } from "../../../lib/qbo-refund"
import { QBO_CONNECTION_MODULE } from "../../../modules/qbo-connection"
import QboConnectionService from "../../../modules/qbo-connection/service"

/**
 * POST /webhooks/quickbooks
 * Handle QBO webhook notifications
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")

  try {
    // Verify webhook signature (mandatory)
    let verifierToken: string
    try {
      verifierToken = getWebhookVerifierToken()
    } catch {
      logger.error("[QBO Webhook] QBO_WEBHOOK_VERIFIER_TOKEN not configured, rejecting webhook")
      return res.status(500).json({ error: "Webhook verification not configured" })
    }

    {
      const signature = req.headers["intuit-signature"] as string
      if (!signature) {
        logger.warn("[QBO Webhook] Missing intuit-signature header")
        return res.status(401).json({ error: "Missing signature" })
      }

      // Use raw body bytes for HMAC verification (preserveRawBody middleware required)
      const rawBody = (req as any).rawBody as string | undefined
      if (!rawBody) {
        logger.error("[QBO Webhook] Raw body not available for signature verification")
        return res.status(500).json({ error: "Server configuration error" })
      }

      if (!verifyWebhookSignature(rawBody, signature, verifierToken)) {
        logger.warn("[QBO Webhook] Invalid signature")
        return res.status(401).json({ error: "Invalid signature" })
      }
    }

    // Parse webhook payload
    const payload = parseWebhookPayload(req.body)
    if (!payload) {
      logger.warn("[QBO Webhook] Invalid payload")
      return res.status(400).json({ error: "Invalid payload" })
    }

    // Get QBO connection
    const qboConnectionService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)
    const isConnected = await qboConnectionService.isConnected()
    if (!isConnected) {
      logger.warn("[QBO Webhook] No active QuickBooks connection")
      return res.status(200).json({ message: "No QBO connection, ignoring" })
    }

    const client = new QboClient(qboConnectionService)

    // Process payment events (QBO Payment → Medusa order paid)
    const paymentEvents = extractPaymentEvents(payload)
    for (const event of paymentEvents) {
      if (event.operation === "Create" || event.operation === "Update") {
        await handlePaymentEvent(req, client, event.paymentId, logger)
      }
    }

    // Process refund events (QBO RefundReceipt → Medusa refund)
    const refundEvents = extractRefundEvents(payload)
    for (const event of refundEvents) {
      if (event.operation === "Create") {
        await handleRefundEvent(req, client, event.refundId, logger)
      }
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({ message: "Webhook processed" })
  } catch (error) {
    logger.error(`[QBO Webhook] Error: ${(error as Error).message}`)
    // Still return 200 to prevent retries for unrecoverable errors
    res.status(200).json({ message: "Webhook received with errors" })
  }
}

/**
 * Handle a QBO Payment event - mark Medusa order as paid
 */
async function handlePaymentEvent(
  req: MedusaRequest,
  client: QboClient,
  qboPaymentId: string,
  logger: any
) {
  try {
    logger.info(`[QBO Webhook] Processing payment ${qboPaymentId}`)

    // Get the payment from QBO
    const qboPayment = await getPayment(client, qboPaymentId)

    // Skip payments created by Medusa (bidirectional sync prevention)
    // Medusa payments have note format: "{Sales Channel} Payment: {order number}"
    const privateNote = (qboPayment as any).PrivateNote || ""
    if (privateNote.includes(" Payment: ")) {
      logger.info(`[QBO Webhook] Payment ${qboPaymentId} was created by Medusa, skipping`)
      return
    }

    // Get linked invoice IDs
    const invoiceIds = getLinkedInvoiceIds(qboPayment)
    if (invoiceIds.length === 0) {
      logger.info(`[QBO Webhook] Payment ${qboPaymentId} has no linked invoices, skipping`)
      return
    }

    // Process each linked invoice
    for (const invoiceId of invoiceIds) {
      const invoice = await getInvoice(client, invoiceId)
      const orderNumber = invoice.DocNumber

      if (!orderNumber) {
        logger.warn(`[QBO Webhook] Invoice ${invoiceId} has no DocNumber, skipping`)
        continue
      }

      // Find the Medusa order by display_id (order number = invoice DocNumber)
      await markMedusaOrderAsPaid(req, orderNumber, qboPaymentId, logger)
    }
  } catch (error) {
    logger.error(`[QBO Webhook] Error processing payment ${qboPaymentId}: ${(error as Error).message}`)
  }
}

/**
 * Handle a QBO RefundReceipt event - create refund in Medusa
 */
async function handleRefundEvent(
  req: MedusaRequest,
  client: QboClient,
  qboRefundId: string,
  logger: any
) {
  try {
    logger.info(`[QBO Webhook] Processing refund ${qboRefundId}`)

    // Get the refund receipt from QBO
    const refundReceipt = await getRefundReceipt(client, qboRefundId)

    // Extract order number from private note
    const orderNumber = extractOrderNumberFromRefund(refundReceipt)
    if (!orderNumber) {
      logger.info(`[QBO Webhook] Refund ${qboRefundId} has no order reference, skipping`)
      return
    }

    // Create refund in Medusa
    await createMedusaRefund(req, orderNumber, refundReceipt.TotalAmt, qboRefundId, logger)
  } catch (error) {
    logger.error(`[QBO Webhook] Error processing refund ${qboRefundId}: ${(error as Error).message}`)
  }
}

/**
 * Mark a Medusa order as paid using the markPaymentCollectionAsPaid workflow
 */
async function markMedusaOrderAsPaid(
  req: MedusaRequest,
  orderNumber: string,
  qboPaymentId: string,
  logger: any
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Find order by display_id
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "status",
      "currency_code",
      "total",
      "payment_collections.id",
      "payment_collections.status",
      "payment_collections.amount",
      "payment_collections.payments.id",
      "payment_collections.payments.captured_at",
    ],
    filters: {
      display_id: orderNumber,
    },
  })

  if (!orders || orders.length === 0) {
    logger.warn(`[QBO Webhook] Order ${orderNumber} not found in Medusa`)
    return
  }

  const order = orders[0] as any

  // Check if already fully paid (has captured/completed collection)
  const paymentCollections = order.payment_collections || []
  const paidCollection = paymentCollections.find(
    (pc: any) => pc.status === "captured" || pc.status === "completed"
  )

  if (paidCollection) {
    logger.info(`[QBO Webhook] Order ${orderNumber} already paid, skipping`)
    return
  }

  // Find a not_paid collection specifically
  let unpaidCollection = paymentCollections.find(
    (pc: any) => pc.status === "not_paid"
  )

  // If no not_paid collection exists, create one
  if (!unpaidCollection) {
    logger.info(`[QBO Webhook] No not_paid collection for order ${orderNumber}, creating one`)

    try {
      const paymentModule = req.scope.resolve("payment")
      const orderModule = req.scope.resolve("order")
      const linkModule = req.scope.resolve("link")

      // Create new payment collection
      const [newCollection] = await paymentModule.createPaymentCollections([{
        currency_code: order.currency_code || "usd",
        amount: order.total || 0,
      }])

      // Link to order
      await linkModule.create({
        order_payment_collection: {
          order_id: order.id,
          payment_collection_id: newCollection.id,
        },
      })

      unpaidCollection = newCollection
      logger.info(`[QBO Webhook] Created payment collection ${newCollection.id} for order ${orderNumber}`)
    } catch (createError) {
      logger.error(`[QBO Webhook] Failed to create payment collection for order ${orderNumber}: ${(createError as Error).message}`)
      return
    }
  }

  // Check if there's already a captured payment
  const hasPayment = unpaidCollection.payments?.some((p: any) => p.captured_at)
  if (hasPayment) {
    logger.info(`[QBO Webhook] Order ${orderNumber} payment already captured, skipping`)
    return
  }

  try {
    // Mark payment collection as paid
    await markPaymentCollectionAsPaid(req.scope).run({
      input: {
        payment_collection_id: unpaidCollection.id,
        order_id: order.id,
      },
    })

    logger.info(
      `[QBO Webhook] Marked order ${orderNumber} as paid (QBO Payment: ${qboPaymentId})`
    )
  } catch (error) {
    logger.error(
      `[QBO Webhook] Failed to mark order ${orderNumber} as paid: ${(error as Error).message}`
    )
  }
}

/**
 * Create a refund in Medusa
 */
async function createMedusaRefund(
  req: MedusaRequest,
  orderNumber: string,
  amount: number,
  qboRefundId: string,
  logger: any
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Find order and its payments
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "payment_collections.payments.id",
      "payment_collections.payments.amount",
      "payment_collections.payments.captured_at",
      "payment_collections.payments.captures.*",
      "payment_collections.payments.refunds.*",
    ],
    filters: {
      display_id: orderNumber,
    },
  })

  if (!orders || orders.length === 0) {
    logger.warn(`[QBO Webhook] Order ${orderNumber} not found for refund`)
    return
  }

  const order = orders[0] as any

  // Find a payment with captured amount that can be refunded
  let paymentToRefund: any = null
  for (const pc of order.payment_collections || []) {
    if (!pc) continue
    for (const payment of pc.payments || []) {
      if (!payment || !payment.captured_at) continue

      // Calculate captured and refunded amounts
      const captures = payment.captures || []
      const refunds = payment.refunds || []
      const capturedAmount = captures.reduce((sum: number, c: any) => sum + Number(c?.amount || 0), 0)
      const refundedAmount = refunds.reduce((sum: number, r: any) => sum + Number(r?.amount || 0), 0)
      const refundable = capturedAmount - refundedAmount

      if (refundable >= amount) {
        paymentToRefund = payment
        break
      }
    }
    if (paymentToRefund) break
  }

  if (!paymentToRefund) {
    logger.warn(`[QBO Webhook] No refundable payment found for order ${orderNumber}`)
    return
  }

  try {
    await refundPaymentWorkflow(req.scope).run({
      input: {
        payment_id: paymentToRefund.id,
        amount,
        note: `QBO Refund: ${qboRefundId}`,
      },
    })

    logger.info(
      `[QBO Webhook] Created refund of ${amount} for order ${orderNumber} (QBO Refund: ${qboRefundId})`
    )
  } catch (error) {
    logger.error(
      `[QBO Webhook] Failed to create refund for order ${orderNumber}: ${(error as Error).message}`
    )
  }
}
