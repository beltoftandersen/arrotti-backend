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

  it("returns DefinitionId from Preferences.SalesFormsPrefs.CustomField by name", async () => {
    const fake = new FakeQboClient([
      {
        QueryResponse: {
          Preferences: [
            {
              SalesFormsPrefs: {
                CustomField: [
                  {
                    CustomField: [
                      { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
                      { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "P.O. Number" },
                      { Name: "SalesFormsPrefs.UseSalesCustom2", Type: "BooleanType", BooleanValue: false },
                      { Name: "SalesFormsPrefs.SalesCustomName2", Type: "StringType", StringValue: "" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ])
    const result = await resolvePoCustomFieldDefinitionId(asClient(fake))
    expect(result).toBe("1")
    expect(fake.queries[0]).toContain("FROM Preferences")
  })

  it.each([
    ["PO Number", "1"],
    ["  purchase order number  ", "1"],
    ["PO", "1"],
    ["p.o. number", "1"],
  ])("matches alias %j case-insensitively", async (label, expected) => {
    const fake = new FakeQboClient([
      {
        QueryResponse: {
          Preferences: [
            {
              SalesFormsPrefs: {
                CustomField: [
                  {
                    CustomField: [
                      { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
                      { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: label },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    ])
    expect(await resolvePoCustomFieldDefinitionId(asClient(fake))).toBe(expected)
  })

  it("ignores disabled slots even if the name matches", async () => {
    const fake = new FakeQboClient([
      {
        QueryResponse: {
          Preferences: [
            {
              SalesFormsPrefs: {
                CustomField: [
                  {
                    CustomField: [
                      { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: false },
                      { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "PO Number" },
                      { Name: "SalesFormsPrefs.UseSalesCustom2", Type: "BooleanType", BooleanValue: true },
                      { Name: "SalesFormsPrefs.SalesCustomName2", Type: "StringType", StringValue: "Department" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
      { QueryResponse: { Invoice: [] } }, // fallback — no invoices
    ])
    expect(await resolvePoCustomFieldDefinitionId(asClient(fake))).toBeNull()
  })

  it("caches the result across calls (single network query)", async () => {
    const prefsResponse = {
      QueryResponse: {
        Preferences: [
          {
            SalesFormsPrefs: {
              CustomField: [
                {
                  CustomField: [
                    { Name: "SalesFormsPrefs.UseSalesCustom1", Type: "BooleanType", BooleanValue: true },
                    { Name: "SalesFormsPrefs.SalesCustomName1", Type: "StringType", StringValue: "PO Number" },
                  ],
                },
              ],
            },
          },
        ],
      },
    }
    const fake = new FakeQboClient([prefsResponse, prefsResponse])
    const first = await resolvePoCustomFieldDefinitionId(asClient(fake))
    const second = await resolvePoCustomFieldDefinitionId(asClient(fake))
    expect(first).toBe("1")
    expect(second).toBe("1")
    expect(fake.queries.length).toBe(1)
  })

  it("falls back to scanning recent invoices when Preferences has no match", async () => {
    const fake = new FakeQboClient([
      // Preferences — no PO slot enabled
      {
        QueryResponse: {
          Preferences: [{ SalesFormsPrefs: { CustomField: [{ CustomField: [] }] } }],
        },
      },
      // Invoice scan — a recent invoice carries a PO CustomField
      {
        QueryResponse: {
          Invoice: [
            {
              Id: "999",
              CustomField: [
                { DefinitionId: "2", Name: "PO Number", Type: "StringType", StringValue: "ABC-1" },
              ],
            },
          ],
        },
      },
    ])
    const result = await resolvePoCustomFieldDefinitionId(asClient(fake))
    expect(result).toBe("2")
    expect(fake.queries[1]).toContain("FROM Invoice")
  })

  it("returns null when neither Preferences nor recent invoices carry a PO field", async () => {
    const fake = new FakeQboClient([
      { QueryResponse: { Preferences: [{ SalesFormsPrefs: { CustomField: [{ CustomField: [] }] } }] } },
      { QueryResponse: { Invoice: [{ Id: "999", CustomField: [] }] } },
    ])
    expect(await resolvePoCustomFieldDefinitionId(asClient(fake))).toBeNull()
  })
})
