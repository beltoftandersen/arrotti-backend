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
