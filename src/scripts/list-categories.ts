import { ExecArgs } from "@medusajs/framework/types"

export default async function listCategories({ container }: ExecArgs) {
  const query = container.resolve("query")
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle", "metadata", "parent_category_id"],
  })
  const roots = data.filter((c: any) => !c.parent_category_id)
  for (const c of roots) {
    console.log(`${c.id} | ${c.name} | ${c.handle} | metadata: ${JSON.stringify(c.metadata)}`)
    const children = data.filter((ch: any) => ch.parent_category_id === c.id)
    for (const ch of children) {
      console.log(`  ${ch.id} | ${ch.name} | ${ch.handle}`)
    }
  }
}
