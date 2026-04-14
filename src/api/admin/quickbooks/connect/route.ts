import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getAuthorizationUrl, generateSignedOAuthState } from "../../../../lib/qbo-oauth"

/**
 * GET /admin/quickbooks/connect
 * Redirects user to QuickBooks OAuth authorization page
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    // Generate cryptographically signed state for CSRF protection
    // Format: {nonce}.{timestamp}.{signature}
    // The signature prevents forgery, timestamp prevents replay attacks
    const state = generateSignedOAuthState()

    const authUrl = await getAuthorizationUrl(state)

    // Redirect to QuickBooks authorization page
    res.redirect(authUrl)
  } catch (error) {
    res.status(500).json({
      message: (error as Error).message,
    })
  }
}
