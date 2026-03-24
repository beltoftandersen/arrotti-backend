/**
 * Cleanup script - deletes all products, categories, fitments, vehicles
 * Keeps: suppliers, sales channels, stock locations, shipping profiles
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FITMENT_MODULE } from "../modules/fitment"

export default async function cleanup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productService = container.resolve(Modules.PRODUCT)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const fitmentService = container.resolve(FITMENT_MODULE)

  logger.info("=== Cleanup Medusa Data ===\n")

  // 1. Delete all products and their links
  logger.info("Deleting products...")
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "variants.sku"],
  })
  
  if (products?.length) {
    // Collect SKUs for inventory cleanup
    const skus: string[] = []
    for (const p of products) {
      for (const v of (p as any).variants || []) {
        if (v.sku) skus.push(v.sku)
      }
    }
    
    // Delete products
    await productService.deleteProducts(products.map((p: any) => p.id))
    logger.info(`  Deleted ${products.length} products`)
    
    // Delete inventory items
    if (skus.length) {
      let deletedInv = 0
      for (const sku of skus) {
        try {
          const items = await inventoryService.listInventoryItems({ sku })
          for (const item of items) {
            await inventoryService.deleteInventoryItems([item.id])
            deletedInv++
          }
        } catch {}
      }
      logger.info(`  Deleted ${deletedInv} inventory items`)
    }
  } else {
    logger.info("  No products to delete")
  }

  // 2. Delete all fitments
  logger.info("Deleting fitments...")
  try {
    const fitments = await fitmentService.listFitments({})
    if (fitments.length) {
      await fitmentService.deleteFitments(fitments.map(f => f.id))
      logger.info(`  Deleted ${fitments.length} fitments`)
    } else {
      logger.info("  No fitments to delete")
    }
  } catch (e: any) {
    logger.info(`  No fitments: ${e.message}`)
  }

  // 3. Delete all vehicles
  logger.info("Deleting vehicles...")
  try {
    const vehicles = await fitmentService.listVehicles({})
    if (vehicles.length) {
      await fitmentService.deleteVehicles(vehicles.map(v => v.id))
      logger.info(`  Deleted ${vehicles.length} vehicles`)
    } else {
      logger.info("  No vehicles to delete")
    }
  } catch (e: any) {
    logger.info(`  No vehicles: ${e.message}`)
  }

  // 4. Delete all vehicle models
  logger.info("Deleting vehicle models...")
  try {
    const models = await fitmentService.listVehicleModels()
    if (models.length) {
      await fitmentService.deleteVehicleModels(models.map(m => m.id))
      logger.info(`  Deleted ${models.length} vehicle models`)
    } else {
      logger.info("  No vehicle models to delete")
    }
  } catch (e: any) {
    logger.info(`  No vehicle models: ${e.message}`)
  }

  // 5. Delete all vehicle makes
  logger.info("Deleting vehicle makes...")
  try {
    const makes = await fitmentService.listVehicleMakes()
    if (makes.length) {
      await fitmentService.deleteVehicleMakes(makes.map(m => m.id))
      logger.info(`  Deleted ${makes.length} vehicle makes`)
    } else {
      logger.info("  No vehicle makes to delete")
    }
  } catch (e: any) {
    logger.info(`  No vehicle makes: ${e.message}`)
  }

  // 6. Delete all categories
  logger.info("Deleting categories...")
  const { data: categories } = await query.graph({
    entity: "product_category",
    fields: ["id", "parent_category_id"],
  })
  
  if (categories?.length) {
    // Delete children first (those with parent), then parents
    const children = categories.filter((c: any) => c.parent_category_id)
    const parents = categories.filter((c: any) => !c.parent_category_id)
    
    if (children.length) {
      await productService.deleteProductCategories(children.map((c: any) => c.id))
      logger.info(`  Deleted ${children.length} subcategories`)
    }
    if (parents.length) {
      await productService.deleteProductCategories(parents.map((c: any) => c.id))
      logger.info(`  Deleted ${parents.length} main categories`)
    }
  } else {
    logger.info("  No categories to delete")
  }

  logger.info("\n=== Cleanup Complete ===")
}
