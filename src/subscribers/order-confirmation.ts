import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h } from "../lib/html-escape"

type OrderPlacedData = {
  id: string
}

export default async function orderConfirmationHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationModuleService = container.resolve("notification")

  try {
    // Get order details
    // Note: Totals must be explicitly requested (not included with "*")
    // Note: items.* is needed to get quantity (individual field requests don't work)
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "created_at",
        "currency_code",
        // Totals - must be explicitly requested (they are calculated, not stored)
        "total",
        "subtotal",
        "shipping_total",
        "tax_total",
        "discount_total",
        // Items - use wildcard to get quantity properly
        "items.*",
        "items.variant.sku",
        "items.variant.title",
        // Addresses
        "shipping_address.first_name",
        "shipping_address.last_name",
        "shipping_address.address_1",
        "shipping_address.address_2",
        "shipping_address.city",
        "shipping_address.province",
        "shipping_address.postal_code",
        "shipping_address.country_code",
        // Shipping methods
        "shipping_methods.name",
        "shipping_methods.amount",
        "shipping_methods.total",
        "shipping_methods.tax_total",
        // Items tax
        "items.tax_total",
      ],
      filters: {
        id: data.id,
      },
    })

    if (!order) {
      logger.warn(`[Order Confirmation] Order ${data.id} not found`)
      return
    }

    if (!order.email) {
      logger.warn(`[Order Confirmation] Order ${order.id} has no email`)
      return
    }

    const items = order.items ?? []
    const shippingAddress = order.shipping_address
    const billingAddress = order.billing_address
    const shippingMethods = order.shipping_methods ?? []

    const poNumber = (() => {
      const raw = (order.metadata as any)?.po_number
      if (typeof raw !== "string") return undefined
      const trimmed = raw.trim()
      return trimmed.length > 0 ? trimmed : undefined
    })()

    // Detect pickup orders by shipping method name
    const isPickup = shippingMethods.some((m: any) => m.name === "Arrotti Group")

    // Joined name(s) of the chosen shipping option — shown next to the Shipping total.
    const shippingMethodLabel = shippingMethods
      .map((m: any) => m?.name)
      .filter((n: any): n is string => typeof n === "string" && n.trim().length > 0)
      .join(", ")

    // Debug logging
    logger.info(`[Order Confirmation] Order ${order.id} - shipping_total: ${order.shipping_total}, tax_total: ${order.tax_total}`)
    logger.info(`[Order Confirmation] Shipping methods: ${JSON.stringify(shippingMethods)}`)

    // Calculate shipping total from shipping methods if order.shipping_total is 0
    let shippingTotal = toNumber(order.shipping_total)
    if (shippingTotal === 0 && shippingMethods.length > 0) {
      shippingTotal = shippingMethods.reduce((sum: number, method: any) => {
        // Use amount (before tax) or total
        return sum + toNumber(method.amount || method.total)
      }, 0)
      logger.info(`[Order Confirmation] Calculated shipping total from methods: ${shippingTotal}`)
    }

    // Calculate tax total if order.tax_total is 0
    let taxTotal = toNumber(order.tax_total)
    if (taxTotal === 0) {
      // Sum tax from items
      const itemsTax = items.reduce((sum: number, item: any) => {
        return sum + toNumber(item.tax_total)
      }, 0)
      // Sum tax from shipping methods
      const shippingTax = shippingMethods.reduce((sum: number, method: any) => {
        return sum + toNumber(method.tax_total)
      }, 0)
      taxTotal = itemsTax + shippingTax
    }

    // Build items HTML (escape user-provided data to prevent HTML injection)
    const itemsHtml = items.map((item: any) => {
      const qty = toNumber(item.quantity) || 1
      const unitPrice = toNumber(item.unit_price)
      const lineTotal = unitPrice * qty
      return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">
          <strong>${h(item.title)}</strong>
          ${item.variant?.title ? `<br><span style="color: #666; font-size: 14px;">${h(item.variant.title)}</span>` : ""}
          ${item.variant_sku ? `<br><span style="color: #999; font-size: 12px;">SKU: ${h(item.variant_sku)}</span>` : ""}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
          ${qty}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
          ${formatPrice(lineTotal, order.currency_code)}
        </td>
      </tr>
    `}).join("")

    // Build address HTML (escape user-provided data to prevent HTML injection)
    const formatAddress = (addr: any) => {
      if (!addr) return "N/A"
      return `
        ${h(addr.first_name)} ${h(addr.last_name)}<br>
        ${h(addr.address_1)}<br>
        ${addr.address_2 ? `${h(addr.address_2)}<br>` : ""}
        ${h(addr.city)}, ${h(addr.province)} ${h(addr.postal_code)}<br>
        ${h(addr.country_code?.toUpperCase())}
      `
    }

    // Order totals table (shared between both email types)
    const totalsHtml = `
        <table style="width: 100%; margin-bottom: 30px;">
          <tr>
            <td style="padding: 8px 0; color: #666;">Subtotal</td>
            <td style="padding: 8px 0; text-align: right;">${formatPrice(order.subtotal, order.currency_code)}</td>
          </tr>
          ${!isPickup ? `
          <tr>
            <td style="padding: 8px 0; color: #666;">Shipping${shippingMethodLabel ? ` (${h(shippingMethodLabel)})` : ""}</td>
            <td style="padding: 8px 0; text-align: right;">${formatPrice(shippingTotal, order.currency_code)}</td>
          </tr>` : ""}
          ${order.discount_total ? `
          <tr>
            <td style="padding: 8px 0; color: #666;">Discount</td>
            <td style="padding: 8px 0; text-align: right; color: #10b981;">-${formatPrice(order.discount_total, order.currency_code)}</td>
          </tr>
          ` : ""}
          <tr>
            <td style="padding: 8px 0; color: #666;">Tax</td>
            <td style="padding: 8px 0; text-align: right;">${formatPrice(taxTotal, order.currency_code)}</td>
          </tr>
          <tr style="font-size: 18px; font-weight: bold;">
            <td style="padding: 12px 0; border-top: 2px solid #333;">Total</td>
            <td style="padding: 12px 0; border-top: 2px solid #333; text-align: right;">${formatPrice(order.total, order.currency_code)}</td>
          </tr>
        </table>`

    // Pickup-specific sections
    const pickupInfoHtml = `
        <div style="background-color: #fff8e1; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b; margin-bottom: 20px;">
          <h3 style="color: #b45309; margin: 0 0 10px;">Pickup Information</h3>
          <p style="margin: 0 0 8px; color: #666;">
            <strong>Pickup Location:</strong><br>
            Arrotti Group<br>
            4651 36th Street, Suite 500<br>
            Orlando, FL 32811
          </p>
          <p style="margin: 8px 0 0; color: #666;">
            <strong>Business Hours:</strong><br>
            Mon–Fri: 8AM – 6PM EST<br>
            Sat: 9AM – 2PM EST
          </p>
        </div>`

    // Shipping-specific sections
    const shippingInfoHtml = `
        <div style="display: flex; gap: 20px; margin-bottom: 30px;">
          <div style="flex: 1;">
            <h3 style="color: #333; font-size: 16px; margin-bottom: 10px;">Shipping Address</h3>
            <p style="color: #666; margin: 0; line-height: 1.8;">
              ${formatAddress(shippingAddress)}
            </p>
          </div>
        </div>`

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://carparts.chimkins.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
        </div>

        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #007ffd; margin-bottom: 10px;">Order Confirmed</h1>
          <p style="color: #666; font-size: 16px;">Thank you for your order</p>
        </div>

        ${isPickup ? `
        <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #007ffd; margin: 0 0 10px;">What's Next?</h3>
          <p style="margin: 0; color: #666;">
            We're preparing your order for pickup. You'll receive an email or a call when your order is ready to be picked up. Please bring a valid ID and your order number.
          </p>
        </div>
        ` : `
        <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: #007ffd; margin: 0 0 10px;">What's Next?</h3>
          <p style="margin: 0; color: #666;">
            We're preparing your order for shipment. You'll receive another email with tracking information once your order ships.
          </p>
        </div>
        `}

        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          ${poNumber ? `<p style="margin: 0 0 8px;"><strong>PO Number:</strong> ${h(poNumber)}</p>` : ""}
          <p style="margin: 0;"><strong>Order Number:</strong> #${order.display_id || order.id}</p>
          <p style="margin: 8px 0 0;"><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
          })}</p>
        </div>

        <h2 style="color: #333; font-size: 18px; border-bottom: 2px solid #007ffd; padding-bottom: 10px;">Order Summary</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f5f5f5;">
              <th style="padding: 12px; text-align: left;">Item</th>
              <th style="padding: 12px; text-align: center;">Qty</th>
              <th style="padding: 12px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        ${totalsHtml}
        ${isPickup ? pickupInfoHtml : shippingInfoHtml}

        <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
          <p>Questions about your order? Contact us at info@arrottigroup.com</p>
          <p style="margin-top: 10px;">&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
        </div>
      </body>
      </html>
    `

    const text = isPickup ? `
ORDER CONFIRMED

Thank you for your order.

We're preparing your order for pickup. You'll receive an email or a call when your order is ready to be picked up. Please bring a valid ID and your order number.

${poNumber ? `PO Number: ${poNumber}\n` : ""}Order Number: #${order.display_id || order.id}
Order Date: ${new Date(order.created_at).toLocaleDateString()}

ORDER SUMMARY
${items.map((item: any) => {
  const qty = toNumber(item.quantity) || 1
  const unitPrice = toNumber(item.unit_price)
  return `- ${qty}x ${item.title} - ${formatPrice(unitPrice * qty, order.currency_code)}`
}).join("\n")}

Subtotal: ${formatPrice(order.subtotal, order.currency_code)}
${order.discount_total ? `Discount: -${formatPrice(order.discount_total, order.currency_code)}\n` : ""}Tax: ${formatPrice(taxTotal, order.currency_code)}
Total: ${formatPrice(order.total, order.currency_code)}

PICKUP LOCATION
Arrotti Group
4651 36th Street, Suite 500
Orlando, FL 32811

Business Hours:
Mon-Fri: 8AM - 6PM EST
Sat: 9AM - 2PM EST

Questions? Contact us at info@arrottigroup.com

© ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim() : `
ORDER CONFIRMED

Thank you for your order.

We're preparing your order for shipment. You'll receive another email with tracking information once your order ships.

${poNumber ? `PO Number: ${poNumber}\n` : ""}Order Number: #${order.display_id || order.id}
Order Date: ${new Date(order.created_at).toLocaleDateString()}

ORDER SUMMARY
${items.map((item: any) => {
  const qty = toNumber(item.quantity) || 1
  const unitPrice = toNumber(item.unit_price)
  return `- ${qty}x ${item.title} - ${formatPrice(unitPrice * qty, order.currency_code)}`
}).join("\n")}

Subtotal: ${formatPrice(order.subtotal, order.currency_code)}
Shipping${shippingMethodLabel ? ` (${shippingMethodLabel})` : ""}: ${formatPrice(shippingTotal, order.currency_code)}
${order.discount_total ? `Discount: -${formatPrice(order.discount_total, order.currency_code)}\n` : ""}Tax: ${formatPrice(taxTotal, order.currency_code)}
Total: ${formatPrice(order.total, order.currency_code)}

SHIPPING ADDRESS
${shippingAddress ? `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}
${shippingAddress.address_1 || ""}
${shippingAddress.address_2 ? `${shippingAddress.address_2}\n` : ""}${shippingAddress.city || ""}, ${shippingAddress.province || ""} ${shippingAddress.postal_code || ""}
${shippingAddress.country_code?.toUpperCase() || ""}` : "N/A"}

Questions? Contact us at info@arrottigroup.com

© ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim()

    await notificationModuleService.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-confirmation",
      data: {
        subject: `Order Confirmed - #${order.display_id || order.id}`,
        html,
        text,
      },
    })

    logger.info(
      `[Order Confirmation] Sent confirmation email to ${order.email} for order ${order.id}`
    )
  } catch (error) {
    logger.error(
      `[Order Confirmation] Error sending confirmation for order ${data.id}: ${(error as Error).message}`
    )
  }
}

// Convert BigNumber or number to cents (Medusa v2 returns BigNumber objects for money)
function toNumber(value: any): number {
  if (value === null || value === undefined) return 0
  // BigNumber objects can be converted with Number()
  return Number(value)
}

function formatPrice(amount: any, currencyCode: string): string {
  const numericAmount = toNumber(amount)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode?.toUpperCase() || "USD",
  }).format(numericAmount)
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
