/**
 * Export all categories with their shipping defaults to an Excel file.
 *
 * Usage: npm run exec src/scripts/export-category-shipping.ts
 * Output: /tmp/category-shipping.xlsx
 */
import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import * as XLSX from "xlsx"

export default async function exportCategoryShipping({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT)

  // Fetch all categories with parent info
  const categories = await productService.listProductCategories(
    {},
    { select: ["id", "name", "handle", "parent_category_id", "metadata", "rank"], take: null as any }
  )

  // Build parent lookup
  const parentMap = new Map<string, typeof categories[0]>()
  for (const cat of categories) {
    parentMap.set(cat.id, cat)
  }

  // Build rows
  const rows: Record<string, any>[] = []

  for (const cat of categories) {
    const isSubcategory = !!cat.parent_category_id
    const parentCat = isSubcategory ? parentMap.get(cat.parent_category_id!) : null
    const parentName = parentCat?.name ?? ""

    const shipping = (cat.metadata as any)?.shipping ?? {}
    const parentShipping = parentCat ? ((parentCat.metadata as any)?.shipping ?? {}) : {}

    // Effective = own value ?? parent value
    const effectiveWeight = shipping.weight ?? parentShipping.weight ?? null
    const effectiveLength = shipping.length ?? parentShipping.length ?? null
    const effectiveWidth = shipping.width ?? parentShipping.width ?? null
    const effectiveHeight = shipping.height ?? parentShipping.height ?? null

    rows.push({
      category_id: cat.id,
      category_name: cat.name,
      handle: cat.handle,
      parent_category: parentName,
      is_subcategory: isSubcategory ? "Yes" : "No",
      weight: shipping.weight ?? "",
      length: shipping.length ?? "",
      width: shipping.width ?? "",
      height: shipping.height ?? "",
      effective_weight: effectiveWeight ?? "",
      effective_length: effectiveLength ?? "",
      effective_width: effectiveWidth ?? "",
      effective_height: effectiveHeight ?? "",
    })
  }

  // Sort: main categories first (alphabetical), then subcategories grouped under parent
  rows.sort((a, b) => {
    if (a.is_subcategory === "No" && b.is_subcategory === "Yes") return -1
    if (a.is_subcategory === "Yes" && b.is_subcategory === "No") return 1
    if (a.is_subcategory === "Yes" && b.is_subcategory === "Yes") {
      if (a.parent_category !== b.parent_category) return a.parent_category.localeCompare(b.parent_category)
    }
    return a.category_name.localeCompare(b.category_name)
  })

  // Create workbook
  const wb = XLSX.utils.book_new()

  // Headers with friendly names
  const header = [
    "Category ID",
    "Category Name",
    "Handle",
    "Parent Category",
    "Is Subcategory",
    "Weight (lb)",
    "Length (in)",
    "Width (in)",
    "Height (in)",
    "Effective Weight",
    "Effective Length",
    "Effective Width",
    "Effective Height",
  ]

  const data = rows.map((r) => [
    r.category_id,
    r.category_name,
    r.handle,
    r.parent_category,
    r.is_subcategory,
    r.weight,
    r.length,
    r.width,
    r.height,
    r.effective_weight,
    r.effective_length,
    r.effective_width,
    r.effective_height,
  ])

  const ws = XLSX.utils.aoa_to_sheet([header, ...data])

  // Set column widths
  ws["!cols"] = [
    { wch: 30 }, // Category ID
    { wch: 35 }, // Category Name
    { wch: 35 }, // Handle
    { wch: 30 }, // Parent Category
    { wch: 15 }, // Is Subcategory
    { wch: 12 }, // Weight
    { wch: 12 }, // Length
    { wch: 12 }, // Width
    { wch: 12 }, // Height
    { wch: 16 }, // Effective Weight
    { wch: 16 }, // Effective Length
    { wch: 16 }, // Effective Width
    { wch: 16 }, // Effective Height
  ]

  XLSX.utils.book_append_sheet(wb, ws, "Category Shipping")

  const outPath = "/tmp/category-shipping.xlsx"
  XLSX.writeFile(wb, outPath)

  console.log(`Exported ${rows.length} categories to ${outPath}`)
  console.log(`  Main categories: ${rows.filter((r) => r.is_subcategory === "No").length}`)
  console.log(`  Subcategories: ${rows.filter((r) => r.is_subcategory === "Yes").length}`)
  console.log(`  With shipping defaults: ${rows.filter((r) => r.weight || r.length || r.width || r.height).length}`)
}
