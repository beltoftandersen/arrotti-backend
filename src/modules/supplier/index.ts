import { Module } from "@medusajs/framework/utils"
import SupplierModuleService from "./service"

export const SUPPLIER_MODULE = "supplier"

const moduleDefinition = Module(SUPPLIER_MODULE, {
  service: SupplierModuleService,
})

export default {
  ...moduleDefinition,
  discoveryPath: __dirname,
}
