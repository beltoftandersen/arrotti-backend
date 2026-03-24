import { Module } from "@medusajs/framework/utils"
import BrandModuleService from "./service"

export const BRAND_MODULE = "brand"

const moduleDefinition = Module(BRAND_MODULE, {
  service: BrandModuleService,
})

export default {
  ...moduleDefinition,
  discoveryPath: __dirname,
}
