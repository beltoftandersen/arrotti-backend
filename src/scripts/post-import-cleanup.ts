/**
 * Post-import cleanup script
 *
 * Fixes:
 * 1. Variants with allow_backorder = true → set to false
 * 2. Products without shipping profiles → assign default profile
 *
 * Usage: npx medusa exec ./src/scripts/post-import-cleanup.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModuleService = container.resolve(Modules.PRODUCT)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  logger.info("=== Post-Import Cleanup ===")

  // ============================================================
  // 1. Fix allow_backorder = true
  // ============================================================
  logger.info("\n--- Fix allow_backorder ---")

  let offset = 0
  const PAGE = 500
  let fixedBackorder = 0

  while (true) {
    const { data: variants } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "allow_backorder"],
      filters: { allow_backorder: true },
      pagination: { skip: offset, take: PAGE },
    })

    if (!variants || variants.length === 0) break

    for (const v of variants) {
      try {
        await productModuleService.updateProductVariants((v as any).id, {
          allow_backorder: false,
        })
        fixedBackorder++
      } catch (err: any) {
        logger.warn(`  Error fixing backorder ${(v as any).sku}: ${err.message}`)
      }
    }

    if (variants.length < PAGE) break
    // Don't advance offset — we're filtering on allow_backorder=true,
    // and each fix removes it from the result set
  }

  logger.info(`  Fixed ${fixedBackorder} variants`)

  // ============================================================
  // 2. Fix missing shipping profiles
  // ============================================================
  logger.info("\n--- Fix missing shipping profiles ---")

  const [shippingProfile] = await fulfillmentService.listShippingProfiles({})
  if (!shippingProfile) {
    logger.error("  No shipping profile found!")
    return
  }
  logger.info(`  Using shipping profile: ${shippingProfile.id}`)

  // Find products without shipping profile via direct SQL
  // (query.graph doesn't support NOT EXISTS easily)
  const pg = await import("pg")
  const pool = new pg.default.Pool({
    connectionString: process.env.DATABASE_URL || "postgres://medusa:medusa123@localhost/medusa-my-medusa-store",
  })

  const { rows: productsNoProfile } = await pool.query(`
    SELECT p.id FROM product p
    WHERE p.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM product_shipping_profile psp
        WHERE psp.product_id = p.id AND psp.deleted_at IS NULL
      )
  `)

  logger.info(`  Found ${productsNoProfile.length} products without shipping profile`)

  let fixedProfiles = 0
  const BATCH = 100

  for (let i = 0; i < productsNoProfile.length; i += BATCH) {
    const batch = productsNoProfile.slice(i, i + BATCH)

    // Insert directly into product_shipping_profile
    const values = batch.map((p: any) =>
      `('${p.id}', '${shippingProfile.id}', 'psp_' || substr(md5(random()::text || '${p.id}'), 1, 26), NOW(), NOW())`
    ).join(",\n")

    try {
      await pool.query(`
        INSERT INTO product_shipping_profile (product_id, shipping_profile_id, id, created_at, updated_at)
        VALUES ${values}
        ON CONFLICT (product_id, shipping_profile_id) DO NOTHING
      `)
      fixedProfiles += batch.length
    } catch (err: any) {
      logger.warn(`  Batch error: ${err.message}`)
    }
  }

  await pool.end()
  logger.info(`  Fixed ${fixedProfiles} products`)

  // ============================================================
  // Summary
  // ============================================================
  logger.info("\n=== Cleanup Complete ===")
  logger.info(`  Backorder fixed:     ${fixedBackorder}`)
  logger.info(`  Shipping profiles:   ${fixedProfiles}`)
}
