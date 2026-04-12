/**
 * Step 5b: Update stock and prices for all variants from import_ready
 *
 * Lightweight daily sync — only updates:
 * - Inventory levels (qty + district_qty from KSI)
 * - Prices (cost * markup for KSI, 0 for quote-only)
 * - Supplier link stock_qty and cost_price
 *
 * Does NOT touch: products, categories, fitments, metadata
 * Much faster than the full import (~15-20 min vs 90+ min)
 *
 * Prerequisites: import_ready table is up to date (run steps 1-4 first)
 *
 * Usage: npx medusa exec ./src/scripts/update-stock-prices.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SUPPLIER_MODULE } from "../modules/supplier"
import SupplierModuleService from "../modules/supplier/service"
import { calculateSellPrice } from "../services/auto-pricing"
import pg from "pg"

const { Pool } = pg

function parseQty(qty: string, districtQty?: string): number {
  const q = parseSingleQty(qty)
  const d = districtQty ? parseSingleQty(districtQty) : 0
  return q + d
}

function parseSingleQty(qty: string): number {
  if (!qty || qty === "0") return 0
  const cleaned = qty.replace("+", "").trim()
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? 0 : num
}

interface StockRow {
  plink: string
  cost_price: string
  ksi_qty: string
  ksi_district_qty: string
  ksi_no: string | null
  has_ksi: boolean
  is_quote_only: boolean
}

export default async function updateStockPrices({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pricingModuleService = container.resolve(Modules.PRICING)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const supplierService: SupplierModuleService = container.resolve(SUPPLIER_MODULE)

  logger.info("=== Stock & Price Update ===")
  const startTime = Date.now()

  // Connect to ksi_data
  const pool = new Pool({
    database: "ksi_data",
    user: "medusa",
    password: "medusa123",
    host: "localhost",
  })

  // Connect to Medusa DB for supplier link updates
  const medusaPool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://medusa:medusa123@localhost/medusa-my-medusa-store",
  })

  // Get stock location
  const stockLocations = await stockLocationService.listStockLocations({})
  if (!stockLocations || stockLocations.length === 0) {
    throw new Error("No stock location found")
  }
  const stockLocationId = stockLocations[0].id

  // Get KSI supplier and markup
  const ksiSupplier = (await supplierService.listSuppliers({ code: "KSI" }))[0]
  if (!ksiSupplier) {
    throw new Error("KSI supplier not found")
  }
  const markup = (ksiSupplier as any).default_markup || 20
  logger.info(`  Markup: ${markup}%`)

  // Load all variant stock data from import_ready (one row per unique plink)
  const { rows: stockData } = await pool.query<StockRow>(`
    SELECT DISTINCT ON (plink) plink, cost_price, ksi_qty, ksi_district_qty, ksi_no, has_ksi, is_quote_only
    FROM import_ready
    ORDER BY plink, has_ksi DESC
  `)
  logger.info(`  ${stockData.length} variants to update`)

  // Build lookup map
  const stockMap = new Map<string, StockRow>()
  for (const row of stockData) {
    stockMap.set(row.plink, row)
  }

  // Load all variants from Medusa with their linked data
  let updatedPrices = 0
  let updatedInventory = 0
  let updatedSupplier = 0
  let skipped = 0
  let errors = 0
  let processed = 0

  const PAGE = 500
  let offset = 0

  while (true) {
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: [
        "id", "sku",
        "inventory_items.inventory_item_id",
      ],
      pagination: { skip: offset, take: PAGE },
    })

    if (!variants || variants.length === 0) break

    for (const variant of variants) {
      const v = variant as any
      if (!v.sku) { skipped++; continue }

      const stock = stockMap.get(v.sku)
      if (!stock) { skipped++; continue }

      const costPrice = parseFloat(stock.cost_price) || 0
      const sellPrice = stock.is_quote_only ? 0 : (costPrice > 0 ? calculateSellPrice(costPrice, markup) : 0)
      const qty = parseQty(stock.ksi_qty, stock.ksi_district_qty)

      // Update price
      try {
        const { data: priceSets } = await query.graph({
          entity: "product_variant_price_set",
          fields: ["variant_id", "price_set_id"],
          filters: { variant_id: v.id },
        })

        if (priceSets?.[0]) {
          const priceSetId = (priceSets[0] as any).price_set_id
          const { data: prices } = await query.graph({
            entity: "price",
            fields: ["id", "amount"],
            filters: { price_set_id: priceSetId, currency_code: "usd" },
          })

          if (prices?.[0]) {
            const currentPrice = Number((prices[0] as any).amount)
            const newPrice = Math.round(sellPrice * 100) / 100
            if (Math.abs(currentPrice - newPrice) > 0.01) {
              await (pricingModuleService as any).updatePrices([{
                id: (prices[0] as any).id,
                amount: newPrice,
              }])
              updatedPrices++
            }
          }
        }
      } catch (err: any) {
        if (errors < 10) logger.warn(`  Price error ${v.sku}: ${err.message}`)
        errors++
      }

      // Update inventory
      try {
        const inventoryItems = v.inventory_items || []
        if (inventoryItems.length > 0 && inventoryItems[0]?.inventory_item_id) {
          const inventoryItemId = inventoryItems[0].inventory_item_id
          const existingLevels = await inventoryService.listInventoryLevels({
            inventory_item_id: inventoryItemId,
            location_id: stockLocationId,
          })

          if (existingLevels.length > 0) {
            const currentQty = existingLevels[0].stocked_quantity
            if (currentQty !== qty) {
              await inventoryService.updateInventoryLevels([{
                id: existingLevels[0].id,
                inventory_item_id: inventoryItemId,
                location_id: stockLocationId,
                stocked_quantity: qty,
              }])
              updatedInventory++
            }
          }
        }
      } catch (err: any) {
        if (errors < 10) logger.warn(`  Inventory error ${v.sku}: ${err.message}`)
        errors++
      }

      // Update supplier link — only if changed
      if (stock.has_ksi && stock.ksi_no) {
        try {
          const newCost = costPrice > 0 ? costPrice : null
          const result = await medusaPool.query(
            `UPDATE variant_supplier SET cost_price = $1, stock_qty = $2, supplier_sku = $3, updated_at = NOW()
             WHERE product_variant_id = $4 AND supplier_id = $5
               AND (cost_price IS DISTINCT FROM $1 OR stock_qty IS DISTINCT FROM $2 OR supplier_sku IS DISTINCT FROM $3)`,
            [newCost, qty, stock.ksi_no, v.id, ksiSupplier.id]
          )
          if (result.rowCount && result.rowCount > 0) updatedSupplier++
        } catch (err: any) {
          if (errors < 10) logger.warn(`  Supplier error ${v.sku}: ${err.message}`)
          errors++
        }
      }

      processed++
    }

    offset += PAGE

    if (processed % 5000 === 0 && processed > 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1)
      logger.info(`  Progress: ${processed}/${stockData.length} (${rate}/s) | prices: ${updatedPrices} | inventory: ${updatedInventory} | supplier: ${updatedSupplier} | errors: ${errors}`)
    }

    if (variants.length < PAGE) break
  }

  await pool.end()
  await medusaPool.end()

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  logger.info("\n=== Update Complete ===")
  logger.info(`Time:              ${totalTime} minutes`)
  logger.info(`Processed:         ${processed}`)
  logger.info(`Prices updated:    ${updatedPrices}`)
  logger.info(`Inventory updated: ${updatedInventory}`)
  logger.info(`Supplier updated:  ${updatedSupplier}`)
  logger.info(`Skipped:           ${skipped}`)
  logger.info(`Errors:            ${errors}`)
}
