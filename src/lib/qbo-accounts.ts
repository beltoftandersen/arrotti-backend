/**
 * QuickBooks Online Account and Item lookups
 * Used for mapping sales to specific income accounts and deposit accounts
 */

import { QboClient } from "./qbo-client"

type QboItem = {
  Id: string
  Name: string
  Sku?: string
  Type: string
  IncomeAccountRef?: { value: string; name: string }
}

type QboAccount = {
  Id: string
  Name: string
  AccountType: string
  AccountSubType?: string
}

type QboQueryResponse<T> = {
  QueryResponse: {
    Item?: T[]
    Account?: T[]
    maxResults?: number
  }
}

// Cache for QBO lookups (cleared on server restart)
const itemCache = new Map<string, { value: string; name: string } | null>()
const accountCache = new Map<string, { value: string; name: string } | null>()

/**
 * Find a QBO Item (product/service) by name
 * Used to assign income account for invoice line items
 */
export async function findItemByName(
  client: QboClient,
  name: string
): Promise<{ value: string; name: string } | null> {
  const cacheKey = `name:${name}`
  if (itemCache.has(cacheKey)) {
    return itemCache.get(cacheKey) || null
  }

  try {
    const query = `SELECT * FROM Item WHERE Name = '${name.replace(/'/g, "\\'")}'`
    const response = await client.query<QboQueryResponse<QboItem>>(query)

    if (response.QueryResponse.Item && response.QueryResponse.Item.length > 0) {
      const item = response.QueryResponse.Item[0]
      const result = { value: item.Id, name: item.Name }
      itemCache.set(cacheKey, result)
      console.log(`[QBO] Found item "${name}" (ID: ${item.Id})`)
      return result
    }
  } catch (error) {
    console.warn(`[QBO] Error finding item by name "${name}": ${(error as Error).message}`)
  }

  itemCache.set(cacheKey, null)
  return null
}

/**
 * Find a QBO Item by SKU
 */
export async function findItemBySku(
  client: QboClient,
  sku: string
): Promise<{ value: string; name: string } | null> {
  const cacheKey = `sku:${sku}`
  if (itemCache.has(cacheKey)) {
    return itemCache.get(cacheKey) || null
  }

  try {
    // QBO doesn't support direct SKU query, so we search by name containing the SKU
    // or get all items and filter - for now, let's try a broader search
    const query = `SELECT * FROM Item WHERE Sku = '${sku.replace(/'/g, "\\'")}'`
    const response = await client.query<QboQueryResponse<QboItem>>(query)

    if (response.QueryResponse.Item && response.QueryResponse.Item.length > 0) {
      const item = response.QueryResponse.Item[0]
      const result = { value: item.Id, name: item.Name }
      itemCache.set(cacheKey, result)
      console.log(`[QBO] Found item by SKU "${sku}" (ID: ${item.Id})`)
      return result
    }
  } catch (error) {
    console.warn(`[QBO] Error finding item by SKU "${sku}": ${(error as Error).message}`)
  }

  itemCache.set(cacheKey, null)
  return null
}

/**
 * Find a QBO Account by name (e.g., "Checking", "Undeposited Funds")
 * Used for deposit-to account on payments
 */
export async function findAccountByName(
  client: QboClient,
  name: string
): Promise<{ value: string; name: string } | null> {
  const cacheKey = `name:${name}`
  if (accountCache.has(cacheKey)) {
    return accountCache.get(cacheKey) || null
  }

  try {
    const query = `SELECT * FROM Account WHERE Name = '${name.replace(/'/g, "\\'")}'`
    const response = await client.query<QboQueryResponse<QboAccount>>(query)

    if (response.QueryResponse.Account && response.QueryResponse.Account.length > 0) {
      const account = response.QueryResponse.Account[0]
      const result = { value: account.Id, name: account.Name }
      accountCache.set(cacheKey, result)
      console.log(`[QBO] Found account "${name}" (ID: ${account.Id})`)
      return result
    }
  } catch (error) {
    console.warn(`[QBO] Error finding account by name "${name}": ${(error as Error).message}`)
  }

  accountCache.set(cacheKey, null)
  return null
}

/**
 * Find a bank/checking account for deposits
 * Searches for common bank account types
 */
export async function findBankAccount(
  client: QboClient,
  preferredName?: string
): Promise<{ value: string; name: string } | null> {
  // Try preferred name first
  if (preferredName) {
    const account = await findAccountByName(client, preferredName)
    if (account) return account
  }

  // Try common bank account names
  const commonNames = ["Checking", "Business Checking", "Bank Account"]
  for (const name of commonNames) {
    const account = await findAccountByName(client, name)
    if (account) return account
  }

  return null
}

/**
 * Clear the lookup caches (useful for testing or manual refresh)
 */
export function clearQboLookupCaches(): void {
  itemCache.clear()
  accountCache.clear()
  console.log("[QBO] Cleared item and account caches")
}
