import { useEffect, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Switch, Text } from "@medusajs/ui"

const ProductQuoteWidget = () => {
  const { id } = useParams()
  const productId = id as string | undefined

  const [isQuoteOnly, setIsQuoteOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSettings = async () => {
    if (!productId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/admin/products/${productId}/quote-settings`,
        { credentials: "include" }
      )

      if (!response.ok) {
        throw new Error("Failed to load quote settings")
      }

      const data = await response.json()
      setIsQuoteOnly(!!data.is_quote_only)
    } catch (err: any) {
      setError(err.message || "Failed to load quote settings")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [productId])

  const handleToggle = async (checked: boolean) => {
    if (!productId) return

    setIsQuoteOnly(checked)
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(
        `/admin/products/${productId}/quote-settings`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_quote_only: checked }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to save quote settings")
      }

      const data = await response.json()
      setIsQuoteOnly(!!data.is_quote_only)
    } catch (err: any) {
      // Revert on error
      setIsQuoteOnly(!checked)
      setError(err.message || "Failed to save quote settings")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Quote Only</Heading>
          <Text size="small" className="text-ui-fg-subtle mt-1">
            {isQuoteOnly
              ? "Customers must request a quote to purchase"
              : "Product is available at listed price"}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          {saving && (
            <Text size="small" className="text-ui-fg-muted">
              Saving...
            </Text>
          )}
          {error && (
            <Text size="small" className="text-ui-fg-error">
              {error}
            </Text>
          )}
          {!loading && (
            <Switch
              checked={isQuoteOnly}
              onCheckedChange={handleToggle}
              disabled={saving}
            />
          )}
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductQuoteWidget
