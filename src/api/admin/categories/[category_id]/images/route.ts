import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

type ImagesBody = {
  thumbnail?: string | null
  image?: string | null
}

// GET /admin/categories/:category_id/images
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { category_id } = req.params

  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    const category = await productService.retrieveProductCategory(category_id, {
      select: ["id", "metadata"],
    })

    const metadata = (category.metadata || {}) as Record<string, unknown>

    res.json({
      images: {
        thumbnail: metadata.thumbnail || null,
        image: metadata.image || null,
      },
    })
  } catch (error: any) {
    res.status(404).json({
      message: "Category not found",
    })
  }
}

// POST /admin/categories/:category_id/images
export async function POST(req: MedusaRequest<ImagesBody>, res: MedusaResponse) {
  const { category_id } = req.params
  const { thumbnail, image } = req.body

  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    const category = await productService.retrieveProductCategory(category_id, {
      select: ["id", "metadata"],
    })

    const currentMetadata = (category.metadata || {}) as Record<string, unknown>
    const updatedMetadata: Record<string, unknown> = { ...currentMetadata }

    if (thumbnail !== undefined) {
      if (thumbnail) {
        updatedMetadata.thumbnail = thumbnail
      } else {
        delete updatedMetadata.thumbnail
      }
    }

    if (image !== undefined) {
      if (image) {
        updatedMetadata.image = image
      } else {
        delete updatedMetadata.image
      }
    }

    await productService.updateProductCategories(category_id, {
      metadata: updatedMetadata,
    })

    res.json({
      images: {
        thumbnail: updatedMetadata.thumbnail || null,
        image: updatedMetadata.image || null,
      },
    })
  } catch (error: any) {
    console.error("Error updating category images:", error)
    res.status(500).json({
      message: error.message || "Failed to update images",
    })
  }
}

// DELETE /admin/categories/:category_id/images
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { category_id } = req.params

  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    const category = await productService.retrieveProductCategory(category_id, {
      select: ["id", "metadata"],
    })

    const currentMetadata = (category.metadata || {}) as Record<string, unknown>
    const updatedMetadata: Record<string, unknown> = { ...currentMetadata }

    delete updatedMetadata.thumbnail
    delete updatedMetadata.image

    await productService.updateProductCategories(category_id, {
      metadata: updatedMetadata,
    })

    res.json({
      images: {
        thumbnail: null,
        image: null,
      },
    })
  } catch (error: any) {
    console.error("Error deleting category images:", error)
    res.status(500).json({
      message: error.message || "Failed to delete images",
    })
  }
}
