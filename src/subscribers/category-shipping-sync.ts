import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type ProductEventData = {
  id: string
}

/**
 * Syncs category shipping defaults to product variants when products are created/updated.
 * Only sets values on variants where weight is 0 or null (doesn't overwrite manual values).
 */
export default async function categoryShippingSyncHandler({
  event: { data },
  container,
}: SubscriberArgs<ProductEventData>) {
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productService = container.resolve(Modules.PRODUCT)

  try {
    const productId = data.id

    // Get product with its categories and variants
    const { data: [product] } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "categories.id",
        "categories.parent_category_id",
        "categories.metadata",
        "variants.id",
        "variants.weight",
        "variants.length",
        "variants.width",
        "variants.height",
      ],
      filters: { id: productId },
    })

    if (!product?.categories?.length || !product?.variants?.length) return

    // Resolve effective shipping from category hierarchy
    const shipping = await resolveShippingDefaults(product.categories, productService)
    if (!shipping) return

    // Update variants that have no weight set (0 or null)
    const variantsToUpdate: { id: string; weight?: number; length?: number; width?: number; height?: number }[] = []

    for (const variant of product.variants) {
      const updates: Record<string, number> = {}
      let hasUpdates = false

      if ((!variant.weight || variant.weight === 0) && shipping.weight) {
        updates.weight = shipping.weight
        hasUpdates = true
      }
      if ((!variant.length || variant.length === 0) && shipping.length) {
        updates.length = shipping.length
        hasUpdates = true
      }
      if ((!variant.width || variant.width === 0) && shipping.width) {
        updates.width = shipping.width
        hasUpdates = true
      }
      if ((!variant.height || variant.height === 0) && shipping.height) {
        updates.height = shipping.height
        hasUpdates = true
      }

      if (hasUpdates) {
        variantsToUpdate.push({ id: variant.id, ...updates })
      }
    }

    if (variantsToUpdate.length > 0) {
      for (const { id, ...data } of variantsToUpdate) {
        await productService.updateProductVariants(id, data)
      }
      logger.info(
        `[category-shipping-sync] Updated ${variantsToUpdate.length} variants for product ${productId}`
      )
    }
  } catch (error: any) {
    logger.error(`[category-shipping-sync] Error: ${error.message}`)
  }
}

/**
 * Resolves effective shipping defaults from a product's categories.
 * Checks subcategory first, then falls back to parent category (inheritance).
 */
async function resolveShippingDefaults(
  categories: any[],
  productService: any
): Promise<{ weight?: number; length?: number; width?: number; height?: number } | null> {
  // Find the most specific (subcategory) first
  let subcategory = categories.find((c: any) => c.parent_category_id)
  let parentCategory = categories.find((c: any) => !c.parent_category_id)

  // If we only have a parent-level category, use it directly
  if (!subcategory && parentCategory) {
    const meta = (parentCategory.metadata || {}) as Record<string, any>
    return meta.shipping || null
  }

  // Get subcategory shipping
  const subMeta = (subcategory?.metadata || {}) as Record<string, any>
  const subShipping = subMeta.shipping || {}

  // If subcategory has all fields, no need to check parent
  if (subShipping.weight && subShipping.length && subShipping.width && subShipping.height) {
    return subShipping
  }

  // Fetch parent shipping for inheritance
  let parentShipping: Record<string, any> = {}
  const parentId = subcategory?.parent_category_id
  if (parentId) {
    // Check if parent is already in categories array
    if (parentCategory && parentCategory.id === parentId) {
      const parentMeta = (parentCategory.metadata || {}) as Record<string, any>
      parentShipping = parentMeta.shipping || {}
    } else {
      try {
        const parent = await productService.retrieveProductCategory(parentId, {
          select: ["id", "metadata"],
        })
        const parentMeta = (parent.metadata || {}) as Record<string, any>
        parentShipping = parentMeta.shipping || {}
      } catch {
        // Parent not found, continue with what we have
      }
    }
  }

  // Merge: subcategory values take precedence, fallback to parent
  const merged = {
    weight: subShipping.weight ?? parentShipping.weight ?? undefined,
    length: subShipping.length ?? parentShipping.length ?? undefined,
    width: subShipping.width ?? parentShipping.width ?? undefined,
    height: subShipping.height ?? parentShipping.height ?? undefined,
  }

  // Return null if no values at all
  if (!merged.weight && !merged.length && !merged.width && !merged.height) {
    return null
  }

  return merged
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
