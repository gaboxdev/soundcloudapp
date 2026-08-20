import type { Track } from '@soundclear/api'
import { isDrmOnly } from '@soundclear/api'
import { getAPI } from '../api'
import { createStore, type Store } from './store'
import { getSettings } from './settings'
import { t } from './i18n.ts'

export interface OfflineEntry {
  id: number
  title: string
  artist: string
  artwork: string | null
  duration: number
  bytes: number
  mime: string
  savedAt: number
}

export interface OfflineState {
  supported: boolean
  ready: boolean
  entries: OfflineEntry[]
  bytes: number
  saving: Record<number, number>
}

const DB_NAME = 'sl-offline'
const DB_VERSION = 1
const AUDIO_STORE = 'audio'
const INDEX_STORE = 'index'
const MB = 1024 * 1024

export const offlineStore: Store<OfflineState> = createStore<OfflineState>({
  supported: typeof indexedDB !== 'undefined',
  ready: false,
  entries: [],
  bytes: 0,
  saving: {},
})

let dbPromise: Promise<IDBDatabase | null> | null = null
let initialized = false
const ids = new Set<number>()

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE)
      if (!db.objectStoreNames.contains(INDEX_STORE)) db.createObjectStore(INDEX_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null)
          return
        }
        let request: IDBRequest<T>
        try {
          request = run(db.transaction(store, mode).objectStore(store))
        } catch {
          resolve(null)
          return
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      }),
  )
}

function syncIndex(entries: OfflineEntry[]): void {
  ids.clear()
  for (const entry of entries) ids.add(entry.id)
  const sorted = [...entries].sort((a, b) => b.savedAt - a.savedAt)
  offlineStore.set({
    entries: sorted,
    bytes: sorted.reduce((sum, entry) => sum + entry.bytes, 0),
    ready: true,
  })
}

export function initOffline(): void {
  if (initialized || !offlineStore.get().supported) return
  initialized = true
  void tx<OfflineEntry[]>(INDEX_STORE, 'readonly', (store) => store.getAll() as IDBRequest<OfflineEntry[]>).then((entries) => {
    syncIndex(Array.isArray(entries) ? entries : [])
  })
}

export function offlineHas(trackId: number): boolean {
  return ids.has(trackId)
}

export function offlineSaving(trackId: number): number | null {
  const value = offlineStore.get().saving[trackId]
  return typeof value === 'number' ? value : null
}

export function offlineBudgetBytes(): number {
  return getSettings().offlineBudget * MB
}

export function offlineFreeBytes(): number {
  return Math.max(0, offlineBudgetBytes() - offlineStore.get().bytes)
}

export function offlineReason(track: Track): string | null {
  if (!offlineStore.get().supported) return t('Este navegador no permite guardar audio sin conexión')
  if (track.policy === 'SNIP') return t('Los previews de 30 s de Go+ no se guardan')
  if (isDrmOnly(track)) return t('SoundCloud entrega este track cifrado (DRM)')
  return null
}

function setSaving(trackId: number, progress: number | null): void {
  const saving = { ...offlineStore.get().saving }
  if (progress === null) delete saving[trackId]
  else saving[trackId] = progress
  offlineStore.set({ saving })
}

export type OfflineSignal = 'saving' | 'saved' | 'gone'

function notify(trackId: number, state: OfflineSignal): void {
  window.dispatchEvent(new CustomEvent('sl:offline', { detail: { trackId, state } }))
}

async function readWithProgress(response: Response, trackId: number, expected: number): Promise<Blob> {
  const body = response.body
  const type = response.headers.get('content-type') ?? 'audio/mpeg'
  if (!body) return new Blob([await response.arrayBuffer()], { type })
  const reader = body.getReader()
  const chunks: BlobPart[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value as unknown as BlobPart)
    received += value.byteLength
    if (expected > 0) setSaving(trackId, Math.min(0.99, received / expected))
  }
  return new Blob(chunks, { type })
}

export async function saveOffline(track: Track): Promise<{ ok: boolean; message: string }> {
  const blocked = offlineReason(track)
  if (blocked) return { ok: false, message: blocked }
  if (ids.has(track.id)) return { ok: true, message: t('Ya estaba guardado') }
  if (offlineSaving(track.id) !== null) return { ok: false, message: t('Ya se está guardando') }

  setSaving(track.id, 0)
  notify(track.id, 'saving')
  try {
    const target = await getAPI().streamUrl(track)
    if (!target) return { ok: false, message: t('SoundCloud no entregó audio para este track') }
    if (target.protocol !== 'progressive') {
      return { ok: false, message: t('Este track solo llega por HLS y todavía no se puede guardar') }
    }
    const response = await fetch(target.url)
    if (!response.ok) return { ok: false, message: `SoundCloud respondió ${response.status}` }
    const expected = Number(response.headers.get('content-length') ?? 0)
    const free = offlineFreeBytes()
    if (expected > 0 && expected > free) {
      return { ok: false, message: t('No cabe en el espacio reservado: súbelo en Ajustes › Datos') }
    }
    const blob = await readWithProgress(response, track.id, expected)
    if (blob.size === 0) return { ok: false, message: t('La descarga llegó vacía') }
    if (blob.size > offlineFreeBytes()) {
      return { ok: false, message: t('No cabe en el espacio reservado: súbelo en Ajustes › Datos') }
    }
    const stored = await tx<IDBValidKey>(AUDIO_STORE, 'readwrite', (store) => store.put(blob, track.id))
    if (stored === null) return { ok: false, message: t('El navegador rechazó guardar el audio') }
    const entry: OfflineEntry = {
      id: track.id,
      title: track.title,
      artist: track.user?.username ?? t('Artista desconocido'),
      artwork: track.artwork_url,
      duration: track.duration,
      bytes: blob.size,
      mime: blob.type || 'audio/mpeg',
      savedAt: Date.now(),
    }
    await tx<IDBValidKey>(INDEX_STORE, 'readwrite', (store) => store.put(entry, track.id))
    syncIndex([...offlineStore.get().entries.filter((item) => item.id !== track.id), entry])
    notify(track.id, 'saved')
    return { ok: true, message: t('Guardado para escuchar sin conexión') }
  } catch {
    return { ok: false, message: t('No se pudo guardar el track') }
  } finally {
    setSaving(track.id, null)
    if (!ids.has(track.id)) notify(track.id, 'gone')
  }
}

export async function removeOffline(trackId: number): Promise<void> {
  await tx<undefined>(AUDIO_STORE, 'readwrite', (store) => store.delete(trackId))
  await tx<undefined>(INDEX_STORE, 'readwrite', (store) => store.delete(trackId))
  syncIndex(offlineStore.get().entries.filter((entry) => entry.id !== trackId))
  notify(trackId, 'gone')
}

export async function clearOffline(): Promise<number> {
  const removed = offlineStore.get().entries.length
  await tx<undefined>(AUDIO_STORE, 'readwrite', (store) => store.clear())
  await tx<undefined>(INDEX_STORE, 'readwrite', (store) => store.clear())
  const previous = offlineStore.get().entries
  syncIndex([])
  for (const entry of previous) notify(entry.id, 'gone')
  return removed
}

export async function offlineBlobUrl(trackId: number): Promise<string | null> {
  if (!ids.has(trackId)) return null
  const blob = await tx<Blob>(AUDIO_STORE, 'readonly', (store) => store.get(trackId) as IDBRequest<Blob>)
  if (!blob || blob.size === 0) return null
  return URL.createObjectURL(blob)
}

export async function offlineQuota(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}
