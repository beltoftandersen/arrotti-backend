import { model } from "@medusajs/framework/utils"

const Quote = model.define("quote", {
  id: model.id().primaryKey(),
  product_id: model.text().index("IDX_QUOTE_PRODUCT_ID"),
  variant_id: model.text().nullable(),
  customer_id: model.text().index("IDX_QUOTE_CUSTOMER_ID"),
  quantity: model.number().default(1),
  notes: model.text().nullable(),
  status: model
    .enum(["pending", "quoted", "accepted", "rejected", "expired", "ordered"])
    .default("pending"),
  quoted_price: model.number().nullable(),
  currency_code: model.text().default("usd"),
  admin_notes: model.text().nullable(),
  expires_at: model.dateTime().nullable(),
  accepted_at: model.dateTime().nullable(),
  ordered_at: model.dateTime().nullable(),
  order_id: model.text().nullable(),
  price_list_id: model.text().nullable(),
  customer_group_id: model.text().nullable(),
}).indexes([
  {
    on: ["status"],
    name: "IDX_QUOTE_STATUS",
  },
])

export default Quote
