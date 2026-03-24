/**
 * Add supplier links to all products that don't have one
 * Usage: npx medusa exec ./src/scripts/add-supplier-links.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { SUPPLIER_MODULE } from "../modules/supplier"
import SupplierModuleService from "../modules/supplier/service"

export default async function addSupplierLinks({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const supplierService: SupplierModuleService = container.resolve(SUPPLIER_MODULE)

  logger.info("=== Adding Supplier Links ===\n")

  // Get KSI supplier
  const [ksiSupplier] = await supplierService.listSuppliers({ code: "KSI" })
  if (!ksiSupplier) {
    logger.error("KSI supplier not found")
    return
  }
  logger.info(`KSI Supplier: ${ksiSupplier.id}`)

  // Get all products with their partslink from metadata
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "metadata"],
  })

  logger.info(`Total products: ${products.length}`)

  // Get existing supplier links
  const { data: existingLinks } = await query.graph({
    entity: "product_supplier",
    fields: ["product_id"],
  })

  const linkedProductIds = new Set((existingLinks || []).map((l: any) => l.product_id))
  logger.info(`Already linked: ${linkedProductIds.size}`)

  // Filter products without links
  const productsToLink = (products || []).filter((p: any) => !linkedProductIds.has(p.id))
  logger.info(`Products to link: ${productsToLink.length}\n`)

  let created = 0
  let errors = 0

  for (const product of productsToLink) {
    const p = product as any
    const partslink = p.metadata?.partslink_no || null

    try {
      await link.create({
        [Modules.PRODUCT]: { product_id: p.id },
        supplier: { supplier_id: ksiSupplier.id },
        data: {
          partslink_no: partslink,
        },
      })
      created++
    } catch (err: any) {
      if (errors < 5) {
        logger.warn(`Error linking ${p.id}: ${err.message}`)
      }
      errors++
    }
  }

  logger.info(`\n=== Complete ===`)
  logger.info(`Created: ${created}`)
  logger.info(`Errors: ${errors}`)
}
