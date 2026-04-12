import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h } from "../lib/html-escape"

type QuoteEventData = {
  id: string
}

const STOREFRONT_URL =
  process.env.B2B_STOREFRONT_URL || process.env.STOREFRONT_URL || "http://localhost:8002"
const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY_CODE || "us"
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "orders@arrottigroup.com"

export default async function quoteNotificationHandler({
  event: { data, name },
  container,
}: SubscriberArgs<QuoteEventData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationModuleService = container.resolve("notification")

  try {
    // Load quote details
    const { data: [quote] } = await query.graph({
      entity: "quote",
      fields: [
        "id",
        "product_id",
        "variant_id",
        "customer_id",
        "quantity",
        "notes",
        "status",
        "quoted_price",
        "currency_code",
        "admin_notes",
        "expires_at",
        "created_at",
      ],
      filters: { id: data.id },
    })

    if (!quote) {
      logger.warn(`[Quote Notification] Quote ${data.id} not found`)
      return
    }

    // Load customer info
    let customerEmail = ""
    let customerName = ""
    let companyName = ""
    if (quote.customer_id) {
      const { data: [customer] } = await query.graph({
        entity: "customer",
        fields: ["id", "email", "first_name", "last_name", "company_name"],
        filters: { id: quote.customer_id },
      })
      if (customer) {
        customerEmail = customer.email || ""
        customerName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
        companyName = (customer as any).company_name || ""
      }
    }

    // Load product info
    let productTitle = ""
    let productSku = ""
    if (quote.product_id) {
      const { data: [product] } = await query.graph({
        entity: "product",
        fields: ["id", "title", "handle"],
        filters: { id: quote.product_id },
      })
      if (product) {
        productTitle = product.title || ""
      }
    }

    if (quote.variant_id) {
      try {
        const { data: [variant] } = await query.graph({
          entity: "product_variant",
          fields: ["id", "sku"],
          filters: { id: quote.variant_id },
        })
        if (variant) {
          productSku = variant.sku || ""
        }
      } catch {
        // Variant not found, ignore
      }
    }

    const formatPrice = (cents: number, currency: string) => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currency.toUpperCase(),
      }).format(cents / 100)
    }

    if (name === "quote.created") {
      // Notify admin about new quote request
      const html = buildAdminNewQuoteEmail({
        quoteId: quote.id,
        productTitle,
        productSku,
        quantity: quote.quantity,
        customerName,
        customerEmail,
        companyName,
        notes: quote.notes,
      })

      await notificationModuleService.createNotifications({
        to: ADMIN_EMAIL,
        channel: "email",
        template: "quote-created",
        data: {
          subject: `New Quote Request: ${productTitle || "Product"} from ${customerName || customerEmail}`,
          html,
          text: `New quote request from ${customerName} (${customerEmail}) for ${productTitle} x${quote.quantity}.`,
        },
      })

      logger.info(`[Quote Notification] Sent new quote notification to admin for quote ${quote.id}`)
    }

    if (name === "quote.sent" && customerEmail) {
      // Notify customer that their quote is ready
      const quotedPrice = formatPrice(quote.quoted_price as number, quote.currency_code || "usd")
      const quotesUrl = `${STOREFRONT_URL}/account/quotes`

      const html = buildCustomerQuoteSentEmail({
        customerName,
        productTitle,
        productSku,
        quantity: quote.quantity,
        quotedPrice,
        expiresAt: quote.expires_at ? String(quote.expires_at) : null,
        adminNotes: quote.admin_notes,
        quotesUrl,
      })

      await notificationModuleService.createNotifications({
        to: customerEmail,
        channel: "email",
        template: "quote-sent",
        data: {
          subject: `Your Quote is Ready: ${productTitle || "Product"}`,
          html,
          text: `Your quote for ${productTitle} x${quote.quantity} is ready: ${quotedPrice}. View at ${quotesUrl}`,
        },
      })

      logger.info(`[Quote Notification] Sent quote-ready email to ${customerEmail} for quote ${quote.id}`)
    }

    if (name === "quote.accepted") {
      // Notify admin that customer accepted the quote
      const quotedPrice = formatPrice(quote.quoted_price as number, quote.currency_code || "usd")

      const html = buildAdminQuoteAcceptedEmail({
        quoteId: quote.id,
        productTitle,
        productSku,
        quantity: quote.quantity,
        quotedPrice,
        customerName,
        customerEmail,
        companyName,
      })

      await notificationModuleService.createNotifications({
        to: ADMIN_EMAIL,
        channel: "email",
        template: "quote-accepted",
        data: {
          subject: `Quote Accepted: ${productTitle || "Product"} by ${customerName || customerEmail}`,
          html,
          text: `Quote ${quote.id} accepted by ${customerName} (${customerEmail}). ${productTitle} x${quote.quantity} at ${quotedPrice}.`,
        },
      })

      logger.info(`[Quote Notification] Sent quote-accepted notification to admin for quote ${quote.id}`)
    }

    if (name === "quote.expired" && customerEmail) {
      // Notify customer that their quote has expired
      const quotesUrl = `${STOREFRONT_URL}/account/quotes`

      const html = buildCustomerQuoteExpiredEmail({
        customerName,
        productTitle,
        quotesUrl,
      })

      await notificationModuleService.createNotifications({
        to: customerEmail,
        channel: "email",
        template: "quote-expired",
        data: {
          subject: `Your Quote Has Expired: ${productTitle || "Product"}`,
          html,
          text: `Your quote for ${productTitle} has expired. You can submit a new quote request at ${quotesUrl}`,
        },
      })

      logger.info(`[Quote Notification] Sent quote-expired email to ${customerEmail} for quote ${quote.id}`)
    }
  } catch (error) {
    logger.error(
      `[Quote Notification] Error processing ${name} for quote ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["quote.created", "quote.sent", "quote.accepted", "quote.expired"],
}

// --- Email template builders ---

function buildAdminNewQuoteEmail(data: {
  quoteId: string
  productTitle: string
  productSku: string
  quantity: number
  customerName: string
  customerEmail: string
  companyName: string
  notes: string | null
}) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://arrottigroup.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
      </div>
      <h1 style="color: #333; margin-bottom: 10px;">New Quote Request</h1>
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Quote ID:</strong> ${h(data.quoteId)}</p>
        <p><strong>Product:</strong> ${h(data.productTitle)}</p>
        ${data.productSku ? `<p><strong>SKU:</strong> ${h(data.productSku)}</p>` : ""}
        <p><strong>Quantity:</strong> ${data.quantity}</p>
        <p><strong>Customer:</strong> ${h(data.customerName)} (${h(data.customerEmail)})</p>
        ${data.companyName ? `<p><strong>Company:</strong> ${h(data.companyName)}</p>` : ""}
        ${data.notes ? `<p><strong>Notes:</strong> ${h(data.notes)}</p>` : ""}
      </div>
      <p style="color: #666;">Log into the admin panel to review and respond to this quote request.</p>
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
        <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
      </div>
    </body>
    </html>
  `
}

function buildCustomerQuoteSentEmail(data: {
  customerName: string
  productTitle: string
  productSku: string
  quantity: number
  quotedPrice: string
  expiresAt: string | null
  adminNotes: string | null
  quotesUrl: string
}) {
  const expiryText = data.expiresAt
    ? `<p style="color: #f59e0b;"><strong>Expires:</strong> ${new Date(data.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>`
    : ""

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://arrottigroup.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
      </div>
      <h1 style="color: #333; margin-bottom: 10px;">Your Quote is Ready</h1>
      <p>Hi ${h(data.customerName)},</p>
      <p>We've reviewed your quote request and have a price ready for you:</p>
      <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Product:</strong> ${h(data.productTitle)}</p>
        ${data.productSku ? `<p><strong>SKU:</strong> ${h(data.productSku)}</p>` : ""}
        <p><strong>Quantity:</strong> ${data.quantity}</p>
        <p style="font-size: 24px; color: #007ffd; font-weight: bold;">${h(data.quotedPrice)}</p>
        ${expiryText}
        ${data.adminNotes ? `<p><strong>Notes:</strong> ${h(data.adminNotes)}</p>` : ""}
      </div>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${h(data.quotesUrl)}"
           style="display: inline-block; background-color: #007ffd; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
          View & Accept Quote
        </a>
      </div>
      <p style="color: #666;">Best regards,<br><strong>The Arrotti Group Team</strong></p>
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
        <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
      </div>
    </body>
    </html>
  `
}

function buildAdminQuoteAcceptedEmail(data: {
  quoteId: string
  productTitle: string
  productSku: string
  quantity: number
  quotedPrice: string
  customerName: string
  customerEmail: string
  companyName: string
}) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://arrottigroup.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
      </div>
      <h1 style="color: #10b981; margin-bottom: 10px;">Quote Accepted</h1>
      <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Quote ID:</strong> ${h(data.quoteId)}</p>
        <p><strong>Product:</strong> ${h(data.productTitle)}</p>
        ${data.productSku ? `<p><strong>SKU:</strong> ${h(data.productSku)}</p>` : ""}
        <p><strong>Quantity:</strong> ${data.quantity}</p>
        <p><strong>Price:</strong> ${h(data.quotedPrice)}</p>
        <p><strong>Customer:</strong> ${h(data.customerName)} (${h(data.customerEmail)})</p>
        ${data.companyName ? `<p><strong>Company:</strong> ${h(data.companyName)}</p>` : ""}
      </div>
      <p style="color: #666;">The customer may proceed to place an order with this accepted quote.</p>
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
        <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
      </div>
    </body>
    </html>
  `
}

function buildCustomerQuoteExpiredEmail(data: {
  customerName: string
  productTitle: string
  quotesUrl: string
}) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 20px;">
        <img src="https://arrottigroup.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
      </div>
      <h1 style="color: #f59e0b; margin-bottom: 10px;">Your Quote Has Expired</h1>
      <p>Hi ${h(data.customerName)},</p>
      <p>Your quote for <strong>${h(data.productTitle)}</strong> has expired. If you're still interested, you can submit a new quote request.</p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${h(data.quotesUrl)}"
           style="display: inline-block; background-color: #007ffd; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">
          View My Quotes
        </a>
      </div>
      <p style="color: #666;">Best regards,<br><strong>The Arrotti Group Team</strong></p>
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
        <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
      </div>
    </body>
    </html>
  `
}
