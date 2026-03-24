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

type Brand = {
  id: string
  name: string
  handle: string
  logo_url: string | null
  description: string | null
}

type SeoData = {
  seo_title: string
  seo_description: string
  seo_keywords: string
}

const BrandDetailPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()

  // Brand data
  const [brand, setBrand] = useState<Brand | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit states
  const [isEditingDetails, setIsEditingDetails] = useState(false)
  const [isEditingSeo, setIsEditingSeo] = useState(false)
  const [saving, setSaving] = useState(false)

  // Detail form
  const [editName, setEditName] = useState("")
  const [editHandle, setEditHandle] = useState("")
  const [editLogoUrl, setEditLogoUrl] = useState("")
  const [editDescription, setEditDescription] = useState("")

  // SEO form
  const [seoData, setSeoData] = useState<SeoData>({
    seo_title: "",
    seo_description: "",
    seo_keywords: "",
  })
  const [editSeoTitle, setEditSeoTitle] = useState("")
  const [editSeoDescription, setEditSeoDescription] = useState("")
  const [editSeoKeywords, setEditSeoKeywords] = useState("")

  const loadBrand = async () => {
    if (!id) return

    try {
      const response = await fetch(`/admin/brands/${id}`, {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Brand not found")
      }

      const data = await response.json()
      setBrand(data.brand)
      setEditName(data.brand.name)
      setEditHandle(data.brand.handle || "")
      setEditLogoUrl(data.brand.logo_url || "")
      setEditDescription(data.brand.description || "")
    } catch (err: any) {
      setError(err.message || "Failed to load brand")
    }
  }

  const loadSeo = async () => {
    if (!id) return

    try {
      const response = await fetch(`/admin/brands/${id}/seo`, {
        credentials: "include",
      })

      if (response.ok) {
        const data = await response.json()
        const seo = {
          seo_title: data.seo?.seo_title || "",
          seo_description: data.seo?.seo_description || "",
          seo_keywords: data.seo?.seo_keywords || "",
        }
        setSeoData(seo)
        setEditSeoTitle(seo.seo_title)
        setEditSeoDescription(seo.seo_description)
        setEditSeoKeywords(seo.seo_keywords)
      }
    } catch (err) {
      // Ignore SEO load errors
    }
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await Promise.all([loadBrand(), loadSeo()])
      setLoading(false)
    }
    load()
  }, [id])

  const handleSaveDetails = async () => {
    if (!id || !editName.trim()) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/brands/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editName.trim(),
          logo_url: editLogoUrl.trim() || null,
          description: editDescription.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to update brand")
      }

      const data = await response.json()
      setBrand(data.brand)
      setIsEditingDetails(false)
    } catch (err: any) {
      setError(err.message || "Failed to update brand")
    } finally {
      setSaving(false)
    }
  }

  const handleCancelDetails = () => {
    if (brand) {
      setEditName(brand.name)
      setEditHandle(brand.handle || "")
      setEditLogoUrl(brand.logo_url || "")
      setEditDescription(brand.description || "")
    }
    setIsEditingDetails(false)
  }

  const handleSaveSeo = async () => {
    if (!id) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/brands/${id}/seo`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          seo_title: editSeoTitle.trim() || null,
          seo_description: editSeoDescription.trim() || null,
          seo_keywords: editSeoKeywords.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to update SEO")
      }

      const data = await response.json()
      const seo = {
        seo_title: data.seo?.seo_title || "",
        seo_description: data.seo?.seo_description || "",
        seo_keywords: data.seo?.seo_keywords || "",
      }
      setSeoData(seo)
      setIsEditingSeo(false)
    } catch (err: any) {
      setError(err.message || "Failed to update SEO")
    } finally {
      setSaving(false)
    }
  }

  const handleCancelSeo = () => {
    setEditSeoTitle(seoData.seo_title)
    setEditSeoDescription(seoData.seo_description)
    setEditSeoKeywords(seoData.seo_keywords)
    setIsEditingSeo(false)
  }

  const hasExistingSeoData =
    seoData.seo_title || seoData.seo_description || seoData.seo_keywords

  if (loading) {
    return (
      <div className="flex flex-col gap-y-4">
        <Text className="text-ui-fg-subtle">Loading...</Text>
      </div>
    )
  }

  if (!brand) {
    return (
      <div className="flex flex-col gap-y-4">
        <Text className="text-ui-fg-error">Brand not found</Text>
        <Button variant="secondary" onClick={() => navigate("/brands")}>
          <ArrowLeft />
          Back to Brands
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
          onClick={() => navigate("/brands")}
        >
          <ArrowLeft />
        </Button>
        <div>
          <Heading level="h1">{brand.name}</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            /{brand.handle}
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
          {!isEditingDetails && (
            <Button
              variant="transparent"
              size="small"
              onClick={() => setIsEditingDetails(true)}
            >
              <PencilSquare />
              Edit
            </Button>
          )}
        </div>
        <div className="px-6 py-4">
          {isEditingDetails ? (
            <div className="flex flex-col gap-4">
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  Name
                </Text>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Brand name"
                />
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  Handle
                </Text>
                <Input
                  value={editHandle}
                  disabled
                  className="bg-ui-bg-disabled"
                />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Handle is auto-generated and cannot be changed
                </Text>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  Logo URL
                </Text>
                <Input
                  value={editLogoUrl}
                  onChange={(e) => setEditLogoUrl(e.target.value)}
                  placeholder="https://example.com/logo.png"
                />
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  Description
                </Text>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Brand description"
                  rows={3}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="secondary"
                  size="small"
                  onClick={handleCancelDetails}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="small"
                  isLoading={saving}
                  disabled={!editName.trim()}
                  onClick={handleSaveDetails}
                >
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Name
                </Text>
                <Text>{brand.name}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Handle
                </Text>
                <Text>{brand.handle}</Text>
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Logo
                </Text>
                {brand.logo_url ? (
                  <img
                    src={brand.logo_url}
                    alt={brand.name}
                    className="h-12 w-auto"
                  />
                ) : (
                  <Text className="text-ui-fg-subtle">No logo</Text>
                )}
              </div>
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Description
                </Text>
                <Text>{brand.description || "-"}</Text>
              </div>
            </div>
          )}
        </div>
      </Container>

      {/* SEO Section */}
      <Container className="divide-y divide-ui-border-base p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">SEO</Heading>
          {hasExistingSeoData && !isEditingSeo && (
            <Button
              variant="transparent"
              size="small"
              onClick={() => setIsEditingSeo(true)}
            >
              <PencilSquare />
              Edit
            </Button>
          )}
        </div>
        <div className="px-6 py-4">
          {hasExistingSeoData && !isEditingSeo ? (
            <div className="flex flex-col gap-3">
              {seoData.seo_title && (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                    Title
                  </Text>
                  <Text size="small">{seoData.seo_title}</Text>
                </div>
              )}
              {seoData.seo_description && (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                    Description
                  </Text>
                  <Text size="small">{seoData.seo_description}</Text>
                </div>
              )}
              {seoData.seo_keywords && (
                <div>
                  <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                    Keywords
                  </Text>
                  <Text size="small">{seoData.seo_keywords}</Text>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  SEO Title
                </Text>
                <Input
                  value={editSeoTitle}
                  onChange={(e) => setEditSeoTitle(e.target.value)}
                  placeholder="Custom page title for search engines"
                />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Overrides the brand name in search results
                </Text>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  SEO Description
                </Text>
                <Textarea
                  value={editSeoDescription}
                  onChange={(e) => setEditSeoDescription(e.target.value)}
                  placeholder="Brief description for search engine results"
                  rows={3}
                />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Recommended: 150-160 characters
                </Text>
              </div>
              <div>
                <Text size="small" weight="plus" className="mb-2">
                  SEO Keywords
                </Text>
                <Input
                  value={editSeoKeywords}
                  onChange={(e) => setEditSeoKeywords(e.target.value)}
                  placeholder="auto parts, OEM, quality, automotive"
                />
                <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                  Comma-separated keywords for search optimization
                </Text>
              </div>
              <div className="flex items-center justify-end gap-2">
                {isEditingSeo && (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={handleCancelSeo}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="small"
                  isLoading={saving}
                  onClick={handleSaveSeo}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      </Container>
    </div>
  )
}

export default BrandDetailPage
