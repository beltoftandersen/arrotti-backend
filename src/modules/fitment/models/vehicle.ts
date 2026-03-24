import { model } from "@medusajs/framework/utils"

const Vehicle = model
  .define("vehicle", {
    id: model.id().primaryKey(),
    make_id: model.text(),
    model_id: model.text(),
    year_start: model.number(),
    year_end: model.number(),
  })
  .indexes([
    {
      on: ["make_id", "model_id", "year_start", "year_end"],
      unique: true,
    },
  ])

export default Vehicle
