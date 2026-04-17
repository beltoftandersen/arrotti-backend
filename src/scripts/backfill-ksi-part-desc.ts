/**
 * One-off: backfill ksi_part_desc onto product_variant.metadata.
 *
 * Reads ksi_r_products.part_desc (from ksi_data DB) and writes it to each
 * variant whose metadata.ksi_no matches. Idempotent — safe to re-run.
 *
 * Prerequisites:
 *   1. sync-ksi.py has run at least once today (daily 11:50 UTC)
 *      so ksi_r_products is populated.
 *   2. Existing variants already have metadata.ksi_no set (from prior imports).
 *
 * Does NOT require import_ready to be rebuilt — reads ksi_r_products directly.
 *
 * Usage: npx medusa exec ./src/scripts/backfill-ksi-part-desc.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { Pool } from "pg"

export default async function backfillKsiPartDesc({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productModuleService = container.resolve(Modules.PRODUCT)

  logger.info("=== Backfill ksi_part_desc to variant metadata ===")
  const start = Date.now()

  // Load ksi_no -> part_desc map
  const ksiPool = new Pool({
    database: "ksi_data",
    user: "medusa",
    password: "medusa123",
    host: "localhost",
  })
  const ksiRes = await ksiPool.query<{ ksi_no: string; part_desc: string | null }>(`
    SELECT DISTINCT ON (ksi_no) ksi_no, part_desc
    FROM ksi_r_products
    WHERE part_desc IS NOT NULL AND part_desc <> ''
    ORDER BY ksi_no
  `)
  await ksiPool.end()

  const byKsi = new Map<string, string>()
  for (const r of ksiRes.rows) {
    if (r.ksi_no && r.part_desc) byKsi.set(r.ksi_no, r.part_desc)
  }
  logger.info(`Loaded ${byKsi.size.toLocaleString()} ksi_no → part_desc mappings`)

  // Pull all variants with metadata.ksi_no directly from medusa DB
  const medusaPool = new Pool({
    connectionString: process.env.DATABASE_URL || "postgres://medusa:medusa123@localhost/medusa-my-medusa-store",
  })
  const vRes = await medusaPool.query<{ id: string; metadata: any }>(`
    SELECT id, metadata
    FROM product_variant
    WHERE metadata->>'ksi_no' IS NOT NULL
      AND metadata->>'ksi_no' <> ''
      AND deleted_at IS NULL
  `)
  await medusaPool.end()

  logger.info(`Found ${vRes.rows.length.toLocaleString()} variants with metadata.ksi_no`)

  let updated = 0
  let alreadyCorrect = 0
  let noMatch = 0
  let errors = 0

  const CHUNK = 50
  for (let i = 0; i < vRes.rows.length; i += CHUNK) {
    const chunk = vRes.rows.slice(i, i + CHUNK)

    await Promise.all(chunk.map(async (v) => {
      const meta = (v.metadata ?? {}) as Record<string, unknown>
      const ksiNo = String(meta.ksi_no ?? "")
      const partDesc = byKsi.get(ksiNo)

      if (!partDesc) { noMatch++; return }
      if (meta.ksi_part_desc === partDesc) { alreadyCorrect++; return }

      try {
        await productModuleService.updateProductVariants(v.id, {
          metadata: { ...meta, ksi_part_desc: partDesc },
        })
        updated++
      } catch (err: any) {
        if (errors < 5) logger.warn(`  update ${v.id}: ${err.message}`)
        errors++
      }
    }))

    const done = Math.min(i + CHUNK, vRes.rows.length)
    if (done % 5000 === 0 || done === vRes.rows.length) {
      logger.info(`  progress: ${done.toLocaleString()} / ${vRes.rows.length.toLocaleString()}  updated=${updated.toLocaleString()}`)
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(0)
  logger.info(`=== Done in ${elapsed}s ===`)
  logger.info(`  updated:         ${updated.toLocaleString()}`)
  logger.info(`  already correct: ${alreadyCorrect.toLocaleString()}`)
  logger.info(`  no match:        ${noMatch.toLocaleString()}`)
  logger.info(`  errors:          ${errors.toLocaleString()}`)
}
