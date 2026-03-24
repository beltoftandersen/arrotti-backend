import { Module } from "@medusajs/framework/utils"
import QboConnectionService from "./service"

export const QBO_CONNECTION_MODULE = "qboConnection"

const moduleDefinition = Module(QBO_CONNECTION_MODULE, {
  service: QboConnectionService,
})

export default {
  ...moduleDefinition,
  discoveryPath: __dirname,
}
