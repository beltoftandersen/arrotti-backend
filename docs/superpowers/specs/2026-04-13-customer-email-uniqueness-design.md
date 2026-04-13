# Customer Email Uniqueness — Design

**Date:** 2026-04-13
**Status:** Approved
**Owner:** backend

## Problem

Medusa V2 intentionally does not enforce uniqueness on `customer.email`. The
table can hold many rows for the same email — a guest checkout row, a registered
account row, or duplicates from repeated registration attempts. In this repo we
have already seen three `has_account=true` rows for the same email
(`christian1@chimkins.com`) produced by earlier wholesale signups that did not
dedupe. Only the newest row had a real `provider_identity`; the first two were
ghosts with no way to log in.

The existing `/store/customers/register-wholesale` route now blocks duplicates
by calling `listCustomers({ email })` and returning 409. That protects this one
route, but:

- It is case-sensitive. `Foo@Bar.com` and `foo@bar.com` collide logically but
  not in the lookup.
- A concurrent request can slip through between the SELECT and the INSERT.
- Any future route (admin manual create, new signup flow, script, Medusa's
  built-in `/store/customers`) can re-introduce duplicates.
- A returning guest customer cannot upgrade to a registered account without
  their previous cart/order history being stranded on the guest row.

## Goal

At most **one** `customer` row with `has_account=true` per email (case-insensitive,
excluding soft-deleted rows), enforced at the database. Guest rows
(`has_account=false`) may still duplicate — Medusa's design relies on this and
we do not want to break guest checkout.

## Non-goals

- Deduping historical rows. Production has zero `has_account=true` duplicates
  right now.
- Normalizing existing mixed-case emails already stored. The partial index uses
  `LOWER(email)`, so enforcement works without a backfill.
- Modifying Medusa's built-in `/store/customers` route or the admin customer-
  create flow. The database index is the safety net for those paths.
- Changes to `auth_identity` / `provider_identity` uniqueness. The auth module
  already enforces one identity per `(provider, entity_id)`.

## Design

Defense in depth across two layers.

### Layer 1 — Route-level upgrade-or-block

`POST /store/customers/register-wholesale`
(`src/api/store/customers/register-wholesale/route.ts`) is the only route we own
that creates customer rows. It gets three changes:

1. **Normalize** the inbound email: `email.trim().toLowerCase()` before any
   lookup, insert, or auth-register call. Store the normalized form.
2. **Case-insensitive lookup** for existing rows. Use `listCustomers` with the
   normalized email; if the underlying filter is case-sensitive, pass the
   normalized value (all writes from this route are already normalized, and the
   index uses `LOWER(email)`).
3. **Branch on what was found:**
   - At least one row with `has_account=true` — return **409** with
     `"An account with this email already exists. Please sign in instead."`
     (same copy as today).
   - Exactly one or more rows all with `has_account=false` — **upgrade the first
     one in place**:
     - `updateCustomers(existingId, { first_name, last_name, company_name, phone, email, has_account: true, metadata: {...oldMetadata, ...registrationMetadata} })`
     - Link the new `auth_identity` to the existing `customer_id` (replicate the
       link step that `createCustomerAccountWorkflow` performs).
     - Do **not** create a new customer row.
     - Any other guest rows with the same email are left alone for now — they
       can be purged manually later if needed; the index only constrains
       `has_account=true`.
   - No row — existing path: register auth identity, run
     `createCustomerAccountWorkflow`.

If multiple guest rows exist for the same email (legal per Medusa design), we
pick the oldest by `created_at` and upgrade it. Orders and carts reference
customers by id, so whichever row we upgrade keeps its history; the other guest
rows remain but they cannot block registration.

### Layer 2 — Database partial unique index

Add a Postgres migration creating a partial unique index on the `customer`
table:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  customer_email_has_account_uniq
  ON customer (LOWER(email))
  WHERE has_account = true AND deleted_at IS NULL;
```

- `CONCURRENTLY` avoids locking writes on the live table during creation.
- `IF NOT EXISTS` makes the migration idempotent.
- Scope `has_account = true AND deleted_at IS NULL` lets guests duplicate freely
  and lets soft-deleted rows be ignored (Medusa sets `deleted_at` on delete).

Medusa V2's per-module migration pattern (files under
`src/modules/<name>/migrations/`) does not fit here — we are adding an index to
a core-module table, not a table we own. Two practical options:

- **Preferred:** a one-off Medusa script at
  `src/scripts/add-customer-email-uniqueness-index.ts` executing the DDL via
  the shared Knex/Postgres connection. Runs once during deploy via
  `npx medusa exec src/scripts/add-customer-email-uniqueness-index.ts`. The
  `IF NOT EXISTS` clause makes it safe to re-run.
- **Alternative:** introduce a tiny `customer-constraints` module whose
  `migrations/Migration<ts>.ts` runs the DDL automatically on boot. Heavier
  scaffolding for one index; prefer only if team wants the auto-apply guarantee.

The implementation plan should pick one; default to the script.

**Rollback:** `DROP INDEX IF EXISTS customer_email_has_account_uniq;` (run via
the same mechanism).

## Data flow

```
POST /store/customers/register-wholesale
│
├─ Validate + normalize email
│
├─ customerModule.listCustomers({ email: normalized })
│     │
│     ├─ any row has_account=true?  ── yes ──► 409 "please log in"
│     │
│     ├─ one or more rows all has_account=false?
│     │     └─ register auth → updateCustomers(upgrade) → link auth → 201
│     │
│     └─ no rows?
│           └─ register auth → createCustomerAccountWorkflow → 201
│
└─ (any INSERT of a second has_account=true row for same email fails
    at the partial unique index → caught → 409)
```

## Error handling

| Case | Behavior |
|---|---|
| Registered customer exists (any case) | 409, "please log in" |
| Guest row(s) exist (no registered row) | Upgrade oldest in place; 201; historical cart/order stays attached |
| Race: two signups with same email arrive simultaneously | One wins, the other hits the partial unique index; route catches the error and returns 409 |
| Mixed-case registered row exists (e.g. `Foo@Bar.com` in DB, `foo@bar.com` submitted) | Case-insensitive filter / index finds it → 409 |
| Auth register succeeds but customer create fails | Current behavior unchanged (exception bubbles). Not introducing new orphaning risk. |
| Auth register fails because `provider_identity` already exists | Current behavior unchanged: 409 "please sign in or contact support." |

## Testing

Integration tests against `POST /store/customers/register-wholesale`:

1. **New email** — 201, customer count increases by one.
2. **Existing registered email** — 409, customer count unchanged.
3. **Case-variant registered email** (`FOO@bar.com` in DB, `foo@bar.com`
   submitted) — 409.
4. **Guest row with cart/order** — 201, customer count **unchanged**, row now
   has `has_account=true`, the attached cart and order IDs still reference the
   same customer id.
5. **Concurrent duplicate race** (optional) — two parallel POSTs for the same
   new email; exactly one 201, exactly one 409.

Database-level assertions:

- The partial unique index exists (`\d+ customer` shows it).
- Attempting a second direct `INSERT INTO customer (email, has_account)
  VALUES ('a@b.com', true)` after one is present raises
  `duplicate key value violates unique constraint`.

## Rollout

1. Pre-flight: confirm zero existing `has_account=true` duplicates
   (already verified today — zero).
2. Run migration. `CONCURRENTLY` is safe on the live DB.
3. Deploy route changes.
4. Monitor logs for new 409s and for any `duplicate key value`
   Postgres errors caught in the route handler.

## Open questions

None identified. Proceed to implementation plan.
