import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"
import BrandModule from "../modules/brand"

export default defineLink(ProductModule.linkable.product, {
  linkable: BrandModule.linkable.brand,
})
