import { SoundCloudAPI, defaultTransport, isTauri, type Transport } from '@soundclear/api'
import { getSettings } from '../core/settings'
import { recordCall } from '../core/diag'

let api: SoundCloudAPI | null = null

export function apiBase(): string {
  return getSettings().apiBase
}

function medido(transport: Transport): Transport {
  const original = transport.getJSON.bind(transport)
  transport.getJSON = async (url: string): Promise<unknown> => {
    const inicio = performance.now()
    try {
      const data = await original(url)
      recordCall(url, performance.now() - inicio, true)
      return data
    } catch (error) {
      recordCall(url, performance.now() - inicio, false)
      throw error
    }
  }
  return transport
}

export function getAPI(): SoundCloudAPI {
  if (api) return api
  const transport = isTauri() ? defaultTransport('') : defaultTransport(apiBase())
  api = new SoundCloudAPI(medido(transport))
  return api
}

export function resetAPI(): void {
  api = null
}
