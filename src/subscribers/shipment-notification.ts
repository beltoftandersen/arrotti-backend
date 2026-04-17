import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h, escapeUrl } from "../lib/html-escape"
import { toNumber, formatPrice } from "../lib/format-helpers"

type ShipmentCreatedData = {
  id: string // fulfillment ID
  no_notification?: boolean
}

/**
 * Sends shipment notification emails to customers when an order is marked as shipped.
 * Three variants based on shipping method:
 * 1. Pickup ("Arrotti Group") — "Your Order is Ready for Pickup"
 * 2. Free Local Delivery — "Your Order is Out for Delivery"
 * 3. Standard shipping — "Your Order Has Shipped" with tracking number
 */
export default async function shipmentNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<ShipmentCreatedData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationModuleService = container.resolve("notification")

  if (data.no_notification) return

  try {
    // Get the fulfillment to find the order ID
    const { data: fulfillmentLinks } = await query.graph({
      entity: "order_fulfillment",
      fields: ["order_id", "fulfillment_id"],
      filters: {
        fulfillment_id: data.id,
      },
    })

    const orderId = (fulfillmentLinks as any)?.[0]?.order_id
    if (!orderId) {
      logger.warn(`[Shipment Notification] No order found for fulfillment ${data.id}`)
      return
    }

    // Get full order details
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "created_at",
        "currency_code",
        "total",
        "items.*",
        "items.variant.sku",
        "items.variant.title",
        "shipping_methods.name",
        "shipping_address.first_name",
        "shipping_address.last_name",
        "shipping_address.address_1",
        "shipping_address.address_2",
        "shipping_address.city",
        "shipping_address.province",
        "shipping_address.postal_code",
        "shipping_address.country_code",
      ],
      filters: {
        id: orderId,
      },
    })

    if (!order) {
      logger.warn(`[Shipment Notification] Order ${orderId} not found`)
      return
    }

    if (!order.email) {
      logger.warn(`[Shipment Notification] Order ${order.id} has no email`)
      return
    }

    // Get tracking info from fulfillment labels
    let trackingNumber: string | null = null
    let trackingUrl: string | null = null
    try {
      const { data: [ful] } = await query.graph({
        entity: "fulfillment",
        fields: ["labels.tracking_number", "labels.tracking_url"],
        filters: { id: data.id },
      })
      trackingNumber = (ful as any)?.labels?.[0]?.tracking_number || null
      trackingUrl = (ful as any)?.labels?.[0]?.tracking_url || null
    } catch {
      logger.debug(`[Shipment Notification] Could not fetch tracking info for fulfillment ${data.id}`)
    }

    // Determine shipping type
    const shippingMethods = (order.shipping_methods ?? []) as any[]
    const isPickup = shippingMethods.some((m: any) => m.name?.startsWith("Arrotti Group"))
    const isLocalDelivery = shippingMethods.some((m: any) => m.name === "Free Local Delivery")

    // Pickup orders get notified at fulfillment creation (pickup-ready-notification subscriber)
    if (isPickup) return

    const items = order.items ?? []
    const shippingAddress = order.shipping_address as any

    const itemsHtml = items.map((item: any) => {
      const qty = toNumber(item.quantity) || 1
      const sku = item.variant?.sku || item.variant_sku || ""
      return `
        <tr>
          <td style="padding: 12px; border-bottom: 1px solid #eee;">
            <strong>${h(item.title)}</strong>
            ${item.variant?.title ? `<br><span style="color: #666; font-size: 14px;">${h(item.variant.title)}</span>` : ""}
            ${sku ? `<br><span style="color: #999; font-size: 12px;">SKU: ${h(sku)}</span>` : ""}
          </td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">${qty}</td>
          <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
            ${formatPrice(toNumber(item.unit_price) * qty, order.currency_code)}
          </td>
        </tr>`
    }).join("")

    const orderSummaryHtml = `
        <h2 style="color: #333; font-size: 18px; border-bottom: 2px solid #007ffd; padding-bottom: 10px;">Order Summary</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background-color: #f5f5f5;">
              <th style="padding: 12px; text-align: left;">Item</th>
              <th style="padding: 12px; text-align: center;">Qty</th>
              <th style="padding: 12px; text-align: right;">Price</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <table style="width: 100%; margin-bottom: 30px;">
          <tr style="font-size: 18px; font-weight: bold;">
            <td style="padding: 12px 0; border-top: 2px solid #333;">Total</td>
            <td style="padding: 12px 0; border-top: 2px solid #333; text-align: right;">${formatPrice(order.total, order.currency_code)}</td>
          </tr>
        </table>`

    const footerHtml = `
        <p style="color: #666;">Questions? Call us at <a href="tel:+14072860498" style="color: #007ffd;">(407) 286-0498</a> or email <a href="mailto:info@arrottigroup.com" style="color: #007ffd;">info@arrottigroup.com</a>.</p>
        <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
          <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
        </div>`

    const itemsText = items.map((item: any) => {
      const qty = toNumber(item.quantity) || 1
      return `- ${qty}x ${item.title} - ${formatPrice(toNumber(item.unit_price) * qty, order.currency_code)}`
    }).join("\n")

    let subject: string
    let html: string
    let text: string

    if (isPickup) {
      // --- PICKUP: Ready for Pickup ---
      subject = `Your Order #${order.display_id || order.id} is Ready for Pickup!`

      html = buildHtml(`
          <h1 style="color: #10b981; margin-bottom: 10px;">Your Order is Ready for Pickup!</h1>
          <p style="color: #666; font-size: 16px;">Order #${order.display_id || order.id}</p>
        `, `
          <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 16px; color: #065f46;">
              Your order has been prepared and is ready for pickup at our location.
            </p>
          </div>

          <div style="background-color: #fff8e1; padding: 20px; border-radius: 8px; border-left: 4px solid #f59e0b; margin-bottom: 20px;">
            <h3 style="color: #b45309; margin: 0 0 10px;">Pickup Location</h3>
            <p style="margin: 0 0 8px; color: #666;">
              <strong>Arrotti Group</strong><br>
              4651 36th Street, Suite 500<br>
              Orlando, FL 32811
            </p>
            <p style="margin: 8px 0 0; color: #666;">
              <strong>Business Hours:</strong><br>
              Mon–Fri: 8AM – 6PM EST<br>
              Sat: 9AM – 2PM EST
            </p>
          </div>

          <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #007ffd; margin: 0 0 10px;">What to Bring</h3>
            <ul style="margin: 0; padding-left: 20px; color: #666;">
              <li>A valid photo ID</li>
              <li>Your order number: <strong>#${order.display_id || order.id}</strong></li>
            </ul>
          </div>

          ${orderSummaryHtml}
          ${footerHtml}`)

      text = `YOUR ORDER IS READY FOR PICKUP!

Order #${order.display_id || order.id}

Your order has been prepared and is ready for pickup at our location.

PICKUP LOCATION
Arrotti Group
4651 36th Street, Suite 500
Orlando, FL 32811

Business Hours:
Mon-Fri: 8AM - 6PM EST
Sat: 9AM - 2PM EST

WHAT TO BRING
- A valid photo ID
- Your order number: #${order.display_id || order.id}

ORDER SUMMARY
${itemsText}

Total: ${formatPrice(order.total, order.currency_code)}

Questions? Call us at (407) 286-0498 or email info@arrottigroup.com.

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.`

    } else if (isLocalDelivery) {
      // --- LOCAL DELIVERY: Out for Delivery ---
      const addressText = shippingAddress
        ? `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}\n${shippingAddress.address_1 || ""}\n${shippingAddress.address_2 ? `${shippingAddress.address_2}\n` : ""}${shippingAddress.city || ""}, ${shippingAddress.province || ""} ${shippingAddress.postal_code || ""}`
        : "N/A"

      const addressHtml = shippingAddress ? `
            ${h(shippingAddress.first_name || "")} ${h(shippingAddress.last_name || "")}<br>
            ${h(shippingAddress.address_1 || "")}<br>
            ${shippingAddress.address_2 ? `${h(shippingAddress.address_2)}<br>` : ""}
            ${h(shippingAddress.city || "")}, ${h(shippingAddress.province || "")} ${h(shippingAddress.postal_code || "")}` : "N/A"

      subject = `Your Order #${order.display_id || order.id} is Out for Delivery`

      html = buildHtml(`
          <h1 style="color: #007ffd; margin-bottom: 10px;">Your Order is Out for Delivery!</h1>
          <p style="color: #666; font-size: 16px;">Order #${order.display_id || order.id}</p>
        `, `
          <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 16px; color: #065f46;">
              Great news! Your order is on its way and will be delivered to you today.
            </p>
          </div>

          <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #007ffd; margin: 0 0 10px;">Delivery Address</h3>
            <p style="margin: 0; color: #666;">${addressHtml}</p>
          </div>

          <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 0; color: #666;">
              Our delivery team will contact you if they need any assistance locating your address. Please ensure someone is available to receive the delivery.
            </p>
          </div>

          ${orderSummaryHtml}
          ${footerHtml}`)

      text = `YOUR ORDER IS OUT FOR DELIVERY!

Order #${order.display_id || order.id}

Great news! Your order is on its way and will be delivered to you today.

DELIVERY ADDRESS
${addressText}

Our delivery team will contact you if they need any assistance locating your address. Please ensure someone is available to receive the delivery.

ORDER SUMMARY
${itemsText}

Total: ${formatPrice(order.total, order.currency_code)}

Questions? Call us at (407) 286-0498 or email info@arrottigroup.com.

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.`

    } else {
      // --- STANDARD SHIPPING: Order Has Shipped with tracking ---
      const addressText = shippingAddress
        ? `${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}\n${shippingAddress.address_1 || ""}\n${shippingAddress.address_2 ? `${shippingAddress.address_2}\n` : ""}${shippingAddress.city || ""}, ${shippingAddress.province || ""} ${shippingAddress.postal_code || ""}`
        : "N/A"

      const addressHtml = shippingAddress ? `
            ${h(shippingAddress.first_name || "")} ${h(shippingAddress.last_name || "")}<br>
            ${h(shippingAddress.address_1 || "")}<br>
            ${shippingAddress.address_2 ? `${h(shippingAddress.address_2)}<br>` : ""}
            ${h(shippingAddress.city || "")}, ${h(shippingAddress.province || "")} ${h(shippingAddress.postal_code || "")}` : "N/A"

      const trackingHtml = trackingNumber ? `
          <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #007ffd; margin: 0 0 10px;">Tracking Information</h3>
            <p style="margin: 0 0 8px; color: #666;">
              <strong>Tracking Number:</strong> ${h(trackingNumber)}
            </p>
            ${trackingUrl ? `
            <a href="${escapeUrl(trackingUrl)}"
               style="display: inline-block; background-color: #007ffd; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 8px;">
              Track Your Package
            </a>` : ""}
          </div>` : ""

      const carrierName = shippingMethods.map((m: any) => m.name).join(", ") || "Standard Shipping"

      subject = `Your Order #${order.display_id || order.id} Has Shipped!`

      html = buildHtml(`
          <h1 style="color: #007ffd; margin-bottom: 10px;">Your Order Has Shipped!</h1>
          <p style="color: #666; font-size: 16px;">Order #${order.display_id || order.id}</p>
        `, `
          <div style="background-color: #ecfdf5; padding: 20px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 16px; color: #065f46;">
              Your order has been shipped via <strong>${h(carrierName)}</strong> and is on its way!
            </p>
          </div>

          ${trackingHtml}

          <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="color: #333; margin: 0 0 10px;">Shipping Address</h3>
            <p style="margin: 0; color: #666;">${addressHtml}</p>
          </div>

          ${orderSummaryHtml}
          ${footerHtml}`)

      text = `YOUR ORDER HAS SHIPPED!

Order #${order.display_id || order.id}

Your order has been shipped via ${carrierName} and is on its way!
${trackingNumber ? `
TRACKING INFORMATION
Tracking Number: ${trackingNumber}${trackingUrl ? `\nTrack your package: ${trackingUrl}` : ""}
` : ""}
SHIPPING ADDRESS
${addressText}

ORDER SUMMARY
${itemsText}

Total: ${formatPrice(order.total, order.currency_code)}

Questions? Call us at (407) 286-0498 or email info@arrottigroup.com.

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.`
    }

    await notificationModuleService.createNotifications({
      to: order.email,
      channel: "email",
      template: "shipment-notification",
      data: { subject, html, text },
    })

    const type = isPickup ? "pickup" : isLocalDelivery ? "local delivery" : "shipping"
    logger.info(
      `[Shipment Notification] Sent ${type} email to ${order.email} for order ${order.id}${trackingNumber ? ` (tracking: ${trackingNumber})` : ""}`
    )
  } catch (error) {
    logger.error(
      `[Shipment Notification] Error for fulfillment ${data.id}: ${(error as Error).message}`
    )
  }
}

function buildHtml(headerContent: string, bodyContent: string): string {
  return `
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
        ${headerContent}
      </div>
      ${bodyContent}
    </body>
    </html>`
}

export const config: SubscriberConfig = {
  event: "shipment.created",
}
