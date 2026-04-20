import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h } from "../lib/html-escape"
import { toNumber, formatPrice } from "../lib/format-helpers"

type FulfillmentCreatedData = {
  order_id: string
  fulfillment_id: string
  no_notification?: boolean
}

/**
 * Sends a "Ready for Pickup" email when a fulfillment is created
 * for an order that uses the pickup shipping method ("Arrotti Group").
 */
export default async function pickupReadyNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<FulfillmentCreatedData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationModuleService = container.resolve("notification")

  // Note: we intentionally ignore data.no_notification for pickup orders
  // because the "Ready for Pickup" email is essential for the customer.

  try {
    const { data: [order] } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "total",
        "items.*",
        "items.variant.sku",
        "items.variant.title",
        "shipping_methods.name",
      ],
      filters: {
        id: data.order_id,
      },
    })

    if (!order) {
      logger.warn(`[Pickup Ready] Order ${data.order_id} not found`)
      return
    }

    // Only handle pickup orders
    const shippingMethods = (order.shipping_methods ?? []) as any[]
    const isPickup = shippingMethods.some((m: any) => m.name?.startsWith("Arrotti Group"))
    if (!isPickup) return

    if (!order.email) {
      logger.warn(`[Pickup Ready] Order ${order.id} has no email`)
      return
    }

    const items = order.items ?? []

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

    const subject = `Your Order #${order.display_id || order.id} is Ready for Pickup`

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
        <h1 style="color: #10b981; margin-bottom: 10px;">Your Order is Ready for Pickup!</h1>
        <p style="color: #666; font-size: 16px;">Order #${order.display_id || order.id}</p>
      </div>

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
          Mon–Fri: 9AM – 5PM EST
        </p>
      </div>

      <div style="background-color: #f0f7ff; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="color: #007ffd; margin: 0 0 10px;">What to Bring</h3>
        <ul style="margin: 0; padding-left: 20px; color: #666;">
          <li>Invoice</li>
          <li>Your order number: <strong>#${order.display_id || order.id}</strong></li>
        </ul>
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
        <tbody>${itemsHtml}</tbody>
      </table>
      <table style="width: 100%; margin-bottom: 30px;">
        <tr style="font-size: 18px; font-weight: bold;">
          <td style="padding: 12px 0; border-top: 2px solid #333;">Total</td>
          <td style="padding: 12px 0; border-top: 2px solid #333; text-align: right;">${formatPrice(order.total, order.currency_code)}</td>
        </tr>
      </table>

      <p style="color: #666;">Questions? Call us at <a href="tel:+14072860498" style="color: #007ffd;">(407) 286-0498</a> or email <a href="mailto:info@arrottigroup.com" style="color: #007ffd;">info@arrottigroup.com</a>.</p>
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 14px;">
        <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
      </div>
    </body>
    </html>`

    const itemsText = items.map((item: any) => {
      const qty = toNumber(item.quantity) || 1
      return `- ${qty}x ${item.title} - ${formatPrice(toNumber(item.unit_price) * qty, order.currency_code)}`
    }).join("\n")

    const text = `YOUR ORDER IS READY FOR PICKUP!

Order #${order.display_id || order.id}

Your order has been prepared and is ready for pickup at our location.

PICKUP LOCATION
Arrotti Group
4651 36th Street, Suite 500
Orlando, FL 32811

Business Hours:
Mon-Fri: 9AM - 5PM EST

WHAT TO BRING
- Invoice
- Your order number: #${order.display_id || order.id}

ORDER SUMMARY
${itemsText}

Total: ${formatPrice(order.total, order.currency_code)}

Questions? Call us at (407) 286-0498 or email info@arrottigroup.com.

(c) ${new Date().getFullYear()} Arrotti Group. All rights reserved.`

    await notificationModuleService.createNotifications({
      to: order.email,
      channel: "email",
      template: "pickup-ready-notification",
      data: { subject, html, text },
    })

    logger.info(
      `[Pickup Ready] Sent pickup ready email to ${order.email} for order ${order.id}`
    )
  } catch (error) {
    logger.error(
      `[Pickup Ready] Error for fulfillment ${data.fulfillment_id} on order ${data.order_id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
