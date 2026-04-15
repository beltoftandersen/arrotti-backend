/**
 * QuickBooks Online Item upsert
 *
 * Per-variant Inventory items identified by Name (= Medusa variant SKU).
 * Update semantics per Intuit docs:
 *   https://developer.intuit.com/app/developer/qbo/docs/api/accounting/most-commonly-used/item
 *
 * Name is the unique key across Items but QBO does not auto-upsert on Name —
 * we must query first to obtain Id + SyncToken, then sparse-update. If the
 * Name is not found we create a new Inventory item on the configured
 * income / COGS / inventory-asset accounts.
 */

import { QboClient } from "./qbo-client"
import { QboHttpError } from "./qbo-retry"

type AccountRef = { value: string; name: string }

export type ItemAccountRefs = {
  income: AccountRef
  cogs: AccountRef
  asset: AccountRef
}

type QboItem = {
  Id: string
  Name: string
  Sku?: string
  Type: string
  SyncToken: string
  UnitPrice?: number
  Description?: string
  Active?: boolean
  IncomeAccountRef?: AccountRef
  ExpenseAccountRef?: AccountRef
  AssetAccountRef?: AccountRef
}

type QboItemResponse = { Item: QboItem }

const MAX_DESCRIPTION_LEN = 4000
const MAX_NAME_LEN = 100

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return value
  return value.length > max ? value.slice(0, max) : value
}

function escapeQboQueryValue(value: string): string {
  return value.replace(/'/g, "\\'")
}

async function findItemByExactName(
  client: QboClient,
  name: string
): Promise<QboItem | null> {
  const query = `SELECT * FROM Item WHERE Name = '${escapeQboQueryValue(name)}'`
  const response = await client.query<{
    QueryResponse: { Item?: QboItem[] }
  }>(query)
  return response.QueryResponse?.Item?.[0] || null
}

export type UpsertInventoryItemInput = {
  /** Item Name in QBO — the variant SKU. Must be unique in the tenant. */
  name: string
  /** Item Sku field in QBO — typically same as name. */
  sku: string
  description?: string
  unitPrice?: number
  /** YYYY-MM-DD, must be <= any transaction that references the item. */
  invStartDate: string
  accounts: ItemAccountRefs
}

/**
 * Upsert an Inventory item keyed on Name. If it exists, sparse-update price +
 * description. Never changes Type. Returns an ItemRef suitable for invoice lines.
 *
 * Retries once on StaleObjectError (another process updated the same SyncToken
 * between our query and our update).
 */
export async function upsertInventoryItemByName(
  client: QboClient,
  input: UpsertInventoryItemInput
): Promise<AccountRef> {
  const name = truncate(input.name, MAX_NAME_LEN)!
  const sku = truncate(input.sku, MAX_NAME_LEN)
  const description = truncate(input.description, MAX_DESCRIPTION_LEN)

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await findItemByExactName(client, name)

    if (existing) {
      const updatePayload: Record<string, unknown> = {
        Id: existing.Id,
        SyncToken: existing.SyncToken,
        sparse: true,
        Name: name,
      }
      if (sku !== undefined) updatePayload.Sku = sku
      if (description !== undefined) updatePayload.Description = description
      if (input.unitPrice !== undefined) updatePayload.UnitPrice = input.unitPrice

      try {
        const response = await client.post<QboItemResponse>("item", updatePayload)
        return { value: response.Item.Id, name: response.Item.Name }
      } catch (err) {
        const isStale =
          err instanceof QboHttpError &&
          /stale|syncToken|5010/i.test(err.body || err.message)
        if (isStale && attempt === 0) {
          continue
        }
        throw err
      }
    }

    const createPayload: Record<string, unknown> = {
      Name: name,
      Sku: sku,
      Type: "Inventory",
      IncomeAccountRef: input.accounts.income,
      ExpenseAccountRef: input.accounts.cogs,
      AssetAccountRef: input.accounts.asset,
      TrackQtyOnHand: true,
      QtyOnHand: 0,
      InvStartDate: input.invStartDate,
      // COGS is intentionally zero — Medusa is the source of truth for inventory;
      // we let QBO QtyOnHand drift negative and every sale posts a $0 COGS journal.
      PurchaseCost: 0,
      Active: true,
    }
    if (description !== undefined) createPayload.Description = description
    if (input.unitPrice !== undefined) createPayload.UnitPrice = input.unitPrice

    try {
      const response = await client.post<QboItemResponse>("item", createPayload)
      return { value: response.Item.Id, name: response.Item.Name }
    } catch (err) {
      // Race: another process created the same Name between our query and our POST.
      // Retry the loop once — the next query-by-name finds it and we sparse-update.
      const isDupe =
        err instanceof QboHttpError &&
        /duplicate|already exists|6240/i.test(err.body || err.message)
      if (isDupe && attempt === 0) {
        continue
      }
      throw err
    }
  }

  throw new Error(`Failed to upsert QBO item "${name}" after 2 attempts`)
}

export type ResolveShippingItemInput = {
  /** QBO Item name for shipping, e.g. "Shipping". */
  name: string
  /** Income account the shipping line should route to. */
  shippingIncomeAccount: AccountRef
}

/**
 * Resolve (or create once) the dedicated shipping Item used for the shipping
 * line on every invoice. Stored as Type=Service since shipping is not stock.
 * If an item with this Name already exists we reuse it regardless of Type.
 */
export async function resolveShippingItem(
  client: QboClient,
  input: ResolveShippingItemInput
): Promise<AccountRef> {
  const existing = await findItemByExactName(client, input.name)
  if (existing) {
    return { value: existing.Id, name: existing.Name }
  }
  const createPayload: Record<string, unknown> = {
    Name: input.name,
    Type: "Service",
    IncomeAccountRef: input.shippingIncomeAccount,
    Active: true,
  }
  const response = await client.post<QboItemResponse>("item", createPayload)
  return { value: response.Item.Id, name: response.Item.Name }
}
