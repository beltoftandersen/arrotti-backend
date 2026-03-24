import ProductModule from "@medusajs/product"
import { defineLink } from "@medusajs/framework/utils"
import FitmentModule from "../modules/fitment"

export default defineLink(ProductModule.linkable.product, {
  linkable: FitmentModule.linkable.fitment,
  isList: true,
})
