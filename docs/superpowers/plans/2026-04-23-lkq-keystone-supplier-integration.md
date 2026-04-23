# Plan — LKQ / Keystone Supplier Integration (Pipeline Step 2b → Step 5b)

**Date**: 2026-04-23
**Project**: Arrotti
**Branch**: main
**Status**: Draft — awaiting review before implementation

---

## Goal

Treat LKQ (Keystone) as a second supplier in Medusa, alongside KSI. Surface LKQ stock and cost on the same variants so we can:

- Sell products that KSI doesn't carry but LKQ does (currently quote-only → becomes live).
- Retain KSI as the default pricing/fulfillment source when present.
- Prepare for future policies (dynamic primary, cheapest-wins, etc.) without re-plumbing.

**In scope**: pipeline SQL, import writer, daily updater, docs.
**Out of scope**: image ingestion from LKQ, admin UI changes, dynamic primary-supplier selection, storefront changes.
**Non-goal**: `list_price` — discarded per product decision (only `your_price` = cost_price matters).

---

## Confirmed facts

- KEYSTONE supplier exists: `id=01KPWFWF4F860RJ8X9JHRYP4DD`, `code=KEYSTONE`, `default_markup=20`.
- `variant_supplier` already supports N suppliers per variant with an `is_primary` flag; `findPricingSupplier` (auto-pricing) honors it.
- Join key is clean: `product_variant.sku = pl_master.plink_cert = ksi_r_products.link_no = lkq_r_stock.lkq_part_number` (verified on AC1000211 — 2 rows returned, both map to distinct variants).
- LKQ scraper + loader (Step 2b) are live and tested; `ksi_data.lkq_r_stock` is populated on demand.
- Input list `lkq_parts.csv` is ~412 parts today — a curated subset of the full ~78k-variant catalog. Most variants will have `has_lkq = false` and behavior stays as today.

---

## Pipeline position

```
Step 1   sync-ksi.py              (existing)
Step 2   sync-partslink.py        (existing)
Step 2b  run-lkq-scrape.sh        (DONE — scrape + load lkq_r_stock)
Step 3   build-partslink-master   (existing, unchanged)
Step 4   merge-import-table-v2    (CHANGE — LEFT JOIN lkq_r_stock)
Step 5   import-from-merged.ts    (CHANGE — write KEYSTONE variant_supplier rows)
Step 5b  update-stock-prices.ts   (CHANGE — refresh KEYSTONE cost/qty)
```

---

## Detailed changes

### Change 1 — `scripts/merge-import-table-v2.sql`

Add a dedup CTE and a LEFT JOIN. New columns exposed on `import_ready`:

| Column | Type | Source |
|---|---|---|
| `lkq_part_number` | varchar(15) | `lkq_r_stock.lkq_part_number` |
| `lkq_cost_price` | varchar(10) | `lkq_r_stock.your_price` (cast text to mirror KSI pattern) |
| `lkq_qty` | varchar(10) | `lkq_r_stock.qty` ("2" or "0") |
| `lkq_eta` | date | `lkq_r_stock.eta` (nullable) |
| `has_lkq` | boolean | `(lkq_part_number IS NOT NULL)` |

Additional edits:
- New CTE `lkq_dedup` — `ROW_NUMBER() OVER (PARTITION BY lkq_part_number ORDER BY qty::int DESC NULLS LAST, your_price ASC)` keeps one row per part number.
- LEFT JOIN: `ld.lkq_part_number = pm.plink_cert`.
- Revise `is_quote_only`:
  ```sql
  (
    (kd.ksi_no IS NULL AND ld.lkq_part_number IS NULL)
    OR (
      COALESCE(kd.qty, '0') = '0'
      AND COALESCE(kd.district_quantity, '0') = '0'
      AND COALESCE(ld.qty, '0') = '0'
    )
  )::boolean AS is_quote_only
  ```
- Add `CREATE INDEX idx_ir_has_lkq ON import_ready (has_lkq);`
- Extend the final summary `\echo` block with `with_lkq` counts.

### Change 2 — `src/scripts/import-from-merged.ts`

Load the KEYSTONE supplier once at start, next to KSI.

Extend the `ImportSourceVariant` type with `lkq_part_number`, `lkq_cost_price`, `lkq_qty`, `has_lkq`.

Write a second `variant_supplier` row wherever a KSI row is written. Four code paths affected (approximate line numbers based on existing file):

| Path | File region | What to add |
|---|---|---|
| New product → new variant | ~line 735 | emit KEYSTONE row after KSI row |
| Existing product → new variant | ~line 980 | same |
| Existing product → existing variant | ~line 1165 (UPDATE SQL) | also UPDATE the KEYSTONE row, or INSERT if missing |
| Variant delete | ~line 1446 (DELETE variant_supplier) | already cascade-deletes both — no change |

Rule for each KEYSTONE row:
```ts
{
  supplier_id: keystoneSupplier.id,
  supplier_sku: sourceVariant.lkq_part_number,
  cost_price: parseFloat(sourceVariant.lkq_cost_price) || null,
  stock_qty: parseQty(sourceVariant.lkq_qty),
  is_primary: !sourceVariant.has_ksi,   // KSI wins primary when present; LKQ takes over when alone
}
```

Sell-price branch: today `costPrice = parseFloat(row.cost_price)` is always KSI. Rewrite as:

```ts
const primary = sourceVariant.has_ksi
  ? { cost: parseFloat(row.cost_price), markup: ksiSupplier.default_markup }
  : sourceVariant.has_lkq
    ? { cost: parseFloat(row.lkq_cost_price), markup: keystoneSupplier.default_markup }
    : null

const sellPrice = sourceVariant.is_quote_only || !primary
  ? 0
  : primary.cost > 0 ? calculateSellPrice(primary.cost, primary.markup) : 0
```

This keeps KSI-primary products pricing the same; LKQ-only products now get a real sell price instead of 0.

### Change 3 — ~~`src/scripts/update-stock-prices.ts`~~ (dropped, see Decisions)

### Change 4 — `scripts/PIPELINE.md`

- Insert Step 2b block describing `run-lkq-scrape.sh` (scrape + load), expected run cadence, and the `lkq_r_stock` schema.
- Update Step 4 summary to mention the LKQ LEFT JOIN.
- Update Step 5 and 5b to mention dual-supplier writes.

---

## Verification plan

1. **SQL spot-check** after updated merge:
   ```sql
   SELECT plink, has_ksi, has_lkq, ksi_qty, lkq_qty, cost_price, lkq_cost_price, is_quote_only
   FROM import_ready WHERE plink = 'AC1000211C';
   ```
   Expected: `has_lkq=true, lkq_qty='2', lkq_cost_price='197.78', is_quote_only=false`.

2. **Dry-run import against one SKU**: add a `--only=AC1000211C` guard flag (or temporarily filter in code) and run `import-from-merged`. Verify in Medusa DB:
   ```sql
   SELECT vs.supplier_id, s.code, vs.cost_price, vs.stock_qty, vs.is_primary
   FROM variant_supplier vs
   JOIN supplier s ON s.id = vs.supplier_id
   WHERE vs.variant_id = (SELECT id FROM product_variant WHERE sku = 'AC1000211C');
   ```
   Expected: 2 rows. KSI is_primary=true, KEYSTONE is_primary=false, both with cost_price + stock_qty populated.

3. **Pricing sanity**:
   ```sql
   SELECT pv.sku, p.amount FROM product_variant pv
   JOIN price p ON p.id IN (...)
   WHERE pv.sku = 'AC1000211C';
   ```
   Amount unchanged from pre-change if KSI is present (KSI-primary drives pricing).

4. **LKQ-only case** (find any SKU in `import_ready` where `has_ksi=false AND has_lkq=true`): verify after import the variant is **not** quote-only, KEYSTONE is primary, sell price = lkq_cost × 1.20.

5. **Storefront**: open one affected product on carparts.chimkins.com, confirm price and availability render as expected.

6. **Rollback**: the merge step is idempotent (`DROP TABLE IF EXISTS import_ready`). The import script is idempotent. Reverting all three files and re-running restores pre-change state.

---

## Risks

- **Dual-primary edge case** — if we ever ship a variant with `is_primary=true` on both KSI and KEYSTONE rows, `findPricingSupplier` picks whichever comes first. Mitigation: strictly set `is_primary = !has_ksi` on the KEYSTONE row.
- **Hardcoded LKQ password** — cron-ifying Step 2b is blocked until the password moves to an env var. Not required for this plan; manual runs still work.
- **Stale LKQ data** — `lkq_r_stock.fetched_at` isn't checked at merge time. If LKQ isn't re-scraped before an import, stock shown may be days old. Document the cadence expectation in PIPELINE.md.
- **Stock cap of 2 units** — per decision, LKQ in-stock = 2. Medusa respects `stock_qty` as an inventory bound. If a buyer wants 5 of an LKQ-only part, they'll hit a cap. If that's wrong, bump the constant in `sync-lkq.py` (`IN_STOCK_QTY`).

---

## Decisions (2026-04-23)

### Primary-supplier rule — let `findPricingSupplier` decide

When both suppliers link a variant, `is_primary` is set to **false on both**; Medusa's existing auto-logic picks in-stock → cheapest → highest-stock. When only one supplier exists, `is_primary` stays/goes to true on that one (only candidate anyway).

| Variant state | KSI row | KEYSTONE row |
|---|---|---|
| `has_ksi && has_lkq` | `is_primary=false` (demoted by importer when adding KEYSTONE) | `is_primary=false` |
| `has_ksi && !has_lkq` | `is_primary=true` (unchanged) | — |
| `!has_ksi && has_lkq` | — | `is_primary=true` |

Implication for `import-from-merged.ts`: when we write or update a KEYSTONE row and the variant already has a KSI row with `is_primary=true`, demote the KSI row's `is_primary` to `false` in the same transaction.

### Cadence — weekly scrape, Sunday 06:00 UTC

Runs ~6 hours before the weekly full sync at 12:10 UTC. Scrape expected ~4–5 min for 412 parts; wrapper gets a 10-minute timeout guard.

```
Sun 06:00 UTC  → run-lkq-scrape.sh         (NEW)  scrape + load lkq_r_stock
Sun 11:50 UTC  → sync-ksi.py               (existing)
Sun 12:00 UTC  → sync-partslink.py         (existing)
Sun 12:10 UTC  → run-weekly-full-sync.sh   (existing)  builds master → merge → import
```

Prerequisites (required before enabling cron):
- Move `PASSWORD` in `lkq_bulk_lookup.js` to env var (loaded from `/var/www/arrotti/scripts/.lkq-env`, mode 600).
- Wrap the scrape in `timeout 10m` inside `run-lkq-scrape.sh`.
- Pipe failures through `notify-failure.py` (same pattern used by `run-weekly-full-sync.sh`).

### update-stock-prices.ts scope — **out of scope**

Dropped after reviewing the actual cadence:

- `update-stock-prices.ts` runs Mon–Sat via `run-daily-stock-sync.sh`.
- LKQ is scraped only on Sunday 06:00 UTC. `lkq_r_stock` is identical Mon–Sat.
- The weekly full import (Sun 12:10 UTC) writes the KEYSTONE `variant_supplier` rows once; Mon–Sat updates would touch the same rows with the same values (no-op writes).

So LKQ flows into Medusa exactly once per week via `import-from-merged.ts`. If we ever scrape LKQ more frequently, we'd revisit.

---

## Estimate

| Piece | Effort |
|---|---|
| Change 1 (merge SQL) | 30 min |
| Change 2 (import-from-merged) | 2–3 h (4 write paths + pricing branch + shared helper) |
| Change 3 (update-stock-prices) | 45 min |
| Change 4 (PIPELINE.md) | 20 min |
| Verification (SQL + dry-run + storefront) | 1 h |
| **Total** | **~half a day** |

---

## Commit / merge strategy

Three commits, independently reviewable:

1. `feat(pipeline): join LKQ stock into import_ready` — merge SQL only
2. `feat(import): write KEYSTONE variant_supplier rows alongside KSI` — import + updater + auto-pricing helper
3. `docs(pipeline): document Step 2b LKQ scrape + dual-supplier merge`

---

## Next step

Answer the 3 open questions, then I implement Change 1 first (merge SQL is self-contained and verifiable in isolation before touching the TypeScript).
