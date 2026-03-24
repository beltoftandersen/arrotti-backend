/**
 * Migration script: product_supplier → variant_supplier
 *
 * For each product_supplier link:
 * 1. Find all variants of that product
 * 2. Create variant_supplier link for each variant
 * 3. Copy supplier_sku, partslink_no, oem_number, cost_price
 * 4. Set first variant as primary (if product has multiple variants)
 *
 * Usage: npx medusa exec ./src/scripts/migrate-product-supplier-to-variant.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export default async function migrateProductSupplierToVariant({
  container,
}: ExecArgs) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)

  logger.info("[Migration] Starting product_supplier → variant_supplier migration")

  try {
    // 1. Get all product_supplier links
    const { data: productSupplierLinks } = await query.graph({
      entity: "product_supplier",
      fields: [
        "product_id",
        "supplier_id",
        "supplier_sku",
        "partslink_no",
        "oem_number",
        "cost_price",
      ],
    })

    logger.info(
      `[Migration] Found ${productSupplierLinks?.length ?? 0} product_supplier links to migrate`
    )

    if (!productSupplierLinks || productSupplierLinks.length === 0) {
      logger.info("[Migration] No links to migrate. Done.")
      return
    }

    // 2. Get unique product IDs
    const productIds = [
      ...new Set((productSupplierLinks as any[]).map((l) => l.product_id)),
    ]

    // 3. Get all variants for these products
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "variants.id"],
      filters: {
        id: productIds,
      },
    })

    // Build product → variants map
    const variantsByProduct = new Map<string, string[]>()
    for (const product of products as any[]) {
      const variantIds = (product.variants || []).map((v: any) => v.id)
      variantsByProduct.set(product.id, variantIds)
    }

    // 4. Check for existing variant_supplier links to avoid duplicates
    const allVariantIds = [...variantsByProduct.values()].flat()
    const { data: existingVariantLinks } = await query.graph({
      entity: "product_variant_supplier",
      fields: ["product_variant_id", "supplier_id"],
      filters: {
        product_variant_id: allVariantIds,
      },
    })

    // Build set of existing links for quick lookup
    const existingLinkSet = new Set(
      (existingVariantLinks as any[]).map(
        (l) => `${l.product_variant_id}:${l.supplier_id}`
      )
    )

    // 5. Migrate each product_supplier link to variant_supplier
    let created = 0
    let skipped = 0
    let errors = 0

    for (const psLink of productSupplierLinks as any[]) {
      const variantIds = variantsByProduct.get(psLink.product_id) || []

      if (variantIds.length === 0) {
        logger.warn(
          `[Migration] Product ${psLink.product_id} has no variants, skipping`
        )
        skipped++
        continue
      }

      for (let i = 0; i < variantIds.length; i++) {
        const variantId = variantIds[i]
        const linkKey = `${variantId}:${psLink.supplier_id}`

        if (existingLinkSet.has(linkKey)) {
          logger.debug(
            `[Migration] Link already exists for variant ${variantId} → supplier ${psLink.supplier_id}, skipping`
          )
          skipped++
          continue
        }

        try {
          // Create variant_supplier link
          // Set first variant as primary
          await link.create({
            [Modules.PRODUCT]: { product_variant_id: variantId },
            supplier: { supplier_id: psLink.supplier_id },
            data: {
              supplier_sku: psLink.supplier_sku,
              partslink_no: psLink.partslink_no,
              oem_number: psLink.oem_number,
              cost_price: psLink.cost_price,
              markup_override: null,
              is_primary: i === 0, // First variant is primary
            },
          })

          created++
          existingLinkSet.add(linkKey) // Prevent duplicates in same run

          if (created % 100 === 0) {
            logger.info(`[Migration] Created ${created} variant_supplier links...`)
          }
        } catch (err) {
          logger.error(
            `[Migration] Error creating link for variant ${variantId}: ${(err as Error).message}`
          )
          errors++
        }
      }
    }

    logger.info(
      `[Migration] Complete: ${created} created, ${skipped} skipped, ${errors} errors`
    )
  } catch (error) {
    logger.error(`[Migration] Failed: ${(error as Error).message}`)
    throw error
  }
}
