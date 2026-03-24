import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SUPPLIER_MODULE } from "../../../../modules/supplier"
import SupplierModuleService from "../../../../modules/supplier/service"
import {
  calculateSellPrice,
  getEffectiveMarkup,
  findPricingSupplier,
  recalculateVariantPrice,
  VariantSupplierLink,
} from "../../../../services/auto-pricing"

/**
 * GET /admin/product-variant-suppliers/:product_id
 * Get all supplier info for all variants of a product
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  console.log("[ROUTE] GET /admin/product-variant-suppliers/:product_id called")
  const { product_id: productId } = req.params

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Get product variants
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "variants.id", "variants.sku", "variants.title"],
      filters: {
        id: productId,
      },
    })

    if (!products || products.length === 0) {
      res.status(404).json({ message: "Product not found" })
      return
    }

    const product = products[0] as any
    const variants = product.variants || []
    const variantIds = variants.map((v: any) => v.id)

    if (variantIds.length === 0) {
      res.json({ variants: [] })
      return
    }

    // Get all supplier links for these variants
    const { data: links } = await query.graph({
      entity: "product_variant_supplier",
      fields: [
        "product_variant_id",
        "supplier_id",
        "supplier_sku",
        "partslink_no",
        "oem_number",
        "cost_price",
        "markup_override",
        "stock_qty",
        "is_primary",
        "supplier.id",
        "supplier.name",
        "supplier.code",
        "supplier.default_markup",
      ],
      filters: {
        product_variant_id: variantIds,
      },
    })

    // Group links by variant
    const linksByVariant = new Map<string, VariantSupplierLink[]>()
    for (const link of links as VariantSupplierLink[]) {
      const variantId = link.product_variant_id
      if (!linksByVariant.has(variantId)) {
        linksByVariant.set(variantId, [])
      }
      linksByVariant.get(variantId)!.push(link)
    }

    // Build response
    const variantsWithSuppliers = variants.map((variant: any) => {
      const variantLinks = linksByVariant.get(variant.id) || []
      const pricingSupplier = findPricingSupplier(variantLinks)

      const suppliers = variantLinks.map((link) => {
        const supplierMarkup = link.supplier?.default_markup ?? 20
        const effectiveMarkup = getEffectiveMarkup(link, supplierMarkup)
        const costPrice = link.cost_price != null ? Number(link.cost_price) : null

        return {
          supplier_id: link.supplier_id,
          supplier: link.supplier,
          supplier_sku: link.supplier_sku,
          partslink_no: link.partslink_no,
          oem_number: link.oem_number,
          cost_price: costPrice,
          markup_override:
            link.markup_override != null ? Number(link.markup_override) : null,
          stock_qty: link.stock_qty != null ? Number(link.stock_qty) : 0,
          is_primary: link.is_primary ?? false,
          effective_markup: effectiveMarkup,
          calculated_sell_price:
            costPrice != null ? calculateSellPrice(costPrice, effectiveMarkup) : null,
        }
      })

      return {
        variant_id: variant.id,
        variant_sku: variant.sku,
        variant_title: variant.title,
        suppliers,
        pricing_supplier_id: pricingSupplier?.supplier_id ?? null,
      }
    })

    console.log("[ROUTE] Returning variants:", variantsWithSuppliers.length)
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate")
    res.json({ variants: variantsWithSuppliers })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * POST /admin/products/:product_id/variants/suppliers
 * Bulk add a supplier to all variants of a product
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params
  const body = req.body as {
    supplier_id: string
    // Optional per-variant cost prices: { [variant_id]: cost_price }
    variant_costs?: Record<string, number | null>
    // Optional per-variant stock qty: { [variant_id]: stock_qty }
    variant_stock?: Record<string, number | null>
    // Default values for all variants
    markup_override?: number | string | null
    stock_qty?: number | string | null
    is_primary?: boolean
    auto_update_prices?: boolean
  }

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  const supplierId = body.supplier_id?.trim()
  if (!supplierId) {
    res.status(400).json({ message: "supplier_id is required" })
    return
  }

  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Verify supplier exists
    const suppliers = await supplierService.listSuppliers({ id: supplierId })
    if (!suppliers.length) {
      res.status(404).json({ message: "Supplier not found" })
      return
    }

    // Get product variants
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "variants.id", "variants.sku"],
      filters: {
        id: productId,
      },
    })

    if (!products || products.length === 0) {
      res.status(404).json({ message: "Product not found" })
      return
    }

    const product = products[0] as any
    const variants = product.variants || []

    if (variants.length === 0) {
      res.status(400).json({ message: "Product has no variants" })
      return
    }

    const variantIds = variants.map((v: any) => v.id)
    const isPrimary = body.is_primary ?? false
    const markupOverride =
      body.markup_override != null && body.markup_override !== ""
        ? Number(body.markup_override)
        : null

    if (markupOverride !== null && isNaN(markupOverride)) {
      res.status(400).json({ message: "markup_override must be a valid number" })
      return
    }

    // If setting as primary, unset existing primaries for all variants
    if (isPrimary) {
      const { data: existingPrimary } = await query.graph({
        entity: "product_variant_supplier",
        fields: [
          "product_variant_id",
          "supplier_id",
          "supplier_sku",
          "partslink_no",
          "oem_number",
          "cost_price",
          "markup_override",
          "stock_qty",
        ],
        filters: {
          product_variant_id: variantIds,
          is_primary: true,
        },
      })

      for (const pl of existingPrimary as any[]) {
        await link.dismiss({
          [Modules.PRODUCT]: { product_variant_id: pl.product_variant_id },
          supplier: { supplier_id: pl.supplier_id },
        })

        await link.create({
          [Modules.PRODUCT]: { product_variant_id: pl.product_variant_id },
          supplier: { supplier_id: pl.supplier_id },
          data: {
            supplier_sku: pl.supplier_sku,
            partslink_no: pl.partslink_no,
            oem_number: pl.oem_number,
            cost_price: pl.cost_price,
            markup_override: pl.markup_override,
            stock_qty: pl.stock_qty ?? 0,
            is_primary: false,
          },
        })
      }
    }

    // Check for existing links to this supplier
    const { data: existingLinks } = await query.graph({
      entity: "product_variant_supplier",
      fields: ["product_variant_id", "supplier_id"],
      filters: {
        product_variant_id: variantIds,
        supplier_id: supplierId,
      },
    })

    const existingVariantIds = new Set(
      (existingLinks as any[]).map((l) => l.product_variant_id)
    )

    // Create links for variants that don't have this supplier
    const results = { created: 0, skipped: 0 }

    const defaultStockQty =
      body.stock_qty != null && body.stock_qty !== ""
        ? Number(body.stock_qty)
        : 0

    if (isNaN(defaultStockQty)) {
      res.status(400).json({ message: "stock_qty must be a valid number" })
      return
    }

    for (const variant of variants) {
      if (existingVariantIds.has(variant.id)) {
        results.skipped++
        continue
      }

      const costPrice = body.variant_costs?.[variant.id] ?? null
      const stockQty = body.variant_stock?.[variant.id] ?? defaultStockQty

      await link.create({
        [Modules.PRODUCT]: { product_variant_id: variant.id },
        supplier: { supplier_id: supplierId },
        data: {
          supplier_sku: null,
          partslink_no: null,
          oem_number: null,
          cost_price: costPrice,
          markup_override: markupOverride,
          stock_qty: stockQty,
          is_primary: isPrimary,
        },
      })

      results.created++

      // Note: Auto-pricing does NOT run on add - only on save/edit
    }

    res.status(201).json({
      message: `Added supplier to ${results.created} variants (${results.skipped} already linked)`,
      ...results,
    })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * DELETE /admin/products/:product_id/variants/suppliers
 * Bulk remove a supplier from all variants of a product
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params
  const { supplier_id: supplierId } = req.query as { supplier_id?: string }

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  if (!supplierId) {
    res.status(400).json({ message: "supplier_id query parameter is required" })
    return
  }

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Get product variants
    const { data: products } = await query.graph({
      entity: "product",
      fields: ["id", "variants.id"],
      filters: {
        id: productId,
      },
    })

    if (!products || products.length === 0) {
      res.status(404).json({ message: "Product not found" })
      return
    }

    const product = products[0] as any
    const variantIds = (product.variants || []).map((v: any) => v.id)

    if (variantIds.length === 0) {
      res.json({ deleted: 0 })
      return
    }

    // Get existing links
    const { data: existingLinks } = await query.graph({
      entity: "product_variant_supplier",
      fields: ["product_variant_id"],
      filters: {
        product_variant_id: variantIds,
        supplier_id: supplierId,
      },
    })

    // Remove all links
    let deleted = 0
    for (const existingLink of existingLinks as any[]) {
      await link.dismiss({
        [Modules.PRODUCT]: { product_variant_id: existingLink.product_variant_id },
        supplier: { supplier_id: supplierId },
      })
      deleted++
    }

    res.json({ deleted })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}
