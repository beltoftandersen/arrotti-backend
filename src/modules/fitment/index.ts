import { Module } from "@medusajs/framework/utils"
import FitmentModuleService from "./service"

export const FITMENT_MODULE = "fitment"

const moduleDefinition = Module(FITMENT_MODULE, {
  service: FitmentModuleService,
})

export default {
  ...moduleDefinition,
  discoveryPath: __dirname,
}
