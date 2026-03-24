import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Enrich quotes with customer name, product title, and variant SKU.
 * Batches lookups to avoid N+1 queries.
 */
export async function enrichQuotes(
  container: any,
  quotes: any[]
): Promise<any[]> {
  if (quotes.length === 0) return quotes

  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Collect unique IDs
  const customerIds = [...new Set(quotes.map((q: any) => q.customer_id).filter(Boolean))]
  const productIds = [...new Set(quotes.map((q: any) => q.product_id).filter(Boolean))]
  const variantIds = [...new Set(quotes.map((q: any) => q.variant_id).filter(Boolean))]

  // Batch load customers
  const customerMap = new Map<string, { name: string; email: string; company: string }>()
  if (customerIds.length > 0) {
    try {
      const { data: customers } = await query.graph({
        entity: "customer",
        fields: ["id", "email", "first_name", "last_name", "company_name"],
        filters: { id: customerIds },
      })
      for (const c of customers || []) {
        const name = `${c.first_name || ""} ${c.last_name || ""}`.trim()
        customerMap.set(c.id, {
          name: name || c.email || "Unknown",
          email: c.email || "",
          company: (c as any).company_name || "",
        })
      }
    } catch {
      // Ignore errors
    }
  }

  // Batch load products
  const productMap = new Map<string, string>()
  if (productIds.length > 0) {
    try {
      const { data: products } = await query.graph({
        entity: "product",
        fields: ["id", "title"],
        filters: { id: productIds },
      })
      for (const p of products || []) {
        productMap.set(p.id, p.title || "Unknown Product")
      }
    } catch {
      // Ignore errors
    }
  }

  // Batch load variants
  const variantMap = new Map<string, { sku: string; title: string }>()
  if (variantIds.length > 0) {
    try {
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "sku", "title"],
        filters: { id: variantIds },
      })
      for (const v of variants || []) {
        variantMap.set(v.id, {
          sku: v.sku || "",
          title: v.title || "",
        })
      }
    } catch {
      // Ignore errors
    }
  }

  // Enrich each quote
  return quotes.map((quote: any) => {
    const customer = customerMap.get(quote.customer_id)
    const variant = quote.variant_id ? variantMap.get(quote.variant_id) : null

    return {
      ...quote,
      customer_name: customer?.company || customer?.name || "Unknown",
      customer_email: customer?.email || "",
      product_title: productMap.get(quote.product_id) || "Unknown Product",
      variant_sku: variant?.sku || null,
      variant_title: variant?.title || null,
    }
  })
}
