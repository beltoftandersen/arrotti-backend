import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BRAND_MODULE } from "../../../../../modules/brand"
import BrandModuleService from "../../../../../modules/brand/service"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links } = await query.graph({
    entity: "product_brand",
    fields: ["product_id", "brand_id", "brand.id", "brand.name", "brand.logo_url", "brand.description"],
    filters: {
      product_id: productId,
    },
  })

  const link = links?.[0]
  const brand = link?.brand ?? null

  res.json({ brand })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { product_id: productId } = req.params
  const { brand_id: brandId } = req.body as { brand_id?: string }

  if (!productId) {
    res.status(400).json({ message: "product_id is required" })
    return
  }

  if (!brandId) {
    res.status(400).json({ message: "brand_id is required" })
    return
  }

  const brandService: BrandModuleService = req.scope.resolve(BRAND_MODULE)
  const link = req.scope.resolve(ContainerRegistrationKeys.LINK)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify brand exists
  const brands = await brandService.listBrands({ id: brandId })
  if (!brands.length) {
    res.status(404).json({ message: "Brand not found" })
    return
  }

  // Check for existing link
  const { data: existingLinks } = await query.graph({
    entity: "product_brand",
    fields: ["brand_id"],
    filters: {
      product_id: productId,
    },
  })

  // Remove existing link if present
  if (existingLinks?.length) {
    await link.dismiss({
      [Modules.PRODUCT]: { product_id: productId },
      brand: { brand_id: existingLinks[0].brand_id },
    })
  }

  // Create new link
  await link.create({
    [Modules.PRODUCT]: { product_id: productId },
    brand: { brand_id: brandId },
  })

  res.status(201).json({ brand: brands[0] })
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
    entity: "product_brand",
    fields: ["brand_id"],
    filters: {
      product_id: productId,
    },
  })

  if (!existingLinks?.length) {
    res.status(404).json({ message: "No brand linked to this product" })
    return
  }

  // Remove the link
  await link.dismiss({
    [Modules.PRODUCT]: { product_id: productId },
    brand: { brand_id: existingLinks[0].brand_id },
  })

  res.status(200).json({ deleted: true })
}
