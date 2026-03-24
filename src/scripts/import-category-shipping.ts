/**
 * Import category shipping defaults from an Excel file.
 *
 * Reads columns: Category ID, Weight (lb), Length (in), Width (in), Height (in)
 * Updates each category's metadata.shipping with the provided values.
 * Empty cells are skipped (existing values preserved). Set to 0 to clear a value.
 *
 * Usage: npm run exec src/scripts/import-category-shipping.ts
 * Input:  /tmp/category-shipping.xlsx (same format as export)
 */
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import * as XLSX from "xlsx"

const INPUT_PATH = "/tmp/category-shipping.xlsx"

export default async function importCategoryShipping({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT)

  // Read Excel file
  const wb = XLSX.readFile(INPUT_PATH)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws)

  if (rows.length === 0) {
    console.log("No data found in spreadsheet.")
    return
  }

  // Collect all unique column names across all rows (some columns only appear on rows with data)
  const allColumnNames = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      allColumnNames.add(key)
    }
  }
  const sample: Record<string, any> = {}
  for (const col of allColumnNames) sample[col] = true

  // Detect column names (support both export format and simplified)
  const idCol = findColumn(sample, ["Category ID", "category_id", "id"])
  const weightCol = findColumn(sample, ["Weight (lb)", "Weight", "Effective Weight", "weight"])
  const lengthCol = findColumn(sample, ["Length (in)", "Length", "Effective Length", "length"])
  const widthCol = findColumn(sample, ["Width (in)", "Width", "Effective Width", "width"])
  const heightCol = findColumn(sample, ["Height (in)", "Height", "Effective Height", "height"])

  if (!idCol) {
    console.error("Could not find 'Category ID' column. Available columns:", Object.keys(sample).join(", "))
    return
  }

  console.log(`Reading from: ${INPUT_PATH}`)
  console.log(`Found ${rows.length} rows`)
  console.log(`Columns: ID=${idCol}, Weight=${weightCol}, Length=${lengthCol}, Width=${widthCol}, Height=${heightCol}`)

  let updated = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
    const categoryId = String(row[idCol!] ?? "").trim()
    if (!categoryId) {
      skipped++
      continue
    }

    // Parse values — empty string = skip, 0 = clear, number = set
    const weight = parseShippingValue(row[weightCol!])
    const length = parseShippingValue(row[lengthCol!])
    const width = parseShippingValue(row[widthCol!])
    const height = parseShippingValue(row[heightCol!])

    // Skip if all values are undefined (nothing to update)
    if (weight === undefined && length === undefined && width === undefined && height === undefined) {
      skipped++
      continue
    }

    try {
      // Fetch current category
      const [category] = await productService.listProductCategories(
        { id: [categoryId] },
        { select: ["id", "name", "metadata"] }
      )

      if (!category) {
        console.warn(`  Category not found: ${categoryId}`)
        errors++
        continue
      }

      // Merge with existing metadata
      const existingMetadata = (category.metadata as Record<string, any>) ?? {}
      const existingShipping = existingMetadata.shipping ?? {}

      const newShipping: Record<string, any> = { ...existingShipping }
      if (weight !== undefined) newShipping.weight = weight === 0 ? null : weight
      if (length !== undefined) newShipping.length = length === 0 ? null : length
      if (width !== undefined) newShipping.width = width === 0 ? null : width
      if (height !== undefined) newShipping.height = height === 0 ? null : height

      // Remove null values
      for (const key of Object.keys(newShipping)) {
        if (newShipping[key] === null || newShipping[key] === undefined) {
          delete newShipping[key]
        }
      }

      const newMetadata = { ...existingMetadata }
      if (Object.keys(newShipping).length > 0) {
        newMetadata.shipping = newShipping
      } else {
        delete newMetadata.shipping
      }

      await productService.updateProductCategories(categoryId, {
        metadata: newMetadata,
      })

      updated++
      if (updated % 50 === 0) {
        console.log(`  Updated ${updated} categories...`)
      }
    } catch (err: any) {
      console.error(`  Error updating ${categoryId}: ${err.message}`)
      errors++
    }
  }

  console.log(`\nCategory metadata import done!`)
  console.log(`  Updated: ${updated}`)
  console.log(`  Skipped (no changes): ${skipped}`)
  console.log(`  Errors: ${errors}`)

  // --- Phase 2: Bulk sync category shipping defaults → product variants ---
  console.log(`\n--- Syncing shipping defaults to product variants ---`)

  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  // Get all categories that have shipping metadata
  const allCategories = await productService.listProductCategories(
    {},
    { select: ["id", "name", "metadata", "parent_category_id"], take: 2000 }
  )

  // Build a map of category shipping values (with parent inheritance)
  const shippingMap = new Map<string, { weight?: number; length?: number; width?: number; height?: number }>()
  const parentMap = new Map<string, string>() // child → parent

  for (const cat of allCategories) {
    const meta = (cat.metadata as Record<string, any>) ?? {}
    if (meta.shipping) {
      shippingMap.set(cat.id, meta.shipping)
    }
    if (cat.parent_category_id) {
      parentMap.set(cat.id, cat.parent_category_id)
    }
  }

  // Resolve effective shipping for each category (subcategory values override parent)
  function resolveShipping(catId: string) {
    const own = shippingMap.get(catId) ?? {}
    const parentId = parentMap.get(catId)
    const parent = parentId ? shippingMap.get(parentId) ?? {} : {}
    return {
      weight: own.weight ?? parent.weight,
      length: own.length ?? parent.length,
      width: own.width ?? parent.width,
      height: own.height ?? parent.height,
    }
  }

  // Group categories by their effective shipping values to batch SQL updates
  type ShippingKey = string
  const batchMap = new Map<ShippingKey, { shipping: Record<string, number>; categoryIds: string[] }>()

  for (const cat of allCategories) {
    const effective = resolveShipping(cat.id)
    if (!effective.weight && !effective.length && !effective.width && !effective.height) continue

    const key = `${effective.weight ?? 0}|${effective.length ?? 0}|${effective.width ?? 0}|${effective.height ?? 0}`
    if (!batchMap.has(key)) {
      batchMap.set(key, { shipping: effective as Record<string, number>, categoryIds: [] })
    }
    batchMap.get(key)!.categoryIds.push(cat.id)
  }

  let totalVariants = 0
  let batchNum = 0

  for (const [, batch] of batchMap) {
    batchNum++
    const { shipping, categoryIds } = batch

    const setClauses: string[] = []
    const params: any[] = []

    if (shipping.weight) { setClauses.push(`weight = ?`); params.push(shipping.weight) }
    if (shipping.length) { setClauses.push(`length = ?`); params.push(shipping.length) }
    if (shipping.width) { setClauses.push(`width = ?`); params.push(shipping.width) }
    if (shipping.height) { setClauses.push(`height = ?`); params.push(shipping.height) }

    if (setClauses.length === 0) continue

    const catIdPlaceholders = categoryIds.map(() => "?").join(", ")
    params.push(...categoryIds)

    const sql = `
      UPDATE product_variant pv
      SET ${setClauses.join(", ")}, updated_at = NOW()
      WHERE pv.product_id IN (
        SELECT DISTINCT pcp.product_id
        FROM product_category_product pcp
        WHERE pcp.product_category_id IN (${catIdPlaceholders})
      )
      AND pv.deleted_at IS NULL
    `

    const result = await pgConnection.raw(sql, params)
    const count = result.rowCount ?? result[0]?.rowCount ?? 0
    totalVariants += count

    if (batchNum % 10 === 0) {
      console.log(`  Processed ${batchNum} batches, ${totalVariants} variants updated so far...`)
    }
  }

  console.log(`\nVariant sync done!`)
  console.log(`  Batches: ${batchNum}`)
  console.log(`  Total variants updated: ${totalVariants}`)
}

function findColumn(sample: Record<string, any>, candidates: string[]): string | null {
  for (const c of candidates) {
    if (c in sample) return c
  }
  // Case-insensitive fallback
  const keys = Object.keys(sample)
  for (const c of candidates) {
    const match = keys.find((k) => k.toLowerCase() === c.toLowerCase())
    if (match) return match
  }
  return null
}

function parseShippingValue(val: any): number | undefined {
  if (val === undefined || val === null || val === "") return undefined
  const num = Number(val)
  if (isNaN(num)) return undefined
  return num
}
