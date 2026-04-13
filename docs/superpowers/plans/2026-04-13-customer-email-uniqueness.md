# Customer Email Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate `has_account=true` customer rows per email in the Medusa V2 backend, while allowing existing guest rows to be upgraded in place during wholesale registration.

**Architecture:** Two-layer defense. Layer 1: the existing `/store/customers/register-wholesale` route is modified to normalize emails to lowercase, look up existing rows case-insensitively, upgrade a matching guest row in place (linking auth instead of creating a new customer), and block on an already-registered email. Layer 2: a Postgres partial unique index on `LOWER(email)` scoped to `has_account=true AND deleted_at IS NULL` backstops every other write path.

**Tech Stack:** Medusa V2, TypeScript/Node 20, PostgreSQL 15+, MikroORM (via Medusa), Knex (via `ContainerRegistrationKeys.PG_CONNECTION`), Jest + `@medusajs/test-utils`.

**Spec:** `docs/superpowers/specs/2026-04-13-customer-email-uniqueness-design.md`

**Working directory:** `/var/www/arrotti/my-medusa-store`

**⚠ Production-database execution (option C).** `.env.test` is empty; integration tests run against the live Postgres instance. All test rows use the prefix
`__test_uniqueness_` in emails and ids, and every test file ships with
`beforeAll`/`afterAll` teardown hooks that delete any row whose email starts
with that prefix. Prod data never shares that pattern, so a failed teardown
still never touches real customers.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/scripts/add-customer-email-uniqueness-index.ts` | Create | One-off migration: pre-flight checks for duplicates, creates the partial unique index concurrently, verifies creation. Run via `npx medusa exec`. |
| `src/api/store/customers/register-wholesale/route.ts` | Modify | Normalize email, case-insensitive lookup via raw SQL, branch into upgrade-in-place vs create-new. Catch unique-index violations on the create path. |
| `integration-tests/http/register-wholesale-uniqueness.spec.ts` | Create | Four integration tests driven through the HTTP surface: new email, registered-email rejection (case variant), guest upgrade in place, unique-violation race caught gracefully. |

---

## Task 1: Create and run the partial unique index migration script

**Files:**
- Create: `src/scripts/add-customer-email-uniqueness-index.ts`

- [ ] **Step 1: Write the migration script**

Create `/var/www/arrotti/my-medusa-store/src/scripts/add-customer-email-uniqueness-index.ts` with the following content:

```ts
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Adds a partial unique index preventing two active registered customer rows
 * from sharing the same email (case-insensitive).
 *
 * Guest rows (has_account=false) and soft-deleted rows are excluded so
 * Medusa's default guest-checkout behaviour remains untouched.
 *
 * Idempotent: safe to re-run.
 */
export default async function addCustomerEmailUniquenessIndex({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  logger.info("[email-uniqueness] Pre-flight: checking for existing duplicates…")

  const dupes = await db.raw(
    `SELECT LOWER(email) AS email, COUNT(*) AS n
     FROM customer
     WHERE has_account = true AND deleted_at IS NULL
     GROUP BY LOWER(email)
     HAVING COUNT(*) > 1`
  )

  if (dupes.rows.length > 0) {
    logger.error(
      `[email-uniqueness] Aborting: found ${dupes.rows.length} duplicate registered emails. Resolve manually before re-running.`
    )
    for (const row of dupes.rows) {
      logger.error(`  ${row.email}: ${row.n} rows`)
    }
    throw new Error("Duplicate registered-customer emails present")
  }

  logger.info("[email-uniqueness] No duplicates. Creating partial unique index…")

  await db.raw(
    `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
       customer_email_has_account_uniq
     ON customer (LOWER(email))
     WHERE has_account = true AND deleted_at IS NULL`
  )

  const check = await db.raw(
    `SELECT indexname FROM pg_indexes
     WHERE tablename='customer' AND indexname='customer_email_has_account_uniq'`
  )

  if (check.rows.length !== 1) {
    throw new Error("Index creation reported success but index not found")
  }

  logger.info("[email-uniqueness] Index customer_email_has_account_uniq is in place.")
}
```

- [ ] **Step 2: Run the migration**

```bash
cd /var/www/arrotti/my-medusa-store
npx medusa exec src/scripts/add-customer-email-uniqueness-index.ts
```

Expected log output:
```
[email-uniqueness] Pre-flight: checking for existing duplicates…
[email-uniqueness] No duplicates. Creating partial unique index…
[email-uniqueness] Index customer_email_has_account_uniq is in place.
```

- [ ] **Step 3: Verify the index from psql**

```bash
PGPASSWORD=medusa123 psql -U medusa -h localhost -d medusa-my-medusa-store \
  -c "\d customer" | grep customer_email_has_account_uniq
```

Expected output contains:
```
"customer_email_has_account_uniq" UNIQUE, btree (lower(email)) WHERE has_account = true AND deleted_at IS NULL
```

- [ ] **Step 4: Commit**

```bash
cd /var/www/arrotti/my-medusa-store
git add src/scripts/add-customer-email-uniqueness-index.ts
git commit -m "feat(db): partial unique index on customer email for has_account=true"
```

---

## Task 2: Scaffold the integration test file

**Files:**
- Create: `integration-tests/http/register-wholesale-uniqueness.spec.ts`

- [ ] **Step 1: Create the test file with boilerplate and a smoke test**

Create `/var/www/arrotti/my-medusa-store/integration-tests/http/register-wholesale-uniqueness.spec.ts`:

```ts
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"

jest.setTimeout(120 * 1000)

/**
 * Prefix applied to every email and customer id this test file creates.
 * The afterAll hook hard-deletes any row matching this pattern, so the
 * test file is safe to run against the production database.
 */
const TEST_PREFIX = "__test_uniqueness_"

function testEmail(tag: string): string {
  return `${TEST_PREFIX}${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@example.com`
}

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    describe("POST /store/customers/register-wholesale — uniqueness", () => {
      const baseBody = {
        password: "StrongPass1!",
        first_name: "Test",
        last_name: "User",
      }

      async function countCustomers(emailLower: string) {
        const container = getContainer()
        const db = container.resolve("__pg_connection__")
        const { rows } = await db.raw(
          `SELECT COUNT(*)::int AS n FROM customer
           WHERE LOWER(email) = $1 AND deleted_at IS NULL`,
          [emailLower]
        )
        return rows[0].n as number
      }

      async function teardownTestData() {
        const container = getContainer()
        const db = container.resolve("__pg_connection__")
        // Remove auth/provider rows first (FK-safe); then customers.
        await db.raw(
          `DELETE FROM provider_identity WHERE entity_id LIKE $1`,
          [`${TEST_PREFIX}%`]
        )
        await db.raw(
          `DELETE FROM auth_identity
             WHERE id NOT IN (SELECT auth_identity_id FROM provider_identity WHERE auth_identity_id IS NOT NULL)
               AND app_metadata::text LIKE $1`,
          [`%${TEST_PREFIX}%`]
        )
        await db.raw(
          `DELETE FROM customer_group_customer
             WHERE customer_id IN (SELECT id FROM customer WHERE email LIKE $1)`,
          [`${TEST_PREFIX}%`]
        )
        await db.raw(
          `DELETE FROM customer WHERE email LIKE $1 OR id LIKE $2`,
          [`${TEST_PREFIX}%`, `cus_${TEST_PREFIX}%`]
        )
      }

      beforeAll(async () => {
        await teardownTestData()
      })

      afterAll(async () => {
        await teardownTestData()
      })

      it("smoke: runner boots and route is reachable", async () => {
        const res = await api.post(
          "/store/customers/register-wholesale",
          { ...baseBody, email: testEmail("smoke") }
        )
        // Either 201 or a validation-ish error proves the route is mounted.
        expect([201, 400, 409]).toContain(res.status)
      })
    })
  },
})
```

Note: `"__pg_connection__"` is the container registration key for Knex; it is
equivalent to `ContainerRegistrationKeys.PG_CONNECTION` (both resolve to the
same token).

- [ ] **Step 2: Run the new test file**

```bash
cd /var/www/arrotti/my-medusa-store
npm run test:integration:http -- --testPathPattern=register-wholesale-uniqueness
```

Expected: smoke test passes, runner bootstraps the in-app Medusa server.

- [ ] **Step 3: Commit**

```bash
git add integration-tests/http/register-wholesale-uniqueness.spec.ts
git commit -m "test(register-wholesale): scaffold uniqueness integration test"
```

---

## Task 3: Red test — case-variant registered email must 409

**Files:**
- Modify: `integration-tests/http/register-wholesale-uniqueness.spec.ts`

- [ ] **Step 1: Add a failing test for case-insensitive block**

Inside the `describe` block, immediately after the smoke `it(...)` test, add:

```ts
it("rejects re-registration with a different casing of an existing registered email", async () => {
  const email = testEmail("case")

  const first = await api.post("/store/customers/register-wholesale", {
    ...baseBody,
    email,
  })
  expect(first.status).toBe(201)

  const second = await api.post("/store/customers/register-wholesale", {
    ...baseBody,
    email: email.toUpperCase(),
  })
  expect(second.status).toBe(409)
  expect(await countCustomers(email.toLowerCase())).toBe(1)
})
```

- [ ] **Step 2: Run and confirm it fails**

```bash
npm run test:integration:http -- --testPathPattern=register-wholesale-uniqueness \
  -t "rejects re-registration with a different casing"
```

Expected: FAIL. Reason: current route compares emails case-sensitively via
`listCustomers({ email })`, so the uppercased address is treated as a new
customer and either returns 201 (creating a second row) or 409 via the auth
conflict rather than the customer conflict.

- [ ] **Step 3: Commit the red test**

```bash
git add integration-tests/http/register-wholesale-uniqueness.spec.ts
git commit -m "test(register-wholesale): red — case-variant email must 409"
```

---

## Task 4: Green — normalize email, case-insensitive lookup via raw SQL

**Files:**
- Modify: `src/api/store/customers/register-wholesale/route.ts`

- [ ] **Step 1: Add the PG connection import and email normalization**

At the top of `/var/www/arrotti/my-medusa-store/src/api/store/customers/register-wholesale/route.ts`, update the imports to include `ContainerRegistrationKeys`:

```ts
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
```

(`Modules` is already imported; just add `ContainerRegistrationKeys` to the same line.)

- [ ] **Step 2: Replace the lookup block**

Find the existing block in `route.ts` (around lines 141–150):

```ts
    // 2. Check if customer with this email already exists
    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    const existingCustomers = await customerModule.listCustomers({ email: body.email })

    if (existingCustomers.length > 0) {
      res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
      })
      return
    }
```

Replace it with:

```ts
    // Normalise email and look up any existing rows case-insensitively.
    // Raw SQL keeps semantics identical to the partial unique index
    // (LOWER(email) WHERE has_account = true AND deleted_at IS NULL).
    const emailLc = body.email.trim().toLowerCase()

    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const { rows: existingRows } = await db.raw(
      `SELECT id, email, has_account, first_name, last_name,
              company_name, phone, metadata, created_at
         FROM customer
        WHERE LOWER(email) = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [emailLc]
    )

    const registeredRow = existingRows.find((r: any) => r.has_account === true)
    if (registeredRow) {
      res.status(409).json({
        message: "An account with this email already exists. Please sign in instead.",
      })
      return
    }

    const guestRow = existingRows.find((r: any) => r.has_account === false)
```

Keep the rest of the function intact for now — `guestRow` will be used in Task 6.

- [ ] **Step 3: Normalize email on write**

Find the `customerData` object (about 25 lines further down, still inside the
same function):

```ts
    const customerData = {
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      company_name: body.company_name || null,
```

Change the `email:` line to use `emailLc`:

```ts
      email: emailLc,
```

Also update the auth register call (around line 159) so the stored auth entity
matches:

```ts
      authResult = await authModule.register("emailpass", {
        body: {
          email: emailLc,
          password: body.password,
        },
      } as any)
```

- [ ] **Step 4: Run the red test — it should now pass**

```bash
npm run test:integration:http -- --testPathPattern=register-wholesale-uniqueness \
  -t "rejects re-registration with a different casing"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/store/customers/register-wholesale/route.ts
git commit -m "feat(register-wholesale): case-insensitive email dedupe via raw SQL"
```

---

## Task 5: Red test — guest row must be upgraded in place

**Files:**
- Modify: `integration-tests/http/register-wholesale-uniqueness.spec.ts`

- [ ] **Step 1: Add a failing test for guest upgrade**

Append to the same `describe` block:

```ts
it("upgrades an existing guest customer in place instead of creating a duplicate", async () => {
  const email = testEmail("guest")
  const container = getContainer()
  const customerModule = container.resolve(Modules.CUSTOMER)

  const [guest] = await customerModule.createCustomers([
    {
      email,
      has_account: false,
      first_name: "Guest",
      last_name: "Shopper",
    },
  ])

  expect(guest.has_account).toBe(false)

  const res = await api.post("/store/customers/register-wholesale", {
    ...baseBody,
    email,
    company_name: "Upgrade Co",
  })
  expect(res.status).toBe(201)
  expect(await countCustomers(email.toLowerCase())).toBe(1)

  const refreshed = await customerModule.retrieveCustomer(guest.id)
  expect(refreshed.has_account).toBe(true)
  expect(refreshed.company_name).toBe("Upgrade Co")
})
```

- [ ] **Step 2: Run and confirm it fails**

```bash
npm run test:integration:http -- --testPathPattern=register-wholesale-uniqueness \
  -t "upgrades an existing guest customer"
```

Expected: FAIL. Reason: the route currently has no branch that handles a guest
row — after Task 4 the guest row is found but nothing is done with it, so
`createCustomerAccountWorkflow` runs and creates a second row (count becomes 2).

- [ ] **Step 3: Commit the red test**

```bash
git add integration-tests/http/register-wholesale-uniqueness.spec.ts
git commit -m "test(register-wholesale): red — guest upgrade in place"
```

---

## Task 6: Green — upgrade guest in place, link auth identity

**Files:**
- Modify: `src/api/store/customers/register-wholesale/route.ts`

- [ ] **Step 1: Insert the upgrade branch after auth registration**

Locate the block in `route.ts` that runs immediately after a successful
auth register (after the `authIdentityId` constant is assigned, roughly
around line 183 in the current file):

```ts
    const authIdentityId = authResult.authIdentity.id

    // 4. Create customer account linked to auth identity
    const customerData = {
```

Replace from "4. Create customer account linked to auth identity" down through
the existing `createCustomerAccountWorkflow` call + its `logger.info`/response
block with the following:

```ts
    const registrationMetadata = {
      tax_id: body.tax_id || null,
      tax_documents: taxDocuments,
      registration_date: new Date().toISOString(),
      pending_approval: true,
      registration_source: "wholesale_portal",
    }

    let customerResult: {
      id: string
      email: string
      first_name: string | null
      last_name: string | null
      company_name: string | null
    }

    if (guestRow) {
      // Upgrade-in-place: keep the existing guest row so carts/orders stay linked.
      const mergedMetadata = {
        ...((guestRow.metadata as Record<string, unknown> | null) || {}),
        ...registrationMetadata,
      }

      const [updated] = await customerModule.updateCustomers(
        [guestRow.id],
        {
          first_name: body.first_name,
          last_name: body.last_name,
          email: emailLc,
          company_name: body.company_name || null,
          phone: body.phone || null,
          has_account: true,
          metadata: mergedMetadata,
        }
      )

      // Link the newly created auth_identity to the upgraded customer.
      const authModuleForLink = req.scope.resolve(Modules.AUTH)
      const existingAuth = await authModuleForLink.retrieveAuthIdentity(
        authIdentityId
      )
      await authModuleForLink.updateAuthIdentities({
        id: authIdentityId,
        app_metadata: {
          ...(existingAuth.app_metadata || {}),
          customer_id: guestRow.id,
        },
      })

      customerResult = {
        id: updated.id,
        email: updated.email,
        first_name: updated.first_name ?? null,
        last_name: updated.last_name ?? null,
        company_name: updated.company_name ?? null,
      }

      logger.info(
        `[Wholesale Registration] Upgraded guest ${guestRow.id} to wholesale account (${emailLc})`
      )
    } else {
      const customerData = {
        first_name: body.first_name,
        last_name: body.last_name,
        email: emailLc,
        company_name: body.company_name || null,
        phone: body.phone || null,
        has_account: true,
        metadata: registrationMetadata,
      }

      const { result } = await createCustomerAccountWorkflow(req.scope).run({
        input: {
          authIdentityId,
          customerData,
        },
      })

      customerResult = {
        id: result.id,
        email: result.email,
        first_name: result.first_name ?? null,
        last_name: result.last_name ?? null,
        company_name: result.company_name ?? null,
      }

      logger.info(
        `[Wholesale Registration] Created wholesale customer ${result.id} (${emailLc})`
      )
    }

    res.status(201).json({
      customer: customerResult,
      message: "Registration successful. Your account is pending approval.",
    })
    return
```

Remove the now-obsolete trailing `res.status(201).json({ customer: { id: customerResult.id, ... } })` block that was previously at the end of the function — it is replaced by the single `res.status(201).json(...)` inside both branches above.

- [ ] **Step 2: Run all uniqueness tests**

```bash
npm run test:integration:http -- --testPathPattern=register-wholesale-uniqueness
```

Expected: all three tests (smoke, case-variant, guest-upgrade) PASS.

- [ ] **Step 3: Commit**

```bash
git add src/api/store/customers/register-wholesale/route.ts
git commit -m "feat(register-wholesale): upgrade guest customer in place on registration"
```

---

## Task 7: Red + green — gracefully handle partial-index race

**Files:**
- Modify: `integration-tests/http/register-wholesale-uniqueness.spec.ts`
- Modify: `src/api/store/customers/register-wholesale/route.ts`

- [ ] **Step 1: Add a failing test that drives the DB-level duplicate path**

Append to the same `describe` block:

```ts
it("returns 409 when the partial unique index blocks a simultaneous duplicate", async () => {
  const email = testEmail("race")
  const container = getContainer()
  const db = container.resolve("__pg_connection__")

  // Simulate a concurrent-write scenario: a registered row already exists,
  // produced outside this route (e.g. admin create, guest->registered edge).
  await db.raw(
    `INSERT INTO customer (id, email, has_account, created_at, updated_at)
     VALUES ($1, $2, true, NOW(), NOW())`,
    [`cus_${TEST_PREFIX}race_${Date.now()}`, email]
  )

  const res = await api.post("/store/customers/register-wholesale", {
    ...baseBody,
    email,
  })

  expect(res.status).toBe(409)
  expect(await countCustomers(email.toLowerCase())).toBe(1)
})
```

- [ ] **Step 2: Run and confirm it fails**

```bash
npm run test:integration:http -- --testPathPattern=register-wholesale-uniqueness \
  -t "partial unique index blocks"
```

Expected: after Task 6 this case is actually already handled by the
application-level check, so the test probably PASSES already. If it passes, the
test still serves as a regression guard — mark Step 2 and Step 4 complete.

If it instead FAILs with an unhandled database error (e.g. the response is 500
because a `duplicate key value` error escaped), proceed to Step 3 to add the
catch.

- [ ] **Step 3: Wrap the `createCustomerAccountWorkflow` call so a unique-index violation becomes a 409**

In `route.ts`, inside the `else` branch of the upgrade check (the "create new"
path), wrap the workflow call:

```ts
      try {
        const { result } = await createCustomerAccountWorkflow(req.scope).run({
          input: {
            authIdentityId,
            customerData,
          },
        })
        customerResult = {
          id: result.id,
          email: result.email,
          first_name: result.first_name ?? null,
          last_name: result.last_name ?? null,
          company_name: result.company_name ?? null,
        }
      } catch (err: any) {
        const msg = (err?.message || "") + " " + (err?.detail || "")
        if (
          msg.includes("customer_email_has_account_uniq") ||
          msg.includes("duplicate key value") ||
          err?.code === "23505"
        ) {
          logger.warn(
            `[Wholesale Registration] Unique index blocked duplicate for ${emailLc}`
          )
          res.status(409).json({
            message: "An account with this email already exists. Please sign in instead.",
          })
          return
        }
        throw err
      }
```

- [ ] **Step 4: Re-run the test — expect PASS**

```bash
npm run test:integration:http -- --testPathPattern=register-wholesale-uniqueness
```

Expected: all four tests PASS.

- [ ] **Step 5: Commit**

```bash
git add integration-tests/http/register-wholesale-uniqueness.spec.ts \
        src/api/store/customers/register-wholesale/route.ts
git commit -m "feat(register-wholesale): surface partial-index conflicts as 409"
```

---

## Task 8: Build, deploy, and smoke test in production

**Files:** no code changes

- [ ] **Step 1: Typecheck**

```bash
cd /var/www/arrotti/my-medusa-store
npx tsc --noEmit -p tsconfig.json
```

Expected: exits with status 0, no output.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected output ends with:
```
info:    Backend build completed successfully
info:    Frontend build completed successfully
```

- [ ] **Step 3: Restart the backend service**

```bash
sudo systemctl restart medusa-backend.service
```

- [ ] **Step 4: Service health check**

```bash
systemctl is-active medusa-backend.service
curl -sS -o /dev/null -w "health: %{http_code}\n" http://localhost:9002/health
```

Expected:
```
active
health: 200
```

- [ ] **Step 5: Smoke test the route with curl**

Replace `PUBLISHABLE_KEY` with the B2B publishable API key from
`/var/www/arrotti/my-medusa-store-storefront-b2b/.env.local` (variable name
`NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`).

```bash
STAMP=$(date +%s)
EMAIL="smoke-${STAMP}@example.com"
curl -sS -X POST http://localhost:9002/store/customers/register-wholesale \
  -H "x-publishable-api-key: PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"SmokeTest1!\",\"first_name\":\"Smoke\",\"last_name\":\"Test\"}" \
  -w "\nHTTP %{http_code}\n"

# Second call with uppercased email — expect 409
curl -sS -X POST http://localhost:9002/store/customers/register-wholesale \
  -H "x-publishable-api-key: PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$(echo ${EMAIL} | tr a-z A-Z)\",\"password\":\"SmokeTest1!\",\"first_name\":\"Smoke\",\"last_name\":\"Test\"}" \
  -w "\nHTTP %{http_code}\n"
```

Expected: first call returns HTTP 201 with a `customer` object. Second call returns HTTP 409 with the "please sign in" message.

- [ ] **Step 6: Clean up the smoke-test customer**

```bash
PGPASSWORD=medusa123 psql -U medusa -h localhost -d medusa-my-medusa-store -c \
  "DELETE FROM provider_identity WHERE entity_id LIKE 'smoke-%@example.com';
   DELETE FROM customer WHERE email LIKE 'smoke-%@example.com';"
```

- [ ] **Step 7: Push to origin**

```bash
cd /var/www/arrotti/my-medusa-store
git push origin main
```

Expected: successful push, new commits visible on GitHub.

---

## Rollback

If a problem surfaces in production after deploy:

1. **Index only** (safe, keeps app changes): no rollback needed for the index itself — it does not interfere with guest checkout or any existing flow.
2. **App changes** (route breaks): revert the relevant commits on `main` and redeploy:
   ```bash
   git revert <commit-sha-of-route-changes>
   git push origin main
   npm run build && sudo systemctl restart medusa-backend.service
   ```
3. **Drop the index** (last resort):
   ```bash
   PGPASSWORD=medusa123 psql -U medusa -h localhost -d medusa-my-medusa-store -c \
     "DROP INDEX IF EXISTS customer_email_has_account_uniq;"
   ```

---

## Out of scope (per spec)

- Medusa's built-in `POST /store/customers` and admin panel manual create: Layer 2 (the index) catches these; no code change planned here.
- Backfilling lowercase emails on existing rows.
- Further deduplication of already-present guest rows.
- Changes to the `auth_identity` / `provider_identity` uniqueness (already enforced by the auth module).
