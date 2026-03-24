import { model } from "@medusajs/framework/utils"

const VehicleMake = model.define("vehicle_make", {
  id: model.id().primaryKey(),
  name: model.text().unique(),
})

export default VehicleMake
