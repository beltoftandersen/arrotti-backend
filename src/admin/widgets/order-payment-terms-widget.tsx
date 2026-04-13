import { useEffect, useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Badge, Select, Button } from "@medusajs/ui"
import { DetailWidgetProps, AdminOrder } from "@medusajs/framework/types"
import { PencilSquare } from "@medusajs/icons"

const PAYMENT_TERMS_OPTIONS = [
  { value: "none", label: "No payment terms" },
  { value: "0", label: "Due on receipt" },
  { value: "7", label: "Net 7" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
  { value: "90", label: "Net 90" },
]

const PAYMENT_TERMS_LABELS: Record<number, string> = {
  0: "Due on receipt",
  7: "Net 7",
  15: "Net 15",
  30: "Net 30",
  45: "Net 45",
  60: "Net 60",
  90: "Net 90",
}

const OrderPaymentTermsWidget = ({ data }: DetailWidgetProps<AdminOrder>) => {
  // Get payment terms from order metadata or customer
  const orderPaymentTerms = (data.metadata as any)?.payment_terms_days as number | undefined
  const [customerPaymentTerms, setCustomerPaymentTerms] = useState<number | null>(null)
  const [loadingCustomer, setLoadingCustomer] = useState(true)

  const [isEditing, setIsEditing] = useState(false)
  const [selectedValue, setSelectedValue] = useState<string>(
    orderPaymentTerms !== undefined ? orderPaymentTerms.toString() : "none"
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const customerId = data.customer_id

  // Load customer payment terms for reference
  useEffect(() => {
    const loadCustomerTerms = async () => {
      if (!customerId) {
        setLoadingCustomer(false)
        return
      }

      try {
        const response = await fetch(`/admin/customers/${customerId}/payment-terms`, {
          credentials: "include",
        })

        if (response.ok) {
          const result = await response.json()
          setCustomerPaymentTerms(result.payment_terms_days)
        }
      } catch (err) {
        // Silently fail
      } finally {
        setLoadingCustomer(false)
      }
    }

    loadCustomerTerms()
  }, [customerId])

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const newValue = selectedValue === "none" ? null : parseInt(selectedValue, 10)

      const response = await fetch(`/admin/orders/${data.id}/payment-terms`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          payment_terms_days: newValue,
        }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.message || "Failed to save payment terms")
      }

      setIsEditing(false)
      // Refresh the page to get updated metadata
      window.location.reload()
    } catch (err: any) {
      setError(err.message || "Failed to save payment terms")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setSelectedValue(orderPaymentTerms !== undefined ? orderPaymentTerms.toString() : "none")
    setIsEditing(false)
    setError(null)
  }

  // Determine which terms to display
  const effectiveTerms = orderPaymentTerms !== undefined ? orderPaymentTerms : customerPaymentTerms
  const isOrderOverride = orderPaymentTerms !== undefined
  const label = effectiveTerms !== null && effectiveTerms !== undefined
    ? PAYMENT_TERMS_LABELS[effectiveTerms] || `Net ${effectiveTerms}`
    : null

  return (
    <Container className="p-0">
      <div className="flex flex-col gap-y-3 px-6 py-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Payment Terms</Heading>
          {!isEditing && (
            <Button
              variant="transparent"
              size="small"
              onClick={() => setIsEditing(true)}
            >
              <PencilSquare />
            </Button>
          )}
        </div>

        {isEditing ? (
          <div className="flex flex-col gap-3">
            <Select
              value={selectedValue}
              onValueChange={setSelectedValue}
            >
              <Select.Trigger>
                <Select.Value placeholder="Select payment terms" />
              </Select.Trigger>
              <Select.Content>
                {PAYMENT_TERMS_OPTIONS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>

            {customerPaymentTerms !== null && (
              <span className="text-ui-fg-muted text-xs">
                Customer default: {PAYMENT_TERMS_LABELS[customerPaymentTerms] || `Net ${customerPaymentTerms}`}
              </span>
            )}

            {error && (
              <span className="text-ui-fg-error text-sm">{error}</span>
            )}

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="small"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="small"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {label ? (
              <div className="flex items-center gap-2">
                <Badge color="blue" size="small">
                  {label}
                </Badge>
                {isOrderOverride && (
                  <span className="text-ui-fg-muted text-xs">(order override)</span>
                )}
                {!isOrderOverride && customerPaymentTerms !== null && (
                  <span className="text-ui-fg-muted text-xs">(from customer)</span>
                )}
              </div>
            ) : (
              <span className="text-ui-fg-subtle text-sm">No payment terms set</span>
            )}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "order.details.side.after",
})

export default OrderPaymentTermsWidget
