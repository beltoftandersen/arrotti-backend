/* @refresh skip */
import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router-dom"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import {
  Badge,
  Button,
  Container,
  Heading,
  IconButton,
  Input,
  Select,
  Text,
} from "@medusajs/ui"
import { ChevronDown, PencilSquare, Plus, Trash } from "@medusajs/icons"

type Vehicle = {
  id: string
  year_start: number
  year_end: number
  make_id: string
  model_id: string
  make_name?: string
  model_name?: string
}

type Fitment = {
  id: string
  submodels: string[]
  conditions: string
  notes: string | null
  vehicle: Vehicle | null
}

type VehicleMake = {
  id: string
  name: string
}

type VehicleModel = {
  id: string
  name: string
  make_id: string
}

const FitmentWidget = () => {
  const { id } = useParams()
  const productId = id as string | undefined

  const [fitments, setFitments] = useState<Fitment[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])

  const [selectedMake, setSelectedMake] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [yearStart, setYearStart] = useState("")
  const [yearEnd, setYearEnd] = useState("")
  const [submodelsInput, setSubmodelsInput] = useState("")
  const [conditionsInput, setConditionsInput] = useState("")
  const [notes, setNotes] = useState("")

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingFitmentId, setEditingFitmentId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const canAddFitment =
    productId && selectedMake && selectedModel && Number(yearStart) && Number(yearEnd) && Number(yearStart) <= Number(yearEnd)

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

  const loadFitments = async () => {
    if (!productId) {
      return
    }

    const response = await fetch(`/admin/products/${productId}/fitments`, {
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("Failed to load fitments")
    }

    const data = await response.json()
    setFitments(data.fitments ?? [])
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
      if (!productId) {
        return
      }

      setLoading(true)
      setError(null)

      try {
        await Promise.all([loadMakes(), loadFitments()])
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
  }, [productId])

  useEffect(() => {
    if (!selectedMake) {
      setModels([])
      setSelectedModel("")
      return
    }

    loadModels(selectedMake).catch((err: any) => {
      setError(err.message || "Failed to load models")
    })
  }, [selectedMake])

  const handleAddFitment = async () => {
    if (!productId || !canAddFitment) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Parse comma-separated submodels and conditions
      const submodels = submodelsInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s)
      const conditions = conditionsInput.trim() || null

      const response = await fetch(`/admin/products/${productId}/fitments`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          make_id: selectedMake,
          model_id: selectedModel,
          year_start: Number(yearStart),
          year_end: Number(yearEnd),
          submodels,
          conditions,
          notes: notes || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to add fitment")
      }

      resetForm()
      setShowAddForm(false)
      await loadFitments()
    } catch (err: any) {
      setError(err.message || "Failed to add fitment")
    } finally {
      setSaving(false)
    }
  }

  const handleRemoveFitment = async (fitmentId: string) => {
    if (!productId) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(
        `/admin/products/${productId}/fitments/${fitmentId}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to remove fitment")
      }

      await loadFitments()
    } catch (err: any) {
      setError(err.message || "Failed to remove fitment")
    } finally {
      setSaving(false)
    }
  }

  const handleEditFitment = (fitment: Fitment) => {
    const vehicle = fitment.vehicle
    if (!vehicle) {
      return
    }

    setEditingFitmentId(fitment.id)
    setSubmodelsInput((fitment.submodels ?? []).join(", "))
    setConditionsInput(fitment.conditions ?? "")
    setNotes(fitment.notes ?? "")
    setYearStart(String(vehicle.year_start))
    setYearEnd(String(vehicle.year_end))
    setSelectedMake(vehicle.make_id ?? "")

    // Load models for this make, then set the model
    loadModels(vehicle.make_id).then(() => {
      setSelectedModel(vehicle.model_id ?? "")
    })

    setShowAddForm(true)
  }

  const resetForm = () => {
    setEditingFitmentId(null)
    setSelectedMake("")
    setSelectedModel("")
    setYearStart("")
    setYearEnd("")
    setSubmodelsInput("")
    setConditionsInput("")
    setNotes("")
  }

  const handleCancelEdit = () => {
    resetForm()
    setShowAddForm(false)
  }

  const handleUpdateFitment = async () => {
    if (!productId || !editingFitmentId || !canAddFitment) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Parse comma-separated submodels and conditions
      const submodels = submodelsInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s)
      const conditions = conditionsInput.trim() || null

      const response = await fetch(
        `/admin/products/${productId}/fitments/${editingFitmentId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            make_id: selectedMake,
            model_id: selectedModel,
            year_start: Number(yearStart),
            year_end: Number(yearEnd),
            submodels,
            conditions,
            notes: notes || null,
          }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || "Failed to update fitment")
      }

      resetForm()
      setShowAddForm(false)
      await loadFitments()
    } catch (err: any) {
      setError(err.message || "Failed to update fitment")
    } finally {
      setSaving(false)
    }
  }

  const selectedMakeName = useMemo(() => {
    return makes.find((make) => make.id === selectedMake)?.name
  }, [makes, selectedMake])

  const selectedModelName = useMemo(() => {
    return models.find((model) => model.id === selectedModel)?.name
  }, [models, selectedModel])

  // Group fitments by vehicle (make/model/year range)
  const groupedFitments = useMemo(() => {
    const groups = new Map<string, {
      key: string
      vehicle: Vehicle
      fitments: Fitment[]
    }>()

    for (const fitment of fitments) {
      const vehicle = fitment.vehicle
      if (!vehicle) continue

      const key = vehicle.id

      const existing = groups.get(key)
      if (existing) {
        existing.fitments.push(fitment)
      } else {
        groups.set(key, {
          key,
          vehicle,
          fitments: [fitment],
        })
      }
    }

    return Array.from(groups.values()).sort((a, b) => {
      const makeCompare = (a.vehicle.make_name ?? "").localeCompare(b.vehicle.make_name ?? "")
      if (makeCompare !== 0) return makeCompare
      const modelCompare = (a.vehicle.model_name ?? "").localeCompare(b.vehicle.model_name ?? "")
      if (modelCompare !== 0) return modelCompare
      return a.vehicle.year_start - b.vehicle.year_start
    })
  }, [fitments])

  const toggleGroupExpanded = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
  }

  const formatYearRange = (start: number, end: number) => {
    return start === end ? String(start) : `${start}-${end}`
  }

  return (
    <Container className="divide-y divide-ui-border-base p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4">
        <Heading level="h2">Fitment</Heading>
        {!showAddForm && (
          <Button
            type="button"
            variant="transparent"
            size="small"
            onClick={() => setShowAddForm(true)}
          >
            <Plus />
            Add
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
        ) : (
          <div className="flex flex-col gap-4">
            {/* Fitments List */}
            {groupedFitments.length > 0 ? (
              <div className="flex flex-col gap-2">
                {groupedFitments.map((group) => {
                  const isExpanded = expandedGroups.has(group.key)
                  const hasMultiple = group.fitments.length > 1

                  return (
                    <div
                      key={group.key}
                      className="rounded-md border border-ui-border-base"
                    >
                      {/* Group Header */}
                      <div className="flex items-center justify-between px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {hasMultiple && (
                            <button
                              type="button"
                              onClick={() => toggleGroupExpanded(group.key)}
                              className="flex items-center justify-center p-0.5 hover:bg-ui-bg-base-hover rounded"
                            >
                              <ChevronDown
                                className={`h-4 w-4 text-ui-fg-subtle transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              />
                            </button>
                          )}
                          <Text size="small" weight="plus">
                            {formatYearRange(group.vehicle.year_start, group.vehicle.year_end)}{" "}
                            {group.vehicle.make_name} {group.vehicle.model_name}
                          </Text>
                          {hasMultiple && (
                            <Badge size="2xsmall" color="blue">
                              {group.fitments.length} variants
                            </Badge>
                          )}
                          {/* Show first fitment's details if single */}
                          {!hasMultiple && group.fitments[0] && (
                            <>
                              {(group.fitments[0].submodels ?? []).length > 0 && (
                                <Badge size="2xsmall" color="grey">
                                  {group.fitments[0].submodels.join(", ")}
                                </Badge>
                              )}
                              {group.fitments[0].conditions && (
                                <Text size="xsmall" className="text-ui-fg-subtle">
                                  {group.fitments[0].conditions}
                                </Text>
                              )}
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {!hasMultiple && (
                            <IconButton
                              variant="transparent"
                              size="small"
                              type="button"
                              onClick={() => handleEditFitment(group.fitments[0])}
                              title="Edit"
                            >
                              <PencilSquare />
                            </IconButton>
                          )}
                          {!hasMultiple && (
                            <IconButton
                              variant="transparent"
                              size="small"
                              type="button"
                              onClick={() => handleRemoveFitment(group.fitments[0].id)}
                              isLoading={saving}
                              title="Remove"
                            >
                              <Trash />
                            </IconButton>
                          )}
                        </div>
                      </div>

                      {/* Expanded Individual Fitments */}
                      {isExpanded && hasMultiple && (
                        <div className="border-t border-ui-border-base bg-ui-bg-subtle">
                          {group.fitments.map((fitment) => (
                            <div
                              key={fitment.id}
                              className="flex items-center justify-between px-3 py-1.5 pl-9 border-b border-ui-border-base last:border-b-0"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                {(fitment.submodels ?? []).length > 0 && (
                                  <Badge size="2xsmall" color="grey">
                                    {fitment.submodels.join(", ")}
                                  </Badge>
                                )}
                                {fitment.conditions && (
                                  <Text size="xsmall" className="text-ui-fg-subtle">
                                    {fitment.conditions}
                                  </Text>
                                )}
                                {(fitment.submodels ?? []).length === 0 && !fitment.conditions && (
                                  <Text size="xsmall" className="text-ui-fg-subtle">
                                    All submodels
                                  </Text>
                                )}
                                {fitment.notes && (
                                  <Text size="xsmall" className="text-ui-fg-muted">
                                    — {fitment.notes}
                                  </Text>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <IconButton
                                  variant="transparent"
                                  size="small"
                                  type="button"
                                  onClick={() => handleEditFitment(fitment)}
                                  title="Edit"
                                >
                                  <PencilSquare />
                                </IconButton>
                                <IconButton
                                  variant="transparent"
                                  size="small"
                                  type="button"
                                  onClick={() => handleRemoveFitment(fitment.id)}
                                  isLoading={saving}
                                  title="Remove"
                                >
                                  <Trash />
                                </IconButton>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : !showAddForm ? (
              <Text size="small" className="text-ui-fg-subtle">
                No fitments attached yet. Click "Add" to attach vehicles.
              </Text>
            ) : null}

            {/* Add/Edit Form */}
            {showAddForm && (
              <div className="border-t border-ui-border-base pt-4">
                <Text size="small" weight="plus" className="mb-4">
                  {editingFitmentId ? "Edit Fitment" : "Add Fitment"}
                </Text>
                <div className="grid grid-cols-1 gap-4">
                  {/* Vehicle Selection */}
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="flex flex-col gap-2">
                      <Text size="small">Make *</Text>
                      <Select value={selectedMake} onValueChange={setSelectedMake}>
                        <Select.Trigger>
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
                    <div className="flex flex-col gap-2">
                      <Text size="small">Model *</Text>
                      <Select value={selectedModel} onValueChange={setSelectedModel}>
                        <Select.Trigger>
                          <Select.Value placeholder="Select model" />
                        </Select.Trigger>
                        <Select.Content>
                          {models.map((model) => (
                            <Select.Item key={model.id} value={model.id}>
                              {model.name}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Text size="small">Year Start *</Text>
                      <Select value={yearStart} onValueChange={setYearStart}>
                        <Select.Trigger>
                          <Select.Value placeholder="From" />
                        </Select.Trigger>
                        <Select.Content className="max-h-60">
                          {Array.from({ length: 2027 - 1930 + 1 }, (_, i) => 2027 - i).map((year) => (
                            <Select.Item key={year} value={String(year)}>
                              {year}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Text size="small">Year End *</Text>
                      <Select value={yearEnd} onValueChange={setYearEnd}>
                        <Select.Trigger>
                          <Select.Value placeholder="To" />
                        </Select.Trigger>
                        <Select.Content className="max-h-60">
                          {Array.from({ length: 2027 - 1930 + 1 }, (_, i) => 2027 - i).map((year) => (
                            <Select.Item key={year} value={String(year)}>
                              {year}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </div>
                  </div>

                  {/* Submodels */}
                  <div className="flex flex-col gap-2">
                    <Text size="small">Submodels</Text>
                    <Input
                      value={submodelsInput}
                      onChange={(event) => setSubmodelsInput(event.target.value)}
                      placeholder="LE, XLE, XSE, HYBRID XLE (comma-separated)"
                    />
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Leave empty if part fits all submodels
                    </Text>
                  </div>

                  {/* Attributes */}
                  <div className="flex flex-col gap-2">
                    <Text size="small">Attributes</Text>
                    <Input
                      value={conditionsInput}
                      onChange={(event) => setConditionsInput(event.target.value)}
                      placeholder="4dr sedan; prime; w/o Fog Lights"
                    />
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Fitment attributes / variables
                    </Text>
                  </div>

                  {/* Notes */}
                  <div className="flex flex-col gap-2">
                    <Text size="small">Notes</Text>
                    <Input
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Internal notes about this fitment"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="small"
                      isLoading={saving}
                      disabled={!canAddFitment}
                      onClick={async () => {
                        if (editingFitmentId) {
                          await handleUpdateFitment()
                        } else {
                          await handleAddFitment()
                        }
                      }}
                    >
                      {editingFitmentId ? "Update" : "Save"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default FitmentWidget
