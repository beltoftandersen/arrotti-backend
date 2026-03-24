import { Module } from "@medusajs/framework/utils"
import GarageModuleService from "./service"

export const GARAGE_MODULE = "garage"

const moduleDefinition = Module(GARAGE_MODULE, {
  service: GarageModuleService,
})

export default {
  ...moduleDefinition,
  discoveryPath: __dirname,
}
