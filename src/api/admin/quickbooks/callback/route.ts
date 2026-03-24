import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { QBO_CONNECTION_MODULE } from "../../../../modules/qbo-connection"
import QboConnectionService from "../../../../modules/qbo-connection/service"
import {
  exchangeCodeForTokens,
  getCompanyInfo,
  calculateExpirationDates,
  verifySignedOAuthState,
} from "../../../../lib/qbo-oauth"

/**
 * GET /admin/quickbooks/callback
 * OAuth callback - exchanges code for tokens and saves connection
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { code, realmId, state, error, error_description } = req.query as {
    code?: string
    realmId?: string
    state?: string
    error?: string
    error_description?: string
  }

  // Handle OAuth errors
  if (error) {
    console.error("[QBO] OAuth error:", error, error_description)
    return res.redirect(
      `/app/quickbooks?qbo_error=${encodeURIComponent(error_description || error)}`
    )
  }

  // Validate OAuth state to prevent CSRF attacks
  // The state is cryptographically signed with timestamp, preventing forgery and replay
  if (!state || !verifySignedOAuthState(state)) {
    console.error("[QBO] OAuth state validation failed - possible CSRF attack")
    return res.redirect(
      `/app/quickbooks?qbo_error=${encodeURIComponent("OAuth state validation failed. Please try connecting again.")}`
    )
  }

  if (!code || !realmId) {
    return res.redirect(
      `/app/quickbooks?qbo_error=${encodeURIComponent("Missing code or realmId from QuickBooks")}`
    )
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)

    // Calculate expiration dates
    const { accessTokenExpiresAt, refreshTokenExpiresAt } = calculateExpirationDates(
      tokens.expires_in,
      tokens.x_refresh_token_expires_in
    )

    // Get company info to verify connection and get company name
    let companyName = "QuickBooks Company"
    try {
      const companyInfo = await getCompanyInfo(tokens.access_token, realmId)
      companyName = companyInfo.companyName
    } catch (e) {
      console.warn("[QBO] Could not fetch company info:", (e as Error).message)
    }

    // Save connection to database
    const qboService: QboConnectionService = req.scope.resolve(QBO_CONNECTION_MODULE)

    await qboService.saveConnection({
      realm_id: realmId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      company_name: companyName,
    })

    console.log(`[QBO] Successfully connected to "${companyName}" (realm: ${realmId})`)

    // Redirect back to admin with success message
    res.redirect(`/app/quickbooks?qbo_success=Connected to ${encodeURIComponent(companyName)}`)
  } catch (error) {
    console.error("[QBO] Callback error:", error)
    res.redirect(
      `/app/quickbooks?qbo_error=${encodeURIComponent((error as Error).message)}`
    )
  }
}
