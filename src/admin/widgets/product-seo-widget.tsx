import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import {
  Button,
  Container,
  Drawer,
  Heading,
  Input,
  Text,
  Textarea,
} from "@medusajs/ui"
import { ArrowUpRightOnBox } from "@medusajs/icons"

type ProductMetadata = {
  seo_title?: string
  seo_description?: string
  seo_keywords?: string
}

const ProductSeoWidget = () => {
  const { id } = useParams()
  const productId = id as string | undefined

  const [metadata, setMetadata] = useState<ProductMetadata>({})
  const [seoTitle, setSeoTitle] = useState("")
  const [seoDescription, setSeoDescription] = useState("")
  const [seoKeywords, setSeoKeywords] = useState("")

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  const hasData = metadata.seo_title || metadata.seo_description || metadata.seo_keywords

  const loadSeo = async () => {
    if (!productId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/admin/products/${productId}/seo`, {
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
  }, [productId])

  const handleOpen = () => {
    setSeoTitle(metadata.seo_title || "")
    setSeoDescription(metadata.seo_description || "")
    setSeoKeywords(metadata.seo_keywords || "")
    setError(null)
    setIsOpen(true)
  }

  const handleSave = async () => {
    if (!productId) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/products/${productId}/seo`, {
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
      setIsOpen(false)
    } catch (err: any) {
      setError(err.message || "Failed to save SEO settings")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">SEO</Heading>
        <button
          type="button"
          onClick={handleOpen}
          className="flex items-center gap-x-1 text-ui-fg-muted hover:text-ui-fg-subtle"
        >
          <ArrowUpRightOnBox />
        </button>
      </div>

      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Content>
          <Drawer.Header>
            <Drawer.Title>SEO Settings</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 p-4">
            {error && (
              <Text className="text-ui-fg-error">{error}</Text>
            )}

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
                Overrides the product title in search results
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
                placeholder="brake pads, ceramic, premium, automotive"
              />
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                Comma-separated keywords for search optimization
              </Text>
            </div>
          </Drawer.Body>
          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Drawer.Close>
            <Button
              variant="primary"
              isLoading={saving}
              onClick={handleSave}
            >
              Save
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductSeoWidget
