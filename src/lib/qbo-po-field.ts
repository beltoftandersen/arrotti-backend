import { QboClient } from "./qbo-client"

const cache = new Map<symbol, string | null>()
const CACHE_KEY = Symbol.for("qbo-po-field-definitionId")

/** Test-only: clear the in-process cache between tests. */
export function __clearPoFieldCacheForTests(): void {
  cache.clear()
}

const PO_FIELD_NAME_ALIASES = ["p.o. number", "po number", "purchase order number", "po"]

type PreferencesResponse = {
  QueryResponse?: {
    Preferences?: Array<{
      SalesFormsPrefs?: {
        CustomField?: Array<{
          CustomField?: Array<{
            Name?: string
            Type?: string
            BooleanValue?: boolean
            StringValue?: string
          }>
        }>
      }
    }>
  }
}

function normalizeName(name: string | undefined): string {
  return (name || "").trim().toLowerCase()
}

async function resolveFromPreferences(client: QboClient): Promise<string | null> {
  const response = await client.query<PreferencesResponse>("SELECT * FROM Preferences")
  const entries =
    response.QueryResponse?.Preferences?.[0]?.SalesFormsPrefs?.CustomField?.[0]?.CustomField ?? []

  // Map each SalesCustomNameN → N, and each UseSalesCustomN → boolean
  const slotNames = new Map<number, string>() // slot → label
  const slotEnabled = new Map<number, boolean>() // slot → enabled
  for (const entry of entries) {
    const name = entry.Name || ""
    const nameMatch = name.match(/^SalesFormsPrefs\.SalesCustomName(\d+)$/)
    if (nameMatch) {
      slotNames.set(Number(nameMatch[1]), entry.StringValue || "")
      continue
    }
    const useMatch = name.match(/^SalesFormsPrefs\.UseSalesCustom(\d+)$/)
    if (useMatch) {
      slotEnabled.set(Number(useMatch[1]), entry.BooleanValue === true)
    }
  }

  for (const [slot, label] of slotNames) {
    if (slotEnabled.get(slot) === false) continue
    if (PO_FIELD_NAME_ALIASES.includes(normalizeName(label))) {
      return String(slot)
    }
  }
  return null
}

export async function resolvePoCustomFieldDefinitionId(
  client: QboClient
): Promise<string | null> {
  if (cache.has(CACHE_KEY)) {
    return cache.get(CACHE_KEY) ?? null
  }
  const fromPrefs = await resolveFromPreferences(client)
  cache.set(CACHE_KEY, fromPrefs)
  return fromPrefs
}
