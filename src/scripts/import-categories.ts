/**
 * Import categories from category_structure.json
 * Only creates categories that have actual products in the KSI data.
 * Skips subcategories with 0 real products and collapses parent categories
 * that would end up with only 1 child into a flat category.
 *
 * Usage: npx medusa exec ./src/scripts/import-categories.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import * as fs from "fs"
import knex from "knex"

interface SubcategoryDef {
  name: string
  handle: string
  product_count: number
}

interface CategoryDef {
  name: string
  handle: string
  product_count: number
  subcategories: SubcategoryDef[]
}

interface CategoryStructure {
  structure: string
  categories: CategoryDef[]
}

export default async function importCategories({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productModuleService = container.resolve(Modules.PRODUCT)

  // Connect to KSI database to validate which categories actually have products
  const ksiDb = knex({
    client: "pg",
    connection: {
      host: "localhost",
      user: "medusa",
      password: "medusa123",
      database: "ksi_data",
    },
  })

  // Get actual category handles with product counts from KSI data
  const ksiCategoryCounts = await ksiDb("ksi_product")
    .select("category_handle")
    .count("* as cnt")
    .whereNotNull("category_handle")
    .whereNotNull("link_no")
    .groupBy("category_handle")

  const actualHandles = new Map<string, number>()
  for (const row of ksiCategoryCounts) {
    actualHandles.set(String(row.category_handle), Number(row.cnt))
  }

  logger.info(`KSI data has ${actualHandles.size} category handles with products`)

  await ksiDb.destroy()

  // Read category structure
  const structurePath = "/root/data/category_structure.json"

  if (!fs.existsSync(structurePath)) {
    logger.error(`Category structure file not found: ${structurePath}`)
    throw new Error(`File not found: ${structurePath}`)
  }

  const structureData = fs.readFileSync(structurePath, "utf-8")
  const structure: CategoryStructure = JSON.parse(structureData)

  // Filter categories: only keep subcategories that have actual products in KSI
  let skippedEmpty = 0
  const filteredCategories: CategoryDef[] = []

  for (const cat of structure.categories) {
    // Filter subcategories to only those with real products
    const validSubs = cat.subcategories.filter((sub) => {
      const hasProducts = actualHandles.has(sub.handle)
      if (!hasProducts) {
        logger.info(`SKIP EMPTY: ${cat.name} > ${sub.name} (handle: ${sub.handle}, no products in KSI)`)
        skippedEmpty++
      }
      return hasProducts
    })

    if (validSubs.length === 0) {
      // Main category with no valid subcategories - check if the main handle itself has products
      if (actualHandles.has(cat.handle)) {
        filteredCategories.push({ ...cat, subcategories: [] })
      } else {
        logger.info(`SKIP EMPTY MAIN: ${cat.name} (no products in KSI)`)
        skippedEmpty++
      }
    } else if (validSubs.length === 1) {
      // Only 1 subcategory - collapse into the parent (no need for nesting)
      // Keep as parent with single child only if parent name differs meaningfully
      // Otherwise just create the parent with subcategories as normal
      filteredCategories.push({ ...cat, subcategories: validSubs })
      logger.info(`NOTE: ${cat.name} has only 1 subcategory: ${validSubs[0].name}`)
    } else {
      filteredCategories.push({ ...cat, subcategories: validSubs })
    }
  }

  const totalSubs = filteredCategories.reduce((sum, c) => sum + c.subcategories.length, 0)
  logger.info(`\n=== Importing ${filteredCategories.length} Main Categories + ${totalSubs} Subcategories (skipped ${skippedEmpty} empty) ===\n`)

  // Get existing categories using query
  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle", "name"],
  })

  const existingByHandle = new Map<string, { id: string; name: string }>()
  for (const cat of existingCategories || []) {
    existingByHandle.set((cat as any).handle, { id: (cat as any).id, name: (cat as any).name })
  }

  logger.info(`Found ${existingByHandle.size} existing categories`)

  // Mappings for product import
  const categoryIdMapping: Record<string, string> = {} // name -> id (for main categories)
  const subcategoryIdMapping: Record<string, Record<string, string>> = {} // main -> {subname -> id}
  const handleToIdMapping: Record<string, string> = {} // flat handle -> id (for ksi_product.category_handle)

  let createdMain = 0
  let createdSub = 0
  let skipped = 0

  for (const cat of filteredCategories) {
    // Create or get main category
    let mainCategoryId: string
    const existingMain = existingByHandle.get(cat.handle)

    if (existingMain) {
      logger.info(`SKIP MAIN: ${cat.name} (exists: ${existingMain.id})`)
      mainCategoryId = existingMain.id
      skipped++
    } else {
      try {
        const created = await productModuleService.createProductCategories({
          name: cat.name,
          handle: cat.handle,
          is_active: true,
          is_internal: false,
        })
        mainCategoryId = created.id
        existingByHandle.set(cat.handle, { id: created.id, name: cat.name })
        logger.info(`OK MAIN: ${cat.name} -> ${created.id}`)
        createdMain++
      } catch (error: any) {
        logger.error(`ERROR MAIN: ${cat.name} - ${error.message}`)
        continue
      }
    }

    categoryIdMapping[cat.name] = mainCategoryId
    subcategoryIdMapping[cat.name] = {}
    // Map main category handle for flat categories (no subcats)
    handleToIdMapping[cat.handle] = mainCategoryId

    // Create subcategories under this main
    for (const sub of cat.subcategories) {
      const subHandle = `${cat.handle}-${sub.handle}`
      const existingSub = existingByHandle.get(subHandle)

      if (existingSub) {
        logger.info(`  SKIP SUB: ${sub.name} (exists)`)
        subcategoryIdMapping[cat.name][sub.name] = existingSub.id
        handleToIdMapping[sub.handle] = existingSub.id // flat handle mapping
        skipped++
        continue
      }

      try {
        const created = await productModuleService.createProductCategories({
          name: sub.name,
          handle: subHandle,
          parent_category_id: mainCategoryId,
          is_active: true,
          is_internal: false,
        })
        subcategoryIdMapping[cat.name][sub.name] = created.id
        handleToIdMapping[sub.handle] = created.id // flat handle mapping
        existingByHandle.set(subHandle, { id: created.id, name: sub.name })
        logger.info(`  OK SUB: ${sub.name} -> ${created.id}`)
        createdSub++
      } catch (error: any) {
        logger.error(`  ERROR SUB: ${sub.name} - ${error.message}`)
      }
    }
  }

  // Save mappings for product import
  const mainMappingPath = "/root/data/category_id_mapping.json"
  const subMappingPath = "/root/data/subcategory_id_mapping.json"
  const handleMappingPath = "/root/data/handle_to_category_id.json"

  fs.writeFileSync(mainMappingPath, JSON.stringify(categoryIdMapping, null, 2))
  fs.writeFileSync(subMappingPath, JSON.stringify(subcategoryIdMapping, null, 2))
  fs.writeFileSync(handleMappingPath, JSON.stringify(handleToIdMapping, null, 2))

  logger.info(`\n=== Summary ===`)
  logger.info(`Main categories created: ${createdMain}`)
  logger.info(`Subcategories created: ${createdSub}`)
  logger.info(`Skipped (existing): ${skipped}`)
  logger.info(`Skipped (no products in KSI): ${skippedEmpty}`)
  logger.info(`\nMappings saved to:`)
  logger.info(`  - ${mainMappingPath}`)
  logger.info(`  - ${subMappingPath}`)
  logger.info(`  - ${handleMappingPath} (flat handle -> ID, ${Object.keys(handleToIdMapping).length} entries)`)

  return { categoryIdMapping, subcategoryIdMapping, handleToIdMapping }
}
