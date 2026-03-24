import { model } from "@medusajs/framework/utils"

const Supplier = model.define("supplier", {
  id: model.id().primaryKey(),
  name: model.text(),
  code: model.text().unique(), // Short code (e.g., "CAPA", "NSF")
  default_markup: model.float().default(20), // Default markup percentage (e.g., 20 = 20%)
  contact_name: model.text().nullable(),
  email: model.text().nullable(),
  phone: model.text().nullable(),
  address: model.text().nullable(),
  website: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default Supplier
