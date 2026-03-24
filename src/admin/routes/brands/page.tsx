import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Table,
  Text,
} from "@medusajs/ui"
import { PencilSquare, Plus, Trash } from "@medusajs/icons"

type Brand = {
  id: string
  name: string
  handle: string
  logo_url: string | null
  description: string | null
}

const BrandsListPage = () => {
  const navigate = useNavigate()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newBrandName, setNewBrandName] = useState("")
  const [saving, setSaving] = useState(false)

  const loadBrands = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/admin/brands", {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to load brands")
      }

      const data = await response.json()
      setBrands(data.brands ?? [])
    } catch (err: any) {
      setError(err.message || "Failed to load brands")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBrands()
  }, [])

  const handleCreateBrand = async () => {
    if (!newBrandName.trim()) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch("/admin/brands", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: newBrandName.trim(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to create brand")
      }

      const data = await response.json()
      setNewBrandName("")
      setShowCreateForm(false)
      // Navigate to the new brand's detail page
      navigate(`/brands/${data.brand.id}`)
    } catch (err: any) {
      setError(err.message || "Failed to create brand")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteBrand = async (brandId: string, brandName: string) => {
    if (!confirm(`Are you sure you want to delete "${brandName}"?`)) {
      return
    }

    try {
      const response = await fetch(`/admin/brands/${brandId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to delete brand")
      }

      await loadBrands()
    } catch (err: any) {
      setError(err.message || "Failed to delete brand")
    }
  }

  return (
    <div className="flex flex-col gap-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Brands</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Manage product brands
          </Text>
        </div>
        <Button
          variant="primary"
          size="small"
          onClick={() => setShowCreateForm(true)}
        >
          <Plus />
          Create Brand
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-ui-bg-subtle-error p-3">
          <Text className="text-ui-fg-error">{error}</Text>
        </div>
      )}

      {/* Create Form Modal */}
      {showCreateForm && (
        <Container className="p-4">
          <Heading level="h2" className="mb-4">
            Create Brand
          </Heading>
          <div className="flex flex-col gap-4">
            <div>
              <Text size="small" weight="plus" className="mb-2">
                Name
              </Text>
              <Input
                value={newBrandName}
                onChange={(e) => setNewBrandName(e.target.value)}
                placeholder="Brand name"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  setShowCreateForm(false)
                  setNewBrandName("")
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="small"
                isLoading={saving}
                disabled={!newBrandName.trim()}
                onClick={handleCreateBrand}
              >
                Create
              </Button>
            </div>
          </div>
        </Container>
      )}

      {/* Brands Table */}
      <Container className="p-0">
        {loading ? (
          <div className="p-4">
            <Text size="small" className="text-ui-fg-subtle">
              Loading...
            </Text>
          </div>
        ) : brands.length === 0 ? (
          <div className="p-8 text-center">
            <Text className="text-ui-fg-subtle">
              No brands yet. Create your first brand to get started.
            </Text>
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Name</Table.HeaderCell>
                <Table.HeaderCell>Handle</Table.HeaderCell>
                <Table.HeaderCell>Description</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {brands.map((brand) => (
                <Table.Row
                  key={brand.id}
                  className="cursor-pointer hover:bg-ui-bg-subtle"
                  onClick={() => navigate(`/brands/${brand.id}`)}
                >
                  <Table.Cell>
                    <div className="flex items-center gap-3">
                      {brand.logo_url && (
                        <img
                          src={brand.logo_url}
                          alt={brand.name}
                          className="h-8 w-8 object-contain"
                        />
                      )}
                      <Text weight="plus">{brand.name}</Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle">{brand.handle}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text className="text-ui-fg-subtle line-clamp-1">
                      {brand.description || "-"}
                    </Text>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton
                        variant="transparent"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/brands/${brand.id}`)
                        }}
                      >
                        <PencilSquare />
                      </IconButton>
                      <IconButton
                        variant="transparent"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteBrand(brand.id, brand.name)
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
  label: "Brands",
  nested: "/products",
})

export default BrandsListPage
