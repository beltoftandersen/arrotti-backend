import { model } from "@medusajs/framework/utils"

const Brand = model.define("brand", {
  id: model.id().primaryKey(),
  name: model.text().unique(),
  handle: model.text().unique(),
  logo_url: model.text().nullable(),
  description: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default Brand
