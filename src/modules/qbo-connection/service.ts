import { MedusaService } from "@medusajs/framework/utils"
import QboConnection from "./models/qbo-connection"

type QboConnectionData = {
  realm_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: Date
  refresh_token_expires_at: Date
  company_name?: string
}

class QboConnectionService extends MedusaService({
  QboConnection,
}) {
  /**
   * Get the current QBO connection (there should only be one)
   */
  async getConnection() {
    const connections = await this.listQboConnections({}, { take: 1 })
    return connections[0] || null
  }

  /**
   * Check if we have a valid connection
   */
  async isConnected(): Promise<boolean> {
    const connection = await this.getConnection()
    if (!connection) return false

    // Check if refresh token is still valid
    const now = new Date()
    return new Date(connection.refresh_token_expires_at) > now
  }

  /**
   * Check if access token needs refresh
   */
  async needsRefresh(): Promise<boolean> {
    const connection = await this.getConnection()
    if (!connection) return false

    const now = new Date()
    // Refresh if access token expires in less than 5 minutes
    const bufferMs = 5 * 60 * 1000
    return new Date(connection.access_token_expires_at).getTime() - bufferMs < now.getTime()
  }

  /**
   * Save or update the connection
   */
  async saveConnection(data: QboConnectionData) {
    const existing = await this.getConnection()

    if (existing) {
      // Update existing connection
      const updated = await this.updateQboConnections({
        selector: { id: existing.id },
        data: {
          ...data,
          last_refreshed_at: new Date(),
        },
      })
      return updated[0]
    } else {
      // Create new connection
      const created = await this.createQboConnections({
        ...data,
        connected_at: new Date(),
      })
      return created
    }
  }

  /**
   * Update tokens after refresh
   */
  async updateTokens(
    accessToken: string,
    refreshToken: string,
    accessTokenExpiresAt: Date,
    refreshTokenExpiresAt: Date
  ): Promise<void> {
    const connection = await this.getConnection()
    if (!connection) {
      throw new Error("No QBO connection found")
    }

    await this.updateQboConnections({
      selector: { id: connection.id },
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_expires_at: refreshTokenExpiresAt,
        last_refreshed_at: new Date(),
      },
    })
  }

  /**
   * Delete the connection (disconnect)
   */
  async disconnect(): Promise<void> {
    const connection = await this.getConnection()
    if (connection) {
      await this.deleteQboConnections([connection.id])
    }
  }

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getValidAccessToken(): Promise<{ accessToken: string; realmId: string } | null> {
    const connection = await this.getConnection()
    if (!connection) return null

    // Check if refresh token is expired
    if (new Date(connection.refresh_token_expires_at) <= new Date()) {
      return null // Need to re-authenticate
    }

    // Check if access token needs refresh
    if (await this.needsRefresh()) {
      // Caller should handle refresh
      return null
    }

    return {
      accessToken: connection.access_token,
      realmId: connection.realm_id,
    }
  }

  /**
   * Check if automatic invoice creation is enabled
   */
  async isAutoInvoiceEnabled(): Promise<boolean> {
    const connection = await this.getConnection()
    // Default to true for backwards compatibility
    const enabled = (connection as any)?.auto_invoice_enabled
    return enabled !== false
  }

  /**
   * Enable or disable automatic invoice creation on order placed
   */
  async setAutoInvoiceEnabled(enabled: boolean): Promise<void> {
    const connection = await this.getConnection()
    if (!connection) {
      throw new Error("No QBO connection found")
    }

    await this.updateQboConnections({
      selector: { id: connection.id },
      data: {
        auto_invoice_enabled: enabled,
      } as any,
    })
  }
}

export default QboConnectionService
