import { Pool } from "pg"

// In-memory cache: product_id -> min price in cents (USD)
const priceCache = new Map<string, number>()
let cacheLoaded = false
let cacheLoadPromise: Promise<void> | null = null

/**
 * Load all product minimum prices (USD, in cents) into memory.
 * Called once and cached for the process lifetime.
 */
async function loadPriceCache(): Promise<void> {
  if (cacheLoaded) return
  if (cacheLoadPromise) return cacheLoadPromise

  cacheLoadPromise = (async () => {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) {
      console.warn("[price-lookup] DATABASE_URL not set, skipping cache load")
      cacheLoaded = true
      return
    }

    const pool = new Pool({ connectionString: databaseUrl })

    try {
      const result = await pool.query(`
        SELECT pv.product_id, MIN(p.amount) as min_price
        FROM product_variant pv
        JOIN product_variant_price_set pvps ON pvps.variant_id = pv.id AND pvps.deleted_at IS NULL
        JOIN price p ON p.price_set_id = pvps.price_set_id AND p.deleted_at IS NULL
        WHERE p.currency_code = 'usd'
          AND pv.deleted_at IS NULL
        GROUP BY pv.product_id
      `)

      for (const row of result.rows) {
        if (row.product_id && row.min_price != null) {
          priceCache.set(row.product_id, Math.round(Number(row.min_price) * 100))
        }
      }

      console.log(`[price-lookup] Loaded ${priceCache.size} product prices into cache`)
      cacheLoaded = true
    } catch (error) {
      console.error("[price-lookup] Failed to load price cache:", error)
      cacheLoaded = true
    } finally {
      await pool.end()
    }
  })()

  return cacheLoadPromise
}

/**
 * Get minimum price in cents (USD) for a product ID.
 * Returns null if not found.
 */
export async function getProductPriceCents(productId: string): Promise<number | null> {
  await loadPriceCache()
  return priceCache.get(productId) ?? null
}
