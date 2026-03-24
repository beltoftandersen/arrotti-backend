import { model } from "@medusajs/framework/utils"

const VinDecodeCache = model.define("vin_decode_cache", {
  id: model.id().primaryKey(),
  vin: model.text().unique(),
  provider: model.text().default("vpic"),
  decoded_json: model.json(),
})

export default VinDecodeCache
