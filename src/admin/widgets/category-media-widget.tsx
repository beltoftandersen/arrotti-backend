import { useEffect, useState, useRef } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { PencilSquare, Photo, Trash, ArrowUpTray } from "@medusajs/icons"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

const CategoryMediaWidget = () => {
  const { id } = useParams()
  const categoryId = id as string | undefined
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const loadImages = async () => {
    if (!categoryId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/admin/categories/${categoryId}/images`, {
        credentials: "include",
      })

      if (!response.ok) {
        throw new Error("Failed to load image data")
      }

      const data = await response.json()
      setThumbnailUrl(data.images?.thumbnail || null)
    } catch (err: any) {
      setError(err.message || "Failed to load image data")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadImages()
  }, [categoryId])

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const validateFile = (file: File): string | null => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Invalid file type. Please use JPEG, PNG, WebP, or GIF."
    }
    if (file.size > MAX_SIZE) {
      return "File too large. Maximum size is 5MB."
    }
    return null
  }

  const handleFileSelect = (file: File) => {
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setSelectedFile(file)

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(URL.createObjectURL(file))
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  const handleSave = async () => {
    if (!categoryId || !selectedFile) return

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      // Upload file to S3 via Medusa's built-in upload endpoint
      const formData = new FormData()
      formData.append("files", selectedFile)

      const uploadResponse = await fetch("/admin/uploads", {
        method: "POST",
        credentials: "include",
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload image")
      }

      const uploadData = await uploadResponse.json()
      const uploadedUrl = uploadData.files?.[0]?.url

      if (!uploadedUrl) {
        throw new Error("No URL returned from upload")
      }

      // Save the URL to category metadata
      const response = await fetch(`/admin/categories/${categoryId}/images`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thumbnail: uploadedUrl,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to save image")
      }

      const data = await response.json()
      setThumbnailUrl(data.images?.thumbnail || null)
      setSelectedFile(null)
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
      }
      setSuccess(true)
      setIsEditing(false)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to save image")
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    if (!categoryId) return

    setSaving(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch(`/admin/categories/${categoryId}/images`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thumbnail: null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to remove image")
      }

      setThumbnailUrl(null)
      setSelectedFile(null)
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
      }
      setSuccess(true)
      setIsEditing(false)
      setTimeout(() => setSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message || "Failed to remove image")
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setSelectedFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
    setIsEditing(false)
    setError(null)
  }

  const handleEdit = () => {
    setIsEditing(true)
    setError(null)
    setSuccess(false)
  }

  const displayUrl = previewUrl || thumbnailUrl

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Media</Heading>
        {thumbnailUrl && !isEditing && (
          <Button
            type="button"
            variant="transparent"
            size="small"
            onClick={handleEdit}
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
          <Text className="text-ui-fg-success mb-4">Image saved!</Text>
        )}

        {loading ? (
          <Text size="small" className="text-ui-fg-subtle">
            Loading...
          </Text>
        ) : thumbnailUrl && !isEditing ? (
          /* View mode with image */
          <div className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-lg border border-ui-border-base">
              <img
                src={thumbnailUrl}
                alt="Category thumbnail"
                className="w-full h-48 object-contain"
              />
            </div>
            <Text size="xsmall" className="text-ui-fg-subtle truncate">
              {thumbnailUrl}
            </Text>
          </div>
        ) : !isEditing && !thumbnailUrl ? (
          /* Empty state */
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-ui-border-base bg-ui-bg-subtle">
              <Photo className="text-ui-fg-subtle" />
            </div>
            <Text size="small" className="text-ui-fg-subtle">
              No image uploaded
            </Text>
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={handleEdit}
            >
              Add Image
            </Button>
          </div>
        ) : (
          /* Edit mode */
          <div className="flex flex-col gap-4">
            {/* Drop zone */}
            <div
              className={`relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer ${
                isDragging
                  ? "border-ui-fg-interactive bg-ui-bg-interactive"
                  : "border-ui-border-strong bg-ui-bg-subtle hover:bg-ui-bg-subtle-hover"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {displayUrl ? (
                <img
                  src={displayUrl}
                  alt="Preview"
                  className="w-full h-48 object-contain rounded"
                />
              ) : (
                <>
                  <ArrowUpTray className="text-ui-fg-subtle" />
                  <Text size="small" className="text-ui-fg-subtle text-center">
                    Drag and drop an image here, or click to browse
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    JPEG, PNG, WebP, GIF (max 5MB)
                  </Text>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleInputChange}
              />
            </div>

            {selectedFile && (
              <Text size="xsmall" className="text-ui-fg-subtle">
                Selected: {selectedFile.name}
              </Text>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between">
              <div>
                {thumbnailUrl && (
                  <Button
                    type="button"
                    variant="transparent"
                    size="small"
                    onClick={handleRemove}
                    disabled={saving}
                    className="text-ui-fg-error"
                  >
                    <Trash />
                    Remove
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="small"
                  isLoading={saving}
                  disabled={!selectedFile}
                  onClick={handleSave}
                >
                  Save
                </Button>
              </div>
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

export default CategoryMediaWidget
