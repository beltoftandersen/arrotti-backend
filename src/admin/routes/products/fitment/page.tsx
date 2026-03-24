import { useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Button, Checkbox, Heading, IconButton, Input, Select, Tabs, Text } from "@medusajs/ui"
import { Trash } from "@medusajs/icons"

const FitmentAdminPage = () => {
  const [makes, setMakes] = useState<any[]>([])
  const [models, setModels] = useState<any[]>([])

  const [selectedMake, setSelectedMake] = useState("")
  const [newMakeName, setNewMakeName] = useState("")
  const [newModelName, setNewModelName] = useState("")

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Selection state for bulk delete
  const [selectedMakeIds, setSelectedMakeIds] = useState<Set<string>>(new Set())
  const [selectedModelIds, setSelectedModelIds] = useState<Set<string>>(new Set())

  const selectedMakeName = useMemo(() => {
    return makes.find((make) => make.id === selectedMake)?.name
  }, [makes, selectedMake])

  const loadMakes = async () => {
    const response = await fetch("/admin/fitment/makes", {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to load makes")
    }

    const data = await response.json()
    setMakes(data.makes ?? [])
  }

  const loadModels = async (makeId: string) => {
    if (!makeId) {
      setModels([])
      return
    }

    const response = await fetch(`/admin/fitment/models?make=${makeId}`, {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to load models")
    }

    const data = await response.json()
    setModels(data.models ?? [])
  }

  useEffect(() => {
    let mounted = true

    const loadAll = async () => {
      setLoading(true)
      setError(null)

      try {
        await loadMakes()
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Failed to load fitment data")
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
  }, [])

  useEffect(() => {
    loadModels(selectedMake).catch((err: any) => {
      setError(err.message || "Failed to load models")
    })
  }, [selectedMake])

  const handleCreateMake = async () => {
    if (!newMakeName) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch("/admin/fitment/makes", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newMakeName }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to create make")
      }

      const data = await response.json()
      setNewMakeName("")
      await loadMakes()
      setSelectedMake(data.make?.id ?? "")
    } catch (err: any) {
      setError(err.message || "Failed to create make")
    } finally {
      setSaving(false)
    }
  }

  const handleCreateModel = async () => {
    if (!newModelName || !selectedMake) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch("/admin/fitment/models", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newModelName, make_id: selectedMake }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to create model")
      }

      await response.json()
      setNewModelName("")
      await loadModels(selectedMake)
    } catch (err: any) {
      setError(err.message || "Failed to create model")
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteMake = async (makeId: string, makeName: string) => {
    if (!confirm(`Delete make "${makeName}"? This cannot be undone.`)) {
      return
    }

    setDeleting(makeId)
    setError(null)

    try {
      const response = await fetch(`/admin/fitment/makes/${makeId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to delete make")
      }

      await loadMakes()
      if (selectedMake === makeId) {
        setSelectedMake("")
        setModels([])
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete make")
    } finally {
      setDeleting(null)
    }
  }

  const handleDeleteModel = async (modelId: string, modelName: string) => {
    if (!confirm(`Delete model "${modelName}"? This cannot be undone.`)) {
      return
    }

    setDeleting(modelId)
    setError(null)

    try {
      const response = await fetch(`/admin/fitment/models/${modelId}`, {
        method: "DELETE",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to delete model")
      }

      await loadModels(selectedMake)
    } catch (err: any) {
      setError(err.message || "Failed to delete model")
    } finally {
      setDeleting(null)
    }
  }

  const toggleMakeSelection = (makeId: string) => {
    setSelectedMakeIds((prev) => {
      const next = new Set(prev)
      if (next.has(makeId)) {
        next.delete(makeId)
      } else {
        next.add(makeId)
      }
      return next
    })
  }

  const toggleAllMakes = () => {
    if (selectedMakeIds.size === makes.length) {
      setSelectedMakeIds(new Set())
    } else {
      setSelectedMakeIds(new Set(makes.map((m) => m.id)))
    }
  }

  const toggleModelSelection = (modelId: string) => {
    setSelectedModelIds((prev) => {
      const next = new Set(prev)
      if (next.has(modelId)) {
        next.delete(modelId)
      } else {
        next.add(modelId)
      }
      return next
    })
  }

  const toggleAllModels = () => {
    if (selectedModelIds.size === models.length) {
      setSelectedModelIds(new Set())
    } else {
      setSelectedModelIds(new Set(models.map((m) => m.id)))
    }
  }

  const handleBulkDeleteMakes = async () => {
    if (selectedMakeIds.size === 0) return

    const count = selectedMakeIds.size
    if (!confirm(`Delete ${count} selected make(s)? This cannot be undone.`)) {
      return
    }

    setBulkDeleting(true)
    setError(null)

    const errors: string[] = []
    for (const makeId of selectedMakeIds) {
      try {
        const response = await fetch(`/admin/fitment/makes/${makeId}`, {
          method: "DELETE",
          credentials: "include",
        })

        if (!response.ok) {
          const data = await response.json()
          const make = makes.find((m) => m.id === makeId)
          errors.push(`${make?.name ?? makeId}: ${data.message}`)
        }
      } catch (err: any) {
        const make = makes.find((m) => m.id === makeId)
        errors.push(`${make?.name ?? makeId}: ${err.message}`)
      }
    }

    if (errors.length > 0) {
      setError(`Some makes could not be deleted:\n${errors.join("\n")}`)
    }

    setSelectedMakeIds(new Set())
    await loadMakes()
    if (selectedMakeIds.has(selectedMake)) {
      setSelectedMake("")
      setModels([])
    }
    setBulkDeleting(false)
  }

  const handleBulkDeleteModels = async () => {
    if (selectedModelIds.size === 0) return

    const count = selectedModelIds.size
    if (!confirm(`Delete ${count} selected model(s)? This cannot be undone.`)) {
      return
    }

    setBulkDeleting(true)
    setError(null)

    const errors: string[] = []
    for (const modelId of selectedModelIds) {
      try {
        const response = await fetch(`/admin/fitment/models/${modelId}`, {
          method: "DELETE",
          credentials: "include",
        })

        if (!response.ok) {
          const data = await response.json()
          const model = models.find((m) => m.id === modelId)
          errors.push(`${model?.name ?? modelId}: ${data.message}`)
        }
      } catch (err: any) {
        const model = models.find((m) => m.id === modelId)
        errors.push(`${model?.name ?? modelId}: ${err.message}`)
      }
    }

    if (errors.length > 0) {
      setError(`Some models could not be deleted:\n${errors.join("\n")}`)
    }

    setSelectedModelIds(new Set())
    await loadModels(selectedMake)
    setBulkDeleting(false)
  }

  return (
    <div className="flex flex-col gap-y-6">
      <div>
        <Heading level="h1">Fitment</Heading>
        <Text className="text-ui-fg-subtle" size="small">
          Manage fitment reference data used across products.
        </Text>
      </div>

      {error && <Text className="text-ui-fg-error">{error}</Text>}

      <Tabs defaultValue="makes">
        <Tabs.List>
          <Tabs.Trigger value="makes">
            Makes {!loading && `(${makes.length})`}
          </Tabs.Trigger>
          <Tabs.Trigger value="models">
            Models {selectedMakeName && `- ${selectedMakeName}`}
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="makes" className="pt-4">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2 items-center">
              <Input
                className="max-w-xs"
                value={newMakeName}
                onChange={(event) => setNewMakeName(event.target.value)}
                placeholder="New make name"
              />
              <Button
                type="button"
                variant="secondary"
                isLoading={saving}
                disabled={!newMakeName}
                onClick={handleCreateMake}
              >
                Add Make
              </Button>
              {selectedMakeIds.size > 0 && (
                <Button
                  type="button"
                  variant="danger"
                  isLoading={bulkDeleting}
                  onClick={handleBulkDeleteMakes}
                >
                  Delete Selected ({selectedMakeIds.size})
                </Button>
              )}
            </div>

            {loading ? (
              <Text size="small" className="text-ui-fg-subtle">Loading...</Text>
            ) : makes.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">No makes yet.</Text>
            ) : (
              <div className="rounded-md border border-ui-border-base">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                      <th className="px-4 py-2 w-10">
                        <Checkbox
                          checked={selectedMakeIds.size === makes.length && makes.length > 0}
                          onCheckedChange={toggleAllMakes}
                        />
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-ui-fg-subtle">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-ui-fg-subtle">ID</th>
                      <th className="px-4 py-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {makes.map((make) => (
                      <tr key={make.id} className="border-b border-ui-border-base last:border-0">
                        <td className="px-4 py-2">
                          <Checkbox
                            checked={selectedMakeIds.has(make.id)}
                            onCheckedChange={() => toggleMakeSelection(make.id)}
                          />
                        </td>
                        <td className="px-4 py-2">{make.name}</td>
                        <td className="px-4 py-2 text-ui-fg-subtle font-mono text-xs">{make.id}</td>
                        <td className="px-4 py-2">
                          <IconButton
                            variant="transparent"
                            size="small"
                            disabled={deleting === make.id}
                            onClick={() => handleDeleteMake(make.id, make.name)}
                          >
                            <Trash className="text-ui-fg-subtle" />
                          </IconButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Tabs.Content>

        <Tabs.Content value="models" className="pt-4">
          <div className="flex flex-col gap-4">
            <div className="flex gap-2 items-end flex-wrap">
              <div className="flex flex-col gap-1">
                <Text size="small" className="text-ui-fg-subtle">Select Make</Text>
                <Select value={selectedMake} onValueChange={(val) => { setSelectedMake(val); setSelectedModelIds(new Set()) }}>
                  <Select.Trigger className="min-w-[200px]">
                    <Select.Value placeholder="Select make" />
                  </Select.Trigger>
                  <Select.Content>
                    {makes.map((make) => (
                      <Select.Item key={make.id} value={make.id}>
                        {make.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <Input
                className="max-w-xs"
                value={newModelName}
                onChange={(event) => setNewModelName(event.target.value)}
                placeholder={selectedMake ? "New model name" : "Select a make first"}
                disabled={!selectedMake}
              />
              <Button
                type="button"
                variant="secondary"
                isLoading={saving}
                disabled={!newModelName || !selectedMake}
                onClick={handleCreateModel}
              >
                Add Model
              </Button>
              {selectedModelIds.size > 0 && (
                <Button
                  type="button"
                  variant="danger"
                  isLoading={bulkDeleting}
                  onClick={handleBulkDeleteModels}
                >
                  Delete Selected ({selectedModelIds.size})
                </Button>
              )}
            </div>

            {!selectedMake ? (
              <Text size="small" className="text-ui-fg-subtle">Select a make to view its models.</Text>
            ) : models.length === 0 ? (
              <Text size="small" className="text-ui-fg-subtle">No models for {selectedMakeName}.</Text>
            ) : (
              <div className="rounded-md border border-ui-border-base">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ui-border-base bg-ui-bg-subtle">
                      <th className="px-4 py-2 w-10">
                        <Checkbox
                          checked={selectedModelIds.size === models.length && models.length > 0}
                          onCheckedChange={toggleAllModels}
                        />
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-ui-fg-subtle">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-ui-fg-subtle">ID</th>
                      <th className="px-4 py-2 w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr key={model.id} className="border-b border-ui-border-base last:border-0">
                        <td className="px-4 py-2">
                          <Checkbox
                            checked={selectedModelIds.has(model.id)}
                            onCheckedChange={() => toggleModelSelection(model.id)}
                          />
                        </td>
                        <td className="px-4 py-2">{model.name}</td>
                        <td className="px-4 py-2 text-ui-fg-subtle font-mono text-xs">{model.id}</td>
                        <td className="px-4 py-2">
                          <IconButton
                            variant="transparent"
                            size="small"
                            disabled={deleting === model.id}
                            onClick={() => handleDeleteModel(model.id, model.name)}
                          >
                            <Trash className="text-ui-fg-subtle" />
                          </IconButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Tabs.Content>

      </Tabs>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "Fitment",
  nested: "/products",
})

export default FitmentAdminPage
