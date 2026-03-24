import { ExecArgs } from "@medusajs/framework/types"

const CATS = [
  "pcat_01KJZ3KX56GVGHEF28FQW4YJP6",
  "pcat_01KJZ3KWZ2HBC8NZNY5YKJF3RB",
]

export default async function checkLocalOnlyFitments({ container }: ExecArgs) {
  const query = container.resolve("query")
  const db = container.resolve("__pg_connection__")

  for (const catId of CATS) {
    const { data: cats } = await query.graph({
      entity: "product_category",
      fields: ["id", "name"],
      filters: { id: catId },
    })
    const cat = cats[0] as any
    console.log(`\n=== ${cat?.name} (${catId}) ===`)

    // Get products in this category
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "title", "categories.id"],
      filters: { categories: { id: [catId] } },
    })

    console.log(`Products: ${products.length}`)
    if (products.length === 0) continue

    // Get fitments for first 3 products via SQL
    const sample = products.slice(0, 3)
    for (const p of sample) {
      const pid = (p as any).id
      const result = await db.raw(`
        SELECT f.vehicle_id, v.year_start, v.year_end, vm.name as make_name, vmod.name as model_name
        FROM product_product_fitment_fitment ppf
        JOIN fitment f ON f.id = ppf.fitment_id
        JOIN vehicle v ON v.id = f.vehicle_id
        JOIN vehicle_make vm ON vm.id = v.make_id
        JOIN vehicle_model vmod ON vmod.id = v.model_id
        WHERE ppf.product_id = ?
        LIMIT 5
      `, [pid])

      console.log(`  ${(p as any).title}`)
      console.log(`    Fitments: ${result.rows.length}`)
      for (const r of result.rows) {
        console.log(`    → ${r.year_start}-${r.year_end} ${r.make_name} ${r.model_name}`)
      }
    }
  }
}
