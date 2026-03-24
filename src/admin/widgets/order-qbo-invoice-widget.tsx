import { useEffect, useState, useRef } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Button, Badge } from "@medusajs/ui"
import { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { ArrowPath } from "@medusajs/icons"

type InvoiceStatus = {
  connected: boolean
  exists: boolean
  invoice_id?: string
  invoice_number?: string
  total?: number
  balance?: number
  is_paid?: boolean
  message?: string
  last_checked?: string
}

// Helper to check if order has captured payments
function hasPaymentCaptured(order: AdminOrder): boolean {
  const collections = (order as any).payment_collections || []
  for (const pc of collections) {
    const payments = pc.payments || []
    for (const payment of payments) {
      if (payment.captured_at) return true
    }
  }
  return false
}

const OrderQboInvoiceWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  // Get saved invoice info from order metadata
  const savedInvoice = (data.metadata as any)?.qbo_invoice as InvoiceStatus | undefined

  const [status, setStatus] = useState<InvoiceStatus | null>(savedInvoice || null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Track if payment was previously captured
  const wasCapturedRef = useRef(hasPaymentCaptured(data))

  // Update local state when order data changes (e.g., after metadata update)
  useEffect(() => {
    const newSavedInvoice = (data.metadata as any)?.qbo_invoice as InvoiceStatus | undefined
    if (newSavedInvoice) {
      setStatus(newSavedInvoice)
    }
  }, [data.metadata])


  // Auto-refresh when payment is captured
  useEffect(() => {
    const isCapturedNow = hasPaymentCaptured(data)
    const wasCaptured = wasCapturedRef.current

    // If payment just got captured, auto-refresh after a delay
    // (gives time for QBO payment to be recorded)
    if (isCapturedNow && !wasCaptured && status?.exists && !status?.is_paid) {
      const timer = setTimeout(async () => {
        setLoading(true)
        try {
          const response = await fetch(`/admin/orders/${data.id}/qbo-invoice`, {
            credentials: "include",
          })
          if (response.ok) {
            const result = await response.json()
            setStatus(result)
          }
        } catch (err) {
          // Silently fail - user can manually refresh
        } finally {
          setLoading(false)
        }
      }, 3000) // 3 second delay for QBO sync
      return () => clearTimeout(timer)
    }

    wasCapturedRef.current = isCapturedNow
  }, [data, status])

  const loadStatus = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/admin/orders/${data.id}/qbo-invoice`, {
        credentials: "include",
      })

      if (response.ok) {
        const result = await response.json()
        setStatus(result)
      }
    } catch (err) {
      setError("Failed to load invoice status")
    } finally {
      setLoading(false)
    }
  }

  const handleCreateInvoice = async () => {
    setCreating(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/admin/orders/${data.id}/qbo-invoice`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      })

      const result = await response.json()

      if (result.success) {
        setSuccess(result.message)
        // Update local state - the API also saves to order metadata
        const newStatus: InvoiceStatus = {
          connected: true,
          exists: true,
          invoice_id: result.invoice_id,
          invoice_number: result.invoice_number,
          total: result.total,
          balance: result.balance,
          is_paid: result.is_paid,
          last_checked: new Date().toISOString(),
        }
        setStatus(newStatus)
      } else {
        setError(result.message || "Failed to create invoice")
      }
    } catch (err: any) {
      setError(err.message || "Failed to create invoice")
    } finally {
      setCreating(false)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null
    return new Date(dateStr).toLocaleString()
  }

  return (
    <Container className="p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">QuickBooks Invoice</Heading>
          <Button
            variant="transparent"
            size="small"
            onClick={loadStatus}
            disabled={loading}
          >
            <ArrowPath className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        {loading && (
          <span className="text-ui-fg-subtle text-sm">Checking QuickBooks...</span>
        )}

        {status?.exists && (
          <div className="flex items-center justify-between p-3 bg-ui-bg-subtle rounded-lg">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  Invoice #{status.invoice_number}
                </span>
                {status.is_paid ? (
                  <Badge color="green" size="small">Paid</Badge>
                ) : (
                  <Badge color="orange" size="small">Unpaid</Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs">
                {status.total !== undefined && (
                  <span className="text-ui-fg-subtle">
                    Total: ${status.total.toFixed(2)}
                  </span>
                )}
                {!status.is_paid && status.balance !== undefined && status.balance > 0 && (
                  <span className="text-ui-fg-muted">
                    Balance: ${status.balance.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <Button
          variant="secondary"
          size="small"
          onClick={handleCreateInvoice}
          disabled={creating}
        >
          {creating ? "Creating..." : status?.exists ? "Recreate Invoice" : "Create Invoice"}
        </Button>

        {status?.last_checked && (
          <span className="text-ui-fg-muted text-xs">
            Last checked: {formatDate(status.last_checked)}
          </span>
        )}

        {error && (
          <span className="text-ui-fg-error text-sm">{error}</span>
        )}

        {success && (
          <span className="text-green-600 text-sm">{success}</span>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default OrderQboInvoiceWidget
