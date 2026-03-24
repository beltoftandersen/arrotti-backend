import { model } from "@medusajs/framework/utils"

const GarageVehicle = model
  .define("garage_vehicle", {
    id: model.id().primaryKey(),
    vehicle_id: model.text(),
    make: model.text().nullable(),
    model: model.text().nullable(),
    year: model.number().nullable(),
    engine: model.text().nullable(),
    trim: model.text().nullable(),
    label: model.text().nullable(),
    is_default: model.boolean().default(false),
    last_used_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      on: ["vehicle_id"],
    },
    {
      on: ["last_used_at"],
    },
  ])

export default GarageVehicle
