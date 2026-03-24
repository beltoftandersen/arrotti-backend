import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Tags specific sub-categories as local_only in their metadata.
 * These categories contain large items (pickup boxes, fenders, roof panels)
 * that can only be delivered locally within Orlando, FL.
 *
 * Usage: npm run exec src/scripts/tag-local-only-categories.ts
 */

const LOCAL_ONLY_CATEGORY_IDS = [
  "pcat_01KJZ3KX56GVGHEF28FQW4YJP6", // LT Pickup box side
  "pcat_01KJZ3KWZ2HBC8NZNY5YKJF3RB", // Pickup box assy
  "pcat_01KJZ3KX48C9AZ6QNH5GJG90SH", // Pickup box floor
  "pcat_01KJZ3KX66XKVTRRTBMR4E2TTD", // RT Pickup box side
  "pcat_01KJZ3KPKK7SNG6S7H7HY37FTM", // LT Rear fender assy
  "pcat_01KJZ3KQTHZXQN5G34FHMB2RSY", // Rear gate assembly
  "pcat_01KJZ3KNNW8PK2XX5XP3GE6DRH", // Roof panel
  "pcat_01KJZ3KNN1DD2VBDKQMA3Q8RJ9", // RT Body side panel
  "pcat_01KJZ3KNYH4NZMECY9YVCTS3BZ", // RT Quarter panel assy
  "pcat_01KJZ3KPMJB6WFE1PF5D23SJVM", // RT Rear fender assy
  "pcat_01KJZ3KPAM71FH5Y1N1KVCRA80", // RT Rear frame rail
]

export default async function ({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productService = container.resolve(Modules.PRODUCT)

  logger.info(`Tagging ${LOCAL_ONLY_CATEGORY_IDS.length} categories as local_only...`)

  let updated = 0
  let notFound = 0

  for (const catId of LOCAL_ONLY_CATEGORY_IDS) {
    try {
      // Retrieve the category to get existing metadata
      const [category] = await productService.listProductCategories(
        { id: catId },
        { select: ["id", "name", "metadata"] }
      )

      if (!category) {
        logger.warn(`Category not found: ${catId}`)
        notFound++
        continue
      }

      // Merge local_only into existing metadata
      const existingMetadata = (category.metadata as Record<string, unknown>) || {}
      await productService.updateProductCategories(catId, {
        metadata: {
          ...existingMetadata,
          local_only: true,
        },
      })

      logger.info(`Tagged: ${category.name} (${catId})`)
      updated++
    } catch (error: any) {
      logger.error(`Failed to tag ${catId}: ${error.message}`)
    }
  }

  logger.info(`Done. Updated: ${updated}, Not found: ${notFound}`)
}
