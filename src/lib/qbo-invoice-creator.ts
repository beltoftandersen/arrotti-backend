/**
 * Shared QBO invoice creation logic
 * Used by both the automatic subscriber and manual trigger API
 */

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { QboClient } from "./qbo-client"
import { findOrCreateCustomer } from "./qbo-customer"
import { createInvoice, getInvoice, deleteInvoice, voidInvoice, getNextInvoiceDocNumber } from "./qbo-invoice"
import type { QboInvoice } from "./qbo-invoice"
import { QboHttpError } from "./qbo-retry"
import { findOrCreateTermByDays } from "./qbo-terms"
import { findAccountByName } from "./qbo-accounts"
import { upsertInventoryItemByName, resolveShippingItem, type ItemAccountRefs } from "./qbo-item"
import { QBO_CONNECTION_MODULE } from "../modules/qbo-connection"
import QboConnectionService from "../modules/qbo-connection/service"

/**
 * Invoice-level configuration. Accounts are resolved by Name at invoice time;
 * per-variant QBO Items are upserted lazily on each order so we never touch
 * the QBO catalog for SKUs that never sell.
 */
const QBO_INCOME_ACCOUNT_NAME = "B2B Website Sales"
const QBO_COGS_ACCOUNT_NAME = "Cost of goods sold"
const QBO_ASSET_ACCOUNT_NAME = "Inventory"
const QBO_SHIPPING_INCOME_ACCOUNT_NAME = "Shipping Income"
const QBO_SHIPPING_ITEM_NAME = "Shipping"
const QBO_CUSTOMER_MEMO = "OUR PRODUCTS ARE NEW AFTERMARKET"

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
      "shipping_methods.name",
      "shipping_methods.amount",
      "shipping_methods.total",
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

  // Resolve the four configured QBO accounts once per invoice (cached within qbo-accounts).
  const [incomeAcc, cogsAcc, assetAcc, shippingIncomeAcc] = await Promise.all([
    findAccountByName(client, QBO_INCOME_ACCOUNT_NAME),
    findAccountByName(client, QBO_COGS_ACCOUNT_NAME),
    findAccountByName(client, QBO_ASSET_ACCOUNT_NAME),
    findAccountByName(client, QBO_SHIPPING_INCOME_ACCOUNT_NAME),
  ])
  if (!incomeAcc || !cogsAcc || !assetAcc) {
    const missing = [
      !incomeAcc && QBO_INCOME_ACCOUNT_NAME,
      !cogsAcc && QBO_COGS_ACCOUNT_NAME,
      !assetAcc && QBO_ASSET_ACCOUNT_NAME,
    ].filter(Boolean).join(", ")
    return { success: false, message: `Required QBO accounts not found: ${missing}` }
  }
  const itemAccounts: ItemAccountRefs = { income: incomeAcc, cogs: cogsAcc, asset: assetAcc }
  const invStartDate = toDateString(order.created_at).split("T")[0]

  // Build invoice line items (use discounted prices so QBO tax is correct).
  // Per-line ItemRef comes from upserting an Inventory item keyed on variant SKU.
  const items = order.items || []
  const orderDiscountTotal = toNumber(order.discount_total)
  const skuToItemRef = new Map<string, { value: string; name: string }>()
  const linesInput = items.map((item: any) => {
    const qty = toNumber(item.quantity) || 1
    const itemDiscount = toNumber(item.discount_total)
    const itemDiscountTax = toNumber(item.discount_tax_total)
    // subtotal is BEFORE discounts (excl. tax), so subtract the pre-tax discount portion
    const discountExclTax = itemDiscount - itemDiscountTax
    const unitPrice = item.subtotal !== undefined && item.subtotal !== null
      ? Math.round((toNumber(item.subtotal) - discountExclTax) / qty * 100) / 100
      : toNumber(item.unit_price)
    const productName = item.product_title || item.title || "Product"
    const variantName = item.variant_title || item.variant?.title
    const description = variantName && variantName !== productName
      ? `${productName} - ${variantName}`
      : productName
    const sku = item.variant?.sku || item.variant_sku
    return {
      sku,
      quantity: qty,
      unitPrice,
      description: itemDiscount > 0
        ? `${description} (discount: -$${itemDiscount.toFixed(2)})`
        : description,
      productDescription: description,
    }
  })

  // JIT upsert one QBO Item per distinct SKU in this order (skip lines missing SKU).
  for (const line of linesInput) {
    if (!line.sku || skuToItemRef.has(line.sku)) continue
    try {
      const itemRef = await upsertInventoryItemByName(client, {
        name: line.sku,
        sku: line.sku,
        description: line.productDescription,
        unitPrice: line.unitPrice > 0 ? line.unitPrice : undefined,
        invStartDate,
        accounts: itemAccounts,
      })
      skuToItemRef.set(line.sku, itemRef)
    } catch (err) {
      logger.error(
        `[QBO Invoice] Failed to upsert QBO item for SKU "${line.sku}": ${(err as Error).message}`
      )
      // Leave unmapped — the line falls through to input.incomeItemRef (undefined = QBO default).
    }
  }

  const lines = linesInput.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    sku: line.sku,
    itemRef: line.sku ? skuToItemRef.get(line.sku) : undefined,
  }))

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

  // Shipping line description = joined names of the chosen shipping option(s).
  const shippingMethods = ((order as any).shipping_methods || []) as Array<any>
  const shippingMethodNames = shippingMethods
    .map((m: any) => m?.name)
    .filter((n: any): n is string => typeof n === "string" && n.trim().length > 0)
  const shippingDescription = shippingMethodNames.length > 0
    ? shippingMethodNames.join(", ")
    : undefined

  // order.shipping_total comes back as 0 in Medusa V2 even when shipping was
  // paid; mirror the fallback used in order-confirmation.ts and sum the
  // individual method amounts when the aggregate is 0.
  let shippingAmount = toNumber(order.shipping_total)
  if (shippingAmount === 0 && shippingMethods.length > 0) {
    shippingAmount = shippingMethods.reduce(
      (sum: number, m: any) => sum + toNumber(m?.amount ?? m?.total),
      0
    )
    if (shippingAmount > 0) {
      logger.info(
        `[QBO Invoice] order.shipping_total was 0; summed shipping_methods to $${shippingAmount.toFixed(2)}`
      )
    }
  }

  // Shipping line uses a dedicated QBO Item on "Shipping Income".
  let shippingItemRef: { value: string; name: string } | undefined
  if (shippingAmount > 0 && shippingIncomeAcc) {
    try {
      shippingItemRef = await resolveShippingItem(client, {
        name: QBO_SHIPPING_ITEM_NAME,
        shippingIncomeAccount: shippingIncomeAcc,
      })
    } catch (err) {
      logger.error(
        `[QBO Invoice] Failed to resolve shipping item: ${(err as Error).message}`
      )
    }
  } else if (shippingAmount > 0 && !shippingIncomeAcc) {
    logger.warn(
      `[QBO Invoice] Shipping charged but QBO account "${QBO_SHIPPING_INCOME_ACCOUNT_NAME}" not found — shipping line will use default account`
    )
  }

  // Build invoice payload (docNumber computed on each attempt in the retry loop below).
  const invoicePayload = {
    customerId: customer.Id,
    customerName: customer.DisplayName,
    orderNumber,
    orderDate: toDateString(order.created_at),
    email: order.email,
    lines,
    shippingAmount,
    shippingDescription,
    taxAmount: toNumber(order.tax_total),
    note: QBO_CUSTOMER_MEMO,
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
    shippingItemRef,
    discountNote: orderDiscountTotal > 0 ? `Discount: -$${orderDiscountTotal.toFixed(2)}` : undefined,
  }

  // QBO's "Custom transaction numbers" is ON for this tenant, so DocNumber
  // must be supplied explicitly. Compute next = max(existing numeric) + 1.
  // Handle races (two invoices computing the same next number) by retrying
  // with a fresh query on duplicate-DocNumber errors from QBO (code 6000 or
  // error text containing "DocNumber" / "duplicate").
  let invoice: QboInvoice | null = null
  let lastDocNumber: string | null = null
  for (let attempt = 0; attempt < 5; attempt++) {
    // Pass attempt as offset so retries skip past the colliding number
    // (avoids re-racing on the same value when the duplicate was one of
    // our own concurrent creates).
    const docNumber = await getNextInvoiceDocNumber(client, attempt)
    lastDocNumber = docNumber
    try {
      invoice = await createInvoice(client, { ...invoicePayload, docNumber })
      break
    } catch (err) {
      const isDupe =
        err instanceof QboHttpError &&
        /docnumber|duplicate|already|6140|6000/i.test(err.body || err.message)
      if (!isDupe) throw err
      logger.warn(
        `[QBO Invoice] DocNumber ${docNumber} conflicted (attempt ${attempt + 1}/5), retrying with fresh number`
      )
    }
  }
  if (!invoice) {
    throw new Error(
      `Failed to create invoice after 5 attempts (last tried DocNumber ${lastDocNumber})`
    )
  }

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
