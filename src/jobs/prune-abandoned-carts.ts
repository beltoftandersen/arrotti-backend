import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const RETENTION_DAYS = 30
const BATCH_SIZE = 200

export default async function pruneAbandonedCartsJob(container: MedusaContainer) {
  const logger = container.resolve("logger") as any
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const cartService = container.resolve(Modules.CART)

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)

  let totalDeleted = 0
  let page = 0

  while (true) {
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id"],
      filters: {
        completed_at: null,
        updated_at: { $lt: cutoff },
      },
      pagination: { skip: page * BATCH_SIZE, take: BATCH_SIZE },
    })

    if (!carts.length) break

    const ids = carts.map((c) => c.id)
    await cartService.deleteCarts(ids)
    totalDeleted += ids.length

    if (carts.length < BATCH_SIZE) break
    page += 1
  }

  if (totalDeleted > 0) {
    logger.info(`[prune-abandoned-carts] Deleted ${totalDeleted} carts older than ${RETENTION_DAYS} days`)
  }
}

export const config = {
  name: "prune-abandoned-carts",
  schedule: "0 3 * * *",
}
