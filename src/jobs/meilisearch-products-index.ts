import { MedusaContainer } from "@medusajs/framework"

/**
 * Override the plugin's meilisearch-products-index job.
 * Skip full reindex on startup if the index already has products.
 * Use the admin sync endpoint or npm run reindex for manual full reindex.
 */
export default async function meilisearchProductsIndexJob(
  container: MedusaContainer
) {
  const logger = container.resolve("logger") as any

  // Check if Meilisearch already has products indexed
  const meilisearchHost = process.env.MEILISEARCH_HOST || "http://127.0.0.1:7700"
  const meilisearchApiKey = process.env.MEILISEARCH_API_KEY || ""

  try {
    const response = await fetch(`${meilisearchHost}/indexes/products/stats`, {
      headers: {
        Authorization: `Bearer ${meilisearchApiKey}`,
      },
    })

    if (response.ok) {
      const stats = (await response.json()) as { numberOfDocuments?: number }
      const documentCount = stats.numberOfDocuments || 0

      if (documentCount > 0) {
        logger.info(
          `[meilisearch-products-index] Skipping startup reindex - index already has ${documentCount} products. Use /admin/meilisearch/sync or npm run reindex for full reindex.`
        )
        return
      }
    }
  } catch (error) {
    logger.warn(
      `[meilisearch-products-index] Could not check Meilisearch stats: ${(error as Error).message}`
    )
  }

  // If we get here, the index is empty or we couldn't check - run the full sync
  logger.info("[meilisearch-products-index] Index is empty, running full product sync...")

  // Dynamically import and run the original workflow
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { syncProductsWorkflow } = require(
    "@rokmohar/medusa-plugin-meilisearch/.medusa/server/src/workflows/sync-products"
  )

  const {
    result: { totalProcessed, totalDeleted },
  } = await syncProductsWorkflow(container).run({
    input: {},
  })

  logger.info(
    `[meilisearch-products-index] Successfully indexed ${totalProcessed} products and deleted ${totalDeleted} products`
  )
}

export const config = {
  name: "meilisearch-products-index",
  schedule: "* * * * *",
  numberOfExecutions: 1,
}
