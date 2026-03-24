/**
 * QuickBooks Online Webhook Helpers
 *
 * QBO webhooks notify when entities are created/updated/deleted.
 * We use this to sync payments made in QBO back to Medusa.
 */

import crypto from "crypto"

/**
 * QBO Webhook Payload Structure
 */
export type QboWebhookPayload = {
  eventNotifications: Array<{
    realmId: string
    dataChangeEvent: {
      entities: Array<{
        name: "Payment" | "Invoice" | "RefundReceipt" | "Customer" | string
        id: string
        operation: "Create" | "Update" | "Delete" | "Merge" | "Void"
        lastUpdated: string
      }>
    }
  }>
}

/**
 * Verify QuickBooks webhook signature
 *
 * QBO signs webhooks with HMAC-SHA256 using the verifier token.
 * The signature is base64-encoded and sent in the 'intuit-signature' header.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  verifierToken: string
): boolean {
  const hash = crypto
    .createHmac("sha256", verifierToken)
    .update(payload)
    .digest("base64")

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, "utf-8"),
      Buffer.from(signature, "utf-8")
    )
  } catch {
    // Lengths differ — not a valid signature
    return false
  }
}

/**
 * Get the verifier token from environment
 */
export function getWebhookVerifierToken(): string {
  const token = process.env.QBO_WEBHOOK_VERIFIER_TOKEN
  if (!token) {
    throw new Error("QBO_WEBHOOK_VERIFIER_TOKEN environment variable not set")
  }
  return token
}

/**
 * Parse and validate webhook payload
 */
export function parseWebhookPayload(body: unknown): QboWebhookPayload | null {
  if (!body || typeof body !== "object") {
    return null
  }

  const payload = body as QboWebhookPayload

  if (!Array.isArray(payload.eventNotifications)) {
    return null
  }

  return payload
}

/**
 * Extract payment events from webhook payload
 */
export function extractPaymentEvents(payload: QboWebhookPayload): Array<{
  realmId: string
  paymentId: string
  operation: string
}> {
  const events: Array<{ realmId: string; paymentId: string; operation: string }> = []

  for (const notification of payload.eventNotifications) {
    const entities = notification.dataChangeEvent?.entities || []
    for (const entity of entities) {
      if (entity.name === "Payment") {
        events.push({
          realmId: notification.realmId,
          paymentId: entity.id,
          operation: entity.operation,
        })
      }
    }
  }

  return events
}

/**
 * Extract refund events from webhook payload
 */
export function extractRefundEvents(payload: QboWebhookPayload): Array<{
  realmId: string
  refundId: string
  operation: string
}> {
  const events: Array<{ realmId: string; refundId: string; operation: string }> = []

  for (const notification of payload.eventNotifications) {
    const entities = notification.dataChangeEvent?.entities || []
    for (const entity of entities) {
      if (entity.name === "RefundReceipt") {
        events.push({
          realmId: notification.realmId,
          refundId: entity.id,
          operation: entity.operation,
        })
      }
    }
  }

  return events
}
