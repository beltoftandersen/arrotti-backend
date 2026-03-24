import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function deleteCategories({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Get all categories
  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name"],
  })

  console.log(`Found ${categories.length} categories to delete`)

  if (categories.length === 0) {
    console.log("No categories to delete")
    return
  }

  // List them
  for (const cat of categories) {
    console.log(`  - ${cat.name} (${cat.id})`)
  }

  // Delete using the product module service
  const productModuleService = container.resolve(Modules.PRODUCT)

  const ids = categories.map((c: any) => c.id)

  // Delete in batches to avoid issues
  for (const id of ids) {
    try {
      await productModuleService.deleteProductCategories([id])
      console.log(`Deleted: ${id}`)
    } catch (error: any) {
      console.error(`Failed to delete ${id}: ${error.message}`)
    }
  }

  console.log(`\nDeleted ${ids.length} categories`)
}
