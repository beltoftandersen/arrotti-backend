import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Input, Text, Textarea } from "@medusajs/ui"
import { PencilSquare } from "@medusajs/icons"

type SeoMetadata = {
  seo_title?: string
  seo_description?: string
  seo_keywords?: string
}

const CollectionSeoWidget = () => {
  const { id } = useParams()
  const collectionId = id as string | undefined

  const [metadata, setMetadata] = useState<SeoMetadata>({})
  const [seoTitle, setSeoTitle] = useState("")
  const [seoDescription, setSeoDescription] = useState("")
  const [seoKeywords, setSeoKeywords] = useState("")

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isEditing, setIsEditing] = useState(false)

  const hasExistingSeoData = metadata.seo_title || metadata.seo_description || metadata.seo_keywords

  const loadSeo = async () => {
    if (!collectionId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/admin/collections/${collectionId}/seo`, {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to load SEO data")
      }

      const data = await response.json()
      const seo = data.seo || {}

      setMetadata({
        seo_title: seo.seo_title || "",
        seo_description: seo.seo_description || "",
        seo_keywords: seo.seo_keywords || "",
      })
      setSeoTitle(seo.seo_title || "")
      setSeoDescription(seo.seo_description || "")
      setSeoKeywords(seo.seo_keywords || "")
    } catch (err: any) {
      setError(err.message || "Failed to load SEO data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSeo()
  }, [collectionId])

  const handleSave = async () => {
    if (!collectionId) return

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/admin/collections/${collectionId}/seo`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          seo_title: seoTitle.trim() || null,
          seo_description: seoDescription.trim() || null,
          seo_keywords: seoKeywords.trim() || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to save SEO settings")
      }

      const data = await response.json()
      const seo = data.seo || {}

      setMetadata({
        seo_title: seo.seo_title || "",
        seo_description: seo.seo_description || "",
        seo_keywords: seo.seo_keywords || "",
      })
      setSuccess(true)
      setIsEditing(false)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save SEO settings")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setSeoTitle(metadata.seo_title || "")
    setSeoDescription(metadata.seo_description || "")
    setSeoKeywords(metadata.seo_keywords || "")
    setIsEditing(false)
    setError(null)
  }

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">SEO</Heading>
        {hasExistingSeoData && !isEditing && (
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
        {success && (
          <Text className="text-ui-fg-success mb-4">SEO settings saved!</Text>
        )}

        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading...
          </Text>
        ) : hasExistingSeoData && !isEditing ? (
          <div className="flex flex-col gap-3">
            {seoTitle && (
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Title
                </Text>
                <Text size="small">{seoTitle}</Text>
              </div>
            )}
            {seoDescription && (
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Description
                </Text>
                <Text size="small">{seoDescription}</Text>
              </div>
            )}
            {seoKeywords && (
              <div>
                <Text size="xsmall" className="text-ui-fg-subtle mb-1">
                  Keywords
                </Text>
                <Text size="small">{seoKeywords}</Text>
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
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder="Custom page title for search engines"
              />
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                Overrides the collection title in search results
              </Text>
            </div>

            <div>
              <Text size="small" weight="plus" className="mb-2">
                SEO Description
              </Text>
              <Textarea
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
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
                value={seoKeywords}
                onChange={(e) => setSeoKeywords(e.target.value)}
                placeholder="summer sale, clearance, featured products"
              />
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                Comma-separated keywords for search optimization
              </Text>
            </div>

            <div className="flex items-center justify-end gap-2">
              {isEditing && (
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
              )}
              <Button
                type="button"
                variant="primary"
                size="small"
                isLoading={saving}
                onClick={handleSave}
              >
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
  zone: "product_collection.details.after",
})

export default CollectionSeoWidget
