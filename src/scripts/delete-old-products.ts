/**
 * Delete products that don't have partslink_no in metadata
 * (i.e., products that existed before the Partslink import)
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { deleteProductsWorkflow } from "@medusajs/medusa/core-flows"

export default async function({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info("Finding products without partslink_no...")

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title", "metadata"],
  })

  const oldProducts = (products as any[]).filter(p => !p.metadata?.partslink_no)

  logger.info(`Found ${products.length} total products`)
  logger.info(`Found ${oldProducts.length} old products to delete`)

  if (oldProducts.length === 0) {
    logger.info("No old products to delete")
    return
  }

  logger.info("Products to delete:")
  for (const p of oldProducts) {
    logger.info(`  - ${p.id}: ${p.title}`)
  }

  logger.info("Deleting old products...")

  const ids = oldProducts.map(p => p.id)

  await deleteProductsWorkflow(container).run({
    input: { ids },
  })

  logger.info(`Deleted ${oldProducts.length} old products`)
}
