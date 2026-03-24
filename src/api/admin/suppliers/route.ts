import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUPPLIER_MODULE } from "../../../modules/supplier"
import SupplierModuleService from "../../../modules/supplier/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)

  const suppliers = await supplierService.listSuppliers(
    {},
    {
      order: {
        name: "ASC",
      },
    }
  )

  res.json({ suppliers })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { name, code, default_markup, contact_name, email, phone, address, website, metadata } = req.body as {
    name?: string
    code?: string
    default_markup?: number | string
    contact_name?: string
    email?: string
    phone?: string
    address?: string
    website?: string
    metadata?: Record<string, unknown>
  }

  const trimmedName = name?.trim()
  const trimmedCode = code?.trim()

  if (!trimmedName) {
    res.status(400).json({ message: "name is required" })
    return
  }

  if (!trimmedCode) {
    res.status(400).json({ message: "code is required" })
    return
  }

  if (trimmedCode.length > 20) {
    res.status(400).json({ message: "code must be 20 characters or less" })
    return
  }

  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)

  // Parse default_markup (default to 20 if not provided)
  const parsedMarkup = default_markup != null && default_markup !== ""
    ? Number(default_markup)
    : 20

  if (isNaN(parsedMarkup)) {
    res.status(400).json({ message: "default_markup must be a valid number" })
    return
  }

  const supplier = await supplierService.createSuppliers({
    name: trimmedName,
    code: trimmedCode.toUpperCase(),
    default_markup: parsedMarkup,
    contact_name: contact_name?.trim() || null,
    email: email?.trim() || null,
    phone: phone?.trim() || null,
    address: address?.trim() || null,
    website: website?.trim() || null,
    metadata: metadata || null,
  })

  res.status(201).json({ supplier })
}
