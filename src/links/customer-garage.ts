import CustomerModule from "@medusajs/customer"
import { defineLink } from "@medusajs/framework/utils"
import GarageModule from "../modules/garage"

export default defineLink(CustomerModule.linkable.customer, {
  linkable: GarageModule.linkable.garageVehicle,
  isList: true,
})
