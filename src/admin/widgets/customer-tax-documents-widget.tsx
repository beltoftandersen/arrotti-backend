import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Container, Heading, Text } from "@medusajs/ui"
import { DocumentText, Photo, ExclamationCircle, CheckCircle, XCircle } from "@medusajs/icons"

type TaxDocument = {
  filename: string
  url: string
  size: number
  uploaded_at: string
}

type CustomerMetadata = {
  tax_id?: string
  tax_documents?: TaxDocument[]
  registration_date?: string
  pending_approval?: boolean
  approved_at?: string
  approved_by?: string
  rejected_at?: string
  rejected_by?: string
  rejection_reason?: string
  registration_source?: string
}

type Customer = {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  company_name: string | null
  phone: string | null
  metadata: CustomerMetadata | null
  created_at: string
}

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const formatDate = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return dateStr
  }
}

const getFileIcon = (filename: string) => {
  const ext = filename.toLowerCase().split(".").pop()
  if (ext === "pdf") {
    return <DocumentText className="text-red-500" />
  }
  return <Photo className="text-blue-500" />
}

const CustomerTaxDocumentsWidget = () => {
  const { id } = useParams()
  const customerId = id as string | undefined

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    const loadCustomer = async () => {
      if (!customerId) return

      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/admin/customers/${customerId}`, {
          credentials: "include",
        })

        if (!response.ok) {
          throw new Error("Failed to load customer")
        }

        const data = await response.json()
        if (mounted) {
          setCustomer(data.customer)
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to load customer data")
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadCustomer()

    return () => {
      mounted = false
    }
  }, [customerId])

  if (loading) {
    return (
      <Container className="p-0">
        <div className="flex flex-col gap-y-4 px-6 py-4">
          <Heading level="h2">Wholesale Registration</Heading>
          <Text className="text-ui-fg-subtle">Loading...</Text>
        </div>
      </Container>
    )
  }

  if (error) {
    return (
      <Container className="p-0">
        <div className="flex flex-col gap-y-4 px-6 py-4">
          <Heading level="h2">Wholesale Registration</Heading>
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      </Container>
    )
  }

  const metadata = customer?.metadata

  // Don't show widget if customer has no wholesale metadata
  if (!metadata?.registration_source && !metadata?.tax_id && !metadata?.tax_documents?.length && metadata?.pending_approval === undefined && !metadata?.rejected_at) {
    return null
  }

  const taxId = metadata?.tax_id
  const taxDocuments = metadata?.tax_documents || []
  const isPending = metadata?.pending_approval === true
  const isApproved = metadata?.pending_approval === false && metadata?.approved_at && !metadata?.rejected_at
  const isRejected = !!metadata?.rejected_at
  const registrationDate = metadata?.registration_date || customer?.created_at

  return (
    <Container className="p-0">
      <div className="flex flex-col gap-y-4 px-6 py-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Wholesale Registration</Heading>
          {isPending && (
            <Badge color="orange" className="flex items-center gap-1">
              <ExclamationCircle className="w-3 h-3" />
              Pending
            </Badge>
          )}
          {isApproved && (
            <Badge color="green" className="flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              Approved
            </Badge>
          )}
          {isRejected && (
            <Badge color="red" className="flex items-center gap-1">
              <XCircle className="w-3 h-3" />
              Rejected
            </Badge>
          )}
        </div>

        {/* Registration Info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          {taxId && (
            <div>
              <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide mb-1">Tax ID / EIN</Text>
              <Text className="font-medium">{taxId}</Text>
            </div>
          )}
          {registrationDate && (
            <div>
              <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide mb-1">Applied</Text>
              <Text className="font-medium">{formatDate(registrationDate)}</Text>
            </div>
          )}
          {metadata?.approved_at && (
            <div>
              <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide mb-1">Approved</Text>
              <Text className="font-medium">{formatDate(metadata.approved_at)}</Text>
            </div>
          )}
          {metadata?.rejected_at && (
            <div>
              <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide mb-1">Rejected</Text>
              <Text className="font-medium">{formatDate(metadata.rejected_at)}</Text>
            </div>
          )}
          {customer?.company_name && (
            <div>
              <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide mb-1">Company</Text>
              <Text className="font-medium">{customer.company_name}</Text>
            </div>
          )}
        </div>

        {/* Rejection Reason */}
        {isRejected && metadata?.rejection_reason && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide mb-1">Rejection Reason</Text>
            <Text className="text-sm">{metadata.rejection_reason}</Text>
          </div>
        )}

        {/* Tax Documents */}
        {taxDocuments.length > 0 && (
          <div className="mt-2">
            <Text className="text-ui-fg-subtle text-xs uppercase tracking-wide mb-2">
              Tax Documents ({taxDocuments.length})
            </Text>
            <div className="space-y-2">
              {taxDocuments.map((doc, index) => (
                <a
                  key={index}
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 bg-ui-bg-subtle rounded-lg border border-ui-border-base hover:bg-ui-bg-subtle-hover transition-colors"
                >
                  <div className="flex-shrink-0">
                    {getFileIcon(doc.filename)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Text className="font-medium truncate">{doc.filename}</Text>
                    <Text className="text-ui-fg-subtle text-xs">
                      {formatFileSize(doc.size)} • Uploaded {formatDate(doc.uploaded_at)}
                    </Text>
                  </div>
                  <div className="flex-shrink-0">
                    <Badge color="grey" size="small">View</Badge>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {taxDocuments.length === 0 && (
          <Text className="text-ui-fg-subtle text-sm italic">No tax documents uploaded</Text>
        )}

        {/* Approve/Reject Buttons for Pending Customers */}
        {isPending && (
          <div className="mt-2 pt-4 border-t border-ui-border-base">
            <ActionButtons customerId={customerId!} onAction={() => {
              // Reload customer data
              window.location.reload()
            }} />
          </div>
        )}
      </div>
    </Container>
  )
}

// Combined action buttons component
const ActionButtons = ({ customerId, onAction }: { customerId: string; onAction: () => void }) => {
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState("")

  const handleApprove = async () => {
    if (!confirm("Are you sure you want to approve this wholesale customer?")) {
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/admin/customers/${customerId}/approve-wholesale`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to approve customer")
      }

      onAction()
    } catch (err: any) {
      setError(err.message || "Failed to approve customer")
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!confirm("Are you sure you want to reject this wholesale application?")) {
      return
    }

    setProcessing(true)
    setError(null)

    try {
      const response = await fetch(`/admin/customers/${customerId}/reject-wholesale`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: rejectReason || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to reject customer")
      }

      onAction()
    } catch (err: any) {
      setError(err.message || "Failed to reject customer")
    } finally {
      setProcessing(false)
    }
  }

  if (showRejectForm) {
    return (
      <div className="flex flex-col gap-3">
        <Text className="font-medium">Rejection Reason (optional)</Text>
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Enter a reason for rejection that will be sent to the customer..."
          className="w-full p-3 border border-ui-border-base rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ui-fg-interactive"
          rows={3}
        />
        <div className="flex gap-2">
          <button
            onClick={handleReject}
            disabled={processing}
            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? "Rejecting..." : "Confirm Rejection"}
          </button>
          <button
            onClick={() => {
              setShowRejectForm(false)
              setRejectReason("")
            }}
            disabled={processing}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
        {error && <Text className="text-ui-fg-error text-sm">{error}</Text>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={processing}
          className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processing ? "Processing..." : "Approve"}
        </button>
        <button
          onClick={() => setShowRejectForm(true)}
          disabled={processing}
          className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reject
        </button>
      </div>
      {error && <Text className="text-ui-fg-error text-sm">{error}</Text>}
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "customer.details.side.after",
})

export default CustomerTaxDocumentsWidget
