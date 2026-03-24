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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { name, logo_url, description } = req.body as {
    name?: string
    logo_url?: string
    description?: string
  }

  const trimmedName = name?.trim()

  if (!trimmedName) {
    res.status(400).json({ message: "name is required" })
    return
  }

  if (trimmedName.length > 100) {
    res.status(400).json({ message: "name must be 100 characters or less" })
    return
  }

  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const brand = await brandService.createBrands({
    name: trimmedName,
    logo_url: logo_url?.trim() || null,
    description: description?.trim() || null,
  })

  res.status(201).json({ brand })
}
