export interface Transport {
  getClientId(refresh?: boolean): Promise<string>
  getJSON(url: string): Promise<unknown>
  rewriteHref(href: string): string
  authedRequest(method: string, url: string, body?: unknown): Promise<unknown>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const API_BASE = 'https://api-v2.soundcloud.com'

let cachedClientId: string | null = null
let clientIdPromise: Promise<string> | null = null
let refreshPromise: Promise<string> | null = null
let refreshGeneration = 0

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function storeClientId(id: string): string {
  if (!id) throw new Error('client_id vacío')
  cachedClientId = id
  return id
}

function shareClientId(load: (refresh: boolean) => Promise<string>, refresh: boolean): Promise<string> {
  if (refresh) {
    if (!refreshPromise) {
      refreshGeneration += 1
      refreshPromise = load(true)
        .then(storeClientId)
        .finally(() => {
          refreshPromise = null
        })
    }
    return refreshPromise
  }
  if (refreshPromise) return refreshPromise
  if (cachedClientId) return Promise.resolve(cachedClientId)
  if (!clientIdPromise) {
    const generation = refreshGeneration
    clientIdPromise = load(false)
      .then((id) => (generation !== refreshGeneration && cachedClientId ? cachedClientId : storeClientId(id)))
      .finally(() => {
        clientIdPromise = null
      })
  }
  return clientIdPromise
}

function fetchClientIdFrom(base: string, refresh: boolean): Promise<string> {
  return shareClientId(async (force) => {
    const res = await fetch(`${base}/sl-client-id${force ? '?refresh=1' : ''}`)
    if (!res.ok) throw new ApiError(res.status, `sl-client-id falló: HTTP ${res.status}`)
    const data = (await res.json()) as { client_id?: string; refreshed?: boolean }
    return data.client_id ?? ''
  }, refresh)
}

export function resetClientIdCache(): void {
  cachedClientId = null
}

export function withClientId(href: string, clientId: string | null = cachedClientId): string {
  if (!clientId) return href
  try {
    const url = new URL(href)
    url.searchParams.set('client_id', clientId)
    return url.toString()
  } catch {
    return href
  }
}

export class ProxyTransport implements Transport {
  constructor(public readonly base: string) {}

  async getClientId(refresh = false): Promise<string> {
    return fetchClientIdFrom(this.base, refresh)
  }

  async getJSON(url: string): Promise<unknown> {
    const res = await fetch(`${this.base}/sl-proxy?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new ApiError(res.status, `proxy: HTTP ${res.status}`)
    return res.json()
  }

  rewriteHref(href: string): string {
    return withClientId(href)
  }

  async authedRequest(_method: string, _url: string, _body?: unknown): Promise<unknown> {
    throw new Error('Iniciar sesión con SoundCloud solo está disponible en la app de escritorio')
  }
}

export class TauriTransport implements Transport {
  private corePromise: Promise<typeof import('@tauri-apps/api/core')> | null = null

  private async core(): Promise<typeof import('@tauri-apps/api/core')> {
    if (!this.corePromise) this.corePromise = import('@tauri-apps/api/core')
    return this.corePromise
  }

  async getClientId(refresh = false): Promise<string> {
    return shareClientId(async (force) => {
      const { invoke } = await this.core()
      return invoke<string>('get_client_id', { refresh: force })
    }, refresh)
  }

  async getJSON(url: string): Promise<unknown> {
    const { invoke } = await this.core()
    let text: string
    try {
      text = await invoke<string>('proxy_fetch', { url })
    } catch (error) {
      const upstream = /upstream HTTP (\d{3})/.exec(String(error))
      if (upstream) throw new ApiError(Number(upstream[1]), `proxy_fetch: HTTP ${upstream[1]}`)
      throw error
    }
    return JSON.parse(text)
  }

  rewriteHref(href: string): string {
    return href
  }

  async authedRequest(method: string, url: string, body?: unknown): Promise<unknown> {
    const { invoke } = await this.core()
    const text = await invoke<string>('authed_request', { method, url, body: body ?? null })
    const separator = text.indexOf('\n')
    const status = separator < 0 ? Number.NaN : Number(text.slice(0, separator))
    if (separator < 0 || !Number.isFinite(status)) {
      throw new ApiError(0, `respuesta inválida del puente sl-bridge: ${text.slice(0, 200)}`)
    }
    const payload = text.slice(separator + 1)
    if (status < 200 || status >= 300) throw new ApiError(status, `HTTP ${status}`)
    if (!payload) return null
    return JSON.parse(payload)
  }
}

export function defaultTransport(base: string): Transport {
  if (isTauri()) return new TauriTransport()
  return new ProxyTransport(base)
}
