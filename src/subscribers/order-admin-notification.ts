import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { h } from "../lib/html-escape"
import { toNumber, formatPrice } from "../lib/format-helpers"

type OrderPlacedData = {
  id: string
}

const ADMIN_ORDER_EMAIL = process.env.ORDER_EMAIL || "orders@arrottigroup.com"

export default async function orderAdminNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationModuleService = container.resolve("notification")

  try {
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
        "items.*",
        "items.variant.sku",
        "items.variant.title",
        "shipping_address.first_name",
        "shipping_address.last_name",
        "shipping_address.address_1",
        "shipping_address.address_2",
        "shipping_address.city",
        "shipping_address.province",
        "shipping_address.postal_code",
        "shipping_address.country_code",
        "shipping_address.phone",
        "shipping_methods.name",
        "shipping_methods.amount",
      ],
      filters: {
        id: data.id,
      },
    })

    if (!order) {
      logger.warn(`[Order Admin] Order ${data.id} not found`)
      return
    }

    const items = order.items ?? []
    const shippingAddress = order.shipping_address as any
    const shippingMethods = (order.shipping_methods ?? []) as any[]
    const isPickup = shippingMethods.some((m: any) => m.name === "Arrotti Group")
    const totalQty = items.reduce((sum: number, item: any) => sum + (toNumber(item.quantity) || 1), 0)

    const itemsHtml = items.map((item: any) => {
      const qty = toNumber(item.quantity) || 1
      const sku = item.variant?.sku || item.variant_sku || "-"
      return `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${h(sku)}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">
            ${h(item.title)}${item.variant?.title ? ` - ${h(item.variant.title)}` : ""}
          </td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${qty}</td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">
            ${formatPrice(toNumber(item.unit_price) * qty, order.currency_code)}
          </td>
        </tr>`
    }).join("")

    const shippingAddressHtml = shippingAddress ? `
        <p><strong>${isPickup ? "Customer:" : "Ship To:"}</strong></p>
        <p>
          ${h(shippingAddress.first_name || "")} ${h(shippingAddress.last_name || "")}<br>
          ${h(shippingAddress.address_1 || "")}<br>
          ${shippingAddress.address_2 ? `${h(shippingAddress.address_2)}<br>` : ""}
          ${h(shippingAddress.city || "")}, ${h(shippingAddress.province || "")} ${h(shippingAddress.postal_code || "")}<br>
          ${h(shippingAddress.country_code?.toUpperCase() || "")}
          ${shippingAddress.phone ? `<br>Phone: ${h(shippingAddress.phone)}` : ""}
        </p>` : ""

    const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://carparts.chimkins.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
          </div>

          <h2 style="color: #333;">New Order${isPickup ? " (Pickup)" : ""}</h2>
          <p><strong>Order #:</strong> ${h(String(order.display_id || order.id))}</p>
          <p><strong>Customer:</strong> ${h(order.email || "N/A")}</p>
          <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>
          <p><strong>Shipping Method:</strong> ${shippingMethods.map((m: any) => h(m.name)).join(", ") || "N/A"}</p>

          ${shippingAddressHtml}

          <h3 style="color: #333; margin-top: 24px;">Order Items</h3>
          <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">SKU</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Product</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Qty</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr style="background-color: #f5f5f5; font-weight: bold;">
                <td colspan="2" style="padding: 8px; border: 1px solid #ddd;">Total</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">${totalQty}</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">
                  ${formatPrice(order.total, order.currency_code)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 12px;">
            <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
          </div>
        </div>`

    const text = `
New Order${isPickup ? " (Pickup)" : ""}

Order #: ${order.display_id || order.id}
Customer: ${order.email || "N/A"}
Order Date: ${new Date(order.created_at).toLocaleString()}
Shipping Method: ${shippingMethods.map((m: any) => m.name).join(", ") || "N/A"}

${shippingAddress ? `${isPickup ? "Customer:" : "Ship To:"}
${shippingAddress.first_name || ""} ${shippingAddress.last_name || ""}
${shippingAddress.address_1 || ""}
${shippingAddress.address_2 ? `${shippingAddress.address_2}\n` : ""}${shippingAddress.city || ""}, ${shippingAddress.province || ""} ${shippingAddress.postal_code || ""}
${shippingAddress.country_code?.toUpperCase() || ""}${shippingAddress.phone ? `\nPhone: ${shippingAddress.phone}` : ""}
` : ""}
Items:
${items.map((item: any) => {
  const qty = toNumber(item.quantity) || 1
  const sku = item.variant?.sku || item.variant_sku || "N/A"
  return `- ${qty}x ${item.title} (SKU: ${sku}) - ${formatPrice(toNumber(item.unit_price) * qty, order.currency_code)}`
}).join("\n")}

Total: ${formatPrice(order.total, order.currency_code)}

© ${new Date().getFullYear()} Arrotti Group. All rights reserved.
    `.trim()

    await notificationModuleService.createNotifications({
      to: ADMIN_ORDER_EMAIL,
      channel: "email",
      template: "order-admin-notification",
      data: {
        subject: `New Order #${order.display_id || order.id}${isPickup ? " (Pickup)" : ""}`,
        html,
        text,
      },
    })

    logger.info(
      `[Order Admin] Sent order notification to ${ADMIN_ORDER_EMAIL} for order ${order.id}`
    )
  } catch (error) {
    logger.error(
      `[Order Admin] Error sending notification for order ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
