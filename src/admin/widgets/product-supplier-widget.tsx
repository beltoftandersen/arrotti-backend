import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Select,
  Text,
  Switch,
  IconButton,
} from "@medusajs/ui"
import { PencilSquare, Plus, Trash, Check } from "@medusajs/icons"

type Supplier = {
  id: string
  name: string
  code: string
  email: string | null
  default_markup: number
}

type VariantSupplierLink = {
  supplier_id: string
  supplier: Supplier | null
  supplier_sku: string | null
  cost_price: number | null
  markup_override: number | null
  stock_qty: number | null
  is_primary: boolean
  effective_markup: number
  calculated_sell_price: number | null
}

type Variant = {
  id: string
  sku: string | null
  title: string | null
}

type VariantWithSuppliers = {
  variant_id: string
  variant_sku: string | null
  variant_title: string | null
  suppliers: VariantSupplierLink[]
}

const NONE_VALUE = "__none__"

const ProductSupplierWidget = () => {
  const { id } = useParams()
  const productId = id as string | undefined

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [variants, setVariants] = useState<VariantWithSuppliers[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  // Per-variant add supplier state
  const [addingToVariantId, setAddingToVariantId] = useState<string | null>(null)
  const [newSupplierData, setNewSupplierData] = useState<{
    supplier_id: string
    cost_price: string
    markup_override: string
    stock_qty: string
    supplier_sku: string
    is_primary: boolean
  }>({
    supplier_id: NONE_VALUE,
    cost_price: "",
    markup_override: "",
    stock_qty: "0",
    supplier_sku: "",
    is_primary: false,
  })

  // Per-variant edit state
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [editingSupplierData, setEditingSupplierData] = useState<{
    supplier_id: string
    cost_price: string
    markup_override: string
    stock_qty: string
    supplier_sku: string
    is_primary: boolean
  } | null>(null)

  const loadSuppliers = async () => {
    const response = await fetch("/admin/suppliers", {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to load suppliers")
    }

    const data = await response.json()
    setSuppliers(data.suppliers ?? [])
  }

  const loadVariants = async () => {
    if (!productId) return

    // Use bulk endpoint to get all variants with their suppliers in one request
    const response = await fetch(
      `/admin/product-variant-suppliers/${productId}`,
      {
        credentials: "include",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error("[Widget] Error loading variants:", errorData)
      throw new Error(errorData.message || "Failed to load variants")
    }

    const data = await response.json()
    console.log("[Widget] Loaded variants:", data)
    setVariants(data.variants ?? [])
  }

  useEffect(() => {
    let mounted = true

    const loadAll = async () => {
      if (!productId) return

      setLoading(true)
      setError(null)

      try {
        await Promise.all([loadSuppliers(), loadVariants()])
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to load data")
        }
      } finally {
        if (mounted) {
          setLoading(false)
        }
      }
    }

    loadAll()

    return () => {
      mounted = false
    }
  }, [productId])

  const handleStartAddSupplier = (variantId: string) => {
    setAddingToVariantId(variantId)
    setNewSupplierData({
      supplier_id: NONE_VALUE,
      cost_price: "",
      markup_override: "",
      stock_qty: "0",
      supplier_sku: "",
      is_primary: false,
    })
  }

  const handleCancelAddSupplier = () => {
    setAddingToVariantId(null)
  }

  const handleAddSupplierToVariant = async () => {
    if (!addingToVariantId || !newSupplierData.supplier_id || newSupplierData.supplier_id === NONE_VALUE) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/variants/${addingToVariantId}/suppliers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: newSupplierData.supplier_id,
          cost_price: newSupplierData.cost_price ? parseFloat(newSupplierData.cost_price) : null,
          markup_override: newSupplierData.markup_override ? parseFloat(newSupplierData.markup_override) : null,
          stock_qty: newSupplierData.stock_qty ? parseInt(newSupplierData.stock_qty, 10) : 0,
          supplier_sku: newSupplierData.supplier_sku || null,
          is_primary: newSupplierData.is_primary,
          auto_update_price: true,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to add supplier")
      }

      await loadVariants()
      setAddingToVariantId(null)
    } catch (err: any) {
      setError(err.message || "Failed to add supplier")
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveSupplierFromVariant = async (variantId: string, supplierId: string) => {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/variants/${variantId}/suppliers/${supplierId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to remove supplier")
      }

      await loadVariants()
    } catch (err: any) {
      setError(err.message || "Failed to remove supplier")
    } finally {
      setSaving(false)
    }
  }

  const handleStartEditSupplier = (variantId: string, supplier: VariantSupplierLink) => {
    setEditingVariantId(variantId)
    setEditingSupplierData({
      supplier_id: supplier.supplier_id,
      cost_price: supplier.cost_price !== null ? String(supplier.cost_price) : "",
      markup_override: supplier.markup_override !== null ? String(supplier.markup_override) : "",
      stock_qty: supplier.stock_qty !== null ? String(supplier.stock_qty) : "0",
      supplier_sku: supplier.supplier_sku || "",
      is_primary: supplier.is_primary,
    })
  }

  const handleCancelEditSupplier = () => {
    setEditingVariantId(null)
    setEditingSupplierData(null)
  }

  const handleSaveSupplier = async () => {
    if (!editingVariantId || !editingSupplierData) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(
        `/admin/variants/${editingVariantId}/suppliers/${editingSupplierData.supplier_id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cost_price: editingSupplierData.cost_price
              ? parseFloat(editingSupplierData.cost_price)
              : null,
            markup_override: editingSupplierData.markup_override
              ? parseFloat(editingSupplierData.markup_override)
              : null,
            stock_qty: editingSupplierData.stock_qty
              ? parseInt(editingSupplierData.stock_qty, 10)
              : 0,
            supplier_sku: editingSupplierData.supplier_sku || null,
            is_primary: editingSupplierData.is_primary,
            auto_update_price: true,
          }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to update supplier")
      }

      await loadVariants()
      handleCancelEditSupplier()
    } catch (err: any) {
      setError(err.message || "Failed to update supplier")
    } finally {
      setSaving(false)
    }
  }

  const handleSetPrimary = async (variantId: string, supplierId: string) => {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/variants/${variantId}/suppliers/${supplierId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_primary: true,
          auto_update_price: true,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to set primary")
      }

      await loadVariants()
    } catch (err: any) {
      setError(err.message || "Failed to set primary")
    } finally {
      setSaving(false)
    }
  }

  const formatPrice = (price: number | null) => {
    if (price === null) return "-"
    return `$${price.toFixed(2)}`
  }

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Suppliers & Pricing</Heading>
        {!isEditing && (
          <Button
            type="button"
            variant="transparent"
            size="small"
            onClick={() => setIsEditing(true)}
          >
            <PencilSquare />
            Edit
          </Button>
        )}
        {isEditing && (
          <Button
            type="button"
            variant="secondary"
            size="small"
            onClick={() => setIsEditing(false)}
          >
            Done
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="px-6 py-4">
        {error && (
          <Text className="text-ui-fg-error mb-4">{error}</Text>
        )}

        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading...
          </Text>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Variants List */}
            {variants.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">
                No variants found for this product.
              </Text>
            ) : (
              <div className="flex flex-col gap-4">
                {variants.map((variant) => (
                  <div
                    key={variant.variant_id}
                    className="border border-ui-border-base rounded-lg overflow-hidden"
                  >
                    {/* Variant Header */}
                    <div className="bg-ui-bg-subtle px-4 py-2 border-b border-ui-border-base">
                      <Text size="small" weight="plus">
                        {variant.variant_sku || variant.variant_title || variant.variant_id}
                      </Text>
                    </div>

                    {/* Suppliers for this variant */}
                    <div className="px-4 py-3">
                      {(variant.suppliers ?? []).length === 0 && addingToVariantId !== variant.variant_id ? (
                        <div className="flex items-center justify-between">
                          <Text size="small" className="text-ui-fg-subtle">
                            No suppliers assigned
                          </Text>
                          {isEditing && (
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() => handleStartAddSupplier(variant.variant_id)}
                            >
                              <Plus />
                              Add Supplier
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {(variant.suppliers ?? []).map((vs) => {
                            const isEditingThis =
                              editingVariantId === variant.variant_id &&
                              editingSupplierData?.supplier_id === vs.supplier_id

                            if (isEditingThis && editingSupplierData) {
                              return (
                                <div
                                  key={vs.supplier_id}
                                  className="bg-ui-bg-subtle rounded-lg p-3"
                                >
                                  <div className="grid grid-cols-5 gap-3 mb-3">
                                    <div>
                                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                        Supplier
                                      </Text>
                                      <Text size="small" weight="plus">
                                        {vs.supplier?.name} ({vs.supplier?.code})
                                      </Text>
                                    </div>
                                    <div>
                                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                        Cost Price
                                      </Text>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        size="small"
                                        value={editingSupplierData.cost_price}
                                        onChange={(e) =>
                                          setEditingSupplierData({
                                            ...editingSupplierData,
                                            cost_price: e.target.value,
                                          })
                                        }
                                        placeholder="0.00"
                                      />
                                    </div>
                                    <div>
                                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                        Markup %
                                      </Text>
                                      <Input
                                        type="number"
                                        step="0.1"
                                        size="small"
                                        value={editingSupplierData.markup_override}
                                        onChange={(e) =>
                                          setEditingSupplierData({
                                            ...editingSupplierData,
                                            markup_override: e.target.value,
                                          })
                                        }
                                        placeholder={`${vs.supplier?.default_markup ?? 20}`}
                                      />
                                    </div>
                                    <div>
                                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                        Stock Qty
                                      </Text>
                                      <Input
                                        type="number"
                                        step="1"
                                        size="small"
                                        value={editingSupplierData.stock_qty}
                                        onChange={(e) =>
                                          setEditingSupplierData({
                                            ...editingSupplierData,
                                            stock_qty: e.target.value,
                                          })
                                        }
                                        placeholder="0"
                                      />
                                    </div>
                                    <div>
                                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                        Supplier SKU
                                      </Text>
                                      <Input
                                        size="small"
                                        value={editingSupplierData.supplier_sku}
                                        onChange={(e) =>
                                          setEditingSupplierData({
                                            ...editingSupplierData,
                                            supplier_sku: e.target.value,
                                          })
                                        }
                                        placeholder="SKU"
                                      />
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Switch
                                        checked={editingSupplierData.is_primary}
                                        onCheckedChange={(checked) =>
                                          setEditingSupplierData({
                                            ...editingSupplierData,
                                            is_primary: checked,
                                          })
                                        }
                                      />
                                      <Text size="small">Primary supplier</Text>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Button
                                        variant="secondary"
                                        size="small"
                                        onClick={handleCancelEditSupplier}
                                      >
                                        Cancel
                                      </Button>
                                      <Button
                                        variant="primary"
                                        size="small"
                                        isLoading={saving}
                                        onClick={handleSaveSupplier}
                                      >
                                        Save
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <div
                                key={vs.supplier_id}
                                className={`flex items-center justify-between p-2 rounded ${
                                  vs.is_primary ? "bg-ui-bg-subtle-success" : ""
                                }`}
                              >
                                <div className="flex items-center gap-4">
                                  <div className="flex items-center gap-2">
                                    <Text size="small" weight="plus">
                                      {vs.supplier?.name}
                                    </Text>
                                    <Badge size="2xsmall" color="grey">
                                      {vs.supplier?.code}
                                    </Badge>
                                    {vs.is_primary && (
                                      <Badge size="2xsmall" color="green">
                                        Primary
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-4 text-ui-fg-subtle">
                                    <Text size="xsmall">
                                      Cost: {formatPrice(vs.cost_price)}
                                    </Text>
                                    <Text size="xsmall">
                                      Markup: {vs.effective_markup}%
                                      {vs.markup_override !== null && " *"}
                                    </Text>
                                    <Text size="xsmall">
                                      Stock: {vs.stock_qty ?? 0}
                                    </Text>
                                    <Text size="xsmall">
                                      → Sell: {formatPrice(vs.calculated_sell_price)}
                                    </Text>
                                  </div>
                                </div>
                                {isEditing && (
                                  <div className="flex items-center gap-1">
                                    {!vs.is_primary && (variant.suppliers ?? []).length > 1 && (
                                      <IconButton
                                        variant="transparent"
                                        size="small"
                                        onClick={() =>
                                          handleSetPrimary(variant.variant_id, vs.supplier_id)
                                        }
                                        disabled={saving}
                                      >
                                        <Check />
                                      </IconButton>
                                    )}
                                    <IconButton
                                      variant="transparent"
                                      size="small"
                                      onClick={() =>
                                        handleStartEditSupplier(variant.variant_id, vs)
                                      }
                                    >
                                      <PencilSquare />
                                    </IconButton>
                                    <IconButton
                                      variant="transparent"
                                      size="small"
                                      onClick={() =>
                                        handleRemoveSupplierFromVariant(
                                          variant.variant_id,
                                          vs.supplier_id
                                        )
                                      }
                                      disabled={saving}
                                    >
                                      <Trash />
                                    </IconButton>
                                  </div>
                                )}
                              </div>
                            )
                          })}

                          {/* Add Supplier button (when editing and not already adding) */}
                          {isEditing && addingToVariantId !== variant.variant_id && (
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() => handleStartAddSupplier(variant.variant_id)}
                              className="mt-2"
                            >
                              <Plus />
                              Add Supplier
                            </Button>
                          )}
                        </div>
                      )}

                      {/* Add Supplier Form */}
                      {addingToVariantId === variant.variant_id && (
                        <div className="bg-ui-bg-subtle rounded-lg p-3 mt-3">
                          <Text size="small" weight="plus" className="mb-3">
                            Add Supplier
                          </Text>
                          <div className="grid grid-cols-3 gap-3 mb-3">
                            <div>
                              <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                Supplier *
                              </Text>
                              <Select
                                value={newSupplierData.supplier_id}
                                onValueChange={(val) =>
                                  setNewSupplierData({ ...newSupplierData, supplier_id: val })
                                }
                              >
                                <Select.Trigger>
                                  <Select.Value placeholder="Select supplier" />
                                </Select.Trigger>
                                <Select.Content>
                                  <Select.Item value={NONE_VALUE}>
                                    <span className="text-ui-fg-subtle">Select a supplier</span>
                                  </Select.Item>
                                  {suppliers
                                    .filter((s) => !(variant.suppliers ?? []).some((vs) => vs.supplier_id === s.id))
                                    .map((supplier) => (
                                      <Select.Item key={supplier.id} value={supplier.id}>
                                        {supplier.name} ({supplier.code}) - {supplier.default_markup}%
                                      </Select.Item>
                                    ))}
                                </Select.Content>
                              </Select>
                            </div>
                            <div>
                              <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                Cost Price
                              </Text>
                              <Input
                                type="number"
                                step="0.01"
                                size="small"
                                value={newSupplierData.cost_price}
                                onChange={(e) =>
                                  setNewSupplierData({ ...newSupplierData, cost_price: e.target.value })
                                }
                                placeholder="0.00"
                              />
                            </div>
                            <div>
                              <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                Markup %
                              </Text>
                              <Input
                                type="number"
                                step="0.1"
                                size="small"
                                value={newSupplierData.markup_override}
                                onChange={(e) =>
                                  setNewSupplierData({ ...newSupplierData, markup_override: e.target.value })
                                }
                                placeholder="Default"
                              />
                            </div>
                            <div>
                              <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                Stock Qty
                              </Text>
                              <Input
                                type="number"
                                step="1"
                                size="small"
                                value={newSupplierData.stock_qty}
                                onChange={(e) =>
                                  setNewSupplierData({ ...newSupplierData, stock_qty: e.target.value })
                                }
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                                Supplier SKU
                              </Text>
                              <Input
                                size="small"
                                value={newSupplierData.supplier_sku}
                                onChange={(e) =>
                                  setNewSupplierData({ ...newSupplierData, supplier_sku: e.target.value })
                                }
                                placeholder="Optional"
                              />
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={newSupplierData.is_primary}
                                onCheckedChange={(checked) =>
                                  setNewSupplierData({ ...newSupplierData, is_primary: checked })
                                }
                              />
                              <Text size="small">Primary supplier</Text>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="secondary"
                                size="small"
                                onClick={handleCancelAddSupplier}
                              >
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                size="small"
                                isLoading={saving}
                                disabled={!newSupplierData.supplier_id || newSupplierData.supplier_id === NONE_VALUE}
                                onClick={handleAddSupplierToVariant}
                              >
                                Add
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductSupplierWidget
