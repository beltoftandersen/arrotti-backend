import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUPPLIER_MODULE } from "../../../../modules/supplier"
import SupplierModuleService from "../../../../modules/supplier/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)

  const suppliers = await supplierService.listSuppliers({ id })

  if (!suppliers.length) {
    res.status(404).json({ message: "Supplier not found" })
    return
  }

  res.json({ supplier: suppliers[0] })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const { name, code, default_markup, contact_name, email, phone, address, website, metadata } = req.body as {
    name?: string
    code?: string
    default_markup?: number | string | null
    contact_name?: string | null
    email?: string | null
    phone?: string | null
    address?: string | null
    website?: string | null
    metadata?: Record<string, unknown> | null
  }

  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)

  const existing = await supplierService.listSuppliers({ id })
  if (!existing.length) {
    res.status(404).json({ message: "Supplier not found" })
    return
  }

  const updateData: Record<string, any> = {}

  if (name !== undefined) {
    const trimmedName = name.trim()
    if (!trimmedName) {
      res.status(400).json({ message: "name cannot be empty" })
      return
    }
    updateData.name = trimmedName
  }

  if (code !== undefined) {
    const trimmedCode = code.trim()
    if (!trimmedCode) {
      res.status(400).json({ message: "code cannot be empty" })
      return
    }
    if (trimmedCode.length > 20) {
      res.status(400).json({ message: "code must be 20 characters or less" })
      return
    }
    updateData.code = trimmedCode.toUpperCase()
  }

  if (default_markup !== undefined) {
    const parsedMarkup = default_markup !== null && default_markup !== ""
      ? Number(default_markup)
      : 30
    if (isNaN(parsedMarkup) || parsedMarkup < 0) {
      res.status(400).json({ message: "default_markup must be a valid non-negative number" })
      return
    }
    updateData.default_markup = parsedMarkup
  }

  if (contact_name !== undefined) {
    updateData.contact_name = contact_name?.trim() || null
  }

  if (email !== undefined) {
    updateData.email = email?.trim() || null
  }

  if (phone !== undefined) {
    updateData.phone = phone?.trim() || null
  }

  if (address !== undefined) {
    updateData.address = address?.trim() || null
  }

  if (website !== undefined) {
    updateData.website = website?.trim() || null
  }

  if (metadata !== undefined) {
    updateData.metadata = metadata
  }

  const [supplier] = await supplierService.updateSuppliers({
    selector: { id },
    data: updateData,
  })

  res.json({ supplier })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)

  const existing = await supplierService.listSuppliers({ id })
  if (!existing.length) {
    res.status(404).json({ message: "Supplier not found" })
    return
  }

  await supplierService.deleteSuppliers(id)

  res.status(200).json({ id, deleted: true })
}
