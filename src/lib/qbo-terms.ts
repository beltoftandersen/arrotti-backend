/**
 * QuickBooks Online Terms Operations
 */

import { QboClient } from "./qbo-client"

export type QboTerm = {
  Id: string
  Name: string
  Active: boolean
  Type: "STANDARD" | "DATE_DRIVEN"
  DueDays?: number
  DiscountDays?: number
  DiscountPercent?: number
  SyncToken?: string
}

type QboQueryResponse = {
  QueryResponse: {
    Term?: QboTerm[]
    maxResults?: number
  }
}

// Standard payment term names in QuickBooks
export const PAYMENT_TERMS = {
  DUE_ON_RECEIPT: "Due on receipt",
  NET_15: "Net 15",
  NET_30: "Net 30",
  NET_45: "Net 45", // May need to be created
  NET_60: "Net 60",
  NET_90: "Net 90", // May need to be created
} as const

// Map days to term names
export const DAYS_TO_TERM_NAME: Record<number, string> = {
  0: "Due on receipt",
  15: "Net 15",
  30: "Net 30",
  45: "Net 45",
  60: "Net 60",
  90: "Net 90",
}

/**
 * Get all active terms from QuickBooks
 */
export async function getAllTerms(client: QboClient): Promise<QboTerm[]> {
  const query = `SELECT * FROM Term WHERE Active = true`

  const response = await client.query<QboQueryResponse>(query)

  return response.QueryResponse.Term || []
}

/**
 * Find a term by name
 */
export async function findTermByName(
  client: QboClient,
  name: string
): Promise<QboTerm | null> {
  const query = `SELECT * FROM Term WHERE Name = '${name.replace(/'/g, "\\'")}'`

  const response = await client.query<QboQueryResponse>(query)

  if (response.QueryResponse.Term && response.QueryResponse.Term.length > 0) {
    return response.QueryResponse.Term[0]
  }

  return null
}

/**
 * Find a term by due days (e.g., 30 for Net 30)
 */
export async function findTermByDays(
  client: QboClient,
  days: number
): Promise<QboTerm | null> {
  // First try to find by standard name
  const termName = DAYS_TO_TERM_NAME[days]
  if (termName) {
    const term = await findTermByName(client, termName)
    if (term) return term
  }

  // Fall back to searching by DueDays
  const query = `SELECT * FROM Term WHERE DueDays = '${days}' AND Active = true`

  const response = await client.query<QboQueryResponse>(query)

  if (response.QueryResponse.Term && response.QueryResponse.Term.length > 0) {
    return response.QueryResponse.Term[0]
  }

  return null
}

/**
 * Create a new term in QuickBooks
 */
export async function createTerm(
  client: QboClient,
  name: string,
  dueDays: number
): Promise<QboTerm> {
  const termData = {
    Name: name,
    Active: true,
    Type: "STANDARD",
    DueDays: dueDays,
  }

  const response = await client.post<{ Term: QboTerm }>("term", termData)
  console.log(`[QBO] Created term: ${response.Term.Name} (ID: ${response.Term.Id})`)
  return response.Term
}

/**
 * Find or create a term by days
 * Returns a reference object suitable for SalesTermRef
 */
export async function findOrCreateTermByDays(
  client: QboClient,
  days: number
): Promise<{ value: string; name: string } | null> {
  // Special case for 0 days
  if (days === 0) {
    const term = await findTermByName(client, "Due on receipt")
    if (term) {
      return { value: term.Id, name: term.Name }
    }
    // Create it if it doesn't exist
    const created = await createTerm(client, "Due on receipt", 0)
    return { value: created.Id, name: created.Name }
  }

  // Try to find existing term
  let term = await findTermByDays(client, days)

  if (!term) {
    // Create the term
    const name = `Net ${days}`
    term = await createTerm(client, name, days)
  }

  return { value: term.Id, name: term.Name }
}
