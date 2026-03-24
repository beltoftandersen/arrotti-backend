import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"
import SupplierModule from "../modules/supplier"

// Product-Supplier link with extra data fields for SKUs
// Many products can link to one supplier (isList on product side)
export default defineLink({
  linkable: ProductModule.linkable.product,
  isList: true,
}, {
  linkable: SupplierModule.linkable.supplier,
  deleteCascade: true,
}, {
  database: {
    table: "product_supplier",
    extraColumns: {
      supplier_sku: {
        type: "text",
        nullable: true,
      },
      partslink_no: {
        type: "text",
        nullable: true,
      },
      oem_number: {
        type: "text",
        nullable: true,
      },
      cost_price: {
        type: "decimal",
        nullable: true,
      },
    },
  },
})
