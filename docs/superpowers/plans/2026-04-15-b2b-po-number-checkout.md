# B2B PO Number Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture an optional PO number during B2B checkout, persist it on the order, transfer it to the QuickBooks invoice's native P.O. Number CustomField (with PrivateNote fallback), and surface it in the order confirmation email and customer account order-detail page.

**Architecture:** Store on `order.metadata.po_number` (via cart metadata which Medusa V2 auto-copies). A new backend resolver detects the QBO tenant's PO CustomField DefinitionId at runtime (Preferences endpoint first, recent-Invoice scan fallback, cached in-process). Invoice creator passes `poNumber` + resolved DefinitionId into the existing `createInvoice` call; when no DefinitionId is available, PO is appended to PrivateNote so the invoice still lands. Storefront adds an input on the review step with debounced `updateCart({ metadata: { po_number } })`.

**Tech Stack:** Medusa V2, Next.js 15 React 19, TypeScript, Jest (with SWC transpiler). QBO REST API v3.

**Spec:** `docs/superpowers/specs/2026-04-15-b2b-po-number-checkout-design.md`

**Repos in play:**
- Backend: `/var/www/arrotti/my-medusa-store` (remote `origin: git@github.com:beltoftandersen/arrotti-backend.git`, branch `main`)
- B2B storefront: `/var/www/arrotti/my-medusa-store-storefront-b2b` (remote `origin: git@github.com:beltoftandersen/arrotti-b2b.git`, branch `main`)

---

## File Structure (locked up-front)

### New files
- `my-medusa-store/src/lib/qbo-po-field.ts` — resolver for the PO CustomField DefinitionId (Preferences → recent Invoice fallback → null; in-process cache).
- `my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts` — unit tests for the resolver.

### Backend files modified
- `my-medusa-store/src/lib/qbo-invoice.ts` — extend `InvoiceInput` with `poNumber` + `poCustomFieldDefinitionId`; `createInvoice` emits `CustomField` block or appends `PO: …` to `PrivateNote`.
- `my-medusa-store/src/lib/qbo-invoice-creator.ts` — read `order.metadata.po_number`, call resolver once per invoice, pass both through `invoicePayload`.
- `my-medusa-store/src/subscribers/order-confirmation.ts` — render `PO Number` row when present (HTML + text).

### B2B storefront files modified
- `my-medusa-store-storefront-b2b/src/modules/checkout/components/review/index.tsx` — new PO input with debounced save + flush-on-submit.
- `my-medusa-store-storefront-b2b/src/modules/order/components/order-details/index.tsx` — render PO column when present (used by both the order confirmation page and the account order-detail page).

### B2B storefront files *unchanged* (already sufficient)
- `my-medusa-store-storefront-b2b/src/lib/data/cart.ts` — `updateCart({ metadata: { po_number } })` already works via the existing `updateCart(data: HttpTypes.StoreUpdateCart)` at line 112.

---

## Task 1: qbo-po-field.ts skeleton — returns null when Preferences empty

**Files:**
- Create: `my-medusa-store/src/lib/qbo-po-field.ts`
- Test: `my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts`

Run from: `cd /var/www/arrotti/my-medusa-store`

- [ ] **Step 1: Write the failing test**

```typescript
// my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts
import { resolvePoCustomFieldDefinitionId, __clearPoFieldCacheForTests } from "../qbo-po-field"
import type { QboClient } from "../qbo-client"

type QueuedResponse = unknown | Error

class FakeQboClient {
  public queries: string[] = []
  constructor(private queryResponses: QueuedResponse[] = []) {}
  async query<T>(q: string): Promise<T> {
    this.queries.push(q)
    const next = this.queryResponses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  async post(): Promise<never> { throw new Error("post not used by qbo-po-field") }
  async get(): Promise<never> { throw new Error("get not used by qbo-po-field") }
}

const asClient = (fake: FakeQboClient) => fake as unknown as QboClient

beforeEach(() => __clearPoFieldCacheForTests())

describe("resolvePoCustomFieldDefinitionId", () => {
  it("returns null when Preferences has no CustomField entries and no recent invoices", async () => {
    const fake = new FakeQboClient([
      { QueryResponse: { Preferences: [{ SalesFormsPrefs: {} }] } },
      { QueryResponse: {} }, // Invoice fallback — empty
    ])
    const result = await resolvePoCustomFieldDefinitionId(asClient(fake))
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: FAIL — cannot find module `../qbo-po-field`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// my-medusa-store/src/lib/qbo-po-field.ts
import { QboClient } from "./qbo-client"

const cache = new Map<symbol, string | null>()
const CACHE_KEY = Symbol.for("qbo-po-field-definitionId")

/** Test-only: clear the in-process cache between tests. */
export function __clearPoFieldCacheForTests(): void {
  cache.clear()
}

export async function resolvePoCustomFieldDefinitionId(
  _client: QboClient
): Promise<string | null> {
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-po-field.ts src/lib/__tests__/qbo-po-field.unit.spec.ts
git commit -m "test(qbo): stub qbo-po-field resolver (null when no definitions)"
```

---

## Task 2: Resolve DefinitionId from Preferences.SalesFormsPrefs.CustomField

**Files:**
- Modify: `my-medusa-store/src/lib/qbo-po-field.ts`
- Modify: `my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `qbo-po-field.unit.spec.ts` inside the `describe` block:

```typescript
it("returns DefinitionId from Preferences.SalesFormsPrefs.CustomField by name", async () => {
  const fake = new FakeQboClient([
    {
      QueryResponse: {
        Preferences: [
          {
            SalesFormsPrefs: {
              CustomField: [
                {
                  CustomField: [
                    { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
                    { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "P.O. Number" },
                    { Name: "SalesFormsPrefs.UseSalesCustom2", Type: "BooleanType", BooleanValue: false },
                    { Name: "SalesFormsPrefs.SalesCustomName2", Type: "StringType", StringValue: "" },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  ])
  const result = await resolvePoCustomFieldDefinitionId(asClient(fake))
  expect(result).toBe("1")
  expect(fake.queries[0]).toContain("FROM Preferences")
})
```

**Note on shape:** QBO's Preferences entity nests CustomField twice (the outer `CustomField` is a wrapper, the inner `CustomField` is the actual list). Each name-value row is a separate entry with names like `SalesFormsPrefs.SalesCustomName1/2/3` and matching `SalesFormsPrefs.UseSalesCustom1/2/3` booleans. The resolver infers the slot number (1/2/3) from the `SalesCustomNameN` whose value matches and returns `String(N)` as the DefinitionId — QBO uses `"1"`, `"2"`, `"3"` as the three sales-form DefinitionIds in CustomField requests on transactions.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: FAIL — returns `null`, expected `"1"`.

- [ ] **Step 3: Implement Preferences lookup**

Replace the body of `resolvePoCustomFieldDefinitionId` in `qbo-po-field.ts`:

```typescript
const PO_FIELD_NAME_ALIASES = ["p.o. number", "po number", "purchase order number", "po"]

type PreferencesResponse = {
  QueryResponse?: {
    Preferences?: Array<{
      SalesFormsPrefs?: {
        CustomField?: Array<{
          CustomField?: Array<{
            Name?: string
            Type?: string
            BooleanValue?: boolean
            StringValue?: string
          }>
        }>
      }
    }>
  }
}

function normalizeName(name: string | undefined): string {
  return (name || "").trim().toLowerCase()
}

async function resolveFromPreferences(client: QboClient): Promise<string | null> {
  const response = await client.query<PreferencesResponse>("SELECT * FROM Preferences")
  const entries =
    response.QueryResponse?.Preferences?.[0]?.SalesFormsPrefs?.CustomField?.[0]?.CustomField ?? []

  // Map each SalesCustomNameN → N, and each UseSalesCustomN → boolean
  const slotNames = new Map<number, string>() // slot → label
  const slotEnabled = new Map<number, boolean>() // slot → enabled
  for (const entry of entries) {
    const name = entry.Name || ""
    const nameMatch = name.match(/^SalesFormsPrefs\.SalesCustomName(\d+)$/)
    if (nameMatch) {
      slotNames.set(Number(nameMatch[1]), entry.StringValue || "")
      continue
    }
    const useMatch = name.match(/^SalesFormsPrefs\.UseSalesCustom(\d+)$/)
    if (useMatch) {
      slotEnabled.set(Number(useMatch[1]), entry.BooleanValue === true)
    }
  }

  for (const [slot, label] of slotNames) {
    if (slotEnabled.get(slot) === false) continue
    if (PO_FIELD_NAME_ALIASES.includes(normalizeName(label))) {
      return String(slot)
    }
  }
  return null
}

export async function resolvePoCustomFieldDefinitionId(
  client: QboClient
): Promise<string | null> {
  const fromPrefs = await resolveFromPreferences(client)
  return fromPrefs
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-po-field.ts src/lib/__tests__/qbo-po-field.unit.spec.ts
git commit -m "feat(qbo): resolve PO CustomField DefinitionId from Preferences"
```

---

## Task 3: Case-insensitive + alias name matching

**Files:**
- Modify: `my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts`

(Implementation from Task 2 already handles this — we're only adding tests to lock the behavior.)

- [ ] **Step 1: Write the failing test**

Add inside the `describe` block:

```typescript
it.each([
  ["PO Number", "1"],
  ["  purchase order number  ", "1"],
  ["PO", "1"],
  ["p.o. number", "1"],
])("matches alias %j case-insensitively", async (label, expected) => {
  const fake = new FakeQboClient([
    {
      QueryResponse: {
        Preferences: [
          {
            SalesFormsPrefs: {
              CustomField: [
                {
                  CustomField: [
                    { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
                    { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: label },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  ])
  expect(await resolvePoCustomFieldDefinitionId(asClient(fake))).toBe(expected)
})

it("ignores disabled slots even if the name matches", async () => {
  const fake = new FakeQboClient([
    {
      QueryResponse: {
        Preferences: [
          {
            SalesFormsPrefs: {
              CustomField: [
                {
                  CustomField: [
                    { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: false },
                    { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "PO Number" },
                    { Name: "SalesFormsPrefs.UseSalesCustom2", Type: "BooleanType", BooleanValue: true },
                    { Name: "SalesFormsPrefs.SalesCustomName2", Type: "StringType", StringValue: "Department" },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  ])
  expect(await resolvePoCustomFieldDefinitionId(asClient(fake))).toBeNull()
})
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: PASS — 6 tests.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/qbo-po-field.unit.spec.ts
git commit -m "test(qbo): lock alias + disabled-slot matching for PO resolver"
```

---

## Task 4: In-process cache

**Files:**
- Modify: `my-medusa-store/src/lib/qbo-po-field.ts`
- Modify: `my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe` block:

```typescript
it("caches the result across calls (single network query)", async () => {
  const prefsResponse = {
    QueryResponse: {
      Preferences: [
        {
          SalesFormsPrefs: {
            CustomField: [
              {
                CustomField: [
                  { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
                  { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "PO Number" },
                ],
              },
            ],
          },
        },
      ],
    },
  }
  const fake = new FakeQboClient([prefsResponse, prefsResponse])
  const first = await resolvePoCustomFieldDefinitionId(asClient(fake))
  const second = await resolvePoCustomFieldDefinitionId(asClient(fake))
  expect(first).toBe("1")
  expect(second).toBe("1")
  expect(fake.queries.length).toBe(1)
})
```

- [ ] **Step 2: Run test (expect fail — second call also queries)**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: FAIL — `queries.length` is `2`.

- [ ] **Step 3: Wire the cache**

Modify `resolvePoCustomFieldDefinitionId` in `qbo-po-field.ts`:

```typescript
export async function resolvePoCustomFieldDefinitionId(
  client: QboClient
): Promise<string | null> {
  if (cache.has(CACHE_KEY)) {
    return cache.get(CACHE_KEY) ?? null
  }
  const fromPrefs = await resolveFromPreferences(client)
  cache.set(CACHE_KEY, fromPrefs)
  return fromPrefs
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-po-field.ts src/lib/__tests__/qbo-po-field.unit.spec.ts
git commit -m "feat(qbo): cache PO CustomField DefinitionId in-process"
```

---

## Task 5: Fallback — scan recent Invoices when Preferences returns nothing

**Files:**
- Modify: `my-medusa-store/src/lib/qbo-po-field.ts`
- Modify: `my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe` block:

```typescript
it("falls back to scanning recent invoices when Preferences has no match", async () => {
  const fake = new FakeQboClient([
    // Preferences — no PO slot enabled
    {
      QueryResponse: {
        Preferences: [{ SalesFormsPrefs: { CustomField: [{ CustomField: [] }] } }],
      },
    },
    // Invoice scan — a recent invoice carries a PO CustomField
    {
      QueryResponse: {
        Invoice: [
          {
            Id: "999",
            CustomField: [
              { DefinitionId: "2", Name: "PO Number", Type: "StringType", StringValue: "ABC-1" },
            ],
          },
        ],
      },
    },
  ])
  const result = await resolvePoCustomFieldDefinitionId(asClient(fake))
  expect(result).toBe("2")
  expect(fake.queries[1]).toContain("FROM Invoice")
})

it("returns null when neither Preferences nor recent invoices carry a PO field", async () => {
  const fake = new FakeQboClient([
    { QueryResponse: { Preferences: [{ SalesFormsPrefs: { CustomField: [{ CustomField: [] }] } }] } },
    { QueryResponse: { Invoice: [{ Id: "999", CustomField: [] }] } },
  ])
  expect(await resolvePoCustomFieldDefinitionId(asClient(fake))).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify both fail**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: both FAIL — resolver currently only checks Preferences.

- [ ] **Step 3: Implement the fallback**

Add below `resolveFromPreferences` in `qbo-po-field.ts`:

```typescript
type InvoiceScanResponse = {
  QueryResponse?: {
    Invoice?: Array<{
      CustomField?: Array<{
        DefinitionId?: string
        Name?: string
      }>
    }>
  }
}

async function resolveFromRecentInvoices(client: QboClient): Promise<string | null> {
  const response = await client.query<InvoiceScanResponse>(
    "SELECT Id, CustomField FROM Invoice ORDERBY MetaData.CreateTime DESC MAXRESULTS 20"
  )
  const invoices = response.QueryResponse?.Invoice ?? []
  for (const inv of invoices) {
    for (const cf of inv.CustomField ?? []) {
      if (cf.DefinitionId && PO_FIELD_NAME_ALIASES.includes(normalizeName(cf.Name))) {
        return cf.DefinitionId
      }
    }
  }
  return null
}
```

Update `resolvePoCustomFieldDefinitionId` to chain the fallback:

```typescript
export async function resolvePoCustomFieldDefinitionId(
  client: QboClient
): Promise<string | null> {
  if (cache.has(CACHE_KEY)) {
    return cache.get(CACHE_KEY) ?? null
  }
  const fromPrefs = await resolveFromPreferences(client)
  if (fromPrefs) {
    cache.set(CACHE_KEY, fromPrefs)
    return fromPrefs
  }
  const fromInvoices = await resolveFromRecentInvoices(client)
  cache.set(CACHE_KEY, fromInvoices)
  return fromInvoices
}
```

- [ ] **Step 4: Run tests**

```bash
npm run test:unit -- --testPathPattern=qbo-po-field
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-po-field.ts src/lib/__tests__/qbo-po-field.unit.spec.ts
git commit -m "feat(qbo): fallback to recent-invoice scan for PO CustomField"
```

---

## Task 6: Extend `InvoiceInput` + `createInvoice` — emit CustomField block

**Files:**
- Modify: `my-medusa-store/src/lib/qbo-invoice.ts`

- [ ] **Step 1: Extend the type**

In `my-medusa-store/src/lib/qbo-invoice.ts`, find the `export type InvoiceInput = {` block and add these two optional fields alongside `shippingItemRef`:

```typescript
  /** Customer PO number to stamp on the invoice. */
  poNumber?: string
  /** DefinitionId for the QBO CustomField that backs the tenant's P.O. Number box. Null/undefined = no CustomField written; falls back to PrivateNote. */
  poCustomFieldDefinitionId?: string | null
```

- [ ] **Step 2: Emit CustomField when both are present**

In `createInvoice` (same file), locate the `invoiceData` object build block (after `const invoiceData: Record<string, unknown> = { ... CustomerRef, TxnDate, Line, PrivateNote, GlobalTaxCalculation ... }`) and add right after `invoiceData.PrivateNote = …` — actually it's already set inline, so add below the `if (input.docNumber)` block:

```typescript
  // PO number — prefer the native CustomField when the tenant has it enabled;
  // otherwise fall back to prepending "PO: <value>" onto PrivateNote so the
  // information is still on the invoice for bookkeeping.
  const poNumber = input.poNumber?.trim()
  if (poNumber) {
    if (input.poCustomFieldDefinitionId) {
      invoiceData.CustomField = [
        {
          DefinitionId: input.poCustomFieldDefinitionId,
          Type: "StringType",
          StringValue: poNumber.slice(0, 30),
        },
      ]
    } else {
      invoiceData.PrivateNote = `PO: ${poNumber} | ${invoiceData.PrivateNote as string}`
    }
  }
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/qbo-invoice.ts
git commit -m "feat(qbo): accept poNumber + DefinitionId on InvoiceInput, emit CustomField"
```

---

## Task 7: Wire resolver + metadata read into `qbo-invoice-creator.ts`

**Files:**
- Modify: `my-medusa-store/src/lib/qbo-invoice-creator.ts`

- [ ] **Step 1: Import the resolver**

At the top of `qbo-invoice-creator.ts`, alongside the other `./qbo-*` imports, add:

```typescript
import { resolvePoCustomFieldDefinitionId } from "./qbo-po-field"
```

- [ ] **Step 2: Read PO + resolve DefinitionId once per invoice**

Inside `createQboInvoiceForOrder`, after the `invStartDate` line and before the `const items = order.items || []` line, add:

```typescript
  // Read optional PO number stamped on the order at checkout.
  const poNumber = (() => {
    const raw = (order as any).metadata?.po_number
    if (typeof raw !== "string") return undefined
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed.slice(0, 30) : undefined
  })()

  // Resolve the tenant's PO CustomField DefinitionId lazily (cached).
  let poCustomFieldDefinitionId: string | null = null
  if (poNumber) {
    try {
      poCustomFieldDefinitionId = await resolvePoCustomFieldDefinitionId(client)
      if (!poCustomFieldDefinitionId) {
        logger.warn(
          `[QBO Invoice] PO "${poNumber}" on order ${orderNumber}: no P.O. Number CustomField detected in QBO — falling back to PrivateNote. Enable the P.O. Number custom field in QBO Company Settings → Sales → Custom fields on sales forms.`
        )
      }
    } catch (err) {
      logger.warn(
        `[QBO Invoice] Failed to resolve PO CustomField DefinitionId: ${(err as Error).message} — falling back to PrivateNote`
      )
    }
  }
```

- [ ] **Step 3: Pass through to the invoice payload**

Find the `const invoicePayload = {` block and add the two new fields right after `shippingItemRef`:

```typescript
    shippingItemRef,
    poNumber,
    poCustomFieldDefinitionId,
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0.

- [ ] **Step 5: Run existing unit tests to make sure nothing broke**

```bash
npm run test:unit
```

Expected: PASS — 27 tests (18 existing + 9 new qbo-po-field).

- [ ] **Step 6: Commit**

```bash
git add src/lib/qbo-invoice-creator.ts
git commit -m "feat(qbo): read order.metadata.po_number and stamp on QBO invoice"
```

---

## Task 8: Order confirmation email — render `PO Number` row when present

**Files:**
- Modify: `my-medusa-store/src/subscribers/order-confirmation.ts`

- [ ] **Step 1: Derive the value once at the top of the handler**

In `orderConfirmationHandler`, after `const shippingMethods = order.shipping_methods ?? []`, add:

```typescript
    const poNumber = (() => {
      const raw = (order.metadata as any)?.po_number
      if (typeof raw !== "string") return undefined
      const trimmed = raw.trim()
      return trimmed.length > 0 ? trimmed : undefined
    })()
```

- [ ] **Step 2: Add HTML row**

Locate the div block that renders Order Number and Order Date:

```jsx
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="margin: 0;"><strong>Order Number:</strong> #${order.display_id || order.id}</p>
```

Insert a PO row before the Order Number line:

```typescript
          ${poNumber ? `<p style="margin: 0 0 8px;"><strong>PO Number:</strong> ${h(poNumber)}</p>` : ""}
```

The final block becomes:

```typescript
        <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          ${poNumber ? `<p style="margin: 0 0 8px;"><strong>PO Number:</strong> ${h(poNumber)}</p>` : ""}
          <p style="margin: 0;"><strong>Order Number:</strong> #${order.display_id || order.id}</p>
          <p style="margin: 8px 0 0;"><strong>Order Date:</strong> ${new Date(order.created_at).toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
          })}</p>
        </div>
```

- [ ] **Step 3: Add plain-text rows (two places: pickup + shipping template strings)**

In both text templates (pickup and shipping branches of the `const text = isPickup ? \`...\` : \`...\`` assignment), find the `Order Number: #…` line and insert a PO row above it:

```
${poNumber ? `PO Number: ${poNumber}\n` : ""}Order Number: #${order.display_id || order.id}
```

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add src/subscribers/order-confirmation.ts
git commit -m "feat(email): show PO Number on order confirmation when present"
```

---

## Task 9: B2B storefront review step — add PO input

**Files:**
- Modify: `my-medusa-store-storefront-b2b/src/modules/checkout/components/review/index.tsx`

Run from: `cd /var/www/arrotti/my-medusa-store-storefront-b2b`

- [ ] **Step 1: Read the current file**

```bash
cat src/modules/checkout/components/review/index.tsx
```

Identify where the "Place Order" button is rendered. The PO input will go in the same panel, just above the button.

- [ ] **Step 2: Add the PO input with debounced save**

At the top of the file (with the existing imports), ensure these imports exist (add only what's missing):

```typescript
import { useEffect, useRef, useState } from "react"
import { updateCart } from "@lib/data/cart"
import { Input } from "@medusajs/ui"
```

Inside the component body, after existing `useState` hooks and before the `return`, add:

```typescript
  const initialPoNumber =
    typeof (cart as any)?.metadata?.po_number === "string"
      ? ((cart as any).metadata.po_number as string)
      : ""
  const [poNumber, setPoNumber] = useState<string>(initialPoNumber)
  const pendingPoSaveRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedPoRef = useRef<string>(initialPoNumber)

  // 30-char cap and permissive character whitelist (alphanumerics + - _ / . space).
  const sanitizePoNumber = (raw: string): string =>
    raw.replace(/[^A-Za-z0-9\-_/.\s]/g, "").slice(0, 30)

  const persistPoNumber = async (value: string) => {
    if (value === lastSavedPoRef.current) return
    lastSavedPoRef.current = value
    try {
      await updateCart({ metadata: { po_number: value } } as any)
    } catch {
      // Non-blocking: checkout continues even if metadata save fails transiently.
    }
  }

  // Flush pending save on unmount so a quick Place Order click doesn't drop the last keystroke.
  useEffect(() => {
    return () => {
      if (pendingPoSaveRef.current) {
        clearTimeout(pendingPoSaveRef.current)
        void persistPoNumber(poNumber)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poNumber])

  const onPoChange = (raw: string) => {
    const value = sanitizePoNumber(raw)
    setPoNumber(value)
    if (pendingPoSaveRef.current) clearTimeout(pendingPoSaveRef.current)
    pendingPoSaveRef.current = setTimeout(() => {
      pendingPoSaveRef.current = null
      void persistPoNumber(value)
    }, 400)
  }
```

Then, directly above the Place Order button (inside the same container), render:

```tsx
      <div className="mb-4">
        <label
          htmlFor="po-number"
          className="block text-sm font-medium text-ui-fg-base mb-1"
        >
          PO Number (optional)
        </label>
        <Input
          id="po-number"
          name="po-number"
          value={poNumber}
          placeholder="e.g. PO-12345"
          maxLength={30}
          onChange={(e) => onPoChange(e.target.value)}
          data-testid="po-number-input"
        />
      </div>
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/modules/checkout/components/review/index.tsx
git commit -m "feat(b2b-checkout): capture optional PO number on review step"
```

---

## Task 10: B2B order-details component — render PO when present

**Files:**
- Modify: `my-medusa-store-storefront-b2b/src/modules/order/components/order-details/index.tsx`

- [ ] **Step 1: Add a PO cell to the metadata grid**

Find the grid block:

```tsx
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 py-4 px-4 bg-gray-50 rounded-lg">
        <div>
          <Text className="text-xs text-gray-400 uppercase tracking-wide">Order date</Text>
          <Text className="text-sm font-medium text-gray-900 mt-1" data-testid="order-date">
            {new Date(order.created_at).toDateString()}
          </Text>
        </div>
        <div>
          <Text className="text-xs text-gray-400 uppercase tracking-wide">Order number</Text>
          <Text className="text-sm font-medium text-gray-900 mt-1" data-testid="order-id">
            #{order.display_id}
          </Text>
        </div>
```

Insert a PO cell right after the Order number cell (only rendered when set):

```tsx
        {typeof (order.metadata as any)?.po_number === "string" &&
        ((order.metadata as any).po_number as string).trim() !== "" ? (
          <div>
            <Text className="text-xs text-gray-400 uppercase tracking-wide">PO number</Text>
            <Text
              className="text-sm font-medium text-gray-900 mt-1"
              data-testid="order-po-number"
            >
              {(order.metadata as any).po_number}
            </Text>
          </div>
        ) : null}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/modules/order/components/order-details/index.tsx
git commit -m "feat(b2b-order): show PO number on order detail when present"
```

---

## Task 11: Build + restart + push both repos

- [ ] **Step 1: Backend build**

```bash
cd /var/www/arrotti/my-medusa-store
npm run build
```

Expected: `Backend build completed successfully` + `Frontend build completed successfully`.

- [ ] **Step 2: B2B storefront build**

```bash
cd /var/www/arrotti/my-medusa-store-storefront-b2b
npm run build
```

Expected: Next.js build report, no errors.

- [ ] **Step 3: Restart services**

```bash
sudo systemctl restart medusa-backend.service medusa-storefront-b2b.service
sleep 8
curl -s -o /dev/null -w "backend=%{http_code}\n" http://localhost:9002/health
curl -s -o /dev/null -w "b2b=%{http_code}\n" http://localhost:8002/
```

Expected: both return `200`.

- [ ] **Step 4: Push backend**

```bash
cd /var/www/arrotti/my-medusa-store
git push origin main
```

- [ ] **Step 5: Push B2B storefront**

```bash
cd /var/www/arrotti/my-medusa-store-storefront-b2b
git push origin main
```

---

## Task 12: Manual QA

- [ ] **Scenario 1 — B2B order with PO**
  - Place a B2B order at `https://arrottigroup.com`. At the review step, enter PO `QA-PO-001`.
  - Complete the order (use Check or Stripe).
  - Confirm order confirmation email shows `PO Number: QA-PO-001` above the order number row.
  - Open the order in the customer account at `/account/orders/details/<id>` and confirm a `PO number: QA-PO-001` cell appears in the metadata grid.
  - Open the corresponding invoice in QBO UI and confirm the native P.O. Number box reads `QA-PO-001`. **If instead the PO appears in the invoice's "Message displayed on statement" private note, check `journalctl -u medusa-backend.service --since '5 minutes ago' | grep 'PO Number CustomField'`** — that warning tells you the custom field isn't enabled in QBO Company Settings → Sales → Custom fields on sales forms. Enabling it + recreating the invoice via the admin widget should then route the PO to the native box.

- [ ] **Scenario 2 — B2B order without PO**
  - Place a B2B order and leave the PO field empty.
  - Confirm email has no PO Number row.
  - Confirm account order detail has no PO cell.
  - Confirm QBO invoice has no PO and no `PO: …` prefix on PrivateNote.

- [ ] **Scenario 3 — 30-char cap**
  - On the review step, try pasting a 100-character string into the PO input. Confirm it's truncated to 30 characters in the input.

- [ ] **Scenario 4 — Admin edit + invoice recreate**
  - For a placed order, edit `metadata.po_number` via the admin Order API (e.g. `PATCH /admin/orders/<id>` with `{ "metadata": { "po_number": "QA-PO-EDITED" } }`).
  - Click "Recreate QBO invoice" in the admin widget.
  - Confirm the new invoice in QBO has `QA-PO-EDITED` in the P.O. Number box.

---

## Self-Review

**Spec coverage (section → task):**
- Storage on `order.metadata.po_number` → Tasks 9 (storefront writes), Task 7 (backend reads). ✓
- Review step UI (input, 30 chars, whitelist, debounce, refresh-persist) → Task 9. ✓
- Order confirmation email (HTML + text) → Task 8. ✓
- Account order-detail page → Task 10. ✓
- QBO CustomField mapping (resolver) → Tasks 1–5. ✓
- Preferences + recent-Invoice fallback → Tasks 2, 5. ✓
- In-process cache → Task 4. ✓
- PrivateNote fallback + one-time warning → Tasks 6, 7. ✓
- Admin editability via metadata API (no new widget) → Task 12 Scenario 4 (verification only, no code change). ✓
- 30-char truncation server-side → Task 6 (slice(0,30) in createInvoice) and Task 7 (slice(0,30) on read). ✓
- Unit tests → Tasks 1–5. ✓

**Placeholder scan:** no "TBD"/"TODO"/"appropriate"/"handle edge cases" language. All code blocks complete.

**Type consistency:** `poNumber: string` + `poCustomFieldDefinitionId: string | null` used identically across `qbo-invoice.ts` (Task 6), `qbo-invoice-creator.ts` (Task 7), and the resolver (returns `string | null`). `updateCart({ metadata: { po_number } })` shape matches `HttpTypes.StoreUpdateCart.metadata?: Record<string, unknown>`.

**Scope:** single feature, no decomposition needed.

---

## Rollback

Each task is a single commit. To back out the feature cleanly:

```bash
# Backend
cd /var/www/arrotti/my-medusa-store
git revert --no-edit <task-11-commit>..HEAD   # or specific commits
# B2B storefront
cd /var/www/arrotti/my-medusa-store-storefront-b2b
git revert --no-edit <relevant-commits>
```
