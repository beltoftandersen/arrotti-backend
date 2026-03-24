import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../modules/brand"
import BrandModuleService from "../modules/brand/service"

export default async function assignBrands({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const brandService: BrandModuleService = container.resolve(BRAND_MODULE)

  logger.info("Fetching brands and products...")

  const brands = await brandService.listBrands({})
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title"],
  })

  if (!products.length || !brands.length) {
    logger.info("No products or brands found")
    return
  }

  logger.info(`Found ${products.length} products and ${brands.length} brands`)

  // Assign random brands to first 10 products
  const productsToAssign = products.slice(0, 10)

  for (let i = 0; i < productsToAssign.length; i++) {
    const product = productsToAssign[i]
    const brand = brands[i % brands.length]

    try {
      await link.create({
        [Modules.PRODUCT]: { product_id: product.id },
        brand: { brand_id: brand.id },
      })
      logger.info(`Assigned ${brand.name} to ${product.title}`)
    } catch (error: any) {
      logger.warn(`Failed to assign brand to ${product.title}: ${error.message}`)
    }
  }

  logger.info("Done assigning brands")
}
