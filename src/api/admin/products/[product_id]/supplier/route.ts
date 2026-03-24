import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SUPPLIER_MODULE } from "../../../../../modules/supplier"
import SupplierModuleService from "../../../../../modules/supplier/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links } = await query.graph({
    entity: "product_supplier",
    fields: [
      "product_id",
      "supplier_id",
      "supplier_sku",
      "partslink_no",
      "oem_number",
      "cost_price",
      "supplier.id",
      "supplier.name",
      "supplier.code",
      "supplier.email",
      "supplier.contact_name",
    ],
    filters: {
      product_id: productId,
    },
  })

  const link = links?.[0] as any

  if (!link) {
    res.json({ supplier: null, supplier_sku: null, partslink_no: null, oem_number: null, cost_price: null })
    return
  }

  res.json({
    supplier: link.supplier ?? null,
    supplier_sku: link.supplier_sku ?? null,
    partslink_no: link.partslink_no ?? null,
    oem_number: link.oem_number ?? null,
    cost_price: link.cost_price ?? null,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params
  const body = req.body as {
    supplier_id?: string
    supplier_sku?: string
    partslink_no?: string
    oem_number?: string
    cost_price?: number | string | null
  }

  const supplierId = body.supplier_id?.trim()
  const supplierSku = body.supplier_sku?.trim() || null
  const partslinkNo = body.partslink_no?.trim() || null
  const oemNumber = body.oem_number?.trim() || null
  const costPrice = body.cost_price !== undefined && body.cost_price !== null && body.cost_price !== ""
    ? Number(body.cost_price)
    : null

  if (costPrice !== null && isNaN(costPrice)) {
    res.status(400).json({ message: "cost_price must be a valid number" })
    return
  }

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  if (!supplierId) {
    res.status(400).json({ message: "supplier_id is required" })
    return
  }

  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify supplier exists
  const suppliers = await supplierService.listSuppliers({ id: supplierId })
  if (!suppliers.length) {
    res.status(404).json({ message: "Supplier not found" })
    return
  }

  // Check for existing link
  const { data: existingLinks } = await query.graph({
    entity: "product_supplier",
    fields: ["supplier_id"],
    filters: {
      product_id: productId,
    },
  })

  // Remove existing link if present
  if (existingLinks?.length) {
    await link.dismiss({
      [Modules.PRODUCT]: { product_id: productId },
      supplier: { supplier_id: (existingLinks[0] as any).supplier_id },
    })
  }

  // Create new link with extra columns
  await link.create({
    [Modules.PRODUCT]: { product_id: productId },
    supplier: { supplier_id: supplierId },
    data: {
      supplier_sku: supplierSku,
      partslink_no: partslinkNo,
      oem_number: oemNumber,
      cost_price: costPrice,
    },
  })

  res.status(201).json({
    supplier: suppliers[0],
    supplier_sku: supplierSku,
    partslink_no: partslinkNo,
    oem_number: oemNumber,
    cost_price: costPrice,
  })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params
  const body = req.body as {
    supplier_sku?: string
    partslink_no?: string
    oem_number?: string
    cost_price?: number | string | null
  }

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)

  // Get existing link
  const { data: existingLinks } = await query.graph({
    entity: "product_supplier",
    fields: ["supplier_id", "supplier_sku", "partslink_no", "oem_number", "cost_price"],
    filters: {
      product_id: productId,
    },
  })

  if (!existingLinks?.length) {
    res.status(404).json({ message: "No supplier linked to this product" })
    return
  }

  const existing = existingLinks[0] as any

  // Update link data by recreating with new values
  await link.dismiss({
    [Modules.PRODUCT]: { product_id: productId },
    supplier: { supplier_id: existing.supplier_id },
  })

  // Handle cost_price - convert to number or null
  let newCostPrice = existing.cost_price
  if (body.cost_price !== undefined) {
    newCostPrice = body.cost_price !== null && body.cost_price !== ""
      ? Number(body.cost_price)
      : null
  }

  if (newCostPrice !== null && isNaN(Number(newCostPrice))) {
    res.status(400).json({ message: "cost_price must be a valid number" })
    return
  }

  await link.create({
    [Modules.PRODUCT]: { product_id: productId },
    supplier: { supplier_id: existing.supplier_id },
    data: {
      supplier_sku: body.supplier_sku !== undefined ? (body.supplier_sku?.trim() || null) : existing.supplier_sku,
      partslink_no: body.partslink_no !== undefined ? (body.partslink_no?.trim() || null) : existing.partslink_no,
      oem_number: body.oem_number !== undefined ? (body.oem_number?.trim() || null) : existing.oem_number,
      cost_price: newCostPrice,
    },
  })

  // Get updated data
  const { data: updatedLinks } = await query.graph({
    entity: "product_supplier",
    fields: [
      "supplier_sku",
      "partslink_no",
      "oem_number",
      "cost_price",
      "supplier.id",
      "supplier.name",
      "supplier.code",
      "supplier.email",
    ],
    filters: {
      product_id: productId,
    },
  })

  const updated = updatedLinks?.[0] as any

  res.json({
    supplier: updated?.supplier ?? null,
    supplier_sku: updated?.supplier_sku ?? null,
    partslink_no: updated?.partslink_no ?? null,
    oem_number: updated?.oem_number ?? null,
    cost_price: updated?.cost_price ?? null,
  })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Check for existing link
  const { data: existingLinks } = await query.graph({
    entity: "product_supplier",
    fields: ["supplier_id"],
    filters: {
      product_id: productId,
    },
  })

  if (!existingLinks?.length) {
    res.status(404).json({ message: "No supplier linked to this product" })
    return
  }

  // Remove the link
  await link.dismiss({
    [Modules.PRODUCT]: { product_id: productId },
    supplier: { supplier_id: (existingLinks[0] as any).supplier_id },
  })

  res.status(200).json({ deleted: true })
}
