import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function fixOrlandoProvince({ container }: ExecArgs) {
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)

  const zones = await fulfillmentModule.listServiceZones(
    { name: "Orlando Local Delivery" },
    { relations: ["geo_zones"] }
  )
  if (!zones.length) { console.log("Zone not found"); return }

  const geoZones = (zones[0] as any).geo_zones ?? []
  console.log(`Found ${geoZones.length} geo zones`)

  let count = 0
  for (const gz of geoZones) {
    if (gz.province_code !== "FL") {
      await fulfillmentModule.updateGeoZones({
        id: gz.id,
        type: "zip",
        country_code: gz.country_code,
        province_code: "FL",
        city: gz.city,
        postal_expression: gz.postal_expression,
      } as any)
      count++
    }
  }
  console.log(`Updated ${count} geo zones: province_code → 'FL'`)
}
