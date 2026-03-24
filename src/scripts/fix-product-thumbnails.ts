import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function fixProductThumbnails({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productService = container.resolve(Modules.PRODUCT)
  const logger = container.resolve("logger")

  // Get all products without thumbnails but with images
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "thumbnail", "images.url", "images.rank"],
  })

  let fixedCount = 0
  let skippedCount = 0

  for (const product of products as any[]) {
    // Skip if already has thumbnail
    if (product.thumbnail) {
      skippedCount++
      continue
    }

    // Skip if no images
    if (!product.images || product.images.length === 0) {
      skippedCount++
      continue
    }

    // Sort by rank and get first image
    const sortedImages = [...product.images].sort((a: any, b: any) => (a.rank || 0) - (b.rank || 0))
    const firstImageUrl = sortedImages[0]?.url

    if (!firstImageUrl) {
      skippedCount++
      continue
    }

    // Update product thumbnail
    try {
      await productService.updateProducts(product.id, {
        thumbnail: firstImageUrl,
      })
      fixedCount++
      logger.info(`Fixed thumbnail for: ${product.title} -> ${firstImageUrl}`)
    } catch (error) {
      logger.error(`Failed to update ${product.title}: ${(error as Error).message}`)
    }
  }

  logger.info(`\n=== SUMMARY ===`)
  logger.info(`Fixed: ${fixedCount} products`)
  logger.info(`Skipped: ${skippedCount} products (already have thumbnail or no images)`)
}
