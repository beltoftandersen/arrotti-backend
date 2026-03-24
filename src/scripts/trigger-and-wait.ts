/**
 * This script runs in the context of medusa exec but just prints instructions.
 * The real test is watching the running backend's behavior.
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export default async function triggerAndWait({ container }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve("logger") as any
  const meilisearchService = container.resolve("meilisearch") as any

  // Find a product with fitments
  const { data: links } = await query.graph({
    entity: "product_fitment",
    fields: ["product_id", "fitment.vehicle_id"],
    pagination: { take: 10 },
  })

  // Get unique product with its vehicle_ids
  const productVehicles = new Map<string, Set<string>>()
  for (const link of links) {
    if (link.fitment?.vehicle_id) {
      const set = productVehicles.get(link.product_id) || new Set()
      set.add(link.fitment.vehicle_id)
      productVehicles.set(link.product_id, set)
    }
  }

  const productId = [...productVehicles.keys()][0]
  const expectedVehicleIds = [...(productVehicles.get(productId) || [])]

  logger.info(`Product ID: ${productId}`)
  logger.info(`Expected vehicle_ids from DB: ${JSON.stringify(expectedVehicleIds)}`)

  // Clear vehicle_ids in Meilisearch
  const index = meilisearchService.getIndex("products")
  const task = await index.updateDocuments([{ id: productId, vehicle_ids: [], fitment_text: [] }])
  await index.waitForTask(task.taskUid)
  logger.info("Cleared vehicle_ids in Meilisearch")

  const docCleared = await index.getDocument(productId)
  logger.info(`After clear - vehicle_ids: ${JSON.stringify(docCleared.vehicle_ids)}`)

  logger.info("\n=== Now watch the running backend logs ===")
  logger.info("Run: sudo journalctl -u medusa-backend-dev -f | grep -E '(fitment-sync|upsert)'")
  logger.info("\nThen in another terminal, call this script again with --update flag")
}
