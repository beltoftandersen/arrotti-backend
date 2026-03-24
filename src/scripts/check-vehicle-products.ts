import { ExecArgs } from "@medusajs/framework/types"

export default async function check({ container }: ExecArgs) {
  const db = container.resolve("__pg_connection__")
  
  // Products in "Rear bumper assembly" for the single resolved vehicle
  const r1 = await db.raw(
    "SELECT COUNT(DISTINCT p.id) as cnt FROM product_product_fitment_fitment ppf " +
    "JOIN fitment f ON f.id = ppf.fitment_id " +
    "JOIN product p ON p.id = ppf.product_id " +
    "JOIN product_category_product pcp ON pcp.product_id = p.id " +
    "JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "WHERE f.vehicle_id = '01KJZ3R5836C1M2MD9CES9F56N' AND pc.name = 'Rear bumper assembly'"
  )
  console.log("Single vehicle (01KJZ3R5836C1M2MD9CES9F56N):", r1.rows[0].cnt, "products in Rear bumper assembly")

  // All vehicles matching 2019 Silverado
  const r2 = await db.raw(
    "SELECT COUNT(DISTINCT p.id) as cnt FROM product_product_fitment_fitment ppf " +
    "JOIN fitment f ON f.id = ppf.fitment_id " +
    "JOIN vehicle v ON v.id = f.vehicle_id " +
    "JOIN vehicle_make vm ON vm.id = v.make_id " +
    "JOIN vehicle_model vmod ON vmod.id = v.model_id " +
    "JOIN product p ON p.id = ppf.product_id " +
    "JOIN product_category_product pcp ON pcp.product_id = p.id " +
    "JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "WHERE vm.name = 'CHEVROLET' AND vmod.name = 'SILVERADO 1500' " +
    "AND v.year_start <= 2019 AND v.year_end >= 2019 AND pc.name = 'Rear bumper assembly'"
  )
  console.log("All matching vehicles:", r2.rows[0].cnt, "products in Rear bumper assembly")

  // What sub-cats does the single vehicle have?
  const r3 = await db.raw(
    "SELECT pc.name, COUNT(DISTINCT p.id) as cnt FROM product_product_fitment_fitment ppf " +
    "JOIN fitment f ON f.id = ppf.fitment_id " +
    "JOIN product p ON p.id = ppf.product_id " +
    "JOIN product_category_product pcp ON pcp.product_id = p.id " +
    "JOIN product_category pc ON pc.id = pcp.product_category_id " +
    "JOIN product_category pc2 ON pc2.id = pc.parent_category_id " +
    "WHERE f.vehicle_id = '01KJZ3R5836C1M2MD9CES9F56N' AND pc2.name = 'Rear Bumpers & Components' " +
    "GROUP BY pc.name ORDER BY cnt DESC"
  )
  console.log("\nSub-cats for single vehicle:")
  for (const r of r3.rows) console.log("  " + r.name + " — " + r.cnt)
}
