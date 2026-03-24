import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  calculateSellPrice,
  getEffectiveMarkup,
  recalculateVariantPrice,
  VariantSupplierLink,
} from "../../../../../../services/auto-pricing"

/**
 * GET /admin/variants/:variant_id/suppliers/:supplier_id
 * Get a specific supplier link for a variant
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { variant_id: variantId, supplier_id: supplierId } = req.params

  if (!variantId || !supplierId) {
    res.status(400).json({ message: "variant_id and supplier_id are required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
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
        supplier_id: supplierId,
      },
    })

    if (!links || links.length === 0) {
      res.status(404).json({ message: "Supplier link not found" })
      return
    }

    const link = links[0] as VariantSupplierLink
    const supplierMarkup = link.supplier?.default_markup ?? 20
    const effectiveMarkup = getEffectiveMarkup(link, supplierMarkup)
    const costPrice = link.cost_price != null ? Number(link.cost_price) : null

    res.json({
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
    })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}

/**
 * PATCH /admin/variants/:variant_id/suppliers/:supplier_id
 * Update a supplier link for a variant
 */
export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const { variant_id: variantId, supplier_id: supplierId } = req.params
  const body = req.body as {
    supplier_sku?: string | null
    partslink_no?: string | null
    oem_number?: string | null
    cost_price?: number | string | null
    markup_override?: number | string | null
    stock_qty?: number | string | null
    is_primary?: boolean
    auto_update_price?: boolean
  }

  if (!variantId || !supplierId) {
    res.status(400).json({ message: "variant_id and supplier_id are required" })
    return
  }

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Get existing link
    const { data: existingLinks } = await query.graph({
      entity: "product_variant_supplier",
      fields: [
        "supplier_id",
        "supplier_sku",
        "partslink_no",
        "oem_number",
        "cost_price",
        "markup_override",
        "stock_qty",
        "is_primary",
      ],
      filters: {
        product_variant_id: variantId,
        supplier_id: supplierId,
      },
    })

    if (!existingLinks || existingLinks.length === 0) {
      res.status(404).json({ message: "Supplier link not found" })
      return
    }

    const existing = existingLinks[0] as any

    // If setting as primary, unset other primary links
    if (body.is_primary === true && !existing.is_primary) {
      const { data: primaryLinks } = await query.graph({
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
          is_primary: true,
        },
      })

      for (const primaryLink of primaryLinks as any[]) {
        await link.dismiss({
          [Modules.PRODUCT]: { product_variant_id: variantId },
          supplier: { supplier_id: primaryLink.supplier_id },
        })

        await link.create({
          [Modules.PRODUCT]: { product_variant_id: variantId },
          supplier: { supplier_id: primaryLink.supplier_id },
          data: {
            supplier_sku: primaryLink.supplier_sku,
            partslink_no: primaryLink.partslink_no,
            oem_number: primaryLink.oem_number,
            cost_price: primaryLink.cost_price,
            markup_override: primaryLink.markup_override,
            stock_qty: primaryLink.stock_qty ?? 0,
            is_primary: false,
          },
        })
      }
    }

    // Update link by dismissing and recreating
    await link.dismiss({
      [Modules.PRODUCT]: { product_variant_id: variantId },
      supplier: { supplier_id: supplierId },
    })

    // Determine new values
    const newCostPrice =
      body.cost_price !== undefined
        ? body.cost_price !== null && body.cost_price !== ""
          ? Number(body.cost_price)
          : null
        : existing.cost_price

    const newMarkupOverride =
      body.markup_override !== undefined
        ? body.markup_override !== null && body.markup_override !== ""
          ? Number(body.markup_override)
          : null
        : existing.markup_override

    const newStockQty =
      body.stock_qty !== undefined
        ? body.stock_qty !== null && body.stock_qty !== ""
          ? Number(body.stock_qty)
          : 0
        : existing.stock_qty ?? 0

    if ((newCostPrice !== null && isNaN(Number(newCostPrice))) ||
        (newMarkupOverride !== null && isNaN(Number(newMarkupOverride))) ||
        isNaN(Number(newStockQty))) {
      res.status(400).json({ message: "cost_price, markup_override, and stock_qty must be valid numbers" })
      return
    }

    await link.create({
      [Modules.PRODUCT]: { product_variant_id: variantId },
      supplier: { supplier_id: supplierId },
      data: {
        supplier_sku:
          body.supplier_sku !== undefined
            ? body.supplier_sku?.trim() || null
            : existing.supplier_sku,
        partslink_no:
          body.partslink_no !== undefined
            ? body.partslink_no?.trim() || null
            : existing.partslink_no,
        oem_number:
          body.oem_number !== undefined
            ? body.oem_number?.trim() || null
            : existing.oem_number,
        cost_price: newCostPrice,
        markup_override: newMarkupOverride,
        stock_qty: newStockQty,
        is_primary: body.is_primary !== undefined ? body.is_primary : existing.is_primary,
      },
    })

    // Auto-update price if requested
    if (body.auto_update_price !== false) {
      await recalculateVariantPrice(req.scope, variantId)
    }

    // Get updated link
    const { data: [updatedLink] } = await query.graph({
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

    const link_data = updatedLink as VariantSupplierLink
    const supplierMarkup = link_data.supplier?.default_markup ?? 20
    const effectiveMarkup = getEffectiveMarkup(link_data, supplierMarkup)
    const costPrice = link_data.cost_price != null ? Number(link_data.cost_price) : null

    res.json({
      supplier_id: link_data.supplier_id,
      supplier: link_data.supplier,
      supplier_sku: link_data.supplier_sku,
      partslink_no: link_data.partslink_no,
      oem_number: link_data.oem_number,
      cost_price: costPrice,
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

/**
 * DELETE /admin/variants/:variant_id/suppliers/:supplier_id
 * Remove a supplier link from a variant
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { variant_id: variantId, supplier_id: supplierId } = req.params

  if (!variantId || !supplierId) {
    res.status(400).json({ message: "variant_id and supplier_id are required" })
    return
  }

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  try {
    // Check if link exists
    const { data: existingLinks } = await query.graph({
      entity: "product_variant_supplier",
      fields: ["supplier_id"],
      filters: {
        product_variant_id: variantId,
        supplier_id: supplierId,
      },
    })

    if (!existingLinks || existingLinks.length === 0) {
      res.status(404).json({ message: "Supplier link not found" })
      return
    }

    await link.dismiss({
      [Modules.PRODUCT]: { product_variant_id: variantId },
      supplier: { supplier_id: supplierId },
    })

    res.json({ deleted: true })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}
