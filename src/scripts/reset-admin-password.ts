/**
 * One-off: reset an admin user's emailpass password.
 *
 * Usage:
 *   ADMIN_EMAIL=orders@arrottigroup.com ADMIN_PW='newpass' \
 *     npx medusa exec ./src/scripts/reset-admin-password.ts
 */
import { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export default async function resetAdminPassword({ container }: ExecArgs) {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PW
  if (!email || !password) {
    throw new Error("ADMIN_EMAIL and ADMIN_PW env vars are required")
  }

  const authModule = container.resolve(Modules.AUTH)
  const { success, error } = await authModule.updateProvider("emailpass", {
    entity_id: email,
    password,
  })

  if (!success) {
    throw new Error(`Failed to reset password: ${error ?? "unknown error"}`)
  }

  console.log(`Password reset for ${email}`)
}
