import { model } from "@medusajs/framework/utils"

const VehicleModel = model
  .define("vehicle_model", {
    id: model.id().primaryKey(),
    make_id: model.text().index(),
    name: model.text(),
  })
  .indexes([
    {
      on: ["make_id", "name"],
      unique: true,
    },
  ])

export default VehicleModel
