import { SoundCloudAPI, defaultTransport, isTauri } from '@soundclear/api'
import { getSettings } from '../core/settings'

let api: SoundCloudAPI | null = null

export function apiBase(): string {
  return getSettings().apiBase
}

export function getAPI(): SoundCloudAPI {
  if (api) return api
  api = isTauri() ? new SoundCloudAPI(defaultTransport('')) : new SoundCloudAPI(defaultTransport(apiBase()))
  return api
}

export function resetAPI(): void {
  api = null
}
