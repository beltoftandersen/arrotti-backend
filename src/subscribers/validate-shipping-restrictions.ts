import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Server-side enforcement of local-delivery-only restrictions.
 *
 * This is a safety net — the frontend shipping component already blocks
 * non-Orlando addresses for local_only categories, but this subscriber
 * ensures the restriction can't be bypassed via direct API calls.
 *
 * On order.placed, checks if any items belong to local_only categories
 * and the shipping address is outside Orlando (328xx). If so, logs a
 * warning and flags the order metadata for admin review.
 */
export default async function validateShippingRestrictionsHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  try {
    const { data: [order] } = await query.graph({
      entity: "order",
      filters: { id: data.id },
      fields: [
        "id",
        "display_id",
        "shipping_address.postal_code",
        "items.id",
        "items.title",
        "items.product.id",
        "items.product.categories.id",
        "items.product.categories.metadata",
      ],
    })

    if (!order) return

    const postalCode = (order as any).shipping_address?.postal_code
    if (!postalCode) return

    // Check if Orlando zip (328xx, 5-digit or ZIP+4)
    const cleaned = postalCode.trim().replace(/\s+/g, "")
    if (/^328\d{2}(-\d{4})?$/.test(cleaned)) return // Orlando — no restrictions

    // Check for local_only items
    const restrictedItems: string[] = []
    for (const item of (order as any).items ?? []) {
      const categories = item.product?.categories ?? []
      for (const cat of categories) {
        if (cat.metadata?.local_only === true) {
          restrictedItems.push(item.title)
          break
        }
      }
    }

    if (restrictedItems.length === 0) return

    // Flag the order — don't cancel (the order is already placed and paid)
    // but alert admin so they can follow up
    logger.warn(
      `[Shipping Restriction] Order #${order.display_id} (${data.id}) has ${restrictedItems.length} local-only item(s) shipping to non-Orlando zip ${postalCode}: ${restrictedItems.join(", ")}`
    )

    // Tag the order metadata for admin visibility
    const orderModule = container.resolve("order")
    await orderModule.updateOrders(data.id, {
      metadata: {
        shipping_restriction_violated: true,
        restricted_items: restrictedItems,
        restricted_zip: postalCode,
      },
    })
  } catch (error) {
    logger.error(
      `[Shipping Restriction] Error checking order ${data.id}: ${(error as Error).message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
