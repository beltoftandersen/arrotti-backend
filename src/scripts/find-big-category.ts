import { ExecArgs } from "@medusajs/framework/types"

export default async function findBigCategory({ container }: ExecArgs) {
  const db = container.resolve("__pg_connection__")
  const result = await db.raw(
    "SELECT v.id as vehicle_id, vm.name as make, vmod.name as model, v.year_start, v.year_end, " +
    "pc.name as category, pc.handle, COUNT(DISTINCT p.id) as product_count " +
    "FROM product_product_fitment_fitment ppf " +
    "JOIN fitment f ON f.id = ppf.fitment_id " +
    "JOIN vehicle v ON v.id = f.vehicle_id " +
    "JOIN vehicle_make vm ON vm.id = v.make_id " +
    "JOIN vehicle_model vmod ON vmod.id = v.model_id " +
    "JOIN product p ON p.id = ppf.product_id " +
    "JOIN product_category_product pcp ON pcp.product_id = p.id " +
    "JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "WHERE pc.parent_category_id IS NOT NULL " +
    "GROUP BY v.id, vm.name, vmod.name, v.year_start, v.year_end, pc.name, pc.handle " +
    "HAVING COUNT(DISTINCT p.id) > 50 " +
    "ORDER BY product_count DESC LIMIT 5"
  )
  for (const r of result.rows) {
    console.log(`${r.year_start}-${r.year_end} ${r.make} ${r.model} | ${r.category} (${r.handle}) | ${r.product_count} products`)
  }
}
