export interface Transport {
  getClientId(): Promise<string>
  getJSON(url: string): Promise<unknown>
  rewriteHref(href: string): string
  authedRequest(method: string, url: string, body?: unknown): Promise<unknown>
}

export const API_BASE = 'https://api-v2.soundcloud.com'

let cachedClientId: string | null = null
let clientIdPromise: Promise<string> | null = null

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function fetchClientIdFrom(base: string): Promise<string> {
  if (cachedClientId) return cachedClientId
  if (!clientIdPromise) {
    clientIdPromise = (async () => {
      const res = await fetch(`${base}/sl-client-id`)
      if (!res.ok) throw new Error(`sl-client-id falló: HTTP ${res.status}`)
      const data = (await res.json()) as { client_id: string }
      if (!data.client_id) throw new Error('client_id vacío')
      cachedClientId = data.client_id
      return cachedClientId
    })().finally(() => {
      clientIdPromise = null
    })
  }
  return clientIdPromise
}

export function resetClientIdCache(): void {
  cachedClientId = null
}

export class ProxyTransport implements Transport {
  constructor(public readonly base: string) {}

  async getClientId(): Promise<string> {
    return fetchClientIdFrom(this.base)
  }

  async getJSON(url: string): Promise<unknown> {
    const res = await fetch(`${this.base}/sl-proxy?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error(`proxy: HTTP ${res.status}`)
    return res.json()
  }

  rewriteHref(href: string): string {
    return `${this.base}/sl-proxy?url=${encodeURIComponent(href)}`
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

  async getClientId(): Promise<string> {
    if (cachedClientId) return cachedClientId
    const { invoke } = await this.core()
    cachedClientId = await invoke<string>('get_client_id')
    return cachedClientId
  }

  async getJSON(url: string): Promise<unknown> {
    const { invoke } = await this.core()
    const text = await invoke<string>('proxy_fetch', { url })
    return JSON.parse(text)
  }

  rewriteHref(href: string): string {
    return href
  }

  async authedRequest(method: string, url: string, body?: unknown): Promise<unknown> {
    const { invoke } = await this.core()
    const text = await invoke<string>('authed_request', { method, url, body: body ?? null })
    const separator = text.indexOf('\n')
    const status = Number(text.slice(0, separator))
    const payload = text.slice(separator + 1)
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`)
    if (!payload) return null
    return JSON.parse(payload)
  }
}

export function defaultTransport(base: string): Transport {
  if (isTauri()) return new TauriTransport()
  return new ProxyTransport(base)
}
