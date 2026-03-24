import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import { linkSalesChannelsToStockLocationWorkflow } from "@medusajs/medusa/core-flows"

export default async function linkSalesChannelsToStock({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  logger.info("Fetching stock locations...")
  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  })

  if (!stockLocations.length) {
    logger.error("No stock locations found. Please create one first.")
    return
  }

  const stockLocation = stockLocations[0]
  logger.info(`Using stock location: ${stockLocation.name} (${stockLocation.id})`)

  logger.info("Fetching sales channels...")
  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  })

  if (!salesChannels.length) {
    logger.error("No sales channels found.")
    return
  }

  logger.info(`Found ${salesChannels.length} sales channel(s)`)

  for (const salesChannel of salesChannels) {
    logger.info(`Linking sales channel: ${salesChannel.name} (${salesChannel.id})`)
    try {
      await linkSalesChannelsToStockLocationWorkflow(container).run({
        input: {
          id: stockLocation.id,
          add: [salesChannel.id],
        },
      })
      logger.info(`  ✓ Linked successfully`)
    } catch (error: any) {
      if (error.message?.includes("already exists")) {
        logger.info(`  ✓ Already linked`)
      } else {
        logger.error(`  ✗ Failed: ${error.message}`)
      }
    }
  }

  logger.info("Done!")
}
