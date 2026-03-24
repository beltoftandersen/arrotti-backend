import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type ValidateShippingBody = {
  cart_id: string
}

type RestrictedItem = {
  line_item_id: string
  title: string
  partslink?: string
  oem?: string
}

type CartWithItems = {
  id: string
  shipping_address?: { postal_code?: string } | null
  items?: Array<{
    id: string
    title: string
    metadata?: Record<string, unknown> | null
    product?: {
      id: string
      metadata?: Record<string, unknown> | null
      categories?: Array<{
        id: string
        name: string
        metadata?: Record<string, unknown> | null
      }>
    } | null
  }>
}

/**
 * Checks if a postal code is in the Orlando, FL area (328xx range).
 */
function isOrlandoZip(postalCode: string): boolean {
  if (!postalCode) return false
  const cleaned = postalCode.trim().replace(/\s+/g, "")
  // Match exactly 328xx (5-digit or ZIP+4 format)
  return /^328\d{2}(-\d{4})?$/.test(cleaned)
}

/**
 * POST /store/cart/validate-shipping
 *
 * Validates that cart items with local_only categories are shipping
 * to an Orlando-area address. Returns restricted items if not.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = req.body as ValidateShippingBody

  if (!body.cart_id) {
    res.status(400).json({ message: "cart_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Load cart with items, their product, and product categories
    const { data: [cart] } = await query.graph({
      entity: "cart",
      filters: { id: body.cart_id },
      fields: [
        "id",
        "shipping_address.postal_code",
        "items.id",
        "items.title",
        "items.metadata",
        "items.product.id",
        "items.product.metadata",
        "items.product.categories.id",
        "items.product.categories.name",
        "items.product.categories.metadata",
      ],
    }) as { data: CartWithItems[] }

    if (!cart) {
      res.status(404).json({ message: "Cart not found" })
      return
    }

    // Identify local_only items in cart
    const localOnlyItemIds: string[] = []
    const items = cart.items ?? []

    for (const item of items) {
      const categories = item.product?.categories ?? []
      for (const category of categories) {
        if (category.metadata?.local_only === true) {
          localOnlyItemIds.push(item.id)
          break
        }
      }
    }

    const postalCode = cart.shipping_address?.postal_code
    if (!postalCode || isOrlandoZip(postalCode)) {
      // No address yet or Orlando address — no restrictions
      res.json({ valid: true, restricted_items: [] })
      return
    }

    // Address is NOT in Orlando — flag local_only items as restricted
    const restrictedItems: RestrictedItem[] = []
    for (const item of items) {
      if (!localOnlyItemIds.includes(item.id)) continue
      const meta = item.metadata as Record<string, any> | null
      const prodMeta = item.product?.metadata as Record<string, any> | null
      restrictedItems.push({
        line_item_id: item.id,
        title: item.title,
        partslink: meta?.partslink || prodMeta?.partslink_no || undefined,
        oem: meta?.oem || prodMeta?.oem || undefined,
      })
    }

    res.json({
      valid: restrictedItems.length === 0,
      restricted_items: restrictedItems,
    })
  } catch (error: any) {
    console.error("validate-shipping error:", error)
    res.status(500).json({ message: "Failed to validate shipping" })
  }
}
