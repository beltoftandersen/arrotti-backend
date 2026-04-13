# Customer Email Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate `has_account=true` customer rows per email in the Medusa V2 backend, while allowing existing guest rows to be upgraded in place during wholesale registration.

**Architecture:** Two-layer defense. Layer 1: the existing `/store/customers/register-wholesale` route is modified to normalize emails to lowercase, look up existing rows case-insensitively, upgrade a matching guest row in place (linking auth instead of creating a new customer), and block on an already-registered email. Layer 2: a Postgres partial unique index on `LOWER(email)` scoped to `has_account=true AND deleted_at IS NULL` backstops every other write path.

**Tech Stack:** Medusa V2, TypeScript/Node 20, PostgreSQL 15+, MikroORM (via Medusa), Knex (via `ContainerRegistrationKeys.PG_CONNECTION`), Jest + `@medusajs/test-utils`.

**Spec:** `docs/superpowers/specs/2026-04-13-customer-email-uniqueness-design.md`

**Working directory:** `/var/www/arrotti/my-medusa-store`

**Test approach (revised).** Original plan included an integration-test suite,
but two test-infra blockers (axios `validateStatus` defaults + missing
publishable-API-key middleware in the harness) made the cost-benefit unfavorable
for this feature. Verification is **manual smoke test** in Task 3 (curl against
the live route after deploy). The DB-level partial unique index from Task 1 is
the durable safety net — application drift cannot defeat it. Test infra
prerequisites (`.env.test` with `DB_USERNAME/PASSWORD/HOST`, `medusa` role
`CREATEDB` grant) are left in place for whenever a real test suite is added
later.

**Binding syntax.** `db.raw()` is Knex, so raw SQL uses `?` positional
placeholders with an array of bindings (not Postgres-native `$1`).

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `src/scripts/add-customer-email-uniqueness-index.ts` | Create | One-off migration: pre-flight checks for duplicates, creates the partial unique index concurrently, verifies creation. Run via `npx medusa exec`. |
| `src/api/store/customers/register-wholesale/route.ts` | Modify | Normalize email, case-insensitive lookup via raw SQL, branch into upgrade-in-place vs create-new. Catch unique-index violations on the create path. |

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

## Task 2: Modify the wholesale registration route

**Files:**
- Modify: `src/api/store/customers/register-wholesale/route.ts`

This single task replaces the original Tasks 2–7 (integration tests and TDD red/green cycles) per the Path B pivot: no automated tests, manual smoke verification in Task 3.

- [ ] **Step 1: Add `ContainerRegistrationKeys` to imports**

In `route.ts`, change the existing imports line from:

```ts
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
```

to (no change — `ContainerRegistrationKeys` is already imported in this codebase per Task 1's pattern; if for some reason only `Modules` is imported, add `ContainerRegistrationKeys`).

Verify the import line exists. If you need to add it:

```ts
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
```

- [ ] **Step 2: Replace the lookup block**

Locate the block (currently around lines 141–150):

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

Replace with:

```ts
    // Normalize email and look up existing rows case-insensitively via
    // raw SQL — same semantics as the partial unique index
    // (LOWER(email) WHERE has_account = true AND deleted_at IS NULL).
    const emailLc = body.email.trim().toLowerCase()

    const customerModule = req.scope.resolve(Modules.CUSTOMER)
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

    const { rows: existingRows } = await db.raw(
      `SELECT id, email, has_account, first_name, last_name,
              company_name, phone, metadata, created_at
         FROM customer
        WHERE LOWER(email) = ? AND deleted_at IS NULL
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

- [ ] **Step 3: Normalize email at the auth-register call**

Around line 159 (auth register call), change `email: body.email` to `email: emailLc`:

```ts
      authResult = await authModule.register("emailpass", {
        body: {
          email: emailLc,
          password: body.password,
        },
      } as any)
```

- [ ] **Step 4: Replace the customer-creation block with the upgrade-or-create branch**

Locate the block starting at "// 4. Create customer account linked to auth identity" (around line 185) through the existing `res.status(201).json({...})` and `return` at the end of the try-block (around line 223). The whole sequence to replace is:

```ts
    // 4. Create customer account linked to auth identity
    const customerData = {
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      company_name: body.company_name || null,
      phone: body.phone || null,
      has_account: true,
      metadata: {
        tax_id: body.tax_id || null,
        tax_documents: taxDocuments,
        registration_date: new Date().toISOString(),
        pending_approval: true,
        registration_source: "wholesale_portal",
      },
    }

    const { result: customerResult } = await createCustomerAccountWorkflow(req.scope).run({
      input: {
        authIdentityId,
        customerData,
      },
    })

    logger.info(
      `[Wholesale Registration] Created wholesale customer ${customerResult.id} (${body.email})`
    )

    // Return success response (user will need to log in separately)
    res.status(201).json({
      customer: {
        id: customerResult.id,
        email: customerResult.email,
        first_name: customerResult.first_name,
        last_name: customerResult.last_name,
        company_name: customerResult.company_name,
      },
      message: "Registration successful. Your account is pending approval.",
    })
```

Replace it with:

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
      // Upgrade-in-place: keep the existing guest row so historical
      // carts/orders stay attached. Then link the auth_identity to it.
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

      logger.info(
        `[Wholesale Registration] Created wholesale customer ${customerResult.id} (${emailLc})`
      )
    }

    res.status(201).json({
      customer: customerResult,
      message: "Registration successful. Your account is pending approval.",
    })
    return
```

- [ ] **Step 5: Typecheck**

```bash
cd /var/www/arrotti/my-medusa-store
npx tsc --noEmit -p tsconfig.json
```

Expected: exits 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/api/store/customers/register-wholesale/route.ts
git commit -m "feat(register-wholesale): case-insensitive dedupe + guest upgrade-in-place"
```

---

## Task 3: Build, deploy, and manual smoke test in production

**Files:** no code changes

This task replaces the original Task 8.

- [ ] **Step 1: Build**

```bash
cd /var/www/arrotti/my-medusa-store
npm run build
```

Expected output ends with:
```
info:    Backend build completed successfully
info:    Frontend build completed successfully
```

- [ ] **Step 2: Restart the backend service**

```bash
sudo systemctl restart medusa-backend.service
```

- [ ] **Step 3: Service health check**

```bash
sleep 2
systemctl is-active medusa-backend.service
curl -sS -o /dev/null -w "health: %{http_code}\n" http://localhost:9002/health
```

Expected:
```
active
health: 200
```

- [ ] **Step 4: Capture publishable API key for smoke test**

```bash
PUB_KEY=$(grep NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY /var/www/arrotti/my-medusa-store-storefront-b2b/.env.local | cut -d= -f2)
echo "key found: ${PUB_KEY:0:8}..."
```

Expected: prints first 8 chars of the key. If empty, look in `.env.production` instead.

- [ ] **Step 5: Smoke test — happy path (new email → 201)**

```bash
STAMP=$(date +%s)
EMAIL="smoke-${STAMP}@example.com"
curl -sS -X POST http://localhost:9002/store/customers/register-wholesale \
  -H "x-publishable-api-key: ${PUB_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"SmokeTest1!\",\"first_name\":\"Smoke\",\"last_name\":\"Test\"}" \
  -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 201, response body contains `"customer":{"id":"cus_..."` and the `email` matches `${EMAIL}` lowercased.

- [ ] **Step 6: Smoke test — case-variant rejection (uppercased email → 409)**

```bash
curl -sS -X POST http://localhost:9002/store/customers/register-wholesale \
  -H "x-publishable-api-key: ${PUB_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$(echo ${EMAIL} | tr a-z A-Z)\",\"password\":\"SmokeTest1!\",\"first_name\":\"Smoke\",\"last_name\":\"Test\"}" \
  -w "\nHTTP %{http_code}\n"
```

Expected: HTTP 409, message `"An account with this email already exists. Please sign in instead."`.

- [ ] **Step 7: Smoke test — guest upgrade in place**

```bash
GUEST_EMAIL="guest-smoke-${STAMP}@example.com"
GUEST_ID="cus_smoke_$(date +%s%N | cut -c1-20)"

# Seed a guest row directly in the DB (bypassing the route, mimicking a guest checkout)
PGPASSWORD=medusa123 psql -U medusa -h localhost -d medusa-my-medusa-store -c \
  "INSERT INTO customer (id, email, has_account, first_name, last_name, created_at, updated_at)
   VALUES ('${GUEST_ID}', '${GUEST_EMAIL}', false, 'Guest', 'Buyer', NOW(), NOW());"

# Count rows for that email — should be 1
PGPASSWORD=medusa123 psql -U medusa -h localhost -d medusa-my-medusa-store -t -c \
  "SELECT COUNT(*) FROM customer WHERE LOWER(email)='${GUEST_EMAIL}';"

# Now register via the route — should upgrade in place
curl -sS -X POST http://localhost:9002/store/customers/register-wholesale \
  -H "x-publishable-api-key: ${PUB_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${GUEST_EMAIL}\",\"password\":\"SmokeTest1!\",\"first_name\":\"Upgraded\",\"last_name\":\"User\",\"company_name\":\"Upgrade Co\"}" \
  -w "\nHTTP %{http_code}\n"

# Count rows again — should still be 1, and that row should now have has_account=true
PGPASSWORD=medusa123 psql -U medusa -h localhost -d medusa-my-medusa-store -c \
  "SELECT id, email, has_account, company_name FROM customer WHERE LOWER(email)='${GUEST_EMAIL}';"
```

Expected: HTTP 201; final SELECT returns exactly one row with `id=${GUEST_ID}`, `has_account=t`, `company_name='Upgrade Co'`.

- [ ] **Step 8: Clean up the smoke-test customers**

```bash
PGPASSWORD=medusa123 psql -U medusa -h localhost -d medusa-my-medusa-store -c \
  "DELETE FROM provider_identity WHERE entity_id LIKE 'smoke-%@example.com' OR entity_id LIKE 'guest-smoke-%@example.com';
   DELETE FROM customer WHERE email LIKE 'smoke-%@example.com' OR email LIKE 'guest-smoke-%@example.com';"
```

- [ ] **Step 9: Push to origin**

```bash
cd /var/www/arrotti/my-medusa-store
git push origin main
```

Expected: successful push, all new commits on GitHub.

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
