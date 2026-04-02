# Quote Inventory Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a customer accepts a quote, automatically add the quoted quantity to the variant's inventory so the order can be fulfilled. When a quote expires or is rejected after acceptance, remove that quantity. Also enable backorders on all existing zero-stock variants as a one-time fix.

**Architecture:** A new subscriber listens for `quote.accepted`, `quote.expired`, and `quote.rejected` events. On acceptance, it looks up the variant's inventory item via the `product_variant_inventory_item` link table, then uses `adjustInventoryLevelsStep` pattern (the `IInventoryService.adjustInventory()` method) to add the quoted quantity to `stocked_quantity`. On expiry/rejection of a previously-accepted quote, it subtracts. The existing `quote-order-cleanup` subscriber already handles the `order.placed` case (status becomes "ordered") — no inventory adjustment needed there because Medusa's `reserve-inventory-step` handles the reservation at checkout.

**Tech Stack:** Medusa V2 workflows/subscribers, IInventoryService, PostgreSQL

---

## Pre-requisite: Understanding the Data Flow

**Quote lifecycle:** `pending` -> `quoted` -> `accepted` -> `ordered` (or `expired`/`rejected`)

**Key tables:**
- `product_variant` — has `variant_id`, `allow_backorder` flag
- `product_variant_inventory_item` — links `variant_id` -> `inventory_item_id`
- `inventory_level` — has `inventory_item_id`, `location_id`, `stocked_quantity`
- Single stock location: `sloc_01KF3BBD2JWJGFJ26R65FSVKHA` ("Arrotti Group")

**Events already emitted:**
- `quote.accepted` — from `src/api/store/quotes/[id]/accept/route.ts:47`
- `quote.expired` — from `src/jobs/expire-quotes.ts:31`
- `quote.rejected` — needs to be checked/added in reject route

**Inventory adjustment API:**
```typescript
const inventoryService = container.resolve(Modules.INVENTORY)
await inventoryService.adjustInventory(inventoryItemId, locationId, adjustment)
// positive = add stock, negative = remove stock
```

---

### Task 1: Enable backorders on all zero-stock variants (one-time SQL fix)

**Files:**
- None (SQL-only operation)

This is a one-time data fix. All 168k+ variants have `manage_inventory = true` and `allow_backorder = false`. Products with 0 stock can never be ordered. Since inventory will now be managed via quote acceptance, we enable backorders as a safety net so orders never get blocked by the inventory check.

- [ ] **Step 1: Run SQL to enable backorders on zero-stock variants**

```bash
cd /var/www/arrotti/my-medusa-store
PGPASSWORD=$(grep DATABASE_URL .env | sed 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/') psql "$(grep DATABASE_URL .env | sed 's/DATABASE_URL=//')" -c "
UPDATE product_variant pv
SET allow_backorder = true
FROM product_variant_inventory_item pvii
JOIN inventory_item ii ON ii.id = pvii.inventory_item_id
JOIN inventory_level il ON il.inventory_item_id = ii.id
WHERE pv.id = pvii.variant_id
  AND il.stocked_quantity = 0
  AND pv.allow_backorder = false;
"
```

Expected: `UPDATE <count>` showing how many rows were updated.

- [ ] **Step 2: Verify the update**

```bash
PGPASSWORD=$(grep DATABASE_URL .env | sed 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/') psql "$(grep DATABASE_URL .env | sed 's/DATABASE_URL=//')" -c "
SELECT
  SUM(CASE WHEN allow_backorder = true THEN 1 ELSE 0 END) as backorder_enabled,
  SUM(CASE WHEN allow_backorder = false THEN 1 ELSE 0 END) as backorder_disabled,
  COUNT(*) as total
FROM product_variant;
"
```

Expected: Most variants now have `backorder_enabled = true`. Variants with stock > 0 may still have `allow_backorder = false` (that's fine — they have stock).

---

### Task 2: Verify the reject route emits `quote.rejected` event

**Files:**
- Check: `src/api/store/quotes/[id]/reject/route.ts`

Before building the subscriber, we need to confirm the reject route emits an event we can subscribe to.

- [ ] **Step 1: Read the reject route**

```bash
cat src/api/store/quotes/[id]/reject/route.ts
```

Check if it emits `quote.rejected` via `eventBus.emit()`. If it does NOT, proceed to Step 2. If it does, skip to Task 3.

- [ ] **Step 2: Add event emission to reject route (only if missing)**

Add after the `respondToQuoteWorkflow` call, same pattern as the accept route (`src/api/store/quotes/[id]/accept/route.ts:46-48`):

```typescript
const eventBus = req.scope.resolve(Modules.EVENT_BUS)
await eventBus.emit({
  name: "quote.rejected",
  data: { id },
})
```

Make sure `Modules` is imported from `@medusajs/framework/utils`.

- [ ] **Step 3: Commit if changes were made**

```bash
git add src/api/store/quotes/[id]/reject/route.ts
git commit -m "feat: emit quote.rejected event from reject route"
```

---

### Task 3: Create the quote inventory subscriber

**Files:**
- Create: `src/subscribers/quote-inventory.ts`

This subscriber adjusts inventory when quotes change status. It adds stock on acceptance and removes it on expiry/rejection (but only if the quote was previously accepted).

- [ ] **Step 1: Create the subscriber file**

Create `src/subscribers/quote-inventory.ts`:

```typescript
import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { QUOTE_MODULE } from "../modules/quote"
import QuoteModuleService from "../modules/quote/service"

type QuoteEventData = {
  id: string
}

const STOCK_LOCATION_ID = "sloc_01KF3BBD2JWJGFJ26R65FSVKHA"

export default async function quoteInventoryHandler({
  event: { data, name },
  container,
}: SubscriberArgs<QuoteEventData>) {
  const logger = container.resolve("logger")
  const quoteService: QuoteModuleService = container.resolve(QUOTE_MODULE)
  const inventoryService = container.resolve(Modules.INVENTORY) as any

  try {
    const [quote] = await quoteService.listQuotes(
      { id: data.id },
      { select: ["id", "variant_id", "quantity", "status"] }
    )

    if (!quote) {
      logger.warn(`[Quote Inventory] Quote ${data.id} not found`)
      return
    }

    if (!quote.variant_id) {
      logger.warn(`[Quote Inventory] Quote ${data.id} has no variant_id, skipping`)
      return
    }

    // Look up the inventory item for this variant
    const inventoryItemId = await getInventoryItemId(container, quote.variant_id)
    if (!inventoryItemId) {
      logger.warn(
        `[Quote Inventory] No inventory item found for variant ${quote.variant_id}, skipping`
      )
      return
    }

    if (name === "quote.accepted") {
      // Add quoted quantity to stocked_quantity
      await inventoryService.adjustInventory(
        inventoryItemId,
        STOCK_LOCATION_ID,
        quote.quantity
      )
      logger.info(
        `[Quote Inventory] Added ${quote.quantity} stock for variant ${quote.variant_id} ` +
          `(inventory item ${inventoryItemId}) — quote ${data.id} accepted`
      )
    }

    if (name === "quote.expired" || name === "quote.rejected") {
      // Only remove stock if the quote was previously accepted
      // For quote.expired: the expire-quotes job changes status from "quoted" or "accepted" to "expired"
      // We only want to adjust inventory if it was accepted (stock was added)
      // BUT: the status has already been changed by the time this subscriber runs.
      // So we can't check quote.status here — it's already "expired"/"rejected".
      //
      // For quote.rejected: the respondToQuoteWorkflow changes status to "rejected"
      // Rejection can only happen from "quoted" status (see reject route validation).
      // A quote in "quoted" status was never accepted, so no inventory was added.
      // Therefore: quote.rejected never needs inventory adjustment.
      //
      // For quote.expired: a quote can expire from "quoted" OR "accepted" status.
      // We need to know if it was accepted before expiring.
      // The accepted_at field tells us: if accepted_at is set, stock was added.

      if (name === "quote.rejected") {
        // Rejected quotes were in "quoted" status — never accepted, no stock to remove
        return
      }

      // For expired quotes, check if it was previously accepted
      const [fullQuote] = await quoteService.listQuotes(
        { id: data.id },
        { select: ["id", "accepted_at"] }
      )

      if (!fullQuote?.accepted_at) {
        // Was never accepted, no stock was added
        logger.info(
          `[Quote Inventory] Quote ${data.id} expired but was never accepted, no inventory adjustment needed`
        )
        return
      }

      // Remove the quoted quantity from stocked_quantity
      await inventoryService.adjustInventory(
        inventoryItemId,
        STOCK_LOCATION_ID,
        -quote.quantity
      )
      logger.info(
        `[Quote Inventory] Removed ${quote.quantity} stock for variant ${quote.variant_id} ` +
          `(inventory item ${inventoryItemId}) — quote ${data.id} expired after acceptance`
      )
    }
  } catch (error) {
    logger.error(
      `[Quote Inventory] Error processing ${name} for quote ${data.id}: ${(error as Error).message}`
    )
  }
}

/**
 * Look up the inventory_item_id for a given variant_id
 * via the product_variant_inventory_item link table.
 */
async function getInventoryItemId(
  container: any,
  variantId: string
): Promise<string | null> {
  try {
    const query = container.resolve("query")
    const { data: links } = await query.graph({
      entity: "product_variant_inventory_item",
      fields: ["inventory_item_id"],
      filters: { variant_id: variantId },
    })
    return links?.[0]?.inventory_item_id || null
  } catch {
    return null
  }
}

export const config: SubscriberConfig = {
  event: ["quote.accepted", "quote.expired", "quote.rejected"],
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd /var/www/arrotti/my-medusa-store
npx tsc --noEmit src/subscribers/quote-inventory.ts 2>&1 || true
```

If there are type errors, fix them. Common issues:
- The `query.graph` entity name for the link table might need to be `"product_variant_inventory_item"` or accessed differently. Check by looking at how other code queries link tables (e.g., in `src/scripts/` files).

- [ ] **Step 3: Commit**

```bash
git add src/subscribers/quote-inventory.ts
git commit -m "feat: adjust inventory on quote acceptance/expiry"
```

---

### Task 4: Update the expire-quotes job to handle accepted quotes

**Files:**
- Modify: `src/jobs/expire-quotes.ts`

The current `getExpiredQuotes()` method needs to be checked — does it include quotes with status "accepted" that have passed their `expires_at` date? If a customer accepts a quote but never places the order before expiry, that accepted quote should expire too, and the inventory should be removed.

- [ ] **Step 1: Check the getExpiredQuotes method**

```bash
# Find the method in the quote service
grep -n "getExpiredQuotes" src/modules/quote/service.ts
```

Read the method to see which statuses it queries. It should include both `"quoted"` and `"accepted"` statuses.

- [ ] **Step 2: Update getExpiredQuotes if needed**

If it only queries `status: "quoted"`, add `"accepted"` to the filter so that accepted-but-not-ordered quotes also expire when past `expires_at`:

Find the status filter (likely something like `{ status: "quoted" }`) and change it to `{ status: ["quoted", "accepted"] }`.

- [ ] **Step 3: Commit if changes were made**

```bash
git add src/modules/quote/service.ts
git commit -m "feat: expire accepted quotes that pass their expiry date"
```

---

### Task 5: Build, restart, and test end-to-end

**Files:**
- None (operational steps)

- [ ] **Step 1: Build the backend**

```bash
cd /var/www/arrotti/my-medusa-store && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Restart the backend service**

```bash
sudo systemctl restart medusa-backend.service
```

- [ ] **Step 3: Wait for startup and check logs**

```bash
sleep 5
sudo journalctl -u medusa-backend.service --since "30 seconds ago" --no-pager | tail -20
```

Expected: No errors, server starts successfully.

- [ ] **Step 4: Test the full quote flow with christian1@chimkins.com**

1. Create a new quote in the admin for a product
2. Send the quote with a price
3. Log in as christian1@chimkins.com on the B2B storefront
4. Accept the quote
5. Check the logs for the inventory adjustment message:
   ```bash
   sudo journalctl -u medusa-backend.service --since "2 minutes ago" --no-pager | grep "Quote Inventory"
   ```
6. Verify inventory was added:
   ```bash
   PGPASSWORD=$(grep DATABASE_URL .env | sed 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/') psql "$(grep DATABASE_URL .env | sed 's/DATABASE_URL=//')" -c "
   SELECT il.stocked_quantity, il.reserved_quantity, ii.sku
   FROM inventory_level il
   JOIN inventory_item ii ON ii.id = il.inventory_item_id
   JOIN product_variant_inventory_item pvii ON pvii.inventory_item_id = ii.id
   WHERE pvii.variant_id = '<THE_VARIANT_ID>';
   "
   ```
7. Add quote to cart and complete checkout — should succeed now
8. Verify the order was created and quote status changed to "ordered"

- [ ] **Step 5: Verify the existing failing quote also works now**

The original failing cart `cart_01KN6ZQ81VPSAFR2RNC1JFB2WC` had variant `variant_01KJZ47C817MGAKQB25JRG6KVN` (SKU: AU1260104) with 0 stock. After Task 1 enabled backorders, this should now work even without the inventory adjustment (backorder is the safety net). Have the customer retry checkout.
