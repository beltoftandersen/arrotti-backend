import { QboClient } from "./qbo-client"

const cache = new Map<symbol, string | null>()
const CACHE_KEY = Symbol.for("qbo-po-field-definitionId")

/** Test-only: clear the in-process cache between tests. */
export function __clearPoFieldCacheForTests(): void {
  cache.clear()
}

export async function resolvePoCustomFieldDefinitionId(
  _client: QboClient
): Promise<string | null> {
  return null
}
