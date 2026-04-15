import { resolvePoCustomFieldDefinitionId, __clearPoFieldCacheForTests } from "../qbo-po-field"
import type { QboClient } from "../qbo-client"

type QueuedResponse = unknown | Error

class FakeQboClient {
  public queries: string[] = []
  constructor(private queryResponses: QueuedResponse[] = []) {}
  async query<T>(q: string): Promise<T> {
    this.queries.push(q)
    const next = this.queryResponses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  async post(): Promise<never> { throw new Error("post not used by qbo-po-field") }
  async get(): Promise<never> { throw new Error("get not used by qbo-po-field") }
}

const asClient = (fake: FakeQboClient) => fake as unknown as QboClient

beforeEach(() => __clearPoFieldCacheForTests())

describe("resolvePoCustomFieldDefinitionId", () => {
  it("returns null when Preferences has no CustomField entries and no recent invoices", async () => {
    const fake = new FakeQboClient([
      { QueryResponse: { Preferences: [{ SalesFormsPrefs: {} }] } },
      { QueryResponse: {} }, // Invoice fallback — empty
    ])
    const result = await resolvePoCustomFieldDefinitionId(asClient(fake))
    expect(result).toBeNull()
  })
})
