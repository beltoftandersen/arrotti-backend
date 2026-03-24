import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  Button,
  Container,
  Heading,
  Input,
  Text,
  Textarea,
} from "@medusajs/ui"
import { ArrowLeft, PencilSquare } from "@medusajs/icons"

type Supplier = {
  id: string
  name: string
  code: string
  default_markup: number
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
}

const SupplierDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  // Supplier data
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit states
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form fields
  const [editName, setEditName] = useState("")
  const [editCode, setEditCode] = useState("")
  const [editDefaultMarkup, setEditDefaultMarkup] = useState("")
  const [editContactName, setEditContactName] = useState("")
  const [editEmail, setEditEmail] = useState("")
  const [editPhone, setEditPhone] = useState("")
  const [editAddress, setEditAddress] = useState("")
  const [editWebsite, setEditWebsite] = useState("")

  // Recalculate prices state
  const [recalculating, setRecalculating] = useState(false)
  const [linkedVariantCount, setLinkedVariantCount] = useState<number | null>(null)

  const loadSupplier = async () => {
    if (!id) return

    try {
      const response = await fetch(`/admin/suppliers/${id}`, {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Supplier not found")
      }

      const data = await response.json()
      setSupplier(data.supplier)
      populateForm(data.supplier)
    } catch (err: any) {
      setError(err.message || "Failed to load supplier")
    } finally {
      setLoading(false)
    }
  }

  const populateForm = (s: Supplier) => {
    setEditName(s.name)
    setEditCode(s.code)
    setEditDefaultMarkup(String(s.default_markup ?? 20))
    setEditContactName(s.contact_name || "")
    setEditEmail(s.email || "")
    setEditPhone(s.phone || "")
    setEditAddress(s.address || "")
    setEditWebsite(s.website || "")
  }

  const loadLinkedVariantCount = async () => {
    if (!id) return

    try {
      // Query variant_supplier links for this supplier
      const response = await fetch(`/admin/variants?supplier_id=${id}`, {
        credentials: "include",
      })

      // This endpoint doesn't exist, so we'll get the count differently
      // For now, we'll skip this as it requires a custom endpoint
    } catch (err) {
      // Silently fail - variant count is optional info
    }
  }

  useEffect(() => {
    loadSupplier()
  }, [id])

  const handleSave = async () => {
    if (!id || !editName.trim() || !editCode.trim()) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/suppliers/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editName.trim(),
          code: editCode.trim(),
          default_markup: editDefaultMarkup ? parseFloat(editDefaultMarkup) : 20,
          contact_name: editContactName.trim() || null,
          email: editEmail.trim() || null,
          phone: editPhone.trim() || null,
          address: editAddress.trim() || null,
          website: editWebsite.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to update supplier")
      }

      const data = await response.json()
      setSupplier(data.supplier)
      setIsEditing(false)
    } catch (err: any) {
      setError(err.message || "Failed to update supplier")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    if (supplier) {
      populateForm(supplier)
    }
    setIsEditing(false)
  }

  const handleRecalculatePrices = async () => {
    if (!id) return

    setRecalculating(true)
    setError(null)

    try {
      const response = await fetch(`/admin/suppliers/${id}/recalculate-prices`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ currency_code: "usd" }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to recalculate prices")
      }

      const data = await response.json()
      alert(`Recalculated prices for ${data.updated} variants${data.failed > 0 ? ` (${data.failed} failed)` : ""}`)
    } catch (err: any) {
      setError(err.message || "Failed to recalculate prices")
    } finally {
      setRecalculating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-y-4">
        <Text className="text-ui-fg-subtle">Loading...</Text>
      </div>
    )
  }

  if (!supplier) {
    return (
      <div className="flex flex-col gap-y-4">
        <Text className="text-ui-fg-error">Supplier not found</Text>
        <Button variant="secondary" onClick={() => navigate("/suppliers")}>
          <ArrowLeft />
          Back to Suppliers
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="transparent"
          size="small"
          onClick={() => navigate("/suppliers")}
        >
          <ArrowLeft />
        </Button>
        <div>
          <Heading level="h1">{supplier.name}</Heading>
          <Text className="text-ui-fg-subtle font-mono" size="small">
            {supplier.code}
          </Text>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-ui-bg-subtle-error p-3">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      {/* Details Section */}
      <Container className="divide-y divide-ui-border-base p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Details</Heading>
          {!isEditing && (
            <Button
              variant="transparent"
              size="small"
              onClick={() => setIsEditing(true)}
            >
              <PencilSquare />
              Edit
            </Button>
          )}
        </div>
        <div className="px-6 py-4">
          {isEditing ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Text size="small" weight="plus" className="mb-2">
                    Name *
                  </Text>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Supplier name"
                  />
                </div>
                <div>
                  <Text size="small" weight="plus" className="mb-2">
                    Code *
                  </Text>
                  <Input
                    value={editCode}
                    onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                    placeholder="SUPP"
                    maxLength={20}
                  />
                </div>
                <div>
                  <Text size="small" weight="plus" className="mb-2">
                    Default Markup %
                  </Text>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editDefaultMarkup}
                    onChange={(e) => setEditDefaultMarkup(e.target.value)}
                    placeholder="30"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Text size="small" weight="plus" className="mb-2">
                    Contact Name
                  </Text>
                  <Input
                    value={editContactName}
                    onChange={(e) => setEditContactName(e.target.value)}
                    placeholder="John Smith"
                  />
                </div>
                <div>
                  <Text size="small" weight="plus" className="mb-2">
                    Email
                  </Text>
                  <Input
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="contact@supplier.com"
                    type="email"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Text size="small" weight="plus" className="mb-2">
                    Phone
                  </Text>
                  <Input
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
                <div>
                  <Text size="small" weight="plus" className="mb-2">
                    Website
                  </Text>
                  <Input
                    value={editWebsite}
                    onChange={(e) => setEditWebsite(e.target.value)}
                    placeholder="https://supplier.com"
                  />
                </div>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  Address
                </Text>
                <Textarea
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  placeholder="123 Main St, City, State 12345"
                  rows={2}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="small"
                  isLoading={saving}
                  disabled={!editName.trim() || !editCode.trim()}
                  onClick={handleSave}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Name
                </Text>
                <Text>{supplier.name}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Code
                </Text>
                <Text className="font-mono">{supplier.code}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Default Markup
                </Text>
                <Text>{supplier.default_markup}%</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Contact Name
                </Text>
                <Text>{supplier.contact_name || "-"}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Email
                </Text>
                {supplier.email ? (
                  <a
                    href={`mailto:${supplier.email}`}
                    className="text-ui-fg-interactive hover:underline"
                  >
                    {supplier.email}
                  </a>
                ) : (
                  <Text>-</Text>
                )}
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Phone
                </Text>
                <Text>{supplier.phone || "-"}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Website
                </Text>
                {supplier.website ? (
                  <a
                    href={supplier.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ui-fg-interactive hover:underline"
                  >
                    {supplier.website}
                  </a>
                ) : (
                  <Text>-</Text>
                )}
              </div>
              <div className="col-span-2">
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Address
                </Text>
                <Text>{supplier.address || "-"}</Text>
              </div>
            </div>
          )}
        </div>
      </Container>

      {/* Pricing Actions Section */}
      <Container className="divide-y divide-ui-border-base p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Pricing Actions</Heading>
        </div>
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Text size="small" weight="plus">
                Recalculate All Prices
              </Text>
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                Update sell prices for all variants linked to this supplier using the default markup ({supplier.default_markup}%)
              </Text>
            </div>
            <Button
              variant="secondary"
              size="small"
              isLoading={recalculating}
              onClick={handleRecalculatePrices}
            >
              Recalculate Prices
            </Button>
          </div>
        </div>
      </Container>
    </div>
  )
}

export default SupplierDetailPage
