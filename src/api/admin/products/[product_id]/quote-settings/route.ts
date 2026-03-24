import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { ensureVariantPrices } from "../../../../../services/ensure-variant-prices"

type QuoteSettingsBody = {
  is_quote_only: boolean
}

// GET /admin/products/:product_id/quote-settings
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { product_id } = req.params

  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    const product = await productService.retrieveProduct(product_id, {
      select: ["id", "metadata"],
    })

    const metadata = (product.metadata || {}) as Record<string, unknown>

    res.json({
      is_quote_only: !!metadata.is_quote_only,
    })
  } catch (error: any) {
    res.status(404).json({
      message: "Product not found",
    })
  }
}

// POST /admin/products/:product_id/quote-settings
export async function POST(
  req: MedusaRequest<QuoteSettingsBody>,
  res: MedusaResponse
) {
  const { product_id } = req.params
  const { is_quote_only } = req.body

  const productService = req.scope.resolve(Modules.PRODUCT)

  try {
    // Get current product metadata
    const product = await productService.retrieveProduct(product_id, {
      select: ["id", "metadata"],
    })

    const currentMetadata = (product.metadata || {}) as Record<string, unknown>

    // Merge metadata — don't overwrite other keys
    const updatedMetadata: Record<string, unknown> = { ...currentMetadata }

    if (is_quote_only) {
      updatedMetadata.is_quote_only = true
    } else {
      delete updatedMetadata.is_quote_only
    }

    // Update product
    await productService.updateProducts(product_id, {
      metadata: updatedMetadata,
    })

    // When toggling ON, ensure all variants have at least a fallback price
    if (is_quote_only) {
      const created = await ensureVariantPrices(req.scope, product_id)
      if (created > 0) {
        const logger = req.scope.resolve("logger") as any
        logger.info(
          `[quote-settings] Created fallback prices for ${created} variants of product ${product_id}`
        )
      }
    }

    res.json({
      is_quote_only: !!updatedMetadata.is_quote_only,
    })
  } catch (error: any) {
    console.error("Error updating quote settings:", error)
    res.status(500).json({
      message: error.message || "Failed to update quote settings",
    })
  }
}
