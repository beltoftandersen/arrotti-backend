import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import BrandModuleService from "../../../../../modules/brand/service"
import { BRAND_MODULE } from "../../../../../modules/brand"

type SeoBody = {
  seo_title?: string | null
  seo_description?: string | null
  seo_keywords?: string | null
}

// GET /admin/brands/:id/seo
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  if (!id) {
    res.status(400).json({ message: "Brand ID is required" })
    return
  }

  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  try {
    const brands = await brandService.listBrands({ id })

    if (!brands.length) {
      res.status(404).json({ message: "Brand not found" })
      return
    }

    const brand = brands[0]
    const metadata = (brand.metadata || {}) as Record<string, unknown>

    res.json({
      seo: {
        seo_title: metadata.seo_title || null,
        seo_description: metadata.seo_description || null,
        seo_keywords: metadata.seo_keywords || null,
      },
    })
  } catch (error: any) {
    console.error("Error fetching brand SEO:", error)
    res.status(500).json({
      message: error.message || "Failed to fetch SEO",
    })
  }
}

// POST /admin/brands/:id/seo
export async function POST(req: MedusaRequest<SeoBody>, res: MedusaResponse) {
  const { id } = req.params
  const { seo_title, seo_description, seo_keywords } = req.body

  if (!id) {
    res.status(400).json({ message: "Brand ID is required" })
    return
  }

  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  try {
    // Get current brand metadata
    const brands = await brandService.listBrands({ id })

    if (!brands.length) {
      res.status(404).json({ message: "Brand not found" })
      return
    }

    const brand = brands[0]
    const currentMetadata = (brand.metadata || {}) as Record<string, unknown>

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

    // Update brand using selector format
    await brandService.updateBrands({
      selector: { id },
      data: { metadata: updatedMetadata },
    })

    res.json({
      seo: {
        seo_title: updatedMetadata.seo_title || null,
        seo_description: updatedMetadata.seo_description || null,
        seo_keywords: updatedMetadata.seo_keywords || null,
      },
    })
  } catch (error: any) {
    console.error("Error updating brand SEO:", error)
    res.status(500).json({
      message: error.message || "Failed to update SEO",
    })
  }
}
