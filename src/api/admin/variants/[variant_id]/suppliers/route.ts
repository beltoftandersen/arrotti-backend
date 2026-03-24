import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SUPPLIER_MODULE } from "../../../../../modules/supplier"
import SupplierModuleService from "../../../../../modules/supplier/service"
import {
  calculateSellPrice,
  getEffectiveMarkup,
  findPricingSupplier,
  recalculateVariantPrice,
  VariantSupplierLink,
} from "../../../../../services/auto-pricing"

/**
 * GET /admin/variants/:variant_id/suppliers
 * Get all suppliers linked to a variant with pricing info
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { variant_id: variantId } = req.params

  if (!variantId) {
    res.status(400).json({ message: "variant_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Get all supplier links for this variant
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
        "supplier.email",
        "supplier.default_markup",
      ],
      filters: {
        product_variant_id: variantId,
      },
    })

    // Calculate effective markup and sell price for each link
    const suppliersWithPricing = (links as VariantSupplierLink[]).map((link) => {
      const supplierMarkup = link.supplier?.default_markup ?? 20
      const effectiveMarkup = getEffectiveMarkup(link, supplierMarkup)
      const costPrice = link.cost_price != null ? Number(link.cost_price) : null
      const calculatedSellPrice =
        costPrice != null ? calculateSellPrice(costPrice, effectiveMarkup) : null

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
        calculated_sell_price: calculatedSellPrice,
      }
    })

    // Find the pricing supplier (primary or lowest cost)
    const pricingSupplier = findPricingSupplier(links as VariantSupplierLink[])

    res.json({
      suppliers: suppliersWithPricing,
      pricing_supplier_id: pricingSupplier?.supplier_id ?? null,
    })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * POST /admin/variants/:variant_id/suppliers
 * Add a supplier to a variant
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { variant_id: variantId } = req.params
  const body = req.body as {
    supplier_id: string
    supplier_sku?: string
    partslink_no?: string
    oem_number?: string
    cost_price?: number | string | null
    markup_override?: number | string | null
    stock_qty?: number | string | null
    is_primary?: boolean
    auto_update_price?: boolean
  }

  if (!variantId) {
    res.status(400).json({ message: "variant_id is required" })
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

    // Check if link already exists
    const { data: existingLinks } = await query.graph({
      entity: "product_variant_supplier",
      fields: ["supplier_id"],
      filters: {
        product_variant_id: variantId,
        supplier_id: supplierId,
      },
    })

    if (existingLinks && existingLinks.length > 0) {
      res.status(409).json({ message: "Supplier already linked to this variant" })
      return
    }

    // Parse and validate numeric values
    const costPrice =
      body.cost_price != null && body.cost_price !== ""
        ? Number(body.cost_price)
        : null
    const markupOverride =
      body.markup_override != null && body.markup_override !== ""
        ? Number(body.markup_override)
        : null
    const stockQty =
      body.stock_qty != null && body.stock_qty !== ""
        ? Number(body.stock_qty)
        : 0

    if ((costPrice !== null && isNaN(costPrice)) ||
        (markupOverride !== null && isNaN(markupOverride)) ||
        isNaN(stockQty)) {
      res.status(400).json({ message: "cost_price, markup_override, and stock_qty must be valid numbers" })
      return
    }

    const isPrimary = body.is_primary ?? false

    // If setting as primary, unset any existing primary
    if (isPrimary) {
      const { data: allLinks } = await query.graph({
        entity: "product_variant_supplier",
        fields: ["supplier_id", "is_primary"],
        filters: {
          product_variant_id: variantId,
          is_primary: true,
        },
      })

      for (const existingLink of allLinks as any[]) {
        // Get full link data first
        const { data: [fullLinkData] } = await query.graph({
          entity: "product_variant_supplier",
          fields: [
            "supplier_id",
            "supplier_sku",
            "partslink_no",
            "oem_number",
            "cost_price",
            "markup_override",
            "stock_qty",
          ],
          filters: {
            product_variant_id: variantId,
            supplier_id: existingLink.supplier_id,
          },
        })

        if (fullLinkData) {
          await link.dismiss({
            [Modules.PRODUCT]: { product_variant_id: variantId },
            supplier: { supplier_id: existingLink.supplier_id },
          })

          await link.create({
            [Modules.PRODUCT]: { product_variant_id: variantId },
            supplier: { supplier_id: existingLink.supplier_id },
            data: {
              supplier_sku: (fullLinkData as any).supplier_sku,
              partslink_no: (fullLinkData as any).partslink_no,
              oem_number: (fullLinkData as any).oem_number,
              cost_price: (fullLinkData as any).cost_price,
              markup_override: (fullLinkData as any).markup_override,
              stock_qty: (fullLinkData as any).stock_qty ?? 0,
              is_primary: false,
            },
          })
        }
      }
    }

    // Create new link
    await link.create({
      [Modules.PRODUCT]: { product_variant_id: variantId },
      supplier: { supplier_id: supplierId },
      data: {
        supplier_sku: body.supplier_sku?.trim() || null,
        partslink_no: body.partslink_no?.trim() || null,
        oem_number: body.oem_number?.trim() || null,
        cost_price: costPrice,
        markup_override: markupOverride,
        stock_qty: stockQty,
        is_primary: isPrimary,
      },
    })

    // Note: Auto-pricing does NOT run on add - only on save/edit

    // Get created link with full data
    const { data: [createdLink] } = await query.graph({
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
        product_variant_id: variantId,
        supplier_id: supplierId,
      },
    })

    const link_data = createdLink as VariantSupplierLink
    const supplierMarkup = link_data.supplier?.default_markup ?? 20
    const effectiveMarkup = getEffectiveMarkup(link_data, supplierMarkup)

    res.status(201).json({
      supplier_id: link_data.supplier_id,
      supplier: link_data.supplier,
      supplier_sku: link_data.supplier_sku,
      partslink_no: link_data.partslink_no,
      oem_number: link_data.oem_number,
      cost_price: link_data.cost_price != null ? Number(link_data.cost_price) : null,
      markup_override:
        link_data.markup_override != null ? Number(link_data.markup_override) : null,
      stock_qty: link_data.stock_qty != null ? Number(link_data.stock_qty) : 0,
      is_primary: link_data.is_primary ?? false,
      effective_markup: effectiveMarkup,
      calculated_sell_price:
        costPrice != null ? calculateSellPrice(costPrice, effectiveMarkup) : null,
    })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}
