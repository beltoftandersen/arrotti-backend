import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Select } from "@medusajs/ui"

type PaymentTermsOption = {
  value: number
  label: string
}

const PAYMENT_TERMS_OPTIONS: PaymentTermsOption[] = [
  { value: 0, label: "Due on receipt" },
  { value: 7, label: "Net 7" },
  { value: 15, label: "Net 15" },
  { value: 30, label: "Net 30" },
  { value: 45, label: "Net 45" },
  { value: 60, label: "Net 60" },
  { value: 90, label: "Net 90" },
]

const CustomerPaymentTermsWidget = () => {
  const { id } = useParams()
  const customerId = id as string | undefined

  const [paymentTermsDays, setPaymentTermsDays] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const loadPaymentTerms = async () => {
      if (!customerId) return

      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/admin/customers/${customerId}/payment-terms`, {
          credentials: "include",
        })

        if (!response.ok) {
          throw new Error("Failed to load payment terms")
        }

        const data = await response.json()
        if (mounted) {
          setPaymentTermsDays(data.payment_terms_days)
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to load payment terms")
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadPaymentTerms()

    return () => {
      mounted = false
    }
  }, [customerId])

  const handleChange = async (value: string) => {
    const newValue = value === "none" ? null : parseInt(value, 10)

    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(`/admin/customers/${customerId}/payment-terms`, {
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
        const data = await response.json()
        throw new Error(data.message || "Failed to save payment terms")
      }

      setPaymentTermsDays(newValue)
      setSuccess("Payment terms saved")

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(null), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save payment terms")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Container className="p-0">
        <div className="flex flex-col gap-y-4 px-6 py-4">
          <Heading level="h2">Payment Terms</Heading>
          <Text className="text-ui-fg-subtle">Loading...</Text>
        </div>
      </Container>
    )
  }

  return (
    <Container className="p-0">
      <div className="flex flex-col gap-y-4 px-6 py-4">
        <Heading level="h2">Payment Terms</Heading>

        <Text className="text-ui-fg-subtle text-sm">
          Set custom payment terms for this customer. These terms will be applied to QuickBooks invoices.
        </Text>

        <div className="flex flex-col gap-2">
          <Select
            value={paymentTermsDays !== null ? paymentTermsDays.toString() : "none"}
            onValueChange={handleChange}
            disabled={saving}
          >
            <Select.Trigger>
              <Select.Value placeholder="Select payment terms" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="none">
                No payment terms (default)
              </Select.Item>
              {PAYMENT_TERMS_OPTIONS.map((option) => (
                <Select.Item key={option.value} value={option.value.toString()}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>

          {saving && (
            <Text className="text-ui-fg-subtle text-sm">Saving...</Text>
          )}

          {error && (
            <Text className="text-ui-fg-error text-sm">{error}</Text>
          )}

          {success && (
            <Text className="text-green-600 text-sm">{success}</Text>
          )}
        </div>

        {paymentTermsDays !== null && (
          <div className="mt-2 p-3 bg-ui-bg-subtle rounded-lg">
            <Text className="text-sm">
              <span className="font-medium">Current setting:</span>{" "}
              {PAYMENT_TERMS_OPTIONS.find(o => o.value === paymentTermsDays)?.label || `${paymentTermsDays} days`}
            </Text>
            <Text className="text-ui-fg-subtle text-xs mt-1">
              Invoices created for this customer in QuickBooks will have this payment term applied.
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.side.after",
})

export default CustomerPaymentTermsWidget
