import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Text,
  Textarea,
} from "@medusajs/ui"

type Quote = {
  id: string
  product_id: string
  variant_id: string | null
  customer_id: string
  quantity: number
  notes: string | null
  status: string
  quoted_price: number | null
  currency_code: string
  admin_notes: string | null
  expires_at: string | null
  accepted_at: string | null
  ordered_at: string | null
  order_id: string | null
  created_at: string
  updated_at: string
}

const STATUS_COLORS: Record<string, "grey" | "blue" | "green" | "red" | "orange" | "purple"> = {
  pending: "grey",
  quoted: "blue",
  accepted: "green",
  rejected: "red",
  expired: "orange",
  ordered: "purple",
}

function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const QuoteDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Send quote form
  const [quotedPrice, setQuotedPrice] = useState("")
  const [expiresAt, setExpiresAt] = useState("")
  const [adminNotes, setAdminNotes] = useState("")
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const loadQuote = async () => {
      setLoading(true)
      try {
        const response = await fetch(`/admin/quotes/${id}`, {
          credentials: "include",
        })

        if (!response.ok) {
          throw new Error("Quote not found")
        }

        const data = await response.json()
        setQuote(data.quote)

        if (data.quote.admin_notes) {
          setAdminNotes(data.quote.admin_notes)
        }
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    loadQuote()
  }, [id])

  const handleSendQuote = async () => {
    const priceInCents = Math.round(parseFloat(quotedPrice) * 100)
    if (isNaN(priceInCents) || priceInCents <= 0) {
      setError("Please enter a valid price")
      return
    }

    setSending(true)
    setError(null)

    try {
      const body: Record<string, any> = {
        quoted_price: priceInCents,
      }
      if (expiresAt) {
        body.expires_at = new Date(expiresAt).toISOString()
      }
      if (adminNotes.trim()) {
        body.admin_notes = adminNotes.trim()
      }

      const response = await fetch(`/admin/quotes/${id}/send`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to send quote")
      }

      const data = await response.json()
      setQuote(data.quote)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this quote?")) return

    try {
      const response = await fetch(`/admin/quotes/${id}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to delete quote")
      }

      navigate("/quotes")
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <Text className="text-ui-fg-subtle">Loading quote...</Text>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="p-4">
        <Text className="text-ui-fg-error">Quote not found</Text>
      </div>
    )
  }

  const badge = STATUS_COLORS[quote.status] || "grey"

  return (
    <div className="flex flex-col gap-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="transparent"
            size="small"
            onClick={() => navigate("/quotes")}
          >
            ← Back
          </Button>
          <div>
            <Heading level="h1">Quote Detail</Heading>
            <Text className="text-ui-fg-subtle font-mono" size="xsmall">
              {quote.id}
            </Text>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge color={badge} size="large">
            {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
          </Badge>
          <Button variant="danger" size="small" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-ui-bg-subtle-error p-3">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      {/* Quote Details */}
      <Container>
        <div className="grid grid-cols-2 gap-6 p-2">
          <div>
            <Text size="small" className="text-ui-fg-subtle mb-1">Customer</Text>
            <Text className="text-sm">{(quote as any).customer_name || quote.customer_id}</Text>
            {(quote as any).customer_email && (
              <Text size="xsmall" className="text-ui-fg-subtle">{(quote as any).customer_email}</Text>
            )}
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle mb-1">Product</Text>
            <Text className="text-sm">{(quote as any).product_title || quote.product_id}</Text>
          </div>
          {quote.variant_id && (
            <div>
              <Text size="small" className="text-ui-fg-subtle mb-1">Variant</Text>
              <Text className="text-sm">
                {(quote as any).variant_sku || (quote as any).variant_title || quote.variant_id}
              </Text>
            </div>
          )}
          <div>
            <Text size="small" className="text-ui-fg-subtle mb-1">Quantity</Text>
            <Text weight="plus">{quote.quantity}</Text>
          </div>
          <div>
            <Text size="small" className="text-ui-fg-subtle mb-1">Submitted</Text>
            <Text>{formatDate(quote.created_at)}</Text>
          </div>
          {quote.notes && (
            <div className="col-span-2">
              <Text size="small" className="text-ui-fg-subtle mb-1">Customer Notes</Text>
              <div className="bg-ui-bg-subtle rounded p-3">
                <Text>{quote.notes}</Text>
              </div>
            </div>
          )}
        </div>
      </Container>

      {/* Send Quote Form (only when status is pending) */}
      {quote.status === "pending" && (
        <Container>
          <div className="flex flex-col gap-4 p-2">
            <Heading level="h2">Send Quote</Heading>
            <Text className="text-ui-fg-subtle" size="small">
              Set a price and optionally an expiry date, then send to the customer.
            </Text>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  Price (USD) *
                </Text>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={quotedPrice}
                  onChange={(e) => setQuotedPrice(e.target.value)}
                />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Enter the unit price in dollars (e.g., 49.99)
                </Text>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  Expires At (optional)
                </Text>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Quote will auto-expire after this date
                </Text>
              </div>
            </div>

            <div>
              <Text size="small" weight="plus" className="mb-2">
                Admin Notes (optional, visible to customer)
              </Text>
              <Textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Any notes for the customer about this quote..."
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end">
              <Button
                variant="primary"
                isLoading={sending}
                disabled={!quotedPrice || parseFloat(quotedPrice) <= 0}
                onClick={handleSendQuote}
              >
                Send Quote to Customer
              </Button>
            </div>
          </div>
        </Container>
      )}

      {/* Quoted Price Display (when already quoted) */}
      {quote.quoted_price != null && quote.status !== "pending" && (
        <Container>
          <div className="flex flex-col gap-3 p-2">
            <Heading level="h2">Quoted Price</Heading>
            <div className="flex items-center gap-4">
              <Text className="text-2xl font-bold">
                {formatPrice(quote.quoted_price, quote.currency_code)}
              </Text>
              {quote.expires_at && (
                <Text className="text-ui-fg-subtle" size="small">
                  Expires: {formatDate(quote.expires_at)}
                </Text>
              )}
            </div>
            {quote.admin_notes && (
              <div className="bg-ui-bg-subtle rounded p-3 mt-2">
                <Text size="small" className="text-ui-fg-subtle mb-1">Admin Notes:</Text>
                <Text>{quote.admin_notes}</Text>
              </div>
            )}
            {quote.accepted_at && (
              <Text size="small" className="text-ui-fg-subtle">
                Accepted at: {formatDate(quote.accepted_at)}
              </Text>
            )}
            {quote.order_id && (
              <div>
                <Text size="small" className="text-ui-fg-subtle">Order ID:</Text>
                <Text className="font-mono">{quote.order_id}</Text>
              </div>
            )}
          </div>
        </Container>
      )}
    </div>
  )
}

export const config = defineRouteConfig({})

export default QuoteDetailPage
