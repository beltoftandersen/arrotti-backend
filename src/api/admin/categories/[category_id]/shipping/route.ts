import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

type ShippingBody = {
  weight?: number | null
  length?: number | null
  width?: number | null
  height?: number | null
}

// GET /admin/categories/:category_id/shipping
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { category_id } = req.params
  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    const category = await productService.retrieveProductCategory(category_id, {
      select: ["id", "name", "metadata", "parent_category_id"],
    })

    const metadata = (category.metadata || {}) as Record<string, any>
    const shipping = metadata.shipping || {}

    // If this is a subcategory, also fetch parent's shipping for inheritance display
    let parentShipping: Record<string, any> | null = null
    if (category.parent_category_id) {
      const parent = await productService.retrieveProductCategory(
        category.parent_category_id,
        { select: ["id", "name", "metadata"] }
      )
      const parentMeta = (parent.metadata || {}) as Record<string, any>
      if (parentMeta.shipping) {
        parentShipping = {
          ...parentMeta.shipping,
          category_name: parent.name,
        }
      }
    }

    res.json({
      shipping: {
        weight: shipping.weight ?? null,
        length: shipping.length ?? null,
        width: shipping.width ?? null,
        height: shipping.height ?? null,
      },
      parent_shipping: parentShipping,
      is_subcategory: !!category.parent_category_id,
    })
  } catch (error: any) {
    res.status(404).json({ message: "Category not found" })
  }
}

// POST /admin/categories/:category_id/shipping
export async function POST(req: MedusaRequest<ShippingBody>, res: MedusaResponse) {
  const { category_id } = req.params
  const { weight, length, width, height } = req.body
  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    const category = await productService.retrieveProductCategory(category_id, {
      select: ["id", "metadata"],
    })

    const currentMetadata = (category.metadata || {}) as Record<string, any>

    // Build shipping object — only include non-null values
    const shipping: Record<string, number> = {}
    if (weight != null && weight > 0) shipping.weight = weight
    if (length != null && length > 0) shipping.length = length
    if (width != null && width > 0) shipping.width = width
    if (height != null && height > 0) shipping.height = height

    const updatedMetadata = { ...currentMetadata }
    if (Object.keys(shipping).length > 0) {
      updatedMetadata.shipping = shipping
    } else {
      delete updatedMetadata.shipping
    }

    await productService.updateProductCategories(category_id, {
      metadata: updatedMetadata,
    })

    res.json({
      shipping: {
        weight: shipping.weight ?? null,
        length: shipping.length ?? null,
        width: shipping.width ?? null,
        height: shipping.height ?? null,
      },
    })
  } catch (error: any) {
    console.error("Error updating category shipping:", error)
    res.status(500).json({ message: error.message || "Failed to update shipping" })
  }
}
