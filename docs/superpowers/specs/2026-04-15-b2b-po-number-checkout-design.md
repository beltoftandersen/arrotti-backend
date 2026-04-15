# B2B PO Number Capture at Checkout → QuickBooks Invoice

**Date:** 2026-04-15
**Status:** Design approved, awaiting implementation plan
**Scope:** B2B storefront (`my-medusa-store-storefront-b2b`) + backend (`my-medusa-store`). B2C out of scope.

## Problem

B2B buyers routinely reference an internal purchase order (PO) number for accounting and audit. Today:
- The storefront captures no PO during checkout.
- The QBO invoice has no customer PO on it, so AP clerks have to match invoices to POs manually.
- Order confirmation emails and customer account order-detail pages have no PO shown even if one existed.

## Goals

1. Capture an optional PO number during B2B checkout.
2. Persist it on the order.
3. Transfer it to the QuickBooks Online invoice's native **P.O. Number** field (the CustomField backing the QBO UI's PO box).
4. Display it in the order confirmation email and the customer's account order-detail page when present.
5. Allow admin edits post-order via standard Medusa order metadata API; existing "Recreate QBO invoice" picks up the change.

## Non-Goals

- B2C storefront changes.
- Required-PO enforcement (all customers or per-customer). Optional for all today; revisit later if needed.
- A dedicated admin UI widget for editing the PO.
- Searching / filtering orders by PO in admin.
- Migrating historical orders.

## Storage

Shape on both cart and order: `metadata.po_number: string` (trimmed, max 30 chars to match QBO's CustomField `StringValue` limit).

- Cart metadata is automatically copied to order metadata by Medusa V2 on `completeCart`. No custom subscriber or link needed.
- Empty / whitespace-only PO is not stored (no empty strings written).
- Matches the existing `order.metadata.payment_terms_days` and `order.metadata.qbo_invoice` conventions.

Rejected alternatives:
- **Dedicated Medusa data model** (new module + table + link) — gives typed columns and searchability, but overkill for a single string.
- **Billing address custom field** — no real advantage.

## UI — B2B Checkout Review Step

File: `my-medusa-store-storefront-b2b/src/modules/checkout/components/review/` (located exactly at impl time).

- Single labeled text input above the Place Order button: **"PO Number (optional)"**.
- Placeholder: `e.g. PO-12345`.
- Max length: 30 characters.
- Character whitelist: alphanumerics plus `-`, `_`, `/`, `.`, space.
- Debounced (~400 ms) update via a new `updateCartMetadata(cart.id, { po_number })` helper in `src/lib/data/cart.ts` that calls `POST /store/carts/:id` with `{ metadata: { po_number } }`.
- Initial value seeded from `cart.metadata.po_number` so refresh / back-navigation preserves input.

## UI — Order Confirmation Email

File: `my-medusa-store/src/subscribers/order-confirmation.ts`.

- When `order.metadata.po_number` is present, add one line `PO Number: <value>` above the Order Number row in both the HTML and plain-text versions. HTML-escaped.

## UI — B2B Account Order-Detail Page

File: `my-medusa-store-storefront-b2b/src/modules/account/components/...` (exact path at impl time).

- If `order.metadata.po_number` is present, render a small "PO Number" label + value next to the Order Number in the order-detail header block.

## QuickBooks Invoice Mapping

### Background (source: developer.intuit.com)

The QBO Invoice entity has **no native `PONumber` attribute**. The "P.O. Number" box on the QBO web UI invoice is backed by a built-in **CustomField** on the Invoice (one of the three system CustomField slots QBO allocates per tenant). Transferring a PO means writing to `Invoice.CustomField[]` with the correct `DefinitionId`.

### Resolving the DefinitionId

New helper: `my-medusa-store/src/lib/qbo-po-field.ts` exporting

```
async function resolvePoCustomFieldDefinitionId(client: QboClient): Promise<string | null>
```

Behavior:
- Queries QBO's `/preferences` endpoint. `Preferences.SalesFormsPrefs.CustomField` lists the three default Invoice CustomFields with their `Name` and a DefinitionId-like identifier.
- Returns the identifier of the entry whose `Name`, case-insensitively trimmed, matches one of: `P.O. Number`, `PO Number`, `Purchase Order Number`, `PO`.
- Returns `null` if no match.
- Result cached in-process in a `Map` identical to the pattern in `qbo-accounts.ts` (cleared on server restart).

### Wiring into invoice creation

Changes in `my-medusa-store/src/lib/qbo-invoice.ts`:

- Extend `InvoiceInput` with two optional fields:
  - `poNumber?: string`
  - `poCustomFieldDefinitionId?: string | null`
- In `createInvoice`: if both are truthy, add
  `CustomField: [{ DefinitionId, Type: "StringType", StringValue: poNumber }]`
  to the invoice payload.
- If `poNumber` is present but `poCustomFieldDefinitionId` is null, append `PO: <poNumber>` to `PrivateNote` and log one warning per boot so the operator knows to enable the custom field in QBO.

Changes in `my-medusa-store/src/lib/qbo-invoice-creator.ts`:

- Read `order.metadata.po_number` after loading the order graph.
- Call `resolvePoCustomFieldDefinitionId(client)` once per invoice.
- Pass both into the `InvoiceInput`.

### Retry / error handling

- CustomField payload errors are handled by the existing duplicate-retry loop already in the creator; the final retry falls back to no CustomField + PrivateNote to ensure the invoice still lands.
- PO > 30 chars is blocked in the UI; server-side safety truncates to 30 and logs if ever exceeded (belt-and-braces).

## Admin Editability

No new admin UI.

- Admins edit `order.metadata.po_number` via the existing Medusa core admin API.
- "Recreate QBO invoice" (already present on the order widget) re-runs the invoice path which reads the updated metadata.

## Testing

### Unit
- `my-medusa-store/src/lib/__tests__/qbo-po-field.unit.spec.ts` — mocked `QboClient`:
  - Returns DefinitionId when Preferences lists `P.O. Number`.
  - Returns DefinitionId when Preferences lists `Purchase Order Number` (alias).
  - Returns DefinitionId case-insensitively.
  - Returns `null` when no match.
  - Caches — two invocations share one network call.

### Manual QA
- B2B order placed **with** a PO → confirm QBO invoice shows PO in the native P.O. Number box, email shows PO, account page shows PO.
- B2B order placed **without** a PO → no PO in QBO, no PO row in email, no PO label in account.
- PO > 30 chars → blocked in the UI.
- Admin edits `metadata.po_number` → "Recreate QBO invoice" → new PO reflected in QBO.
- PO custom field **not** enabled in QBO tenant → PO captured, invoice lands with PO in PrivateNote + warning in logs.

## Files Touched

Backend (`my-medusa-store`):
- `src/lib/qbo-po-field.ts` (new)
- `src/lib/qbo-invoice.ts` (add optional inputs)
- `src/lib/qbo-invoice-creator.ts` (read metadata, resolve DefinitionId, pass through)
- `src/lib/__tests__/qbo-po-field.unit.spec.ts` (new)
- `src/subscribers/order-confirmation.ts` (render PO line)

B2B storefront (`my-medusa-store-storefront-b2b`):
- `src/lib/data/cart.ts` (add `updateCartMetadata` helper)
- `src/modules/checkout/components/review/...` (add PO input)
- `src/modules/account/components/.../order-detail…` (render PO when present)

## Risks

- **MEDIUM — QBO Preferences API shape uncertainty:** The exact key path for the three built-in Invoice CustomFields under `Preferences.SalesFormsPrefs` isn't documented with full JSON examples for V2 REST. The implementation plan must verify the real shape against the live tenant before wiring `resolvePoCustomFieldDefinitionId`. If the shape is unusable, fallback strategy is to query an existing QBO-UI-created invoice and read its `CustomField[].Name` / `DefinitionId`.
- **MEDIUM — Custom field must be enabled in QBO UI:** If the tenant never enabled a P.O. Number custom field, the resolver returns null and the PO lands in PrivateNote only. Mitigated by logged warning.
- **LOW — Debounced cart update races on place-order click:** If the customer clicks Place Order during the 400 ms debounce, the last PO keystroke may not have been persisted. Mitigated by flushing pending updates on submit.
- **LOW — Searching orders by PO not supported.** Out of scope per goals.

## Estimated Complexity: LOW–MEDIUM

- Backend: ~1.5 h
- B2B storefront: ~1.5 h
- Tests + QA: ~1 h
- Total: ~4 h
