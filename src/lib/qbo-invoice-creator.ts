/**
 * Shared QBO invoice creation logic
 * Used by both the automatic subscriber and manual trigger API
 */

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { QboClient } from "./qbo-client"
import { findOrCreateCustomer } from "./qbo-customer"
import { createInvoice, getInvoice, deleteInvoice, voidInvoice } from "./qbo-invoice"
import type { QboInvoice } from "./qbo-invoice"
import { findOrCreateTermByDays } from "./qbo-terms"
import { findItemByName } from "./qbo-accounts"
import { QBO_CONNECTION_MODULE } from "../modules/qbo-connection"
import QboConnectionService from "../modules/qbo-connection/service"

/**
 * Map sales channel name to QBO Item name for income account routing
 * Add entries here as you create corresponding products/services in QBO
 */
const SALES_CHANNEL_TO_QBO_ITEM: Record<string, string> = {
  "B2B Wholesale": "B2B Ecommerce Sales",
  // Add more mappings as needed:
  // "Default Sales Channel": "Ecommerce Sales",
}

type InvoiceMetadata = {
  connected: boolean
  exists: boolean
  invoice_id?: string
  invoice_number?: string
  total?: number
  balance?: number
  is_paid?: boolean
  last_checked: string
}

async function saveInvoiceToOrderMetadata(
  orderId: string,
  invoiceData: InvoiceMetadata,
  container: any
) {
  try {
    const orderService = container.resolve(Modules.ORDER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    // Get current order metadata
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: orderId },
    })

    if (order) {
      const currentMetadata = (order.metadata || {}) as Record<string, any>
      await orderService.updateOrders([{
        id: orderId,
        metadata: {
          ...currentMetadata,
          qbo_invoice: invoiceData,
        },
      }])
    }
  } catch (error) {
    console.error("[QBO] Failed to save invoice metadata:", error)
    // Don't throw - this is a nice-to-have feature
  }
}

/**
 * Look up an existing QBO invoice for a Medusa order using the invoice_id
 * saved in order.metadata.qbo_invoice. Returns null if no id is stored or
 * the invoice no longer exists in QBO (e.g. deleted from the QB UI).
 */
async function getQboInvoiceFromOrderMetadata(
  orderMetadata: Record<string, any> | null | undefined,
  client: QboClient
): Promise<QboInvoice | null> {
  const invoiceId = orderMetadata?.qbo_invoice?.invoice_id
  if (!invoiceId) return null
  try {
    return await getInvoice(client, invoiceId)
  } catch {
    return null
  }
}

function toNumber(value: any): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

function toDateString(value: any): string {
  if (!value) return new Date().toISOString()
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  return new Date().toISOString()
}

export type CreateInvoiceResult = {
  success: boolean
  invoiceId?: string
  invoiceNumber?: string
  total?: number
  message: string
  alreadyExists?: boolean
}

/**
 * Create a QBO invoice for an order
 * Returns result object with success status and details
 */
export async function createQboInvoiceForOrder(
  orderId: string,
  container: any
): Promise<CreateInvoiceResult> {
  const logger = container.resolve("logger")
  const qboConnectionService: QboConnectionService = container.resolve(QBO_CONNECTION_MODULE)

  // Check if we have an active QBO connection
  const isConnected = await qboConnectionService.isConnected()
  if (!isConnected) {
    return { success: false, message: "QuickBooks is not connected" }
  }

  // Get order details
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [order] } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "created_at",
      "currency_code",
      "total",
      "subtotal",
      "shipping_total",
      "tax_total",
      "discount_total",
      "metadata",
      "items.*",
      "items.subtotal",
      "items.discount_total",
      "items.discount_tax_total",
      "items.variant.sku",
      "items.variant.title",
      "shipping_address.*",
      "billing_address.*",
      "customer.first_name",
      "customer.last_name",
      "customer.phone",
      "customer.metadata",
      "sales_channel.name",
    ],
    filters: {
      id: orderId,
    },
  })

  if (!order) {
    return { success: false, message: `Order ${orderId} not found` }
  }

  if (!order.email) {
    return { success: false, message: `Order ${order.id} has no email` }
  }

  // Create QBO client
  const client = new QboClient(qboConnectionService)

  // Use display_id for logging/PrivateNote only (QBO will auto-assign DocNumber)
  const orderNumber = order.display_id?.toString() || order.id

  // Idempotency: look up the QBO invoice via the id we previously stored in order metadata
  const existingInvoice = await getQboInvoiceFromOrderMetadata(
    order.metadata as Record<string, any> | null | undefined,
    client
  )
  if (existingInvoice) {
    logger.info(`[QBO Invoice] Invoice already exists for order ${orderNumber} (QBO DocNumber ${existingInvoice.DocNumber})`)
    return {
      success: true,
      alreadyExists: true,
      invoiceId: existingInvoice.Id,
      invoiceNumber: existingInvoice.DocNumber,
      total: existingInvoice.TotalAmt,
      message: `Invoice ${existingInvoice.DocNumber} already exists for this order`,
    }
  }

  // Find or create customer in QBO
  const billingAddress = order.billing_address || order.shipping_address
  const customer = await findOrCreateCustomer(client, {
    email: order.email,
    firstName: order.customer?.first_name || billingAddress?.first_name || undefined,
    lastName: order.customer?.last_name || billingAddress?.last_name || undefined,
    phone: order.customer?.phone || billingAddress?.phone || undefined,
    billingAddress: billingAddress ? {
      address_1: billingAddress.address_1 || undefined,
      city: billingAddress.city || undefined,
      province: billingAddress.province || undefined,
      postal_code: billingAddress.postal_code || undefined,
      country_code: billingAddress.country_code || undefined,
    } : undefined,
  })

  // Build invoice line items (use discounted prices so QBO tax is correct)
  const items = order.items || []
  const orderDiscountTotal = toNumber(order.discount_total)
  const lines = items.map((item: any) => {
    const qty = toNumber(item.quantity) || 1
    const itemDiscount = toNumber(item.discount_total)
    const itemDiscountTax = toNumber(item.discount_tax_total)
    // subtotal is BEFORE discounts (excl. tax), so subtract the pre-tax discount portion
    const discountExclTax = itemDiscount - itemDiscountTax
    const unitPrice = item.subtotal !== undefined && item.subtotal !== null
      ? Math.round((toNumber(item.subtotal) - discountExclTax) / qty * 100) / 100
      : toNumber(item.unit_price)
    const description = item.title || item.variant?.title || "Product"
    return {
      description: itemDiscount > 0
        ? `${description} (discount: -$${itemDiscount.toFixed(2)})`
        : description,
      quantity: qty,
      unitPrice,
      sku: item.variant?.sku || item.variant_sku,
    }
  })

  // Look up payment terms - order metadata takes priority over customer metadata
  let salesTermRef: { value: string; name: string } | undefined
  const orderPaymentTermsDays = (order as any).metadata?.payment_terms_days
  const customerPaymentTermsDays = order.customer?.metadata?.payment_terms_days
  const paymentTermsDays = orderPaymentTermsDays !== undefined ? orderPaymentTermsDays : customerPaymentTermsDays

  if (paymentTermsDays !== undefined && paymentTermsDays !== null) {
    const days = Number(paymentTermsDays)
    if (!isNaN(days)) {
      salesTermRef = await findOrCreateTermByDays(client, days) || undefined
      if (salesTermRef) {
        const source = orderPaymentTermsDays !== undefined ? "order" : "customer"
        logger.info(`[QBO Invoice] Using payment terms from ${source}: ${salesTermRef.name} (${days} days)`)
      }
    }
  }

  // Look up QBO Item for income account based on sales channel
  let incomeItemRef: { value: string; name: string } | undefined
  const salesChannelName = (order as any).sales_channel?.name
  if (salesChannelName) {
    const qboItemName = SALES_CHANNEL_TO_QBO_ITEM[salesChannelName]
    if (qboItemName) {
      incomeItemRef = await findItemByName(client, qboItemName) || undefined
      if (incomeItemRef) {
        logger.info(`[QBO Invoice] Using income item "${qboItemName}" for sales channel "${salesChannelName}"`)
      }
    }
  }

  // Create invoice
  const invoice = await createInvoice(client, {
    customerId: customer.Id,
    customerName: customer.DisplayName,
    orderNumber,
    orderDate: toDateString(order.created_at),
    email: order.email,
    lines,
    shippingAmount: toNumber(order.shipping_total),
    taxAmount: toNumber(order.tax_total),
    billingAddress: billingAddress ? {
      address_1: billingAddress.address_1 || undefined,
      city: billingAddress.city || undefined,
      province: billingAddress.province || undefined,
      postal_code: billingAddress.postal_code || undefined,
      country_code: billingAddress.country_code || undefined,
    } : undefined,
    shippingAddress: order.shipping_address ? {
      address_1: order.shipping_address.address_1 || undefined,
      city: order.shipping_address.city || undefined,
      province: order.shipping_address.province || undefined,
      postal_code: order.shipping_address.postal_code || undefined,
      country_code: order.shipping_address.country_code || undefined,
    } : undefined,
    salesTermRef,
    salesChannelName: (order as any).sales_channel?.name,
    incomeItemRef,
    discountNote: orderDiscountTotal > 0 ? `Discount: -$${orderDiscountTotal.toFixed(2)}` : undefined,
  })

  logger.info(
    `[QBO Invoice] Created invoice ${invoice.DocNumber} (ID: ${invoice.Id}) for order ${orderNumber}, total: ${invoice.TotalAmt}`
  )

  // Save invoice info to order metadata (for widget display)
  await saveInvoiceToOrderMetadata(orderId, {
    connected: true,
    exists: true,
    invoice_id: invoice.Id,
    invoice_number: invoice.DocNumber,
    total: invoice.TotalAmt,
    balance: invoice.TotalAmt, // New invoice has full balance
    is_paid: false,
    last_checked: new Date().toISOString(),
  }, container)

  return {
    success: true,
    invoiceId: invoice.Id,
    invoiceNumber: invoice.DocNumber,
    total: invoice.TotalAmt,
    message: `Invoice ${invoice.DocNumber} created successfully`,
  }
}

/**
 * Recreate a QBO invoice for an order (delete existing + create new)
 */
export async function recreateQboInvoiceForOrder(
  orderId: string,
  container: any
): Promise<CreateInvoiceResult> {
  const logger = container.resolve("logger")
  const qboConnectionService: QboConnectionService = container.resolve(QBO_CONNECTION_MODULE)

  const isConnected = await qboConnectionService.isConnected()
  if (!isConnected) {
    return { success: false, message: "QuickBooks is not connected" }
  }

  // Get order display_id + metadata (for stored invoice id)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: [order] } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "metadata"],
    filters: { id: orderId },
  })

  if (!order) {
    return { success: false, message: `Order ${orderId} not found` }
  }

  const orderNumber = order.display_id?.toString() || order.id
  const client = new QboClient(qboConnectionService)

  // Find and delete existing invoice (only if unpaid) — resolved via stored invoice id
  const existingInvoice = await getQboInvoiceFromOrderMetadata(
    order.metadata as Record<string, any> | null | undefined,
    client
  )
  if (existingInvoice) {
    const balance = Number(existingInvoice.Balance) || 0
    if (balance < existingInvoice.TotalAmt) {
      // Fully or partially paid — do not touch
      return {
        success: false,
        message: `Invoice ${existingInvoice.DocNumber} has payments applied. Cannot recreate a paid or partially paid invoice.`,
      }
    }

    try {
      // Unpaid — safe to delete
      const freshInvoice = await getInvoice(client, existingInvoice.Id)
      await deleteInvoice(client, freshInvoice.Id, freshInvoice.SyncToken!)
      logger.info(`[QBO Invoice] Deleted invoice ${freshInvoice.DocNumber} for recreate`)
    } catch (error) {
      return {
        success: false,
        message: `Failed to remove existing invoice: ${(error as Error).message}`,
      }
    }
  }

  // Create fresh invoice
  return createQboInvoiceForOrder(orderId, container)
}
