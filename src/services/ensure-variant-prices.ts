import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Ensure all variants for a product have at least one price.
 * If a variant has no money amounts in its price set, creates a $0.01 USD base price.
 *
 * @param container - The Medusa container
 * @param productId - The product ID to check
 * @returns Number of variants that had prices created
 */
export async function ensureVariantPrices(
  container: any,
  productId: string
): Promise<number> {
  const pricingService = container.resolve(Modules.PRICING)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve("logger")

  // Get all variants for this product
  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "product_id"],
    filters: { product_id: productId },
  })

  if (!variants?.length) {
    return 0
  }

  let created = 0

  for (const variant of variants) {
    const variantId = (variant as any).id

    // Get the variant's price set
    const { data: variantPriceSets } = await query.graph({
      entity: "product_variant_price_set",
      fields: ["variant_id", "price_set_id"],
      filters: { variant_id: variantId },
    })

    if (!variantPriceSets?.length) {
      logger.warn(
        `[ensure-variant-prices] Variant ${variantId} has no price set, skipping`
      )
      continue
    }

    const priceSetId = (variantPriceSets[0] as any).price_set_id

    // Check if this price set has any money amounts
    const { data: existingPrices } = await query.graph({
      entity: "price",
      fields: ["id", "currency_code", "amount"],
      filters: { price_set_id: priceSetId },
    })

    if (existingPrices && existingPrices.length > 0) {
      // Already has prices, skip
      continue
    }

    // No prices — create a $0.01 USD fallback
    await pricingService.addPrices({
      priceSetId,
      prices: [
        {
          currency_code: "usd",
          amount: 0.01,
        },
      ],
    })

    logger.info(
      `[ensure-variant-prices] Created $0.01 USD fallback price for variant ${variantId}`
    )
    created++
  }

  return created
}
