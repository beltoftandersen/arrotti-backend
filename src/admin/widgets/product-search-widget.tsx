import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { useEffect, useState, useRef, useCallback } from "react"
import { Container, Heading } from "@medusajs/ui"

type SearchResult = {
  id: string
  title: string
  handle: string
  thumbnail: string | null
  variant_skus: string[]
  partslink_no: string
  oem_number: string
  brand_name: string
}

const ProductSearchWidget = () => {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setCount(0)
      setHasSearched(false)
      return
    }

    // Cancel previous request
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setHasSearched(true)
    try {
      const res = await fetch(
        `/admin/products/search?q=${encodeURIComponent(q.trim())}&limit=25`,
        {
          credentials: "include",
          signal: controller.signal,
        }
      )
      if (!res.ok) throw new Error("Search failed")
      const data = await res.json()
      if (!controller.signal.aborted) {
        setResults(data.products ?? [])
        setCount(data.count ?? 0)
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Admin product search failed:", err)
        if (!controller.signal.aborted) {
          setResults([])
          setCount(0)
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      abortRef.current?.abort()
    }
  }, [query, search])

  return (
    <Container>
      <div style={{ marginBottom: "12px" }}>
        <Heading level="h2">Search by SKU / Partslink / OEM</Heading>
        <p style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px" }}>
          Searches across product title, variant SKU, partslink number, and OEM number via Meilisearch.
        </p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter SKU, partslink, OEM, or product name..."
        style={{
          width: "100%",
          padding: "8px 12px",
          border: "1px solid #d1d5db",
          borderRadius: "8px",
          fontSize: "14px",
          outline: "none",
        }}
        onFocus={(e) => (e.target.style.borderColor = "#6366f1")}
        onBlur={(e) => (e.target.style.borderColor = "#d1d5db")}
      />

      {loading && (
        <p style={{ fontSize: "13px", color: "#9ca3af", marginTop: "8px" }}>
          Searching...
        </p>
      )}

      {!loading && hasSearched && results.length === 0 && (
        <p style={{ fontSize: "13px", color: "#9ca3af", marginTop: "8px" }}>
          No products found for &quot;{query}&quot;
        </p>
      )}

      {!loading && results.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "6px" }}>
            {count} result{count !== 1 ? "s" : ""} found
          </p>
          <div style={{ maxHeight: "400px", overflowY: "auto" }}>
            <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Product</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>SKU</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Partslink</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>OEM</th>
                </tr>
              </thead>
              <tbody>
                {results.map((p) => (
                  <tr
                    key={p.id}
                    style={{ borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}
                    onClick={() => window.location.assign(`/app/products/${p.id}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f9fafb")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                  >
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {p.thumbnail && (
                          <img
                            src={p.thumbnail}
                            alt=""
                            style={{ width: "32px", height: "32px", objectFit: "cover", borderRadius: "4px" }}
                          />
                        )}
                        <div>
                          <div style={{ fontWeight: 500 }}>{p.title}</div>
                          {p.brand_name && (
                            <div style={{ fontSize: "11px", color: "#9ca3af" }}>{p.brand_name}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: "6px 8px", color: "#374151" }}>
                      {(p.variant_skus ?? []).join(", ") || "-"}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#374151" }}>
                      {p.partslink_no || "-"}
                    </td>
                    <td style={{ padding: "6px 8px", color: "#374151" }}>
                      {p.oem_number || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.list.before",
})

export default ProductSearchWidget
