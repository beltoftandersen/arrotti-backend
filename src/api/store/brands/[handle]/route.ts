import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../../modules/brand"
import BrandModuleService from "../../../../modules/brand/service"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { handle } = req.params
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const brands = await brandService.listBrands(
    { handle },
    { take: 1 }
  )

  if (!brands.length) {
    res.status(404).json({
      message: `Brand with handle "${handle}" not found`,
    })
    return
  }

  res.json({ brand: brands[0] })
}
