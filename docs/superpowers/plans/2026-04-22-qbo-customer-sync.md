# QuickBooks Customer Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `src/lib/qbo-customer.ts` from a find-or-create-by-email integration into a proper upsert that (a) persists the QBO customer Id on the Medusa customer, (b) writes both billing and shipping addresses, (c) updates drifted fields via sparse POST with `SyncToken` reconciliation, and (d) prevents duplicate customer creation under concurrency via a Redis lock keyed on email.

**Architecture:** Three-layer lookup chain inside a Redis `SET NX PX` lock:

1. **Stored QBO Id** — `customer.metadata.qbo_customer_id` (Medusa customer). Fetched via `SELECT * FROM Customer WHERE Id = 'X'` (QBO query API).
2. **Email** — `SELECT * FROM Customer WHERE PrimaryEmailAddr = '…'`.
3. **Create** — fresh `POST /customer` with both `BillAddr` and `ShipAddr`.

When an existing QBO customer is found, a diff helper (`buildCustomerUpdatePatch`) compares desired vs actual fields and emits a sparse patch body (`{Id, SyncToken, sparse: true, …changed}`). If QBO rejects with Fault code `5010` (Stale Object), we re-query for the fresh `SyncToken` and retry once.

The returned QBO customer Id is written back onto the Medusa customer via `customerService.updateCustomers([{id, metadata: {...existing, qbo_customer_id}}])`, so subsequent orders skip the email query.

**Tech Stack:** Medusa V2 (2.12.x), TypeScript/Node 20, QuickBooks Online v3 API (OAuth 2.0 via `QboConnection` module), `ioredis` (already present transitively through `@medusajs/caching-redis`, pinned directly in this plan), Jest + `@swc/jest` unit tests using the existing `FakeQboClient` pattern from `src/lib/__tests__/qbo-item.unit.spec.ts`.

**Working directory:** `/var/www/arrotti/my-medusa-store`

**Pre-existing uncommitted state (do NOT include in your commits):** `src/modules/shipstation/service.ts` has unrelated modifications; `.env.backup-1776191407` is untracked. Create the feature branch from `origin/main`, not from the current working tree.

**Scope:** Subsystems 1–4 (stored ID, both addresses, sparse upsert, dedup lock). Sub-customers for multi-ship-to (B2B) and QBO→Medusa webhook reverse sync are explicitly OUT of scope for this plan.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/lib/qbo-customer.ts` | Modify | All customer read/write ops. Add `SyncToken` + `CompanyName` to `QboCustomer` type, add `getCustomerById`, add `shippingAddress` to `CustomerInput`, add `buildCustomerUpdatePatch` diff helper, add `updateCustomer` with stale-token retry, rename `findOrCreateCustomer` → `upsertCustomer` with stored-Id priority. |
| `src/lib/__tests__/qbo-customer.unit.spec.ts` | Create | Full unit coverage for every function in `qbo-customer.ts` using a `FakeQboClient` mirroring the `qbo-item.unit.spec.ts` style. |
| `src/lib/qbo-lock.ts` | Create | `withCustomerLock(email, fn)` Redis `SET key NX PX` mutex with automatic release; ~60 lines, no external deps beyond `ioredis`. |
| `src/lib/__tests__/qbo-lock.unit.spec.ts` | Create | Mocks `ioredis` via dependency-injected factory; tests acquire/release, contention, and ttl-expiry paths. |
| `src/lib/qbo-invoice-creator.ts` | Modify | Pass `billing_address` and `shipping_address` separately into `upsertCustomer`, wrap the call in `withCustomerLock`, resolve `order.customer.metadata.qbo_customer_id` up front, persist the returned QBO Id back to `customer.metadata` after success. |
| `src/scripts/backfill-qbo-customer-ids.ts` | Create | One-off script: for every Medusa customer that already has an order with `metadata.qbo_invoice`, query QBO by email, stamp `qbo_customer_id` into `customer.metadata`. Reports duplicates. Run via `npx medusa exec`. |
| `package.json` | Modify | Add `ioredis` to `dependencies` (currently only transitive). |

---

## Task 1: Feature branch

**Files:** none (git only)

- [ ] **Step 1: Create and check out a feature branch from latest main**

```bash
cd /var/www/arrotti/my-medusa-store
git fetch origin
git checkout -b feat/qbo-customer-sync origin/main
```

Expected: `Switched to a new branch 'feat/qbo-customer-sync'` with a clean working tree (the pre-existing `shipstation/service.ts` diff stays on whatever branch you left).

- [ ] **Step 2: Verify clean starting state**

```bash
git status --short
```

Expected: no output (or only the untracked `.env.backup-*` which we ignore). If any other files show up, stop and investigate — they don't belong on this branch.

---

## Task 2: Pin `ioredis` as a direct dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Check the version currently resolved via caching-redis**

```bash
npm ls ioredis --all | head
```

Record the version shown (e.g., `ioredis@5.4.2`).

- [ ] **Step 2: Add it as a direct dep at the same major**

```bash
npm install ioredis@^5
```

- [ ] **Step 3: Verify install**

```bash
grep '"ioredis"' package.json
```

Expected: `"ioredis": "^5.x.x"` listed under `"dependencies"`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(backend): pin ioredis as direct dep for qbo customer lock"
```

---

## Task 3: Baseline unit tests locking in current `qbo-customer.ts` behavior

**Files:**
- Create: `src/lib/__tests__/qbo-customer.unit.spec.ts`
- Test: same file

Rationale: before refactoring, capture the existing contract so we can refactor with confidence. These three tests describe the file as it exists today.

- [ ] **Step 1: Write the baseline spec**

Create `/var/www/arrotti/my-medusa-store/src/lib/__tests__/qbo-customer.unit.spec.ts`:

```ts
import {
  findCustomerByEmail,
  createCustomer,
  findOrCreateCustomer,
} from "../qbo-customer"
import type { QboClient } from "../qbo-client"

type QueuedResponse = unknown | Error

class FakeQboClient {
  public queries: string[] = []
  public posts: Array<{ endpoint: string; body: any }> = []
  public gets: Array<{ endpoint: string; params?: Record<string, string> }> = []

  constructor(
    private queryResponses: QueuedResponse[] = [],
    private postResponses: QueuedResponse[] = [],
    private getResponses: QueuedResponse[] = []
  ) {}

  async query<T>(q: string): Promise<T> {
    this.queries.push(q)
    const next = this.queryResponses.shift()
    if (next instanceof Error) throw next
    return next as T
  }

  async post<T>(endpoint: string, body: any): Promise<T> {
    this.posts.push({ endpoint, body })
    const next = this.postResponses.shift()
    if (next instanceof Error) throw next
    return next as T
  }

  async get<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    this.gets.push({ endpoint, params })
    const next = this.getResponses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
}

const asClient = (fake: FakeQboClient) => fake as unknown as QboClient

describe("findCustomerByEmail", () => {
  it("returns the first customer when the query matches", async () => {
    const fake = new FakeQboClient([
      {
        QueryResponse: {
          Customer: [
            { Id: "7", DisplayName: "Jane", PrimaryEmailAddr: { Address: "jane@example.com" } },
          ],
        },
      },
    ])
    const result = await findCustomerByEmail(asClient(fake), "jane@example.com")
    expect(result?.Id).toBe("7")
    expect(fake.queries[0]).toContain("PrimaryEmailAddr = 'jane@example.com'")
  })

  it("returns null when no customer matches", async () => {
    const fake = new FakeQboClient([{ QueryResponse: {} }])
    const result = await findCustomerByEmail(asClient(fake), "nobody@example.com")
    expect(result).toBeNull()
  })

  it("escapes single quotes in the email", async () => {
    const fake = new FakeQboClient([{ QueryResponse: {} }])
    await findCustomerByEmail(asClient(fake), "o'brien@example.com")
    expect(fake.queries[0]).toContain("o\\'brien@example.com")
  })
})

describe("createCustomer", () => {
  it("posts display name, email, billing address, and phone when provided", async () => {
    const fake = new FakeQboClient([], [{ Customer: { Id: "42", DisplayName: "J D (j@d.com)" } }])
    const result = await createCustomer(asClient(fake), {
      email: "j@d.com",
      firstName: "J",
      lastName: "D",
      phone: "+1-555-0100",
      billingAddress: {
        address_1: "1 Main St",
        city: "Austin",
        province: "TX",
        postal_code: "78701",
        country_code: "us",
      },
    })
    expect(result.Id).toBe("42")
    const body = fake.posts[0].body
    expect(body.DisplayName).toBe("J D (j@d.com)")
    expect(body.PrimaryEmailAddr).toEqual({ Address: "j@d.com" })
    expect(body.GivenName).toBe("J")
    expect(body.FamilyName).toBe("D")
    expect(body.PrimaryPhone).toEqual({ FreeFormNumber: "+1-555-0100" })
    expect(body.BillAddr).toEqual({
      Line1: "1 Main St",
      City: "Austin",
      CountrySubDivisionCode: "TX",
      PostalCode: "78701",
      Country: "us",
    })
  })

  it("falls back to email as DisplayName when no name is given", async () => {
    const fake = new FakeQboClient([], [{ Customer: { Id: "1", DisplayName: "a@b.com" } }])
    await createCustomer(asClient(fake), { email: "a@b.com" })
    expect(fake.posts[0].body.DisplayName).toBe("a@b.com")
    expect(fake.posts[0].body.GivenName).toBeUndefined()
  })
})

describe("findOrCreateCustomer (baseline)", () => {
  it("returns the existing customer without a POST when email matches", async () => {
    const fake = new FakeQboClient([
      { QueryResponse: { Customer: [{ Id: "9", DisplayName: "Existing" }] } },
    ])
    const result = await findOrCreateCustomer(asClient(fake), { email: "x@y.com" })
    expect(result.Id).toBe("9")
    expect(fake.posts).toHaveLength(0)
  })

  it("creates when email does not match", async () => {
    const fake = new FakeQboClient(
      [{ QueryResponse: {} }],
      [{ Customer: { Id: "10", DisplayName: "x@y.com" } }]
    )
    const result = await findOrCreateCustomer(asClient(fake), { email: "x@y.com" })
    expect(result.Id).toBe("10")
    expect(fake.posts).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the baseline tests**

```bash
npm run test:unit -- qbo-customer
```

Expected: all three describe blocks pass (3–7 individual tests, all green).

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/qbo-customer.unit.spec.ts
git commit -m "test(qbo): baseline unit coverage for customer find/create"
```

---

## Task 4: Extend `QboCustomer` type and add `getCustomerById`

**Files:**
- Modify: `src/lib/qbo-customer.ts`
- Test: `src/lib/__tests__/qbo-customer.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/__tests__/qbo-customer.unit.spec.ts`:

```ts
import { getCustomerById } from "../qbo-customer"

describe("getCustomerById", () => {
  it("queries by Id and returns the customer with SyncToken", async () => {
    const fake = new FakeQboClient([
      {
        QueryResponse: {
          Customer: [
            {
              Id: "42",
              SyncToken: "3",
              DisplayName: "Jane",
              PrimaryEmailAddr: { Address: "j@e.com" },
            },
          ],
        },
      },
    ])
    const result = await getCustomerById(asClient(fake), "42")
    expect(result?.Id).toBe("42")
    expect(result?.SyncToken).toBe("3")
    expect(fake.queries[0]).toContain("FROM Customer WHERE Id = '42'")
  })

  it("returns null when the Id is not found", async () => {
    const fake = new FakeQboClient([{ QueryResponse: {} }])
    const result = await getCustomerById(asClient(fake), "999")
    expect(result).toBeNull()
  })

  it("escapes single quotes in the Id", async () => {
    const fake = new FakeQboClient([{ QueryResponse: {} }])
    await getCustomerById(asClient(fake), "a'b")
    expect(fake.queries[0]).toContain("Id = 'a\\'b'")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- qbo-customer
```

Expected: FAIL with `getCustomerById is not a function` or a module-export error.

- [ ] **Step 3: Implement `getCustomerById` and extend the type**

Edit `/var/www/arrotti/my-medusa-store/src/lib/qbo-customer.ts`. Replace the top `QboCustomer` type and add the function. The file should start like:

```ts
/**
 * QuickBooks Online Customer Operations
 */

import { QboClient } from "./qbo-client"

export type QboAddress = {
  Line1?: string
  City?: string
  CountrySubDivisionCode?: string
  PostalCode?: string
  Country?: string
}

export type QboCustomer = {
  Id: string
  SyncToken?: string
  DisplayName: string
  CompanyName?: string
  PrimaryEmailAddr?: { Address: string }
  BillAddr?: QboAddress
  ShipAddr?: QboAddress
  PrimaryPhone?: { FreeFormNumber: string }
  GivenName?: string
  FamilyName?: string
}

type QboQueryResponse = {
  QueryResponse: {
    Customer?: QboCustomer[]
    maxResults?: number
  }
}

type QboCustomerResponse = {
  Customer: QboCustomer
}
```

Then add `getCustomerById` immediately after `findCustomerByEmail`:

```ts
/**
 * Fetch a customer in QuickBooks by its QBO Id.
 * Returns null if the Id does not exist (e.g. the customer was deleted in QBO).
 */
export async function getCustomerById(
  client: QboClient,
  id: string
): Promise<QboCustomer | null> {
  const query = `SELECT * FROM Customer WHERE Id = '${id.replace(/'/g, "\\'")}'`

  const response = await client.query<QboQueryResponse>(query)

  if (response.QueryResponse.Customer && response.QueryResponse.Customer.length > 0) {
    return response.QueryResponse.Customer[0]
  }

  return null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:unit -- qbo-customer
```

Expected: all tests pass (baseline + 3 new `getCustomerById` tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-customer.ts src/lib/__tests__/qbo-customer.unit.spec.ts
git commit -m "feat(qbo): add getCustomerById and SyncToken on QboCustomer type"
```

---

## Task 5: Add `shippingAddress` to `CustomerInput` and write `ShipAddr` on create

**Files:**
- Modify: `src/lib/qbo-customer.ts`
- Test: `src/lib/__tests__/qbo-customer.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe("createCustomer", …)` block in `qbo-customer.unit.spec.ts`:

```ts
  it("posts ShipAddr when shippingAddress is provided", async () => {
    const fake = new FakeQboClient([], [{ Customer: { Id: "77", DisplayName: "x" } }])
    await createCustomer(asClient(fake), {
      email: "x@y.com",
      shippingAddress: {
        address_1: "500 Ship Ln",
        city: "Dallas",
        province: "TX",
        postal_code: "75001",
        country_code: "us",
      },
    })
    const body = fake.posts[0].body
    expect(body.ShipAddr).toEqual({
      Line1: "500 Ship Ln",
      City: "Dallas",
      CountrySubDivisionCode: "TX",
      PostalCode: "75001",
      Country: "us",
    })
  })

  it("omits ShipAddr when shippingAddress is not provided", async () => {
    const fake = new FakeQboClient([], [{ Customer: { Id: "78", DisplayName: "x" } }])
    await createCustomer(asClient(fake), {
      email: "x@y.com",
      billingAddress: { address_1: "1 Bill St", city: "Austin", province: "TX", postal_code: "78701", country_code: "us" },
    })
    expect(fake.posts[0].body.ShipAddr).toBeUndefined()
    expect(fake.posts[0].body.BillAddr).toBeDefined()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- qbo-customer
```

Expected: FAIL — `CustomerInput` rejects `shippingAddress` (TS error) or `ShipAddr` is undefined.

- [ ] **Step 3: Extend `CustomerInput` and `createCustomer`**

In `src/lib/qbo-customer.ts`, replace the `CustomerInput` type and update `createCustomer`:

```ts
export type AddressInput = {
  address_1?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
}

export type CustomerInput = {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  companyName?: string
  billingAddress?: AddressInput
  shippingAddress?: AddressInput
}

function toQboAddress(input: AddressInput): QboAddress {
  return {
    Line1: input.address_1,
    City: input.city,
    CountrySubDivisionCode: input.province,
    PostalCode: input.postal_code,
    Country: input.country_code,
  }
}
```

Then inside `createCustomer`, after the existing `BillAddr` block, add:

```ts
  if (input.shippingAddress) {
    customerData.ShipAddr = toQboAddress(input.shippingAddress)
  }

  if (input.companyName) {
    customerData.CompanyName = input.companyName
  }
```

And replace the existing `BillAddr` block with:

```ts
  if (input.billingAddress) {
    customerData.BillAddr = toQboAddress(input.billingAddress)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:unit -- qbo-customer
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-customer.ts src/lib/__tests__/qbo-customer.unit.spec.ts
git commit -m "feat(qbo): write ShipAddr and CompanyName on customer create"
```

---

## Task 6: Add `buildCustomerUpdatePatch` diff helper

**Files:**
- Modify: `src/lib/qbo-customer.ts`
- Test: `src/lib/__tests__/qbo-customer.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `qbo-customer.unit.spec.ts`:

```ts
import { buildCustomerUpdatePatch } from "../qbo-customer"

describe("buildCustomerUpdatePatch", () => {
  const base = {
    Id: "42",
    SyncToken: "3",
    DisplayName: "Jane D (j@e.com)",
    PrimaryEmailAddr: { Address: "j@e.com" },
    GivenName: "Jane",
    FamilyName: "D",
    PrimaryPhone: { FreeFormNumber: "555-0100" },
    BillAddr: { Line1: "1 A St", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701", Country: "us" },
    ShipAddr: { Line1: "1 A St", City: "Austin", CountrySubDivisionCode: "TX", PostalCode: "78701", Country: "us" },
  }

  it("returns null when nothing has changed", () => {
    const patch = buildCustomerUpdatePatch(base, {
      email: "j@e.com",
      firstName: "Jane",
      lastName: "D",
      phone: "555-0100",
      billingAddress: { address_1: "1 A St", city: "Austin", province: "TX", postal_code: "78701", country_code: "us" },
      shippingAddress: { address_1: "1 A St", city: "Austin", province: "TX", postal_code: "78701", country_code: "us" },
    })
    expect(patch).toBeNull()
  })

  it("includes only changed fields plus Id+SyncToken+sparse", () => {
    const patch = buildCustomerUpdatePatch(base, {
      email: "j@e.com",
      firstName: "Jane",
      lastName: "D",
      phone: "555-9999", // changed
      billingAddress: { address_1: "1 A St", city: "Austin", province: "TX", postal_code: "78701", country_code: "us" },
    })
    expect(patch).toEqual({
      Id: "42",
      SyncToken: "3",
      sparse: true,
      PrimaryPhone: { FreeFormNumber: "555-9999" },
    })
  })

  it("emits BillAddr when any billing sub-field changes", () => {
    const patch = buildCustomerUpdatePatch(base, {
      email: "j@e.com",
      firstName: "Jane",
      lastName: "D",
      phone: "555-0100",
      billingAddress: { address_1: "2 B St", city: "Austin", province: "TX", postal_code: "78701", country_code: "us" },
    })
    expect(patch).not.toBeNull()
    expect(patch!.BillAddr).toEqual({
      Line1: "2 B St",
      City: "Austin",
      CountrySubDivisionCode: "TX",
      PostalCode: "78701",
      Country: "us",
    })
    expect(patch!.ShipAddr).toBeUndefined()
  })

  it("emits ShipAddr when shipping_address is newly provided and existing had none", () => {
    const existing = { ...base, ShipAddr: undefined }
    const patch = buildCustomerUpdatePatch(existing, {
      email: "j@e.com",
      firstName: "Jane",
      lastName: "D",
      phone: "555-0100",
      billingAddress: { address_1: "1 A St", city: "Austin", province: "TX", postal_code: "78701", country_code: "us" },
      shippingAddress: { address_1: "9 S St", city: "Dallas", province: "TX", postal_code: "75001", country_code: "us" },
    })
    expect(patch?.ShipAddr).toBeDefined()
    expect(patch!.ShipAddr!.Line1).toBe("9 S St")
  })

  it("does not emit a field when input omits it (no clobber of existing value)", () => {
    const patch = buildCustomerUpdatePatch(base, {
      email: "j@e.com",
      // firstName, lastName, phone, addresses omitted — treat as "no opinion"
    })
    expect(patch).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- qbo-customer
```

Expected: FAIL with `buildCustomerUpdatePatch is not exported`.

- [ ] **Step 3: Implement the diff helper**

Append to `src/lib/qbo-customer.ts`:

```ts
export type QboCustomerUpdatePatch = {
  Id: string
  SyncToken: string
  sparse: true
  GivenName?: string
  FamilyName?: string
  CompanyName?: string
  PrimaryPhone?: { FreeFormNumber: string }
  BillAddr?: QboAddress
  ShipAddr?: QboAddress
}

function addressEquals(a: QboAddress | undefined, b: QboAddress | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (
    (a.Line1 ?? "") === (b.Line1 ?? "") &&
    (a.City ?? "") === (b.City ?? "") &&
    (a.CountrySubDivisionCode ?? "") === (b.CountrySubDivisionCode ?? "") &&
    (a.PostalCode ?? "") === (b.PostalCode ?? "") &&
    (a.Country ?? "") === (b.Country ?? "")
  )
}

/**
 * Compare an existing QBO customer against a desired CustomerInput and return
 * a sparse update patch — or null if nothing changed.
 *
 * Fields omitted from `desired` are treated as "no opinion" and NEVER clobber
 * an existing value in QBO. This matches how checkout normally works: a
 * returning customer whose order didn't include, say, a phone, shouldn't wipe
 * the phone on file in QBO.
 */
export function buildCustomerUpdatePatch(
  existing: QboCustomer,
  desired: CustomerInput
): QboCustomerUpdatePatch | null {
  if (!existing.SyncToken) return null

  const patch: QboCustomerUpdatePatch = {
    Id: existing.Id,
    SyncToken: existing.SyncToken,
    sparse: true,
  }
  let changed = false

  if (desired.firstName !== undefined && desired.firstName !== existing.GivenName) {
    patch.GivenName = desired.firstName
    changed = true
  }
  if (desired.lastName !== undefined && desired.lastName !== existing.FamilyName) {
    patch.FamilyName = desired.lastName
    changed = true
  }
  if (desired.companyName !== undefined && desired.companyName !== existing.CompanyName) {
    patch.CompanyName = desired.companyName
    changed = true
  }
  if (
    desired.phone !== undefined &&
    desired.phone !== existing.PrimaryPhone?.FreeFormNumber
  ) {
    patch.PrimaryPhone = { FreeFormNumber: desired.phone }
    changed = true
  }
  if (desired.billingAddress) {
    const newAddr = toQboAddress(desired.billingAddress)
    if (!addressEquals(existing.BillAddr, newAddr)) {
      patch.BillAddr = newAddr
      changed = true
    }
  }
  if (desired.shippingAddress) {
    const newAddr = toQboAddress(desired.shippingAddress)
    if (!addressEquals(existing.ShipAddr, newAddr)) {
      patch.ShipAddr = newAddr
      changed = true
    }
  }

  return changed ? patch : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:unit -- qbo-customer
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-customer.ts src/lib/__tests__/qbo-customer.unit.spec.ts
git commit -m "feat(qbo): add buildCustomerUpdatePatch diff helper"
```

---

## Task 7: Add `updateCustomer` with stale-SyncToken retry

**Files:**
- Modify: `src/lib/qbo-customer.ts`
- Test: `src/lib/__tests__/qbo-customer.unit.spec.ts`

Context: QBO rejects a sparse update with a 400 Fault code `5010` ("Stale Object Update") when the `SyncToken` is not the current one. Standard recovery is a single retry after re-fetching the fresh token.

- [ ] **Step 1: Write the failing tests**

Append to `qbo-customer.unit.spec.ts`:

```ts
import { updateCustomer, QboStaleSyncTokenError } from "../qbo-customer"

describe("updateCustomer", () => {
  it("posts the patch and returns the updated customer", async () => {
    const fake = new FakeQboClient(
      [],
      [{ Customer: { Id: "42", SyncToken: "4", DisplayName: "x" } }]
    )
    const patch = { Id: "42", SyncToken: "3", sparse: true as const, GivenName: "Jane" }
    const result = await updateCustomer(asClient(fake), patch)
    expect(result.Id).toBe("42")
    expect(result.SyncToken).toBe("4")
    expect(fake.posts[0].endpoint).toBe("customer")
    expect(fake.posts[0].body).toEqual(patch)
  })

  it("retries once when QBO returns Fault 5010 (stale SyncToken)", async () => {
    const staleFault = {
      Fault: {
        Error: [{ code: "5010", Message: "Stale Object Update" }],
        type: "ValidationFault",
      },
    }
    const fake = new FakeQboClient(
      // re-query for fresh token:
      [
        {
          QueryResponse: {
            Customer: [{ Id: "42", SyncToken: "5", DisplayName: "x" }],
          },
        },
      ],
      [
        staleFault, // first attempt: stale
        { Customer: { Id: "42", SyncToken: "6", DisplayName: "x" } }, // retry succeeds
      ]
    )
    const patch = { Id: "42", SyncToken: "3", sparse: true as const, GivenName: "Jane" }
    const result = await updateCustomer(asClient(fake), patch)
    expect(result.SyncToken).toBe("6")
    expect(fake.posts).toHaveLength(2)
    // second attempt must use the fresh token
    expect(fake.posts[1].body.SyncToken).toBe("5")
  })

  it("throws QboStaleSyncTokenError if the retry also fails stale", async () => {
    const staleFault = {
      Fault: { Error: [{ code: "5010", Message: "Stale" }], type: "ValidationFault" },
    }
    const fake = new FakeQboClient(
      [{ QueryResponse: { Customer: [{ Id: "42", SyncToken: "5", DisplayName: "x" }] } }],
      [staleFault, staleFault]
    )
    const patch = { Id: "42", SyncToken: "3", sparse: true as const, GivenName: "Jane" }
    await expect(updateCustomer(asClient(fake), patch)).rejects.toBeInstanceOf(
      QboStaleSyncTokenError
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- qbo-customer
```

Expected: FAIL — `updateCustomer`/`QboStaleSyncTokenError` not exported.

- [ ] **Step 3: Implement `updateCustomer` and `QboStaleSyncTokenError`**

Append to `src/lib/qbo-customer.ts`:

```ts
export class QboStaleSyncTokenError extends Error {
  constructor(customerId: string) {
    super(`QBO customer ${customerId} still stale after one retry`)
    this.name = "QboStaleSyncTokenError"
  }
}

type QboFaultResponse = {
  Fault?: {
    Error?: Array<{ code?: string; Message?: string }>
    type?: string
  }
}

function isStaleFault(resp: unknown): boolean {
  const f = (resp as QboFaultResponse)?.Fault
  return !!f?.Error?.some((e) => e.code === "5010")
}

/**
 * Sparse-update a QBO customer. Retries once on Fault 5010 (stale SyncToken)
 * after re-querying for the fresh token.
 */
export async function updateCustomer(
  client: QboClient,
  patch: QboCustomerUpdatePatch
): Promise<QboCustomer> {
  const firstResp = await client.post<QboCustomerResponse | QboFaultResponse>(
    "customer",
    patch
  )
  if (!isStaleFault(firstResp)) {
    return (firstResp as QboCustomerResponse).Customer
  }

  // Stale — re-query for the fresh SyncToken and retry once.
  const fresh = await getCustomerById(client, patch.Id)
  if (!fresh || !fresh.SyncToken) {
    throw new QboStaleSyncTokenError(patch.Id)
  }
  const retryPatch = { ...patch, SyncToken: fresh.SyncToken }
  const secondResp = await client.post<QboCustomerResponse | QboFaultResponse>(
    "customer",
    retryPatch
  )
  if (isStaleFault(secondResp)) {
    throw new QboStaleSyncTokenError(patch.Id)
  }
  return (secondResp as QboCustomerResponse).Customer
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:unit -- qbo-customer
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-customer.ts src/lib/__tests__/qbo-customer.unit.spec.ts
git commit -m "feat(qbo): add updateCustomer with stale SyncToken retry"
```

---

## Task 8: Replace `findOrCreateCustomer` with `upsertCustomer`

**Files:**
- Modify: `src/lib/qbo-customer.ts`
- Test: `src/lib/__tests__/qbo-customer.unit.spec.ts`

New function `upsertCustomer` supersedes `findOrCreateCustomer`. Lookup priority: stored Id → email → create. When an existing customer is found and the patch is non-empty, also update.

- [ ] **Step 1: Write the failing tests**

Append to `qbo-customer.unit.spec.ts`:

```ts
import { upsertCustomer } from "../qbo-customer"

describe("upsertCustomer", () => {
  it("looks up by stored Id first and returns without update when nothing changed", async () => {
    const fake = new FakeQboClient([
      {
        QueryResponse: {
          Customer: [
            {
              Id: "42",
              SyncToken: "3",
              DisplayName: "x",
              PrimaryEmailAddr: { Address: "j@e.com" },
              GivenName: "Jane",
              FamilyName: "D",
            },
          ],
        },
      },
    ])
    const result = await upsertCustomer(asClient(fake), {
      email: "j@e.com",
      firstName: "Jane",
      lastName: "D",
      qboCustomerId: "42",
    })
    expect(result.Id).toBe("42")
    expect(fake.queries[0]).toContain("Id = '42'")
    expect(fake.posts).toHaveLength(0)
  })

  it("updates an existing customer when fields differ", async () => {
    const fake = new FakeQboClient(
      [
        {
          QueryResponse: {
            Customer: [
              {
                Id: "42",
                SyncToken: "3",
                DisplayName: "x",
                PrimaryEmailAddr: { Address: "j@e.com" },
                GivenName: "Jane",
                FamilyName: "OldName",
              },
            ],
          },
        },
      ],
      [{ Customer: { Id: "42", SyncToken: "4", DisplayName: "x" } }]
    )
    const result = await upsertCustomer(asClient(fake), {
      email: "j@e.com",
      firstName: "Jane",
      lastName: "NewName",
      qboCustomerId: "42",
    })
    expect(result.SyncToken).toBe("4")
    expect(fake.posts[0].body.FamilyName).toBe("NewName")
    expect(fake.posts[0].body.sparse).toBe(true)
  })

  it("falls back to email lookup when stored Id returns null", async () => {
    const fake = new FakeQboClient(
      [
        { QueryResponse: {} }, // stored Id: miss
        {
          QueryResponse: {
            Customer: [
              {
                Id: "99",
                SyncToken: "0",
                DisplayName: "x",
                PrimaryEmailAddr: { Address: "j@e.com" },
                GivenName: "Jane",
              },
            ],
          },
        },
      ]
    )
    const result = await upsertCustomer(asClient(fake), {
      email: "j@e.com",
      firstName: "Jane",
      qboCustomerId: "42", // stale
    })
    expect(result.Id).toBe("99")
    expect(fake.queries[0]).toContain("Id = '42'")
    expect(fake.queries[1]).toContain("PrimaryEmailAddr = 'j@e.com'")
    expect(fake.posts).toHaveLength(0)
  })

  it("creates when neither stored Id nor email matches", async () => {
    const fake = new FakeQboClient(
      [{ QueryResponse: {} }, { QueryResponse: {} }],
      [{ Customer: { Id: "100", SyncToken: "0", DisplayName: "j@e.com" } }]
    )
    const result = await upsertCustomer(asClient(fake), {
      email: "j@e.com",
      firstName: "Jane",
      qboCustomerId: "42",
    })
    expect(result.Id).toBe("100")
    expect(fake.posts).toHaveLength(1)
    expect(fake.posts[0].endpoint).toBe("customer")
    expect(fake.posts[0].body.sparse).toBeUndefined()
  })

  it("skips the stored-Id lookup when qboCustomerId is not provided", async () => {
    const fake = new FakeQboClient(
      [{ QueryResponse: {} }],
      [{ Customer: { Id: "200", SyncToken: "0", DisplayName: "j@e.com" } }]
    )
    await upsertCustomer(asClient(fake), { email: "j@e.com" })
    expect(fake.queries).toHaveLength(1)
    expect(fake.queries[0]).toContain("PrimaryEmailAddr")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- qbo-customer
```

Expected: FAIL — `upsertCustomer` not exported, `CustomerInput` has no `qboCustomerId`.

- [ ] **Step 3: Extend `CustomerInput` and implement `upsertCustomer`**

In `src/lib/qbo-customer.ts`, add `qboCustomerId` to `CustomerInput`:

```ts
export type CustomerInput = {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  companyName?: string
  billingAddress?: AddressInput
  shippingAddress?: AddressInput
  /** Previously-stored QBO customer Id from Medusa customer metadata. */
  qboCustomerId?: string
}
```

Then append:

```ts
/**
 * Upsert a QBO customer, preferring a persisted QBO Id when available.
 *
 * Lookup order:
 *   1. `input.qboCustomerId` (if set) — exact match via Id query
 *   2. email
 *   3. create a new customer
 *
 * When an existing customer is found and `buildCustomerUpdatePatch` returns a
 * non-null patch, a sparse update is issued.
 */
export async function upsertCustomer(
  client: QboClient,
  input: CustomerInput
): Promise<QboCustomer> {
  let existing: QboCustomer | null = null

  if (input.qboCustomerId) {
    existing = await getCustomerById(client, input.qboCustomerId)
    if (!existing) {
      console.warn(
        `[QBO] Stored qbo_customer_id ${input.qboCustomerId} not found; falling back to email lookup`
      )
    }
  }

  if (!existing) {
    existing = await findCustomerByEmail(client, input.email)
  }

  if (existing) {
    const patch = buildCustomerUpdatePatch(existing, input)
    if (patch) {
      console.log(`[QBO] Updating customer ${existing.Id} with drifted fields`)
      return await updateCustomer(client, patch)
    }
    console.log(`[QBO] Found unchanged customer: ${existing.DisplayName} (Id ${existing.Id})`)
    return existing
  }

  const created = await createCustomer(client, input)
  console.log(`[QBO] Created new customer: ${created.DisplayName} (Id ${created.Id})`)
  return created
}
```

**Keep `findOrCreateCustomer` as a deprecated thin wrapper** so we don't break external imports in the same commit:

```ts
/** @deprecated Use `upsertCustomer` instead. Will be removed after all callers migrate. */
export async function findOrCreateCustomer(
  client: QboClient,
  input: CustomerInput
): Promise<QboCustomer> {
  return upsertCustomer(client, input)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:unit -- qbo-customer
```

Expected: all tests pass (baseline `findOrCreateCustomer` tests still green because it delegates to `upsertCustomer`; `createCustomer` still tested directly).

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-customer.ts src/lib/__tests__/qbo-customer.unit.spec.ts
git commit -m "feat(qbo): add upsertCustomer with stored-Id priority and drift updates"
```

---

## Task 9: Redis lock helper `withCustomerLock`

**Files:**
- Create: `src/lib/qbo-lock.ts`
- Test: `src/lib/__tests__/qbo-lock.unit.spec.ts`

Purpose: prevent two simultaneous orders for the same email from racing each other into creating duplicate QBO customer records. Lock is per-email, TTL-bounded (so a crashed lock holder auto-recovers), and acquired via `SET key NX PX`.

- [ ] **Step 1: Write the failing tests**

Create `/var/www/arrotti/my-medusa-store/src/lib/__tests__/qbo-lock.unit.spec.ts`:

```ts
import { withCustomerLock, __setRedisFactoryForTests } from "../qbo-lock"

class FakeRedis {
  public setCalls: Array<{ key: string; value: string; args: any[] }> = []
  public delCalls: string[] = []
  public evalCalls: Array<{ script: string; keys: string[]; args: string[] }> = []
  public store = new Map<string, string>()

  async set(key: string, value: string, ...args: any[]) {
    this.setCalls.push({ key, value, args })
    // Emulate NX: fail if key exists
    const idxNX = args.indexOf("NX")
    if (idxNX >= 0 && this.store.has(key)) return null
    this.store.set(key, value)
    return "OK"
  }

  async eval(script: string, numKeys: number, ...rest: string[]) {
    const keys = rest.slice(0, numKeys)
    const args = rest.slice(numKeys)
    this.evalCalls.push({ script, keys, args })
    // Emulate "delete only if value matches" (standard redlock release)
    const current = this.store.get(keys[0])
    if (current === args[0]) {
      this.store.delete(keys[0])
      return 1
    }
    return 0
  }

  async del(key: string) {
    this.delCalls.push(key)
    this.store.delete(key)
    return 1
  }

  async quit() { /* no-op */ }
}

describe("withCustomerLock", () => {
  let fake: FakeRedis
  beforeEach(() => {
    fake = new FakeRedis()
    __setRedisFactoryForTests(() => fake as any)
  })
  afterEach(() => {
    __setRedisFactoryForTests(null)
  })

  it("acquires, runs the work, and releases the lock", async () => {
    const result = await withCustomerLock("j@e.com", async () => "done")
    expect(result).toBe("done")
    expect(fake.setCalls).toHaveLength(1)
    expect(fake.setCalls[0].key).toBe("qbo:lock:customer:j@e.com")
    expect(fake.setCalls[0].args).toEqual(expect.arrayContaining(["NX", "PX"]))
    expect(fake.evalCalls).toHaveLength(1) // released via compare-and-delete
  })

  it("normalizes email to lowercase for the lock key", async () => {
    await withCustomerLock("J@E.COM", async () => 1)
    expect(fake.setCalls[0].key).toBe("qbo:lock:customer:j@e.com")
  })

  it("releases the lock even when the work throws", async () => {
    const work = jest.fn().mockRejectedValue(new Error("boom"))
    await expect(withCustomerLock("j@e.com", work)).rejects.toThrow("boom")
    expect(fake.evalCalls).toHaveLength(1)
  })

  it("retries on contention and eventually acquires", async () => {
    fake.store.set("qbo:lock:customer:j@e.com", "other-holder")
    // simulate the holder releasing after a tick
    const workPromise = withCustomerLock(
      "j@e.com",
      async () => "ok",
      { retryDelayMs: 5, maxWaitMs: 200 }
    )
    setTimeout(() => fake.store.delete("qbo:lock:customer:j@e.com"), 15)
    const result = await workPromise
    expect(result).toBe("ok")
  })

  it("times out after maxWaitMs of continuous contention", async () => {
    fake.store.set("qbo:lock:customer:j@e.com", "permanent-holder")
    await expect(
      withCustomerLock("j@e.com", async () => "ok", { retryDelayMs: 5, maxWaitMs: 30 })
    ).rejects.toThrow(/timed out/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:unit -- qbo-lock
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `qbo-lock.ts`**

Create `/var/www/arrotti/my-medusa-store/src/lib/qbo-lock.ts`:

```ts
/**
 * Redis-backed mutex for QBO customer upserts.
 *
 * Prevents concurrent orders for the same email from each creating a
 * duplicate QBO customer record. Uses the standard `SET key NX PX` pattern
 * with a random token so release is safe (compare-and-delete via Lua).
 *
 * Keyed on lowercased email — that's what the dedup target is.
 */

import Redis from "ioredis"
import crypto from "crypto"

type RedisLike = {
  set(key: string, value: string, ...args: any[]): Promise<any>
  eval(script: string, numKeys: number, ...args: string[]): Promise<any>
  quit?(): Promise<any>
}

type RedisFactory = () => RedisLike

let sharedClient: RedisLike | null = null
let testFactory: RedisFactory | null = null

/** Test seam. Pass null to restore default. */
export function __setRedisFactoryForTests(factory: RedisFactory | null): void {
  testFactory = factory
  sharedClient = null
}

function getRedis(): RedisLike {
  if (testFactory) return testFactory()
  if (!sharedClient) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error("REDIS_URL not set — qbo-lock requires Redis")
    sharedClient = new Redis(url) as unknown as RedisLike
  }
  return sharedClient
}

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`

export type LockOptions = {
  /** Max ms to hold the lock if the work crashes. Default 30s. */
  ttlMs?: number
  /** Max ms to wait for the lock before throwing. Default 10s. */
  maxWaitMs?: number
  /** Ms between acquire retries during contention. Default 50ms. */
  retryDelayMs?: number
}

/**
 * Run `work` while holding an exclusive lock on `qbo:lock:customer:<email>`.
 * Retries on contention up to `maxWaitMs`, then throws.
 */
export async function withCustomerLock<T>(
  email: string,
  work: () => Promise<T>,
  opts: LockOptions = {}
): Promise<T> {
  const ttlMs = opts.ttlMs ?? 30_000
  const maxWaitMs = opts.maxWaitMs ?? 10_000
  const retryDelayMs = opts.retryDelayMs ?? 50

  const key = `qbo:lock:customer:${email.toLowerCase()}`
  const token = crypto.randomBytes(16).toString("hex")
  const redis = getRedis()
  const deadline = Date.now() + maxWaitMs

  // Acquire loop
  while (true) {
    const ok = await redis.set(key, token, "PX", ttlMs, "NX")
    if (ok === "OK") break
    if (Date.now() >= deadline) {
      throw new Error(`qbo-lock: timed out acquiring ${key} after ${maxWaitMs}ms`)
    }
    await new Promise((r) => setTimeout(r, retryDelayMs))
  }

  try {
    return await work()
  } finally {
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token)
    } catch (err) {
      console.error(`[qbo-lock] release failed for ${key}:`, (err as Error).message)
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:unit -- qbo-lock
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qbo-lock.ts src/lib/__tests__/qbo-lock.unit.spec.ts
git commit -m "feat(qbo): add Redis-backed customer upsert lock"
```

---

## Task 10: Wire `qbo-invoice-creator.ts` to the new upsert

**Files:**
- Modify: `src/lib/qbo-invoice-creator.ts`

Current state: lines 200–213 call `findOrCreateCustomer` with a fused `billingAddress || shipping_address` and no shipping address. We replace that call to (a) load `qbo_customer_id` from the Medusa customer, (b) pass billing and shipping separately, (c) wrap in `withCustomerLock`, (d) persist the returned QBO Id back.

- [ ] **Step 1: Import the new symbols**

At the top of `src/lib/qbo-invoice-creator.ts`, replace the existing `qbo-customer` import:

```ts
import { upsertCustomer } from "./qbo-customer"
```

And add alongside the other imports:

```ts
import { withCustomerLock } from "./qbo-lock"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
```

(If those two are already imported, skip — check the file's existing imports.)

- [ ] **Step 2: Replace the customer block at lines ~199–213**

Find the block starting with `// Find or create customer in QBO` and ending with the `findOrCreateCustomer({...})` call. Replace it entirely with:

```ts
  // Resolve the customer via the new upsert flow.
  // Priority: stored qbo_customer_id → email → create. Locked on email to
  // prevent concurrent orders racing into duplicate QBO customers.
  const billingAddress = order.billing_address || null
  const shippingAddress = order.shipping_address || null
  const profileAddress = billingAddress || shippingAddress // for name/phone fallback

  const medusaCustomerId: string | undefined = (order as any).customer?.id
  const medusaCustomerMetadata =
    ((order as any).customer?.metadata as Record<string, any> | null | undefined) ?? {}
  const storedQboCustomerId =
    typeof medusaCustomerMetadata.qbo_customer_id === "string"
      ? medusaCustomerMetadata.qbo_customer_id
      : undefined

  const companyName =
    typeof medusaCustomerMetadata.company_name === "string"
      ? medusaCustomerMetadata.company_name
      : undefined

  const customer = await withCustomerLock(order.email, () =>
    upsertCustomer(client, {
      email: order.email,
      firstName: order.customer?.first_name || profileAddress?.first_name || undefined,
      lastName: order.customer?.last_name || profileAddress?.last_name || undefined,
      phone: order.customer?.phone || profileAddress?.phone || undefined,
      companyName,
      qboCustomerId: storedQboCustomerId,
      billingAddress: billingAddress
        ? {
            address_1: billingAddress.address_1 || undefined,
            city: billingAddress.city || undefined,
            province: billingAddress.province || undefined,
            postal_code: billingAddress.postal_code || undefined,
            country_code: billingAddress.country_code || undefined,
          }
        : undefined,
      shippingAddress: shippingAddress
        ? {
            address_1: shippingAddress.address_1 || undefined,
            city: shippingAddress.city || undefined,
            province: shippingAddress.province || undefined,
            postal_code: shippingAddress.postal_code || undefined,
            country_code: shippingAddress.country_code || undefined,
          }
        : undefined,
    })
  )

  // Persist the QBO Id back onto the Medusa customer so the next order skips
  // the email query. Best-effort: never block invoice creation on this.
  if (medusaCustomerId && customer.Id !== storedQboCustomerId) {
    try {
      const customerService = container.resolve(Modules.CUSTOMER)
      await customerService.updateCustomers([
        {
          id: medusaCustomerId,
          metadata: {
            ...medusaCustomerMetadata,
            qbo_customer_id: customer.Id,
          },
        },
      ])
      logger.info(
        `[QBO Invoice] Stamped qbo_customer_id=${customer.Id} on Medusa customer ${medusaCustomerId}`
      )
    } catch (err) {
      logger.warn(
        `[QBO Invoice] Failed to stamp qbo_customer_id on Medusa customer ${medusaCustomerId}: ${(err as Error).message}`
      )
    }
  }
```

- [ ] **Step 3: Add `customer.id` to the order GraphQL field list**

Find the `query.graph({ entity: "order", fields: [ … ] })` call around lines 131–166 and add `"customer.id"` to the fields array (it already has `customer.first_name`, `customer.metadata`, etc. — just add the `id` line):

```ts
      "customer.id",
      "customer.first_name",
      "customer.last_name",
      "customer.phone",
      "customer.metadata",
```

- [ ] **Step 4: Run the full unit-test suite to catch regressions**

```bash
npm run test:unit
```

Expected: all tests pass. No file outside `__tests__/qbo-*` should be affected.

- [ ] **Step 5: Typecheck the whole backend**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/qbo-invoice-creator.ts
git commit -m "feat(qbo): wire invoice creator to upsertCustomer with lock and id persistence"
```

---

## Task 11: Backfill script for existing customers

**Files:**
- Create: `src/scripts/backfill-qbo-customer-ids.ts`

Purpose: for every Medusa customer who already has a QBO-invoiced order but no `metadata.qbo_customer_id`, query QBO by email and stamp the Id. Reports duplicates and customers with no QBO match.

- [ ] **Step 1: Write the script**

Create `/var/www/arrotti/my-medusa-store/src/scripts/backfill-qbo-customer-ids.ts`:

```ts
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { QboClient } from "../lib/qbo-client"
import { findCustomerByEmail } from "../lib/qbo-customer"
import { QBO_CONNECTION_MODULE } from "../modules/qbo-connection"

/**
 * Stamp customer.metadata.qbo_customer_id for every Medusa customer who
 * already has an order invoiced to QBO (order.metadata.qbo_invoice.invoice_id)
 * but whose customer record doesn't yet carry the QBO Id.
 *
 * Idempotent. Safe to re-run.
 */
export default async function backfillQboCustomerIds({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const customerService = container.resolve(Modules.CUSTOMER)
  const qbo = container.resolve(QBO_CONNECTION_MODULE) as any

  if (!(await qbo.isConnected())) {
    logger.error("[backfill-qbo-customer-ids] QuickBooks is not connected")
    return
  }
  const client = new QboClient(qbo)

  logger.info("[backfill-qbo-customer-ids] Loading candidate customers…")
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "email", "metadata", "customer.id", "customer.metadata"],
    filters: {},
  })

  // Email → { medusaCustomerId, currentMetadata }
  const byEmail = new Map<
    string,
    { medusaCustomerId: string; metadata: Record<string, any> }
  >()
  for (const o of orders || []) {
    const invoiceId = (o.metadata as any)?.qbo_invoice?.invoice_id
    const medusaCustomerId = (o as any).customer?.id
    const email = (o.email || "").toLowerCase()
    if (!invoiceId || !medusaCustomerId || !email) continue
    const cmeta = ((o as any).customer?.metadata || {}) as Record<string, any>
    if (cmeta.qbo_customer_id) continue
    if (!byEmail.has(email)) byEmail.set(email, { medusaCustomerId, metadata: cmeta })
  }

  logger.info(`[backfill-qbo-customer-ids] ${byEmail.size} customers need backfill`)

  let stamped = 0
  let missing = 0
  for (const [email, { medusaCustomerId, metadata }] of byEmail) {
    let qboCustomer
    try {
      qboCustomer = await findCustomerByEmail(client, email)
    } catch (err) {
      logger.warn(`[backfill-qbo-customer-ids] query failed for ${email}: ${(err as Error).message}`)
      continue
    }
    if (!qboCustomer) {
      missing++
      logger.warn(`[backfill-qbo-customer-ids] no QBO customer for ${email}`)
      continue
    }
    try {
      await customerService.updateCustomers([
        {
          id: medusaCustomerId,
          metadata: { ...metadata, qbo_customer_id: qboCustomer.Id },
        },
      ])
      stamped++
    } catch (err) {
      logger.error(
        `[backfill-qbo-customer-ids] failed to stamp ${email} (${medusaCustomerId}): ${(err as Error).message}`
      )
    }
  }

  logger.info(
    `[backfill-qbo-customer-ids] Done. Stamped=${stamped}, MissingInQBO=${missing}, Total=${byEmail.size}`
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Dry-run against the dev env (optional but recommended)**

If a dev/staging backend + QBO sandbox is available, run it there first. Otherwise skip this step — the script only reads existing QBO data and writes Medusa metadata; worst case a misfire stamps a wrong Id, which the upsert fallback chain recovers from automatically.

```bash
cd /var/www/arrotti/my-medusa-store
npx medusa exec src/scripts/backfill-qbo-customer-ids.ts
```

Expected log:
```
[backfill-qbo-customer-ids] N customers need backfill
[backfill-qbo-customer-ids] Done. Stamped=X, MissingInQBO=Y, Total=N
```

- [ ] **Step 4: Commit**

```bash
git add src/scripts/backfill-qbo-customer-ids.ts
git commit -m "feat(qbo): backfill script to stamp qbo_customer_id on existing customers"
```

---

## Task 12: Manual smoke test checklist

**Files:** none (verification only)

- [ ] **Step 1: Build the backend**

```bash
cd /var/www/arrotti/my-medusa-store
npm run build
```

Expected: build succeeds.

- [ ] **Step 2: Restart the dev backend**

```bash
sudo systemctl restart medusa-backend-dev.service
sudo journalctl -u medusa-backend-dev.service -n 50 --no-pager
```

Expected: clean boot, no startup errors.

- [ ] **Step 3: Place a test order via the dev storefront and confirm QBO side**

Checklist:
- [ ] New customer with **different** billing and shipping addresses → QBO customer has both `BillAddr` and `ShipAddr` populated, distinct.
- [ ] Same customer places a second order with a changed phone → the QBO customer's `PrimaryPhone` is updated (check QBO UI "Edit" > Phone). No duplicate customer row appears.
- [ ] Same customer places a third order with identical data → no POST to `/customer` is issued (check `journalctl` for `[QBO] Found unchanged customer`).
- [ ] After order #1, Medusa customer's `metadata.qbo_customer_id` is set (check via admin UI customer detail > Metadata widget, or SQL: `SELECT metadata FROM customer WHERE email = '…';`).

- [ ] **Step 4: Concurrency spot-check (optional)**

Fire two near-simultaneous test checkouts for the same new email using two browser tabs. Expected: exactly one QBO customer created, not two. Check QBO customer list filtered by email — should show a single row.

- [ ] **Step 5: Final commit (if any cleanup was needed)**

If smoke testing surfaced issues, fix them and commit. Otherwise no-op.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feat/qbo-customer-sync
```

Expected: branch pushed, PR link printed.

---

## Out of scope (for a later plan)

- **B2B sub-customers** with `ParentRef` for companies that have multiple ship-to locations — depends on Task 8's upsert foundation.
- **QBO → Medusa webhook reverse sync** for customer updates made directly in the QBO UI — depends on Task 8's `SyncToken` awareness.
- **Backfill shipping addresses** onto existing QBO customers whose records were created with `BillAddr` only. This plan's upsert will naturally fill `ShipAddr` on the customer's next order (via the diff helper), so an explicit backfill is avoidable unless accountants are waiting.
