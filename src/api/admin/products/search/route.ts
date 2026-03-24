import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { escapeFilterValue } from "../../../../lib/meilisearch-filter"

/**
 * Admin product search via Meilisearch.
 * Searches across title, description, variant SKUs, partslink, and OEM numbers.
 * No sales channel filtering — admin sees all products.
 */

function looksLikePartNumber(query: string): boolean {
  const trimmed = query.trim()
  if (!trimmed || trimmed.includes(" ")) return false
  if (trimmed.length < 4) return false
  return /^[a-zA-Z0-9._-]+$/.test(trimmed)
}

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { q, limit: limitParam, offset: offsetParam } = req.query as Record<string, string>
  const searchQuery = (q || "").trim()

  if (!searchQuery) {
    return res.json({ products: [], count: 0 })
  }

  const limit = Math.min(parseInt(limitParam || "50", 10) || 50, 200)
  const offset = parseInt(offsetParam || "0", 10) || 0

  const meilisearchService = req.scope.resolve("meilisearch") as any
  const indexes = Object.keys(
    (meilisearchService as any).options_?.settings ?? {}
  )
  if (!indexes.length) {
    return res.json({ products: [], count: 0 })
  }

  const searchOptions: any = {
    limit,
    offset,
    attributesToRetrieve: [
      "id", "title", "handle", "thumbnail", "variant_skus",
      "partslink_no", "oem_number", "category_id", "brand_name",
      "created_at",
    ],
  }

  // --- Exact match for part-number-like queries ---
  if (looksLikePartNumber(searchQuery)) {
    const escaped = escapeFilterValue(searchQuery)
    const partFilter = `oem_number = "${escaped}" OR partslink_no = "${escaped}" OR variant_skus = "${escaped}"`

    const exactResults = await Promise.all(
      indexes.map((indexKey: string) =>
        meilisearchService.search(indexKey, "", { ...searchOptions, filter: partFilter })
      )
    )

    const exactHits = exactResults.flatMap((r: any) => r.hits ?? [])
    const totalExact = exactResults.reduce(
      (sum: number, r: any) => sum + (r.estimatedTotalHits || r.hits?.length || 0), 0
    )

    if (totalExact > 0) {
      return res.json({
        products: dedup(exactHits),
        count: totalExact,
      })
    }
    // Fall through to fuzzy search
  }

  // --- Fuzzy search ---
  const results = await Promise.all(
    indexes.map((indexKey: string) =>
      meilisearchService.search(indexKey, searchQuery, searchOptions)
    )
  )

  const hits = results.flatMap((r: any) => r.hits ?? [])
  const totalHits = results.reduce(
    (sum: number, r: any) => sum + (r.estimatedTotalHits || r.hits?.length || 0), 0
  )

  return res.json({
    products: dedup(hits),
    count: totalHits,
  })
}

function dedup(hits: any[]): any[] {
  const seen = new Set<string>()
  return hits.filter((h) => {
    if (seen.has(h.id)) return false
    seen.add(h.id)
    return true
  })
}
