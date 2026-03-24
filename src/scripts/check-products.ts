import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function checkProducts({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "metadata", "categories.id", "categories.handle", "categories.metadata"],
    pagination: { take: 5 },
  })

  console.log("Sample products:")
  for (const p of products) {
    const prod = p as any
    console.log("---")
    console.log("Product:", prod.title)
    console.log("Product metadata:", JSON.stringify(prod.metadata))
    console.log("Categories:", prod.categories?.map((c: any) => ({
      handle: c.handle,
      metadata: c.metadata
    })))
  }
}
