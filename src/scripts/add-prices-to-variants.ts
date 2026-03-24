/**
 * Add default prices to all product variants that don't have prices
 *
 * Usage: npx medusa exec ./src/scripts/add-prices-to-variants.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function addPricesToVariants({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pricingService = container.resolve(Modules.PRICING)
  const productService = container.resolve(Modules.PRODUCT)

  logger.info("Checking for variants without prices...")

  // Get all product variants with their prices
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "product.title", "price_set.id", "price_set.prices.*"],
  })

  logger.info(`Found ${variants?.length || 0} total variants`)

  // Default prices
  const DEFAULT_USD_PRICE = 9999 // $99.99
  const DEFAULT_EUR_PRICE = 9499 // €94.99

  let updated = 0
  let skipped = 0
  let errors = 0

  for (const variant of variants || []) {
    try {
      const v = variant as any
      const existingPrices = v.price_set?.prices || []

      // Check if variant already has USD and EUR prices
      const hasUsd = existingPrices.some((p: any) => p.currency_code === "usd")
      const hasEur = existingPrices.some((p: any) => p.currency_code === "eur")

      if (hasUsd && hasEur) {
        skipped++
        continue
      }

      // Create price set if doesn't exist
      let priceSetId = v.price_set?.id

      if (!priceSetId) {
        // Create a new price set and link to variant
        const priceSet = await pricingService.createPriceSets({
          prices: [
            { currency_code: "usd", amount: DEFAULT_USD_PRICE },
            { currency_code: "eur", amount: DEFAULT_EUR_PRICE },
          ],
        })
        priceSetId = priceSet.id

        // Link price set to variant using the link service
        const linkService = container.resolve(ContainerRegistrationKeys.LINK)
        await linkService.create({
          [Modules.PRODUCT]: { product_variant_id: v.id },
          [Modules.PRICING]: { price_set_id: priceSetId },
        })

        logger.info(`Created prices for variant ${v.sku || v.id} (${v.product?.title})`)
        updated++
      } else {
        // Add missing prices to existing price set
        const pricesToAdd: any[] = []

        if (!hasUsd) {
          pricesToAdd.push({ currency_code: "usd", amount: DEFAULT_USD_PRICE })
        }
        if (!hasEur) {
          pricesToAdd.push({ currency_code: "eur", amount: DEFAULT_EUR_PRICE })
        }

        if (pricesToAdd.length > 0) {
          await pricingService.addPrices({
            priceSetId,
            prices: pricesToAdd,
          })
          logger.info(`Added ${pricesToAdd.length} price(s) to variant ${v.sku || v.id}`)
          updated++
        }
      }
    } catch (err: any) {
      logger.error(`Error updating variant ${(variant as any).id}: ${err.message}`)
      errors++
    }
  }

  logger.info("Price update complete!")
  logger.info(`  Updated: ${updated}`)
  logger.info(`  Skipped (already has prices): ${skipped}`)
  logger.info(`  Errors: ${errors}`)
}
