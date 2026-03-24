import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brand"

export default async function deleteBrands({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const brandService = container.resolve(BRAND_MODULE)

  // Get all brands
  const { data: brands } = await query.graph({
    entity: "brand",
    fields: ["id", "name"],
  })

  console.log(`Found ${brands.length} brands to delete`)

  if (brands.length === 0) {
    console.log("No brands to delete")
    return
  }

  for (const brand of brands) {
    console.log(`  - ${(brand as any).name} (${(brand as any).id})`)
  }

  // Delete each brand
  for (const brand of brands) {
    try {
      await brandService.deleteBrands((brand as any).id)
      console.log(`Deleted: ${(brand as any).id}`)
    } catch (error: any) {
      console.error(`Failed to delete ${(brand as any).id}: ${error.message}`)
    }
  }

  console.log(`\nDeleted ${brands.length} brands`)
}
