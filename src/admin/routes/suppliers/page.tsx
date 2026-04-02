import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Switch,
  Table,
  Text,
} from "@medusajs/ui"
import { PencilSquare, Plus, Trash } from "@medusajs/icons"

type Supplier = {
  id: string
  name: string
  code: string
  contact_name: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
}

const SuppliersListPage = () => {
  const navigate = useNavigate()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Notification toggle
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [notificationsLoading, setNotificationsLoading] = useState(true)

  const loadNotificationSetting = async () => {
    try {
      const res = await fetch("/admin/stores", { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        const store = data.store ?? data.stores?.[0]
        setNotificationsEnabled(store?.metadata?.supplier_notifications_enabled !== false)
      }
    } catch {
      // default to enabled
    } finally {
      setNotificationsLoading(false)
    }
  }

  const toggleNotifications = async (enabled: boolean) => {
    setNotificationsEnabled(enabled)
    try {
      // Get store ID first
      const storeRes = await fetch("/admin/stores", { credentials: "include" })
      const storeData = await storeRes.json()
      const store = storeData.store ?? storeData.stores?.[0]
      if (!store?.id) return

      await fetch(`/admin/stores/${store.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metadata: {
            ...store.metadata,
            supplier_notifications_enabled: enabled,
          },
        }),
      })
    } catch {
      setNotificationsEnabled(!enabled) // revert on error
    }
  }

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState("")
  const [newSupplierCode, setNewSupplierCode] = useState("")
  const [saving, setSaving] = useState(false)

  const loadSuppliers = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/admin/suppliers", {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to load suppliers")
      }

      const data = await response.json()
      setSuppliers(data.suppliers ?? [])
    } catch (err: any) {
      setError(err.message || "Failed to load suppliers")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSuppliers()
    loadNotificationSetting()
  }, [])

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim() || !newSupplierCode.trim()) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch("/admin/suppliers", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newSupplierName.trim(),
          code: newSupplierCode.trim(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to create supplier")
      }

      const data = await response.json()
      setNewSupplierName("")
      setNewSupplierCode("")
      setShowCreateForm(false)
      // Navigate to the new supplier's detail page
      navigate(`/suppliers/${data.supplier.id}`)
    } catch (err: any) {
      setError(err.message || "Failed to create supplier")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSupplier = async (supplierId: string, supplierName: string) => {
    if (!confirm(`Are you sure you want to delete "${supplierName}"?`)) {
      return
    }

    try {
      const response = await fetch(`/admin/suppliers/${supplierId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to delete supplier")
      }

      await loadSuppliers()
    } catch (err: any) {
      setError(err.message || "Failed to delete supplier")
    }
  }

  return (
    <div className="flex flex-col gap-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Suppliers</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage product suppliers
          </Text>
        </div>
        <Button
          variant="primary"
          size="small"
          onClick={() => setShowCreateForm(true)}
        >
          <Plus />
          Create Supplier
        </Button>
      </div>

      {/* Order Notification Toggle */}
      <Container className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <Text weight="plus">Supplier Order Notifications</Text>
            <Text size="small" className="text-ui-fg-subtle">
              Email suppliers automatically when an order is placed
            </Text>
          </div>
          {notificationsLoading ? (
            <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
          ) : (
            <Switch
              checked={notificationsEnabled}
              onCheckedChange={toggleNotifications}
            />
          )}
        </div>
      </Container>

      {error && (
        <div className="rounded-md bg-ui-bg-subtle-error p-3">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      {/* Create Form Modal */}
      {showCreateForm && (
        <Container className="p-4">
          <Heading level="h2" className="mb-4">
            Create Supplier
          </Heading>
          <div className="flex flex-col gap-4">
            <div>
              <Text size="small" weight="plus" className="mb-2">
                Name *
              </Text>
              <Input
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                placeholder="Supplier name"
                autoFocus
              />
            </div>
            <div>
              <Text size="small" weight="plus" className="mb-2">
                Code *
              </Text>
              <Input
                value={newSupplierCode}
                onChange={(e) => setNewSupplierCode(e.target.value.toUpperCase())}
                placeholder="SUPP"
                maxLength={20}
              />
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                Short unique identifier (e.g., CAPA, NSF, KEYSTONE)
              </Text>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  setShowCreateForm(false)
                  setNewSupplierName("")
                  setNewSupplierCode("")
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="small"
                isLoading={saving}
                disabled={!newSupplierName.trim() || !newSupplierCode.trim()}
                onClick={handleCreateSupplier}
              >
                Create
              </Button>
            </div>
          </div>
        </Container>
      )}

      {/* Suppliers Table */}
      <Container className="p-0">
        {loading ? (
          <div className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading...
            </Text>
          </div>
        ) : suppliers.length === 0 ? (
          <div className="p-8 text-center">
            <Text className="text-ui-fg-subtle">
              No suppliers yet. Create your first supplier to get started.
            </Text>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Code</Table.HeaderCell>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Contact</Table.HeaderCell>
                <Table.HeaderCell>Email</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {suppliers.map((supplier) => (
                <Table.Row
                  key={supplier.id}
                  className="cursor-pointer hover:bg-ui-bg-subtle"
                  onClick={() => navigate(`/suppliers/${supplier.id}`)}
                >
                  <Table.Cell>
                    <Text weight="plus" className="font-mono">
                      {supplier.code}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text>{supplier.name}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle">
                      {supplier.contact_name || "-"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle">
                      {supplier.email || "-"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        variant="transparent"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/suppliers/${supplier.id}`)
                        }}
                      >
                        <PencilSquare />
                      </IconButton>
                      <IconButton
                        variant="transparent"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteSupplier(supplier.id, supplier.name)
                        }}
                      >
                        <Trash />
                      </IconButton>
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
  label: "Suppliers",
  nested: "/products",
})

export default SuppliersListPage
