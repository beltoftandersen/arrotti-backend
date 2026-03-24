import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function checkOrlandoZone({ container }: ExecArgs) {
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  
  const zones = await fulfillmentModule.listServiceZones({}, { relations: ["geo_zones"] })
  for (const z of zones) {
    console.log(`Zone: ${z.name} (${z.id})`)
    for (const gz of (z as any).geo_zones ?? []) {
      console.log(`  GeoZone: type=${gz.type} country=${gz.country_code} province=${gz.province_code} city=${gz.city} postal=${JSON.stringify(gz.postal_expression)}`)
    }
  }
  
  const options = await fulfillmentModule.listShippingOptions({}, { relations: ["service_zone"] })
  for (const o of options) {
    console.log(`\nOption: ${o.name} (${o.id}) zone=${(o as any).service_zone?.name}`)
  }
}
