import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SUPPLIER_MODULE } from "../modules/supplier"
import SupplierModuleService from "../modules/supplier/service"
import { findPricingSupplier, VariantSupplierLink } from "../services/auto-pricing"
import { h } from "../lib/html-escape"

type OrderPlacedData = {
  id: string
}

type OrderItem = {
  id: string
  title: string
  quantity: number
  unit_price: number
  product_id: string
  variant_id: string
  variant?: {
    sku?: string
    title?: string
  }
}

type Supplier = {
  id: string
  name: string
  email: string | null
  code: string
  default_markup?: number
}

type SupplierOrderItem = OrderItem & {
  supplier_sku?: string | null
  partslink_no?: string | null
  oem_number?: string | null
  cost_price?: number | null
}

export default async function supplierOrderNotificationHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const notificationModuleService = container.resolve("notification")
  const supplierModuleService: SupplierModuleService = container.resolve(SUPPLIER_MODULE)

  try {
    // 0. Check if supplier notifications are enabled (store metadata)
    const { data: stores } = await query.graph({
      entity: "store",
      fields: ["id", "metadata"],
    })
    const store = stores?.[0]
    if (store?.metadata?.supplier_notifications_enabled === false) {
      logger.info(`[Supplier Notification] Notifications disabled in store settings, skipping`)
      return
    }

    // 1. Get order details with items
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
        // Use items.* to properly get quantity (individual field requests don't work)
        "items.*",
        "items.variant.sku",
        "items.variant.title",
      ],
      filters: {
        id: data.id,
      },
    })

    // 2. Get warehouse address from stock location
    const { data: stockLocations } = await query.graph({
      entity: "stock_location",
      fields: ["id", "name", "address.*"],
    })
    const warehouse = stockLocations?.[0] // Use first stock location as warehouse

    if (!order) {
      logger.warn(`[Supplier Notification] Order ${data.id} not found`)
      return
    }

    const items = (order.items ?? []) as OrderItem[]
    if (items.length === 0) {
      logger.info(`[Supplier Notification] Order ${order.id} has no items`)
      return
    }

    // 2. Get variant IDs from order items
    const variantIds = [...new Set(items.map((item) => item.variant_id).filter(Boolean))]

    if (variantIds.length === 0) {
      logger.info(`[Supplier Notification] Order ${order.id} has no variant IDs`)
      return
    }

    // 3. Query variant_supplier links (multiple suppliers per variant supported)
    const { data: variantSupplierLinks } = await query.graph({
      entity: "product_variant_supplier",
      fields: [
        "product_variant_id",
        "supplier_id",
        "supplier_sku",
        "partslink_no",
        "oem_number",
        "cost_price",
        "is_primary",
        "supplier.id",
        "supplier.name",
        "supplier.email",
        "supplier.code",
        "supplier.default_markup",
      ],
      filters: {
        product_variant_id: variantIds,
      },
    })

    // 3b. Query products to get metadata (for partslink_no fallback)
    const productIds = [...new Set(items.map((item) => item.product_id).filter(Boolean))]
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "metadata"],
      filters: {
        id: productIds,
      },
    })

    // Build product metadata lookup map
    const productMetadataMap = new Map<string, any>()
    for (const product of (products || [])) {
      productMetadataMap.set(product.id, product.metadata || {})
    }

    if (!variantSupplierLinks || variantSupplierLinks.length === 0) {
      logger.info(`[Supplier Notification] No suppliers found for variants in order ${order.id}`)
      return
    }

    // Build a map of variant_id -> supplier links
    const linksByVariant = new Map<string, VariantSupplierLink[]>()
    for (const link of variantSupplierLinks as VariantSupplierLink[]) {
      const variantId = link.product_variant_id
      if (!linksByVariant.has(variantId)) {
        linksByVariant.set(variantId, [])
      }
      linksByVariant.get(variantId)!.push(link)
    }

    // 4. Group items by supplier (using primary or lowest-cost supplier per variant)
    const supplierItemsMap = new Map<string, {
      supplier: Supplier
      items: SupplierOrderItem[]
    }>()

    for (const item of items) {
      // Find the pricing supplier for this variant (primary or lowest cost)
      const variantLinks = linksByVariant.get(item.variant_id) || []
      const pricingLink = findPricingSupplier(variantLinks)

      if (!pricingLink?.supplier?.email) {
        logger.debug(`[Supplier Notification] No supplier with email for variant ${item.variant_id}`)
        continue
      }

      const supplierId = pricingLink.supplier.id
      if (!supplierItemsMap.has(supplierId)) {
        supplierItemsMap.set(supplierId, {
          supplier: pricingLink.supplier as Supplier,
          items: [],
        })
      }

      // Get product metadata for fallback values
      const productMetadata = productMetadataMap.get(item.product_id) || {}

      supplierItemsMap.get(supplierId)!.items.push({
        ...item,
        supplier_sku: pricingLink.supplier_sku || null,
        // Fallback: link.partslink_no -> product.metadata.partslink_no
        partslink_no: pricingLink.partslink_no || productMetadata.partslink_no,
        oem_number: pricingLink.oem_number || productMetadata.oem_number,
        cost_price: pricingLink.cost_price != null ? Number(pricingLink.cost_price) : null,
      })
    }

    // 5. Send email to each supplier
    for (const [supplierId, { supplier, items: supplierItems }] of supplierItemsMap) {
      if (!supplier.email) {
        logger.debug(`[Supplier Notification] Supplier ${supplier.name} has no email`)
        continue
      }

      // Calculate supplier's portion total
      const supplierTotal = supplierItems.reduce(
        (sum, item) => sum + (toNumber(item.unit_price) * (toNumber(item.quantity) || 1)),
        0
      )

      // Build email HTML (escape user-provided data to prevent HTML injection)
      const itemsHtml = supplierItems.map((item) => {
        const qty = toNumber(item.quantity) || 1
        const sku = item.supplier_sku || item.partslink_no || "-"
        return `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">
            ${h(sku)}
          </td>
          <td style="padding: 8px; border: 1px solid #ddd;">
            ${h(item.title)}${(item as any).variant_title ? ` - ${h((item as any).variant_title)}` : ""}
          </td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
            ${qty}
          </td>
          <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">
            ${formatPrice(item.unit_price, order.currency_code)}
          </td>
        </tr>
      `}).join("")

      // Use warehouse address instead of customer shipping address
      // Escape all address fields to prevent HTML injection
      const warehouseAddress = warehouse?.address
      const shippingAddressHtml = warehouseAddress ? `
        <p><strong>Ship To (Warehouse):</strong></p>
        <p>
          ${h(warehouse.name) || "Arrotti Group Warehouse"}<br>
          ${warehouseAddress.company ? `${h(warehouseAddress.company)}<br>` : ""}
          ${h(warehouseAddress.address_1)}<br>
          ${warehouseAddress.address_2 ? `${h(warehouseAddress.address_2)}<br>` : ""}
          ${h(warehouseAddress.city)}, ${h(warehouseAddress.province)} ${h(warehouseAddress.postal_code)}<br>
          ${h(warehouseAddress.country_code?.toUpperCase())}
          ${warehouseAddress.phone ? `<br>Phone: ${h(warehouseAddress.phone)}` : ""}
        </p>
      ` : ""

      const totalQty = supplierItems.reduce((sum, item) => sum + (toNumber(item.quantity) || 1), 0)

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="text-align: center; margin-bottom: 20px;">
            <img src="https://carparts.chimkins.com/logo.png" alt="Arrotti Group" style="max-width: 200px; height: auto;" />
          </div>

          <h2 style="color: #333;">New Order - Arrotti Group</h2>
          <p style="color: #666;">Supplier: <strong>${h(supplier.name)}</strong> (${h(supplier.code)})</p>

          <p><strong>Order ID:</strong> ${h(String(order.display_id || order.id))}</p>
          <p><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleString()}</p>

          ${shippingAddressHtml}

          <h3 style="color: #333; margin-top: 24px;">Items to Fulfill</h3>
          <table style="width: 100%; border-collapse: collapse; margin-top: 12px;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">SKU</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Product</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: center;">Qty</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
            <tfoot>
              <tr style="background-color: #f5f5f5; font-weight: bold;">
                <td colspan="2" style="padding: 8px; border: 1px solid #ddd;">Total</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
                  ${totalQty}
                </td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">
                  ${formatPrice(supplierTotal, order.currency_code)}
                </td>
              </tr>
            </tfoot>
          </table>

          <p style="margin-top: 24px; color: #666; font-size: 14px;">
            Please process this order as soon as possible.
          </p>

          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 12px;">
            <p>&copy; ${new Date().getFullYear()} Arrotti Group. All rights reserved.</p>
          </div>
        </div>
      `

      const text = `
New Order - Arrotti Group

Supplier: ${supplier.name} (${supplier.code})

Order ID: ${order.display_id || order.id}
Order Date: ${new Date(order.created_at).toLocaleString()}

${warehouseAddress ? `Ship To (Warehouse):
${warehouse.name || "Arrotti Group Warehouse"}
${warehouseAddress.company ? `${warehouseAddress.company}\n` : ""}${warehouseAddress.address_1 || ""}
${warehouseAddress.address_2 ? `${warehouseAddress.address_2}\n` : ""}${warehouseAddress.city || ""}, ${warehouseAddress.province || ""} ${warehouseAddress.postal_code || ""}
${warehouseAddress.country_code?.toUpperCase() || ""}${warehouseAddress.phone ? `\nPhone: ${warehouseAddress.phone}` : ""}
` : ""}

Items to Fulfill:
${supplierItems.map((item) => {
  const qty = toNumber(item.quantity) || 1
  const sku = item.supplier_sku || item.partslink_no || "N/A"
  return `- ${qty}x ${item.title} (SKU: ${sku}) - ${formatPrice(toNumber(item.unit_price) * qty, order.currency_code)}`
}).join("\n")}

Total: ${formatPrice(supplierTotal, order.currency_code)}

Please process this order as soon as possible.

© ${new Date().getFullYear()} Arrotti Group. All rights reserved.
      `.trim()

      try {
        await notificationModuleService.createNotifications({
          to: supplier.email,
          channel: "email",
          template: "supplier-order",
          data: {
            subject: `New Order #${order.display_id || order.id} - Action Required`,
            html,
            text,
          },
        })

        logger.info(
          `[Supplier Notification] Sent order notification to supplier ${supplier.name} (${supplier.email}) for order ${order.id}`
        )
      } catch (emailError) {
        logger.error(
          `[Supplier Notification] Failed to send email to supplier ${supplier.name}: ${(emailError as Error).message}`
        )
      }
    }
  } catch (error) {
    logger.error(
      `[Supplier Notification] Error processing order ${data.id}: ${(error as Error).message}`
    )
  }
}

// Convert BigNumber or number to a numeric value
function toNumber(value: any): number {
  if (value === null || value === undefined) return 0
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
