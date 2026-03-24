import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SUPPLIER_MODULE } from "../../../../../modules/supplier"
import SupplierModuleService from "../../../../../modules/supplier/service"
import { recalculateSupplierVariantPrices } from "../../../../../services/auto-pricing"

/**
 * POST /admin/suppliers/:id/recalculate-prices
 * Recalculate prices for all variants linked to this supplier
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id: supplierId } = req.params
  const { currency_code: currencyCode = "usd" } = req.body as {
    currency_code?: string
  }

  if (!supplierId) {
    res.status(400).json({ message: "supplier id is required" })
    return
  }

  const supplierService: SupplierModuleService = req.scope.resolve(SUPPLIER_MODULE)

  try {
    // Verify supplier exists
    const suppliers = await supplierService.listSuppliers({ id: supplierId })
    if (!suppliers.length) {
      res.status(404).json({ message: "Supplier not found" })
      return
    }

    const result = await recalculateSupplierVariantPrices(
      req.scope,
      supplierId,
      currencyCode
    )

    res.json({
      message: `Recalculated prices for ${result.updated} variants`,
      ...result,
    })
  } catch (error) {
    res.status(500).json({ message: (error as Error).message })
  }
}
