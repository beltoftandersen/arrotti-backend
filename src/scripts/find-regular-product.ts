import { ExecArgs } from "@medusajs/framework/types"

export default async function findRegularProduct({ container }: ExecArgs) {
  const db = container.resolve("__pg_connection__")
  const result = await db.raw(
    "SELECT p.id, p.title, p.metadata, pv.sku, pr.amount " +
    "FROM product p " +
    "JOIN product_variant pv ON pv.product_id = p.id " +
    "LEFT JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id " +
    "LEFT JOIN price pr ON pr.price_set_id = pvps.price_set_id AND pr.currency_code = 'usd' " +
    "WHERE pr.amount IS NOT NULL AND pr.amount > 0 " +
    "AND p.id NOT IN ( " +
    "  SELECT pcp.product_id FROM product_category_product pcp " +
    "  JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "  WHERE pc.metadata->>'local_only' = 'true' " +
    ") " +
    "ORDER BY random() LIMIT 3"
  )
  for (const r of result.rows) {
    const pl = r.metadata?.partslink_no || "N/A"
    console.log(`${r.title} | PL: ${pl} | SKU: ${r.sku} | $${(r.amount/100).toFixed(2)}`)
  }
}
