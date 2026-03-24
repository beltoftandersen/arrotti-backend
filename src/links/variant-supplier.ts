import ProductModule from "@medusajs/medusa/product"
import { defineLink } from "@medusajs/framework/utils"
import SupplierModule from "../modules/supplier"

// Variant-Supplier link with cost tracking and pricing data
// Many variants can link to many suppliers (isList on both sides)
// Each variant can have multiple suppliers, with one marked as primary
export default defineLink(
  {
    linkable: ProductModule.linkable.productVariant,
    isList: true,
  },
  {
    linkable: SupplierModule.linkable.supplier,
    isList: true,
    deleteCascade: true,
  },
  {
    database: {
      table: "variant_supplier",
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
        } as any,
        markup_override: {
          type: "decimal",
          nullable: true,
        } as any,
        stock_qty: {
          type: "integer",
          defaultValue: "0",
        },
        is_primary: {
          type: "boolean",
          defaultValue: "false",
        },
      },
    },
  }
)
