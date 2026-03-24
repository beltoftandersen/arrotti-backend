import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

type SeoBody = {
  seo_title?: string | null
  seo_description?: string | null
  seo_keywords?: string | null
}

// GET /admin/products/:product_id/seo
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { product_id } = req.params

  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    const product = await productService.retrieveProduct(product_id, {
      select: ["id", "metadata"],
    })

    const metadata = (product.metadata || {}) as Record<string, unknown>

    res.json({
      seo: {
        seo_title: metadata.seo_title || null,
        seo_description: metadata.seo_description || null,
        seo_keywords: metadata.seo_keywords || null,
      },
    })
  } catch (error: any) {
    res.status(404).json({
      message: "Product not found",
    })
  }
}

// POST /admin/products/:product_id/seo
export async function POST(req: MedusaRequest<SeoBody>, res: MedusaResponse) {
  const { product_id } = req.params
  const { seo_title, seo_description, seo_keywords } = req.body

  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    // Get current product metadata
    const product = await productService.retrieveProduct(product_id, {
      select: ["id", "metadata"],
    })

    const currentMetadata = (product.metadata || {}) as Record<string, unknown>

    // Build updated metadata
    const updatedMetadata: Record<string, unknown> = { ...currentMetadata }

    // Update or remove SEO fields
    if (seo_title !== undefined) {
      if (seo_title) {
        updatedMetadata.seo_title = seo_title
      } else {
        delete updatedMetadata.seo_title
      }
    }

    if (seo_description !== undefined) {
      if (seo_description) {
        updatedMetadata.seo_description = seo_description
      } else {
        delete updatedMetadata.seo_description
      }
    }

    if (seo_keywords !== undefined) {
      if (seo_keywords) {
        updatedMetadata.seo_keywords = seo_keywords
      } else {
        delete updatedMetadata.seo_keywords
      }
    }

    // Update product
    await productService.updateProducts(product_id, {
      metadata: updatedMetadata,
    })

    res.json({
      seo: {
        seo_title: updatedMetadata.seo_title || null,
        seo_description: updatedMetadata.seo_description || null,
        seo_keywords: updatedMetadata.seo_keywords || null,
      },
    })
  } catch (error: any) {
    console.error("Error updating product SEO:", error)
    res.status(500).json({
      message: error.message || "Failed to update SEO",
    })
  }
}
