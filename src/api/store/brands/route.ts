import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../modules/brand"
import BrandModuleService from "../../../modules/brand/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const brands = await brandService.listBrands(
    {},
    {
      order: {
        name: "ASC",
      },
    }
  )

  res.json({ brands })
}
