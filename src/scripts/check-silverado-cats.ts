import { ExecArgs } from "@medusajs/framework/types"

export default async function checkSilveradoCats({ container }: ExecArgs) {
  const db = container.resolve("__pg_connection__")
  
  const result = await db.raw(
    "SELECT pc.name, COUNT(DISTINCT p.id) as cnt " +
    "FROM product_product_fitment_fitment ppf " +
    "JOIN fitment f ON f.id = ppf.fitment_id " +
    "JOIN vehicle v ON v.id = f.vehicle_id " +
    "JOIN vehicle_make vm ON vm.id = v.make_id " +
    "JOIN vehicle_model vmod ON vmod.id = v.model_id " +
    "JOIN product p ON p.id = ppf.product_id " +
    "JOIN product_category_product pcp ON pcp.product_id = p.id " +
    "JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "JOIN product_category pc2 ON pc2.id = pc.parent_category_id " +
    "WHERE vm.name = 'CHEVROLET' AND vmod.name = 'SILVERADO 1500' " +
    "AND v.year_start <= 2019 AND v.year_end >= 2019 " +
    "AND pc2.name = 'Rear Bumpers & Components' " +
    "GROUP BY pc.name ORDER BY cnt DESC"
  )
  for (const r of result.rows) {
    console.log(r.name + " — " + r.cnt + " products")
  }
}
