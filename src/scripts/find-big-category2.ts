import { ExecArgs } from "@medusajs/framework/types"

export default async function findBigCategory2({ container }: ExecArgs) {
  const db = container.resolve("__pg_connection__")
  const result = await db.raw(
    "SELECT vm.name as make, vmod.name as model, v.year_start, v.year_end, " +
    "pc2.name as main_cat, pc.name as sub_cat, pc.handle, COUNT(DISTINCT p.id) as cnt " +
    "FROM product_product_fitment_fitment ppf " +
    "JOIN fitment f ON f.id = ppf.fitment_id " +
    "JOIN vehicle v ON v.id = f.vehicle_id " +
    "JOIN vehicle_make vm ON vm.id = v.make_id " +
    "JOIN vehicle_model vmod ON vmod.id = v.model_id " +
    "JOIN product p ON p.id = ppf.product_id " +
    "JOIN product_category_product pcp ON pcp.product_id = p.id " +
    "JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "LEFT JOIN product_category pc2 ON pc2.id = pc.parent_category_id " +
    "WHERE pc.parent_category_id IS NOT NULL " +
    "GROUP BY vm.name, vmod.name, v.year_start, v.year_end, pc2.name, pc.name, pc.handle " +
    "HAVING COUNT(DISTINCT p.id) > 30 " +
    "ORDER BY cnt DESC LIMIT 10"
  )
  for (const r of result.rows) {
    console.log(`${r.year_start}-${r.year_end} ${r.make} ${r.model} | ${r.main_cat} > ${r.sub_cat} | ${r.cnt} products`)
  }
}
