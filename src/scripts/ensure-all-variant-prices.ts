import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * One-time migration script: finds all variants without any price
 * and creates a $0.01 USD base price for each.
 *
 * Usage: npm run exec src/scripts/ensure-all-variant-prices.ts
 */
export default async function ensureAllVariantPrices({
  container,
}: {
  container: any
}) {
  const pricingService = container.resolve(Modules.PRICING)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve("logger")

  console.log("[ensure-prices] Finding variants without prices...")

  // Get all variant -> price_set links
  const { data: allVariantPriceSets } = await query.graph({
    entity: "product_variant_price_set",
    fields: ["variant_id", "price_set_id"],
  })

  if (!allVariantPriceSets?.length) {
    console.log("[ensure-prices] No variant price sets found. Done.")
    return
  }

  console.log(
    `[ensure-prices] Found ${allVariantPriceSets.length} variant price sets`
  )

  // Batch-load all prices to find which price sets are empty
  const priceSetIds = allVariantPriceSets.map(
    (vps: any) => vps.price_set_id
  )

  // Load all prices in batches to avoid query limits
  const batchSize = 500
  const priceSetIdsWithPrices = new Set<string>()

  for (let i = 0; i < priceSetIds.length; i += batchSize) {
    const batch = priceSetIds.slice(i, i + batchSize)
    const { data: prices } = await query.graph({
      entity: "price",
      fields: ["id", "price_set_id"],
      filters: { price_set_id: batch },
    })

    for (const price of prices ?? []) {
      priceSetIdsWithPrices.add((price as any).price_set_id)
    }
  }

  // Find variants whose price sets have no prices
  const variantsWithoutPrices = allVariantPriceSets.filter(
    (vps: any) => !priceSetIdsWithPrices.has(vps.price_set_id)
  )

  console.log(
    `[ensure-prices] Found ${variantsWithoutPrices.length} variants without prices`
  )

  if (variantsWithoutPrices.length === 0) {
    console.log("[ensure-prices] All variants have prices. Done.")
    return
  }

  // Create $0.01 USD price for each
  let created = 0
  let errors = 0

  for (const vps of variantsWithoutPrices) {
    const variantId = (vps as any).variant_id
    const priceSetId = (vps as any).price_set_id

    try {
      await pricingService.addPrices({
        priceSetId,
        prices: [
          {
            currency_code: "usd",
            amount: 0.01,
          },
        ],
      })
      created++

      if (created % 100 === 0) {
        console.log(`[ensure-prices] Created ${created} prices...`)
      }
    } catch (err: any) {
      errors++
      logger.warn(
        `[ensure-prices] Failed to create price for variant ${variantId}: ${err.message}`
      )
    }
  }

  console.log(
    `[ensure-prices] Done. Created ${created} prices, ${errors} errors.`
  )
}
