import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SUPPLIER_MODULE } from "../modules/supplier"

export type VariantSupplierLink = {
  product_variant_id: string
  supplier_id: string
  supplier_sku?: string | null
  partslink_no?: string | null
  oem_number?: string | null
  cost_price?: number | null
  markup_override?: number | null
  stock_qty?: number | null
  is_primary?: boolean
  supplier?: {
    id: string
    name: string
    code: string
    email?: string | null
    default_markup: number
  }
}

/**
 * Calculate sell price from cost and markup percentage
 * @param costPrice - The cost price in dollars
 * @param markupPercent - The markup percentage (e.g., 30 = 30%)
 * @returns The sell price in dollars
 */
export function calculateSellPrice(costPrice: number, markupPercent: number): number {
  return costPrice * (1 + markupPercent / 100)
}

/**
 * Raw supplier candidate for import-time pricing. Used when we don't have
 * VariantSupplierLink rows yet (we're about to create them) but know the
 * underlying cost/stock per supplier.
 */
export type SupplierCandidate = {
  code: string
  costPrice: number
  stockQty: number
  markup: number
}

/**
 * Pick the best supplier at import time, mirroring findPricingSupplier's
 * stock-then-cost-then-qty sort. Returns null if no candidate has a cost.
 * Used by import-from-merged to drive sell price + is_primary decisions
 * before the variant_supplier rows exist in the DB.
 */
export function pickPrimaryCandidate(
  candidates: SupplierCandidate[]
): SupplierCandidate | null {
  const withCost = candidates.filter((c) => c.costPrice > 0)
  if (withCost.length === 0) return null

  return [...withCost].sort((a, b) => {
    const aHas = a.stockQty > 0 ? 1 : 0
    const bHas = b.stockQty > 0 ? 1 : 0
    if (aHas !== bHas) return bHas - aHas
    if (a.costPrice !== b.costPrice) return a.costPrice - b.costPrice
    return b.stockQty - a.stockQty
  })[0]
}

/**
 * Get the effective markup for a variant-supplier link
 * Uses markup_override if set, otherwise falls back to supplier's default_markup
 */
export function getEffectiveMarkup(
  link: VariantSupplierLink,
  supplierDefaultMarkup: number
): number {
  if (link.markup_override !== null && link.markup_override !== undefined) {
    return Number(link.markup_override)
  }
  return supplierDefaultMarkup
}

/**
 * Find the pricing supplier for a variant
 *
 * Selection logic (in priority order):
 * 1. If a supplier is marked is_primary (and has cost_price), use it
 * 2. Suppliers with stock (qty > 0) come first
 * 3. Among equal stock status, lower cost_price wins
 * 4. If same price, higher stock_qty wins as tiebreaker
 *
 * Returns the supplier link to use for pricing, or null if none found
 */
export function findPricingSupplier(
  links: VariantSupplierLink[]
): VariantSupplierLink | null {
  if (!links || links.length === 0) return null

  // Only consider suppliers with a cost_price
  const withCost = links.filter((l) => l.cost_price != null)
  if (withCost.length === 0) return null

  // If a primary supplier is set and has a cost_price, use it
  const primary = withCost.find((l) => l.is_primary === true)
  if (primary) return primary

  // Otherwise sort by: has_stock DESC, cost_price ASC, stock_qty DESC
  const sorted = [...withCost].sort((a, b) => {
    const aStock = Number(a.stock_qty) || 0
    const bStock = Number(b.stock_qty) || 0
    const aHasStock = aStock > 0 ? 1 : 0
    const bHasStock = bStock > 0 ? 1 : 0

    // 1. Prefer suppliers with stock
    if (bHasStock !== aHasStock) return bHasStock - aHasStock

    // 2. Lower cost_price wins
    const aCost = Number(a.cost_price)
    const bCost = Number(b.cost_price)
    if (aCost !== bCost) return aCost - bCost

    // 3. Higher stock_qty breaks ties
    return bStock - aStock
  })

  return sorted[0]
}

/**
 * Update a variant's price based on cost and markup
 * @param container - The Medusa container
 * @param variantId - The variant ID to update
 * @param sellPrice - The new sell price in dollars
 * @param currencyCode - The currency code (default: "usd")
 */
export async function updateVariantPrice(
  container: any,
  variantId: string,
  sellPrice: number,
  currencyCode: string = "usd"
): Promise<void> {
  const pricingService = container.resolve(Modules.PRICING)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve("logger")

  // Round to 2 decimal places for currency
  const priceAmount = Math.round(sellPrice * 100) / 100

  try {
    // Get the variant's price set
    const { data: variantPriceSets } = await query.graph({
      entity: "product_variant_price_set",
      fields: ["variant_id", "price_set_id"],
      filters: {
        variant_id: variantId,
      },
    })

    if (!variantPriceSets || variantPriceSets.length === 0) {
      logger.warn(`[Auto-Pricing] Variant ${variantId} has no price set`)
      return
    }

    const priceSetId = (variantPriceSets[0] as any).price_set_id

    // Get existing prices for this price set
    const { data: existingPrices } = await query.graph({
      entity: "price",
      fields: ["id", "currency_code", "amount"],
      filters: {
        price_set_id: priceSetId,
        currency_code: currencyCode,
      },
    })

    if (existingPrices && existingPrices.length > 0) {
      // Update existing price
      await pricingService.updatePrices([
        {
          id: (existingPrices[0] as any).id,
          amount: priceAmount,
        },
      ])
      logger.info(
        `[Auto-Pricing] Updated variant ${variantId} price to $${priceAmount} (${currencyCode})`
      )
    } else {
      // Create new price
      await pricingService.addPrices({
        priceSetId,
        prices: [
          {
            currency_code: currencyCode,
            amount: priceAmount,
          },
        ],
      })
      logger.info(
        `[Auto-Pricing] Created variant ${variantId} price: $${priceAmount} (${currencyCode})`
      )
    }
  } catch (error) {
    logger.error(
      `[Auto-Pricing] Failed to update variant ${variantId} price: ${(error as Error).message}`
    )
    throw error
  }
}

/**
 * Update a variant's inventory level based on supplier stock
 * @param container - The Medusa container
 * @param variantId - The variant ID to update
 * @param stockQty - The stock quantity from the selected supplier
 */
export async function updateVariantInventory(
  container: any,
  variantId: string,
  stockQty: number
): Promise<void> {
  const inventoryService = container.resolve(Modules.INVENTORY)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve("logger")

  try {
    // Get the variant's inventory items via the link table
    // Use product_variant entity with inventory_items relation
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "inventory_items.inventory_item_id"],
      filters: { id: variantId },
    })

    const variant = (variants[0] as any)
    const inventoryItems = variant?.inventory_items || []

    if (inventoryItems.length === 0) {
      logger.warn(`[Auto-Pricing] Variant ${variantId} has no inventory item linked`)
      return
    }

    const inventoryItemId = inventoryItems[0]?.inventory_item_id
    if (!inventoryItemId) {
      logger.warn(`[Auto-Pricing] No inventory_item_id found for variant ${variantId}`)
      return
    }

    // Get the default stock location
    const stockLocations = await stockLocationService.listStockLocations({})

    if (!stockLocations || stockLocations.length === 0) {
      logger.warn(`[Auto-Pricing] No stock location found, skipping inventory update`)
      return
    }
    const stockLocationId = stockLocations[0].id

    // Check if inventory level exists
    const existingLevels = await inventoryService.listInventoryLevels({
      inventory_item_id: inventoryItemId,
      location_id: stockLocationId,
    })

    if (existingLevels && existingLevels.length > 0) {
      // Update existing level
      await inventoryService.updateInventoryLevels([{
        id: existingLevels[0].id,
        inventory_item_id: inventoryItemId,
        location_id: stockLocationId,
        stocked_quantity: stockQty,
      }])
      logger.info(`[Auto-Pricing] Updated variant ${variantId} inventory to ${stockQty}`)
    } else {
      // Create new level
      await inventoryService.createInventoryLevels([{
        inventory_item_id: inventoryItemId,
        location_id: stockLocationId,
        stocked_quantity: stockQty,
      }])
      logger.info(`[Auto-Pricing] Created variant ${variantId} inventory level: ${stockQty}`)
    }
  } catch (error) {
    // Log but don't throw - inventory update is secondary to price update
    logger.warn(
      `[Auto-Pricing] Failed to update inventory for ${variantId}: ${(error as Error).message}`
    )
  }
}

/**
 * Recalculate and update a variant's price and inventory based on its supplier links
 * Selects supplier by: has_stock > lowest_price > highest_stock
 * Updates both selling price and Medusa inventory from selected supplier
 */
export async function recalculateVariantPrice(
  container: any,
  variantId: string,
  currencyCode: string = "usd"
): Promise<{ success: boolean; newPrice?: number; newStock?: number; error?: string }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Get all supplier links for this variant
    const { data: links } = await query.graph({
      entity: "product_variant_supplier",
      fields: [
        "product_variant_id",
        "supplier_id",
        "cost_price",
        "markup_override",
        "stock_qty",
        "is_primary",
        "supplier.id",
        "supplier.default_markup",
      ],
      filters: {
        product_variant_id: variantId,
      },
    })

    const pricingSupplier = findPricingSupplier(links as VariantSupplierLink[])
    if (!pricingSupplier || pricingSupplier.cost_price == null) {
      return { success: false, error: "No supplier with cost price found" }
    }

    const costPrice = Number(pricingSupplier.cost_price)
    const stockQty = Number(pricingSupplier.stock_qty) || 0
    const supplierMarkup = pricingSupplier.supplier?.default_markup ?? 20
    const effectiveMarkup = getEffectiveMarkup(pricingSupplier, supplierMarkup)
    const sellPrice = calculateSellPrice(costPrice, effectiveMarkup)

    // Update variant price
    await updateVariantPrice(container, variantId, sellPrice, currencyCode)

    // Update variant inventory from selected supplier's stock
    await updateVariantInventory(container, variantId, stockQty)

    return { success: true, newPrice: sellPrice, newStock: stockQty }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * Recalculate prices for all variants linked to a specific supplier
 */
export async function recalculateSupplierVariantPrices(
  container: any,
  supplierId: string,
  currencyCode: string = "usd"
): Promise<{ updated: number; failed: number; errors: string[] }> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve("logger")

  const result = { updated: 0, failed: 0, errors: [] as string[] }

  try {
    // Get all variant IDs linked to this supplier
    const { data: links } = await query.graph({
      entity: "product_variant_supplier",
      fields: ["product_variant_id"],
      filters: {
        supplier_id: supplierId,
      },
    })

    const variantIds = [...new Set((links as any[]).map((l) => l.product_variant_id))]

    logger.info(
      `[Auto-Pricing] Recalculating prices for ${variantIds.length} variants linked to supplier ${supplierId}`
    )

    for (const variantId of variantIds) {
      const { success, error } = await recalculateVariantPrice(
        container,
        variantId,
        currencyCode
      )

      if (success) {
        result.updated++
      } else {
        result.failed++
        if (error) {
          result.errors.push(`${variantId}: ${error}`)
        }
      }
    }

    logger.info(
      `[Auto-Pricing] Completed: ${result.updated} updated, ${result.failed} failed`
    )
  } catch (error) {
    logger.error(
      `[Auto-Pricing] Error recalculating supplier prices: ${(error as Error).message}`
    )
    throw error
  }

  return result
}
