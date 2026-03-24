import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Select, Text } from "@medusajs/ui"
import { PencilSquare, XMark } from "@medusajs/icons"

type Brand = {
  id: string
  name: string
  logo_url: string | null
  description: string | null
}

const ProductBrandWidget = () => {
  const { id } = useParams()
  const productId = id as string | undefined

  const [brands, setBrands] = useState<Brand[]>([])
  const [currentBrand, setCurrentBrand] = useState<Brand | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState("")

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  const loadBrands = async () => {
    const response = await fetch("/admin/brands", {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to load brands")
    }

    const data = await response.json()
    setBrands(data.brands ?? [])
  }

  const loadProductBrand = async () => {
    if (!productId) {
      return
    }

    const response = await fetch(`/admin/products/${productId}/brand`, {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to load product brand")
    }

    const data = await response.json()
    setCurrentBrand(data.brand)
    setSelectedBrandId(data.brand?.id ?? "")
  }

  useEffect(() => {
    let mounted = true

    const loadAll = async () => {
      if (!productId) {
        return
      }

      setLoading(true)
      setError(null)

      try {
        await Promise.all([loadBrands(), loadProductBrand()])
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to load brand data")
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

  const handleSetBrand = async () => {
    if (!productId || !selectedBrandId) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/products/${productId}/brand`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ brand_id: selectedBrandId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to set brand")
      }

      const data = await response.json()
      setCurrentBrand(data.brand)
    } catch (err: any) {
      setError(err.message || "Failed to set brand")
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveBrand = async () => {
    if (!productId || !currentBrand) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/products/${productId}/brand`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to remove brand")
      }

      setCurrentBrand(null)
      setSelectedBrandId("")
    } catch (err: any) {
      setError(err.message || "Failed to remove brand")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Brand</Heading>
        {currentBrand && !isEditing && (
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
        ) : currentBrand && !isEditing ? (
          <div className="flex items-center gap-3">
            {currentBrand.logo_url && (
              <img
                src={currentBrand.logo_url}
                alt={currentBrand.name}
                className="h-10 w-auto"
              />
            )}
            <div>
              <Text size="base" weight="plus">
                {currentBrand.name}
              </Text>
              {currentBrand.description && (
                <Text size="small" className="text-ui-fg-subtle">
                  {currentBrand.description}
                </Text>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <Text size="small" weight="plus" className="mb-2">
                Select Brand
              </Text>
              <Select
                value={selectedBrandId}
                onValueChange={setSelectedBrandId}
              >
                <Select.Trigger>
                  <Select.Value placeholder="Choose a brand..." />
                </Select.Trigger>
                <Select.Content>
                  {brands.map((brand) => (
                    <Select.Item key={brand.id} value={brand.id}>
                      {brand.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              {brands.length === 0 && (
                <Text size="small" className="text-ui-fg-subtle mt-2">
                  No brands available. Create brands in Products → Brands.
                </Text>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              {isEditing && (
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={() => {
                    setIsEditing(false)
                    setSelectedBrandId(currentBrand?.id ?? "")
                  }}
                >
                  Cancel
                </Button>
              )}
              {currentBrand && isEditing && (
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  isLoading={saving}
                  onClick={async () => {
                    await handleRemoveBrand()
                    setIsEditing(false)
                  }}
                >
                  <XMark />
                  Remove Brand
                </Button>
              )}
              <Button
                type="button"
                variant="primary"
                size="small"
                isLoading={saving}
                disabled={!selectedBrandId}
                onClick={async () => {
                  await handleSetBrand()
                  setIsEditing(false)
                }}
              >
                {currentBrand ? "Update" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductBrandWidget
