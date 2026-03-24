import { model } from "@medusajs/framework/utils"

const QboConnection = model.define("qbo_connection", {
  id: model.id().primaryKey(),
  // QuickBooks company ID
  realm_id: model.text(),
  // OAuth tokens
  access_token: model.text(),
  refresh_token: model.text(),
  // Token expiration timestamps
  access_token_expires_at: model.dateTime(),
  refresh_token_expires_at: model.dateTime(),
  // Connection metadata
  company_name: model.text().nullable(),
  connected_at: model.dateTime(),
  last_refreshed_at: model.dateTime().nullable(),
  // Settings
  // Whether to automatically create invoices when orders are placed
  auto_invoice_enabled: model.boolean().default(true),
})

export default QboConnection
