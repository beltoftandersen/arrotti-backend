import { useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Button, Badge, Switch } from "@medusajs/ui"
import { CogSixTooth } from "@medusajs/icons"

type ConnectionStatus = {
  connected: boolean
  expired?: boolean
  company_name?: string
  realm_id?: string
  connected_at?: string
  last_refreshed_at?: string
  access_token_expires_at?: string
  refresh_token_expires_at?: string
  needs_refresh?: boolean
  error?: string
  message?: string
}

const QuickBooksPage = () => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [autoInvoiceEnabled, setAutoInvoiceEnabled] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)

  const fetchSettings = async () => {
    try {
      const response = await fetch("/admin/qbo/settings", { credentials: "include" })
      if (response.ok) {
        const data = await response.json()
        setAutoInvoiceEnabled(data.auto_invoice_enabled)
      }
    } catch (error) {
      // Ignore settings fetch errors
    }
  }

  const handleAutoInvoiceToggle = async (checked: boolean) => {
    setSavingSettings(true)
    try {
      const response = await fetch("/admin/qbo/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_invoice_enabled: checked }),
      })
      if (response.ok) {
        setAutoInvoiceEnabled(checked)
      } else {
        // Revert on error
        setAutoInvoiceEnabled(!checked)
      }
    } catch (error) {
      // Revert on error
      setAutoInvoiceEnabled(!checked)
    } finally {
      setSavingSettings(false)
    }
  }

  const fetchStatus = async () => {
    try {
      const response = await fetch("/admin/quickbooks/status", {
        credentials: "include",
      })
      const data = await response.json()
      setStatus(data)
    } catch (error) {
      setStatus({ connected: false, error: "Failed to fetch status" })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStatus()
    fetchSettings()

    // Check URL for success/error messages from OAuth callback
    const urlParams = new URLSearchParams(window.location.search)
    const qboSuccess = urlParams.get("qbo_success")
    const qboError = urlParams.get("qbo_error")

    if (qboSuccess) {
      setMessage({ type: "success", text: decodeURIComponent(qboSuccess) })
      window.history.replaceState({}, "", window.location.pathname)
      fetchStatus()
    } else if (qboError) {
      setMessage({ type: "error", text: decodeURIComponent(qboError) })
      window.history.replaceState({}, "", window.location.pathname)
    }
  }, [])

  const handleConnect = () => {
    window.location.href = "/admin/quickbooks/connect"
  }

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect from QuickBooks?")) {
      return
    }

    setActionLoading(true)
    setMessage(null)
    try {
      const response = await fetch("/admin/quickbooks/disconnect", {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json()
      if (data.success) {
        setMessage({ type: "success", text: data.message })
        await fetchStatus()
      } else {
        setMessage({ type: "error", text: data.error || "Failed to disconnect" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to disconnect" })
    } finally {
      setActionLoading(false)
    }
  }

  const handleRefresh = async () => {
    setActionLoading(true)
    setMessage(null)
    try {
      const response = await fetch("/admin/quickbooks/refresh", {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json()
      if (data.success) {
        setMessage({ type: "success", text: "Tokens refreshed successfully" })
        await fetchStatus()
      } else {
        setMessage({ type: "error", text: data.error || "Failed to refresh tokens" })
      }
    } catch (error) {
      setMessage({ type: "error", text: "Failed to refresh tokens" })
    } finally {
      setActionLoading(false)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "-"
    return new Date(dateStr).toLocaleString()
  }

  return (
    <div className="flex flex-col gap-4">
      <Heading level="h1">QuickBooks Integration</Heading>

      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === "success"
              ? "bg-ui-bg-success-subtle text-ui-fg-success"
              : "bg-ui-bg-error-subtle text-ui-fg-error"
          }`}
        >
          <Text>{message.text}</Text>
        </div>
      )}

      <Container className="divide-y divide-ui-border-base p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <Heading level="h2">Connection Status</Heading>
            {status?.connected && (
              <Badge color="green" size="small">
                Connected
              </Badge>
            )}
            {status?.expired && (
              <Badge color="orange" size="small">
                Expired
              </Badge>
            )}
            {!status?.connected && !status?.expired && !loading && (
              <Badge color="grey" size="small">
                Not Connected
              </Badge>
            )}
          </div>
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <Text className="text-ui-fg-subtle">Loading...</Text>
          ) : status?.connected ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Company
                  </Text>
                  <Text weight="plus">{status.company_name}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Company ID (Realm)
                  </Text>
                  <Text className="font-mono text-sm">{status.realm_id}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Connected At
                  </Text>
                  <Text>{formatDate(status.connected_at)}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Last Token Refresh
                  </Text>
                  <Text>{formatDate(status.last_refreshed_at)}</Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Access Token Expires
                  </Text>
                  <Text>
                    {formatDate(status.access_token_expires_at)}
                    {status.needs_refresh && (
                      <Badge color="orange" size="2xsmall" className="ml-2">
                        needs refresh
                      </Badge>
                    )}
                  </Text>
                </div>
                <div>
                  <Text size="small" className="text-ui-fg-subtle">
                    Refresh Token Expires
                  </Text>
                  <Text>{formatDate(status.refresh_token_expires_at)}</Text>
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-ui-border-base">
                {status.needs_refresh && (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={handleRefresh}
                    disabled={actionLoading}
                  >
                    Refresh Token
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="small"
                  onClick={handleDisconnect}
                  disabled={actionLoading}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Text className="text-ui-fg-subtle">
                Connect your QuickBooks Online account to sync orders, invoices, and customers.
              </Text>
              <div>
                <Button variant="primary" onClick={handleConnect} disabled={actionLoading}>
                  Connect to QuickBooks
                </Button>
              </div>
            </div>
          )}
        </div>
      </Container>

      {status?.connected && (
        <Container className="divide-y divide-ui-border-base p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Invoice Settings</Heading>
          </div>
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <Text className="font-medium">Auto-create invoices</Text>
                <Text size="small" className="text-ui-fg-subtle">
                  {autoInvoiceEnabled
                    ? "Invoices are created automatically when orders are placed"
                    : "Invoices must be created manually from order details"}
                </Text>
              </div>
              <Switch
                checked={autoInvoiceEnabled}
                onCheckedChange={handleAutoInvoiceToggle}
                disabled={savingSettings}
              />
            </div>
          </div>
        </Container>
      )}
    </div>
  )
}

export const config = defineRouteConfig({
  label: "QuickBooks",
  icon: CogSixTooth,
})

export default QuickBooksPage
