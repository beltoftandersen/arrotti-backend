#!/bin/bash
# Warms up Meilisearch index by firing a dummy search query.
# This forces the index to be loaded into memory (mmap) and
# filterable attributes to be checked, eliminating cold-start latency.

MEILI_HOST="${MEILISEARCH_HOST:-http://127.0.0.1:7700}"
MEILI_KEY="${MEILISEARCH_API_KEY:-ms}"

echo "[meilisearch-warmup] Warming up products index at $MEILI_HOST..."

# Fire a minimal search to prime the index
curl -sf -o /dev/null \
  -X POST "$MEILI_HOST/indexes/products/search" \
  -H "Authorization: Bearer $MEILI_KEY" \
  -H "Content-Type: application/json" \
  -d '{"q":"warmup","limit":1}' \
  && echo "[meilisearch-warmup] Index warmed up successfully." \
  || echo "[meilisearch-warmup] Warmup failed (non-critical)."
