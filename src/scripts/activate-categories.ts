import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "is_active", "metadata"],
  })

  const inactive = (categories as any[]).filter(c => !c.is_active)
  
  logger.info(`Found ${categories.length} total categories`)
  logger.info(`Found ${inactive.length} inactive categories`)

  if (inactive.length === 0) {
    logger.info("All categories are already active")
    return
  }

  for (const cat of inactive) {
    await productService.updateProductCategories(cat.id, {
      is_active: true,
    })
    logger.info(`Activated: ${cat.name}`)
  }

  logger.info(`Activated ${inactive.length} categories`)
}
