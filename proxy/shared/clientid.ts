export const API_HOST = 'api-v2.soundcloud.com'
export const CLIENT_ID_URL = 'https://soundcloud.com'
export const REQUEST_TIMEOUT_MS = 10_000

const ALLOWED_HOSTS: readonly string[] = [API_HOST]

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const ID_PATTERNS: readonly RegExp[] = [
  /"hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]{16,64})"/,
  /"apiClient"[\s\S]{0,300}?"id":"([A-Za-z0-9]{16,64})"/,
  /(?<![\w-])client_id\s*[:=]\s*"([A-Za-z0-9]{16,64})"/,
  /(?<![\w-])client_id=([A-Za-z0-9]{16,64})(?![A-Za-z0-9])/,
]

const BUNDLE_PATTERN = /https:\/\/a-v2\.sndcdn\.com\/assets\/[A-Za-z0-9._-]+\.js/g
const MAX_BUNDLES = 5

export function isAllowedTarget(url: URL): boolean {
  return url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname)
}

export function extractClientId(source: string): string | null {
  for (const pattern of ID_PATTERNS) {
    const match = source.match(pattern)
    if (match && match[1]) return match[1]
  }
  return null
}

export function bundleUrls(html: string): string[] {
  const found = html.match(BUNDLE_PATTERN)
  if (!found) return []
  return [...new Set(found)].reverse().slice(0, MAX_BUNDLES)
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'user-agent': BROWSER_UA, accept: '*/*' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) return null
  return res.text()
}

export async function fetchClientId(): Promise<string> {
  const html = await fetchText(CLIENT_ID_URL)
  if (html === null) throw new Error('soundcloud.com no respondió correctamente')
  const direct = extractClientId(html)
  if (direct) return direct
  for (const bundle of bundleUrls(html)) {
    let script: string | null = null
    try {
      script = await fetchText(bundle)
    } catch {
      script = null
    }
    if (!script) continue
    const id = extractClientId(script)
    if (id) return id
  }
  throw new Error('no se pudo extraer client_id de soundcloud.com')
}

export interface ClientIdCache {
  get(force?: boolean): Promise<string>
  invalidate(): void
}

export function createClientIdCache(ttlMs: number, minRefreshMs = 15_000): ClientIdCache {
  let value: string | null = null
  let storedAt = 0
  let refreshedAt = 0
  let inFlight: Promise<string> | null = null

  function load(): Promise<string> {
    if (!inFlight) {
      inFlight = fetchClientId()
        .then((id) => {
          value = id
          storedAt = Date.now()
          refreshedAt = storedAt
          return id
        })
        .finally(() => {
          inFlight = null
        })
    }
    return inFlight
  }

  return {
    async get(force = false): Promise<string> {
      const now = Date.now()
      if (force) {
        if (value && now - refreshedAt < minRefreshMs) return value
        value = null
      }
      if (value && now - storedAt < ttlMs) return value
      return load()
    },
    invalidate(): void {
      if (Date.now() - refreshedAt < minRefreshMs) return
      value = null
    },
  }
}

export function wantsRefresh(param: string | null): boolean {
  if (param === null) return false
  return param !== '0' && param !== 'false' && param !== ''
}
