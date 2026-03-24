import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

// POST /admin/categories/:category_id/shipping/sync
// Bulk-applies category shipping defaults to all product variants in this category (and subcategories)
// Uses direct SQL for performance (handles 100k+ variants in seconds)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { category_id } = req.params
  const logger = req.scope.resolve("logger")
  const productService = req.scope.resolve(Modules.PRODUCT)
  const pgConnection = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  )

  try {
    // Get category and its shipping defaults
    const category = await productService.retrieveProductCategory(category_id, {
      select: ["id", "name", "metadata", "parent_category_id"],
    })

    const categoryMeta = (category.metadata || {}) as Record<string, any>
    let shipping = categoryMeta.shipping || {}

    // If subcategory, merge with parent values (parent as fallback)
    if (category.parent_category_id) {
      const parent = await productService.retrieveProductCategory(
        category.parent_category_id,
        { select: ["id", "metadata"] }
      )
      const parentMeta = (parent.metadata || {}) as Record<string, any>
      const parentShipping = parentMeta.shipping || {}
      shipping = {
        weight: shipping.weight ?? parentShipping.weight,
        length: shipping.length ?? parentShipping.length,
        width: shipping.width ?? parentShipping.width,
        height: shipping.height ?? parentShipping.height,
      }
    }

    if (!shipping.weight && !shipping.length && !shipping.width && !shipping.height) {
      return res.status(400).json({
        message: "No shipping defaults found for this category or its parent",
      })
    }

    // Collect all category IDs (this + subcategories)
    const categoryIds = [category_id]
    const subcategories = await productService.listProductCategories(
      { parent_category_id: category_id },
      { select: ["id"] }
    )
    for (const sub of subcategories) {
      categoryIds.push(sub.id)
    }

    // Build SET clauses for all fields that have values
    // Knex uses ? for bindings
    const setClauses: string[] = []
    const params: any[] = []

    if (shipping.weight) {
      setClauses.push(`weight = ?`)
      params.push(shipping.weight)
    }
    if (shipping.length) {
      setClauses.push(`length = ?`)
      params.push(shipping.length)
    }
    if (shipping.width) {
      setClauses.push(`width = ?`)
      params.push(shipping.width)
    }
    if (shipping.height) {
      setClauses.push(`height = ?`)
      params.push(shipping.height)
    }

    if (setClauses.length === 0) {
      return res.json({ success: true, updated_variants: 0, total_products: 0, categories_synced: categoryIds.length })
    }

    // Parameterize category IDs
    const catIdPlaceholders = categoryIds.map(() => "?").join(", ")
    params.push(...categoryIds)

    const sql = `
      UPDATE product_variant pv
      SET ${setClauses.join(", ")}, updated_at = NOW()
      WHERE pv.product_id IN (
        SELECT DISTINCT pcp.product_id
        FROM product_category_product pcp
        WHERE pcp.product_category_id IN (${catIdPlaceholders})
      )
      AND pv.deleted_at IS NULL
    `

    const result = await pgConnection.raw(sql, params)
    const updatedCount = result.rowCount ?? result[0]?.rowCount ?? 0

    // Count total products for response
    const countResult = await pgConnection.raw(
      `SELECT COUNT(DISTINCT product_id) as cnt FROM product_category_product WHERE product_category_id IN (${catIdPlaceholders})`,
      categoryIds
    )
    const totalProducts = parseInt(countResult.rows?.[0]?.cnt || countResult[0]?.[0]?.cnt || "0")

    logger.info(
      `[category-shipping-sync] Bulk synced ${updatedCount} variants across ${totalProducts} products in category ${category.name}`
    )

    res.json({
      success: true,
      updated_variants: updatedCount,
      total_products: totalProducts,
      categories_synced: categoryIds.length,
    })
  } catch (error: any) {
    logger.error(`[category-shipping-sync] Bulk sync error: ${error.message}`)
    res.status(500).json({ message: error.message || "Failed to sync shipping defaults" })
  }
}
