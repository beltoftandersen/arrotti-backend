import { ExecArgs } from "@medusajs/framework/types"

export default async function findPricedLocalOnly({ container }: ExecArgs) {
  const db = container.resolve("__pg_connection__")
  
  const result = await db.raw(
    "SELECT p.id, p.title, p.metadata, pc.name as category_name, " +
    "pv.sku, pr.amount as price_amount " +
    "FROM product p " +
    "JOIN product_category_product pcp ON pcp.product_id = p.id " +
    "JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "JOIN product_variant pv ON pv.product_id = p.id " +
    "LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id " +
    "LEFT JOIN price pr ON pr.price_set_id = pvps.price_set_id AND pr.currency_code = 'usd' " +
    "WHERE pc.metadata->>'local_only' = 'true' " +
    "AND pr.amount IS NOT NULL AND pr.amount > 0 " +
    "ORDER BY pc.name, p.title LIMIT 20"
  )
  
  console.log("Found " + result.rows.length + " priced variants:\n")
  for (const r of result.rows) {
    const pl = r.metadata?.partslink_no || "N/A"
    const price = (r.price_amount / 100).toFixed(2)
    console.log(r.category_name + " | " + r.title + " | PL: " + pl + " | SKU: " + r.sku + " | $" + price)
  }
}
