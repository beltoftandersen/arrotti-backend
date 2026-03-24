import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Select,
  Table,
  Text,
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
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const QuotesListPage = () => {
  const navigate = useNavigate()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const loadQuotes = async (status?: string) => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" })
      if (status && status !== "all") {
        params.set("status", status)
      }

      const response = await fetch(`/admin/quotes?${params.toString()}`, {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to load quotes")
      }

      const data = await response.json()
      setQuotes(data.quotes ?? [])
    } catch (err: any) {
      setError(err.message || "Failed to load quotes")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQuotes(statusFilter)
  }, [statusFilter])

  const handleDelete = async (quoteId: string) => {
    if (!confirm("Are you sure you want to delete this quote?")) return

    try {
      const response = await fetch(`/admin/quotes/${quoteId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to delete quote")
      }

      setQuotes((prev) => prev.filter((q) => q.id !== quoteId))
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div className="flex flex-col gap-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Quotes</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage quote requests from B2B customers
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <Select.Trigger className="w-[140px]">
              <Select.Value placeholder="Filter status" />
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="all">All</Select.Item>
              <Select.Item value="pending">Pending</Select.Item>
              <Select.Item value="quoted">Quoted</Select.Item>
              <Select.Item value="accepted">Accepted</Select.Item>
              <Select.Item value="rejected">Rejected</Select.Item>
              <Select.Item value="expired">Expired</Select.Item>
              <Select.Item value="ordered">Ordered</Select.Item>
            </Select.Content>
          </Select>
          <Button variant="secondary" size="small" onClick={() => loadQuotes(statusFilter)}>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-ui-bg-subtle-error p-3">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      <Container className="p-0">
        {loading ? (
          <div className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading quotes...
            </Text>
          </div>
        ) : quotes.length === 0 ? (
          <div className="p-8 text-center">
            <Text className="text-ui-fg-subtle">
              No quote requests found.
            </Text>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Product</Table.HeaderCell>
                <Table.HeaderCell className="text-center">Qty</Table.HeaderCell>
                <Table.HeaderCell className="text-center">Status</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Price</Table.HeaderCell>
                <Table.HeaderCell>Date</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {quotes.map((quote) => (
                <Table.Row
                  key={quote.id}
                  className="cursor-pointer hover:bg-ui-bg-subtle"
                  onClick={() => navigate(`/quotes/${quote.id}`)}
                >
                  <Table.Cell>
                    <Text className="text-sm">
                      {(quote as any).customer_name || quote.customer_id.slice(0, 16)}
                    </Text>
                    {(quote as any).customer_email && (
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        {(quote as any).customer_email}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-sm">
                      {(quote as any).product_title || quote.product_id.slice(0, 16)}
                    </Text>
                    {(quote as any).variant_sku && (
                      <Text size="xsmall" className="text-ui-fg-subtle font-mono">
                        {(quote as any).variant_sku}
                      </Text>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-center">
                    <Text>{quote.quantity}</Text>
                  </Table.Cell>
                  <Table.Cell className="text-center">
                    <Badge color={STATUS_COLORS[quote.status] || "grey"} size="small">
                      {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {quote.quoted_price != null ? (
                      <Text weight="plus">
                        {formatPrice(quote.quoted_price, quote.currency_code)}
                      </Text>
                    ) : (
                      <Text className="text-ui-fg-subtle">—</Text>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {formatDate(quote.created_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="transparent"
                        size="small"
                        onClick={() => handleDelete(quote.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Quotes",
})

export default QuotesListPage
