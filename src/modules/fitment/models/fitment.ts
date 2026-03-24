import { model } from "@medusajs/framework/utils"

const Fitment = model.define("fitment", {
  id: model.id().primaryKey(),
  vehicle_id: model.text().index(),
  // Original VARIABLES string from Partslink (for reference)
  variables_raw: model.text().nullable(),
  // Submodels/trims this fitment applies to (e.g., ["HYBRID LE", "HYBRID XLE"])
  // Combined from trim segments. Empty array means "all submodels"
  submodels: model.json().default([] as unknown as Record<string, unknown>),
  // Conditions string - non-trim segments joined (e.g., "w/o Rear Spoiler; Smart Entry; Chrome")
  // Empty string means "no specific conditions"
  conditions: model.text().nullable(),
  // True if original VARIABLES contained "see notes" - display notice to check notes
  has_notes_notice: model.boolean().default(false),
  // Free-form notes (from NOTES field, separate from VARIABLES)
  notes: model.text().nullable(),
})

export default Fitment
