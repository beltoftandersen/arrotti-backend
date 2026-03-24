import { ExecArgs } from "@medusajs/framework/types"

export default async function testResolveCoverage({ container }: ExecArgs) {
  const db = container.resolve("__pg_connection__")
  
  const combos = await db.raw(
    "SELECT vm.name as make, vmod.name as model, vm.id as make_id, vmod.id as model_id, " +
    "COUNT(v.id) as vehicle_count, MIN(v.year_start) as min_year, MAX(v.year_end) as max_year " +
    "FROM vehicle v JOIN vehicle_make vm ON vm.id = v.make_id JOIN vehicle_model vmod ON vmod.id = v.model_id " +
    "GROUP BY vm.name, vmod.name, vm.id, vmod.id HAVING COUNT(v.id) > 5 " +
    "ORDER BY COUNT(v.id) DESC LIMIT 5"
  )
  
  for (const combo of combos.rows) {
    const testYear = Math.floor((Number(combo.min_year) + Number(combo.max_year)) / 2)
    
    const allMatching = await db.raw(
      "SELECT id FROM vehicle WHERE make_id = '" + combo.make_id + "' AND model_id = '" + combo.model_id + 
      "' AND year_start <= " + testYear + " AND year_end >= " + testYear
    )
    
    const vehicleIds = allMatching.rows.map((v: any) => v.id)
    if (vehicleIds.length === 0) continue
    
    const quotedIds = vehicleIds.map((id: string) => "'" + id + "'").join(",")
    const allProducts = await db.raw(
      "SELECT COUNT(DISTINCT ppf.product_id) as cnt FROM product_product_fitment_fitment ppf " +
      "JOIN fitment f ON f.id = ppf.fitment_id WHERE f.vehicle_id IN (" + quotedIds + ")"
    )
    
    const firstProducts = await db.raw(
      "SELECT COUNT(DISTINCT ppf.product_id) as cnt FROM product_product_fitment_fitment ppf " +
      "JOIN fitment f ON f.id = ppf.fitment_id WHERE f.vehicle_id = '" + vehicleIds[0] + "'"
    )
    
    const allCount = parseInt(allProducts.rows[0].cnt)
    const firstCount = parseInt(firstProducts.rows[0].cnt)
    const missing = allCount - firstCount
    const status = missing > 0 ? "MISSING " + missing + " products with single vehicle" : "OK"
    
    console.log(combo.make + " " + combo.model + " (year " + testYear + ") | " + 
      vehicleIds.length + " vehicles | All: " + allCount + " | First only: " + firstCount + " | " + status)
  }
}
