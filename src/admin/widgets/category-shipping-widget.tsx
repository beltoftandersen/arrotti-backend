import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Text, Badge } from "@medusajs/ui"
import { PencilSquare } from "@medusajs/icons"

type ShippingData = {
  weight: number | null
  length: number | null
  width: number | null
  height: number | null
}

type ParentShipping = ShippingData & {
  category_name: string
}

const WEIGHT_UNIT = "lb"
const DIM_UNIT = "in"

const CategoryShippingWidget = () => {
  const { id } = useParams()
  const categoryId = id as string | undefined

  const [shipping, setShipping] = useState<ShippingData>({ weight: null, length: null, width: null, height: null })
  const [parentShipping, setParentShipping] = useState<ParentShipping | null>(null)
  const [isSubcategory, setIsSubcategory] = useState(false)

  const [weight, setWeight] = useState("")
  const [length, setLength] = useState("")
  const [width, setWidth] = useState("")
  const [height, setHeight] = useState("")

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const hasData = shipping.weight || shipping.length || shipping.width || shipping.height

  const loadShipping = async () => {
    if (!categoryId) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/admin/categories/${categoryId}/shipping`, {
        credentials: "include",
      })
      if (!response.ok) throw new Error("Failed to load shipping data")

      const data = await response.json()
      const s = data.shipping || {}
      setShipping(s)
      setParentShipping(data.parent_shipping || null)
      setIsSubcategory(data.is_subcategory)
      setWeight(s.weight?.toString() || "")
      setLength(s.length?.toString() || "")
      setWidth(s.width?.toString() || "")
      setHeight(s.height?.toString() || "")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadShipping() }, [categoryId])

  const handleSave = async () => {
    if (!categoryId) return
    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/admin/categories/${categoryId}/shipping`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight: weight ? parseFloat(weight) : null,
          length: length ? parseFloat(length) : null,
          width: width ? parseFloat(width) : null,
          height: height ? parseFloat(height) : null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to save")
      }

      const data = await response.json()
      setShipping(data.shipping)
      setSuccess(true)
      setIsEditing(false)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setWeight(shipping.weight?.toString() || "")
    setLength(shipping.length?.toString() || "")
    setWidth(shipping.width?.toString() || "")
    setHeight(shipping.height?.toString() || "")
    setIsEditing(false)
    setError(null)
  }

  const handleSync = async () => {
    if (!categoryId) return
    setSyncing(true)
    setSyncResult(null)
    setError(null)

    try {
      const response = await fetch(`/admin/categories/${categoryId}/shipping/sync`, {
        method: "POST",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to sync")
      }

      const data = await response.json()
      setSyncResult(
        `Updated ${data.updated_variants} variants across ${data.total_products} products`
      )
      setTimeout(() => setSyncResult(null), 5000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  const effectiveWeight = shipping.weight ?? parentShipping?.weight ?? null
  const effectiveLength = shipping.length ?? parentShipping?.length ?? null
  const effectiveWidth = shipping.width ?? parentShipping?.width ?? null
  const effectiveHeight = shipping.height ?? parentShipping?.height ?? null
  const hasEffective = effectiveWeight || effectiveLength || effectiveWidth || effectiveHeight

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Shipping Defaults</Heading>
        {hasData && !isEditing && (
          <Button type="button" variant="transparent" size="small" onClick={() => setIsEditing(true)}>
            <PencilSquare />
            Edit
          </Button>
        )}
      </div>

      <div className="px-6 py-4">
        {error && <Text className="text-ui-fg-error mb-4">{error}</Text>}
        {success && <Text className="text-ui-fg-interactive mb-4">Shipping defaults saved!</Text>}
        {syncResult && <Text className="text-ui-fg-interactive mb-4">{syncResult}</Text>}

        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
        ) : hasData && !isEditing ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-4">
              {shipping.weight != null && (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-1">Weight</Text>
                  <Text size="small">{shipping.weight} {WEIGHT_UNIT}</Text>
                </div>
              )}
              {shipping.length != null && (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-1">Length</Text>
                  <Text size="small">{shipping.length} {DIM_UNIT}</Text>
                </div>
              )}
              {shipping.width != null && (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-1">Width</Text>
                  <Text size="small">{shipping.width} {DIM_UNIT}</Text>
                </div>
              )}
              {shipping.height != null && (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-1">Height</Text>
                  <Text size="small">{shipping.height} {DIM_UNIT}</Text>
                </div>
              )}
            </div>
            <Button type="button" variant="secondary" size="small" isLoading={syncing} onClick={handleSync}>
              Apply to all products in this category
            </Button>
          </div>
        ) : !isEditing && !hasData ? (
          <div className="flex flex-col gap-3">
            {isSubcategory && parentShipping && hasEffective ? (
              <div>
                <Badge color="blue" className="mb-3">
                  Inheriting from: {parentShipping.category_name}
                </Badge>
                <div className="grid grid-cols-2 gap-4">
                  {effectiveWeight != null && (
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Weight</Text>
                      <Text size="small" className="text-ui-fg-muted">{effectiveWeight} {WEIGHT_UNIT}</Text>
                    </div>
                  )}
                  {effectiveLength != null && (
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Length</Text>
                      <Text size="small" className="text-ui-fg-muted">{effectiveLength} {DIM_UNIT}</Text>
                    </div>
                  )}
                  {effectiveWidth != null && (
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Width</Text>
                      <Text size="small" className="text-ui-fg-muted">{effectiveWidth} {DIM_UNIT}</Text>
                    </div>
                  )}
                  {effectiveHeight != null && (
                    <div>
                      <Text size="xsmall" className="text-ui-fg-subtle mb-1">Height</Text>
                      <Text size="small" className="text-ui-fg-muted">{effectiveHeight} {DIM_UNIT}</Text>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Button type="button" variant="secondary" size="small" onClick={() => setIsEditing(true)}>
                    Override
                  </Button>
                  <Button type="button" variant="secondary" size="small" isLoading={syncing} onClick={handleSync}>
                    Apply to all products
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Text size="small" className="text-ui-fg-subtle mb-3">
                  No shipping defaults set. Products in this category will use these values for shipping calculations.
                </Text>
                <Button type="button" variant="secondary" size="small" onClick={() => setIsEditing(true)}>
                  Set Defaults
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {isSubcategory && parentShipping && (
              <div className="bg-ui-bg-subtle rounded-lg p-3 mb-1">
                <Text size="xsmall" className="text-ui-fg-subtle">
                  Parent ({parentShipping.category_name}): {parentShipping.weight ?? "—"} {WEIGHT_UNIT}, {parentShipping.length ?? "—"}x{parentShipping.width ?? "—"}x{parentShipping.height ?? "—"} {DIM_UNIT}
                </Text>
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Leave fields empty to inherit from parent.
                </Text>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text size="small" weight="plus" className="mb-2">Weight ({WEIGHT_UNIT})</Text>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder={parentShipping?.weight?.toString() || "0"}
                />
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">Length ({DIM_UNIT})</Text>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  placeholder={parentShipping?.length?.toString() || "0"}
                />
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">Width ({DIM_UNIT})</Text>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={width}
                  onChange={(e) => setWidth(e.target.value)}
                  placeholder={parentShipping?.width?.toString() || "0"}
                />
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">Height ({DIM_UNIT})</Text>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  value={height}
                  onChange={(e) => setHeight(e.target.value)}
                  placeholder={parentShipping?.height?.toString() || "0"}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              {(isEditing || hasData) && (
                <Button type="button" variant="secondary" size="small" onClick={handleCancel}>
                  Cancel
                </Button>
              )}
              <Button type="button" variant="primary" size="small" isLoading={saving} onClick={handleSave}>
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product_category.details.after",
})

export default CategoryShippingWidget
