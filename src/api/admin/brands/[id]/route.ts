import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { BRAND_MODULE } from "../../../../modules/brand"
import BrandModuleService from "../../../../modules/brand/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const brands = await brandService.listBrands({ id })

  if (!brands.length) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  res.json({ brand: brands[0] })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const { name, logo_url, description } = req.body as {
    name?: string
    logo_url?: string | null
    description?: string | null
  }

  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const existing = await brandService.listBrands({ id })
  if (!existing.length) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  const updateData: Record<string, any> = {}

  if (name !== undefined) {
    const trimmedName = name.trim()
    if (!trimmedName) {
      res.status(400).json({ message: "name cannot be empty" })
      return
    }
    if (trimmedName.length > 100) {
      res.status(400).json({ message: "name must be 100 characters or less" })
      return
    }
    updateData.name = trimmedName
  }

  if (logo_url !== undefined) {
    updateData.logo_url = logo_url?.trim() || null
  }

  if (description !== undefined) {
    updateData.description = description?.trim() || null
  }

  const [brand] = await brandService.updateBrands({
    selector: { id },
    data: updateData,
  })

  res.json({ brand })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)

  const existing = await brandService.listBrands({ id })
  if (!existing.length) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  await brandService.deleteBrands(id)

  res.status(200).json({ id, deleted: true })
}
