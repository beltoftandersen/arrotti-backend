import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Table,
  Text,
  Select,
} from "@medusajs/ui"
import { CheckCircle, ExclamationCircle, XCircle } from "@medusajs/icons"

type WholesaleCustomer = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  company_name: string | null
  phone: string | null
  tax_id: string | null
  status: "pending" | "approved" | "rejected"
  applied_at: string
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  documents_count: number
}

const formatDate = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return dateStr
  }
}

const StatusBadge = ({ status }: { status: WholesaleCustomer["status"] }) => {
  switch (status) {
    case "pending":
      return (
        <Badge color="orange" className="flex items-center gap-1">
          <ExclamationCircle className="w-3 h-3" />
          Pending
        </Badge>
      )
    case "approved":
      return (
        <Badge color="green" className="flex items-center gap-1">
          <CheckCircle className="w-3 h-3" />
          Approved
        </Badge>
      )
    case "rejected":
      return (
        <Badge color="red" className="flex items-center gap-1">
          <XCircle className="w-3 h-3" />
          Rejected
        </Badge>
      )
  }
}

const WholesaleCustomersPage = () => {
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<WholesaleCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")

  const loadCustomers = async (status?: string) => {
    setLoading(true)
    setError(null)

    try {
      const url = status && status !== "all"
        ? `/admin/customers/wholesale?status=${status}`
        : "/admin/customers/wholesale"

      const response = await fetch(url, {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to load customers")
      }

      const data = await response.json()
      setCustomers(data.customers || [])
    } catch (err: any) {
      setError(err.message || "Failed to load wholesale customers")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCustomers(statusFilter)
  }, [statusFilter])

  const handleApprove = async (customerId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm("Are you sure you want to approve this customer?")) return

    try {
      const response = await fetch(`/admin/customers/${customerId}/approve-wholesale`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to approve")
      }

      loadCustomers(statusFilter)
    } catch (err: any) {
      alert(err.message || "Failed to approve customer")
    }
  }

  const handleReject = async (customerId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const reason = prompt("Enter rejection reason (optional):")
    if (reason === null) return // User cancelled

    try {
      const response = await fetch(`/admin/customers/${customerId}/reject-wholesale`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to reject")
      }

      loadCustomers(statusFilter)
    } catch (err: any) {
      alert(err.message || "Failed to reject customer")
    }
  }

  // Count by status
  const pendingCount = customers.filter(c => c.status === "pending").length
  const approvedCount = customers.filter(c => c.status === "approved").length
  const rejectedCount = customers.filter(c => c.status === "rejected").length

  return (
    <div className="flex flex-col gap-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Wholesale Customers</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage wholesale account applications
          </Text>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Container className="p-4">
          <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide">Pending</Text>
          <Heading level="h2" className="text-orange-600">{pendingCount}</Heading>
        </Container>
        <Container className="p-4">
          <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide">Approved</Text>
          <Heading level="h2" className="text-green-600">{approvedCount}</Heading>
        </Container>
        <Container className="p-4">
          <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide">Rejected</Text>
          <Heading level="h2" className="text-red-600">{rejectedCount}</Heading>
        </Container>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <Text className="text-sm font-medium">Filter by status:</Text>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <Select.Trigger className="w-40">
            <Select.Value placeholder="All" />
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="all">All</Select.Item>
            <Select.Item value="pending">Pending</Select.Item>
            <Select.Item value="approved">Approved</Select.Item>
            <Select.Item value="rejected">Rejected</Select.Item>
          </Select.Content>
        </Select>
      </div>

      {error && (
        <div className="rounded-md bg-ui-bg-subtle-error p-3">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      {/* Customers Table */}
      <Container className="p-0">
        {loading ? (
          <div className="p-4">
            <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
          </div>
        ) : customers.length === 0 ? (
          <div className="p-8 text-center">
            <Text className="text-ui-fg-subtle">
              No wholesale customers found.
            </Text>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Company</Table.HeaderCell>
                <Table.HeaderCell>Tax ID</Table.HeaderCell>
                <Table.HeaderCell>Applied</Table.HeaderCell>
                <Table.HeaderCell>Docs</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {customers.map((customer) => (
                <Table.Row
                  key={customer.id}
                  className="cursor-pointer hover:bg-ui-bg-subtle"
                  onClick={() => navigate(`/customers/${customer.id}`)}
                >
                  <Table.Cell>
                    <div>
                      <Text weight="plus">
                        {customer.first_name} {customer.last_name}
                      </Text>
                      <Text className="text-ui-fg-subtle text-xs">
                        {customer.email}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text>{customer.company_name || "-"}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle">
                      {customer.tax_id || "-"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle">
                      {formatDate(customer.applied_at)}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle">
                      {customer.documents_count}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <StatusBadge status={customer.status} />
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {customer.status === "pending" && (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={(e) => handleApprove(customer.id, e)}
                          className="bg-green-100 hover:bg-green-200 text-green-700 border-green-200"
                        >
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={(e) => handleReject(customer.id, e)}
                          className="bg-red-100 hover:bg-red-200 text-red-700 border-red-200"
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    {customer.status === "approved" && (
                      <Text className="text-xs text-ui-fg-subtle">
                        {customer.approved_at && formatDate(customer.approved_at)}
                      </Text>
                    )}
                    {customer.status === "rejected" && (
                      <Text className="text-xs text-ui-fg-subtle">
                        {customer.rejected_at && formatDate(customer.rejected_at)}
                      </Text>
                    )}
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
  label: "Wholesale",
  nested: "/customers",
})

export default WholesaleCustomersPage
