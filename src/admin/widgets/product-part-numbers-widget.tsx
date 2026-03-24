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
} from "@medusajs/ui"
import { ArrowUpRightOnBox } from "@medusajs/icons"

const ProductPartNumbersWidget = () => {
  const { id } = useParams()
  const productId = id as string | undefined

  const [partslinkNo, setPartslinkNo] = useState("")
  const [oemNumber, setOemNumber] = useState("")

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  // Form state for editing
  const [editPartslinkNo, setEditPartslinkNo] = useState("")
  const [editOemNumber, setEditOemNumber] = useState("")

  const loadProduct = async () => {
    if (!productId) return

    const response = await fetch(`/admin/products/${productId}`, {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to load product")
    }

    const data = await response.json()
    const metadata = data.product?.metadata ?? {}
    setPartslinkNo(metadata.partslink_no ?? "")
    setOemNumber(metadata.oem_number ?? "")
  }

  useEffect(() => {
    let mounted = true

    const load = async () => {
      if (!productId) return

      setLoading(true)
      setError(null)

      try {
        await loadProduct()
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

    load()

    return () => {
      mounted = false
    }
  }, [productId])

  const handleOpen = () => {
    setEditPartslinkNo(partslinkNo)
    setEditOemNumber(oemNumber)
    setError(null)
    setIsOpen(true)
  }

  const handleSave = async () => {
    if (!productId) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/admin/products/${productId}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          metadata: {
            partslink_no: editPartslinkNo.trim() || null,
            oem_number: editOemNumber.trim() || null,
          },
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to save part numbers")
      }

      setPartslinkNo(editPartslinkNo.trim())
      setOemNumber(editOemNumber.trim())
      setIsOpen(false)
    } catch (err: any) {
      setError(err.message || "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Part Numbers</Heading>
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
            <Drawer.Title>Part Numbers</Drawer.Title>
          </Drawer.Header>
          <Drawer.Body className="flex flex-col gap-y-4 p-4">
            {error && (
              <Text className="text-ui-fg-error">{error}</Text>
            )}

            <div>
              <Text size="small" weight="plus" className="mb-2">
                Partslink Number
              </Text>
              <Input
                value={editPartslinkNo}
                onChange={(e) => setEditPartslinkNo(e.target.value)}
                placeholder="e.g., GM1200629"
              />
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                Industry-standard part interchange number
              </Text>
            </div>

            <div>
              <Text size="small" weight="plus" className="mb-2">
                OEM Number
              </Text>
              <Input
                value={editOemNumber}
                onChange={(e) => setEditOemNumber(e.target.value)}
                placeholder="Original equipment manufacturer number"
              />
              <Text size="xsmall" className="text-ui-fg-subtle mt-1">
                Manufacturer's original part number
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

export default ProductPartNumbersWidget
