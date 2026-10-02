import type { Track } from '@soundclear/api'
import { isDrmOnly } from '@soundclear/api'
import { getAPI } from '../api'
import { createStore, type Store } from './store'
import { getSettings } from './settings'
import { t } from './i18n.ts'
import { completeIdbTransaction, enqueueMutation, type MutationQueue } from './idb'

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
const saveTokens = new Map<number, number>()
let saveTokenCounter = 0
const mutationQueue: MutationQueue = { tail: Promise.resolve() }

class SaveInvalidated extends Error {}

class OfflineTooLarge extends Error {}

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

function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => IDBRequest<T> | readonly IDBRequest<T>[] | null,
): Promise<T | null> {
  return openDb().then(async (db) => {
    if (!db) return null
    const transaction = db.transaction(stores, mode)
    const result = await completeIdbTransaction(transaction, () => run(transaction))
    return result as T
  })
}

function serializeMutation<T>(task: () => Promise<T>): Promise<T> {
  return enqueueMutation(mutationQueue, task)
}

function nextSaveToken(trackId: number): number {
  const token = ++saveTokenCounter
  saveTokens.set(trackId, token)
  return token
}

function invalidateSave(trackId: number): number {
  return nextSaveToken(trackId)
}

function isCurrentSave(trackId: number, token: number): boolean {
  return saveTokens.get(trackId) === token
}

function clearSaveToken(trackId: number, token: number): void {
  if (isCurrentSave(trackId, token)) saveTokens.delete(trackId)
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
  void serializeMutation(async () => {
    try {
      const entries = await tx<OfflineEntry[]>(INDEX_STORE, 'readonly', (transaction) => transaction.objectStore(INDEX_STORE).getAll() as IDBRequest<OfflineEntry[]>)
      syncIndex(Array.isArray(entries) ? entries : [])
    } catch {
      syncIndex([])
    }
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

function setSaving(trackId: number, progress: number | null, token?: number): void {
  if (token !== undefined && !isCurrentSave(trackId, token)) return
  const saving = { ...offlineStore.get().saving }
  if (progress === null) delete saving[trackId]
  else saving[trackId] = progress
  offlineStore.set({ saving })
}

export type OfflineSignal = 'saving' | 'saved' | 'gone'

function notify(trackId: number, state: OfflineSignal): void {
  window.dispatchEvent(new CustomEvent('sl:offline', { detail: { trackId, state } }))
}

async function readWithProgress(
  response: Response,
  trackId: number,
  expected: number,
  maxBytes: number,
  active: () => boolean,
  token: number,
): Promise<Blob> {
  const body = response.body
  const type = response.headers.get('content-type') ?? 'audio/mpeg'
  if (!body) {
    const buffer = await response.arrayBuffer()
    if (!active()) throw new SaveInvalidated()
    if (buffer.byteLength > maxBytes) throw new OfflineTooLarge()
    return new Blob([buffer], { type })
  }
  const reader = body.getReader()
  const chunks: BlobPart[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!active()) {
      try {
        await reader.cancel()
      } catch {
        throw new SaveInvalidated()
      }
      throw new SaveInvalidated()
    }
    if (!value) continue
    chunks.push(value as unknown as BlobPart)
    received += value.byteLength
    if (received > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        throw new OfflineTooLarge()
      }
      throw new OfflineTooLarge()
    }
    if (expected > 0) setSaving(trackId, Math.min(0.99, received / expected), token)
  }
  if (!active()) throw new SaveInvalidated()
  return new Blob(chunks, { type })
}

function createOfflineEntry(track: Track, blob: Blob): OfflineEntry {
  return {
    id: track.id,
    title: track.title,
    artist: track.user?.username ?? t('Artista desconocido'),
    artwork: track.artwork_url,
    duration: track.duration,
    bytes: blob.size,
    mime: blob.type || 'audio/mpeg',
    savedAt: Date.now(),
  }
}

export async function saveOffline(track: Track): Promise<{ ok: boolean; message: string }> {
  const blocked = offlineReason(track)
  if (blocked) return { ok: false, message: blocked }
  if (ids.has(track.id)) return { ok: true, message: t('Ya estaba guardado') }
  if (offlineSaving(track.id) !== null) return { ok: false, message: t('Ya se está guardando') }

  const token = nextSaveToken(track.id)
  setSaving(track.id, 0, token)
  notify(track.id, 'saving')
  try {
    const target = await getAPI().streamUrl(track)
    if (!isCurrentSave(track.id, token)) throw new SaveInvalidated()
    if (!target) return { ok: false, message: t('SoundCloud no entregó audio para este track') }
    if (target.snipped) return { ok: false, message: t('Los previews de 30 s de Go+ no se guardan') }
    if (target.protocol !== 'progressive') {
      return { ok: false, message: t('Este track solo llega por HLS y todavía no se puede guardar') }
    }
    const response = await fetch(target.url)
    if (!isCurrentSave(track.id, token)) throw new SaveInvalidated()
    if (!response.ok) return { ok: false, message: `SoundCloud respondió ${response.status}` }
    const expected = Number(response.headers.get('content-length') ?? 0)
    const free = offlineFreeBytes()
    if (expected > 0 && expected > free) {
      return { ok: false, message: t('No cabe en el espacio reservado: súbelo en Ajustes › Datos') }
    }
    const blob = await readWithProgress(response, track.id, expected, free, () => isCurrentSave(track.id, token), token)
    if (blob.size === 0) return { ok: false, message: t('La descarga llegó vacía') }
    if (blob.size > offlineFreeBytes()) {
      return { ok: false, message: t('No cabe en el espacio reservado: súbelo en Ajustes › Datos') }
    }
    const entry = createOfflineEntry(track, blob)
    const persisted = await serializeMutation(async () => {
      if (!isCurrentSave(track.id, token)) return 'cancelled' as const
      if (blob.size > offlineFreeBytes()) return 'too-large' as const
      const indexed = await tx<IDBValidKey>([AUDIO_STORE, INDEX_STORE], 'readwrite', (transaction) => [
        transaction.objectStore(AUDIO_STORE).put(blob, track.id),
        transaction.objectStore(INDEX_STORE).put(entry, track.id),
      ])
      if (indexed === null) return 'unavailable' as const
      if (!isCurrentSave(track.id, token)) return 'cancelled' as const
      syncIndex([...offlineStore.get().entries.filter((item) => item.id !== track.id), entry])
      return 'saved' as const
    })
    if (persisted === 'too-large') return { ok: false, message: t('No cabe en el espacio reservado: súbelo en Ajustes › Datos') }
    if (persisted === 'unavailable') return { ok: false, message: t('El navegador rechazó guardar el audio') }
    if (persisted === 'cancelled') return { ok: false, message: t('No se pudo guardar el track') }
    notify(track.id, 'saved')
    return { ok: true, message: t('Guardado para escuchar sin conexión') }
  } catch (error) {
    if (error instanceof OfflineTooLarge) return { ok: false, message: t('No cabe en el espacio reservado: súbelo en Ajustes › Datos') }
    return { ok: false, message: t('No se pudo guardar el track') }
  } finally {
    if (isCurrentSave(track.id, token)) {
      setSaving(track.id, null, token)
      if (!ids.has(track.id)) notify(track.id, 'gone')
      clearSaveToken(track.id, token)
    }
  }
}

export async function removeOffline(trackId: number): Promise<void> {
  const token = invalidateSave(trackId)
  setSaving(trackId, null)
  if (!offlineStore.get().supported) {
    syncIndex(offlineStore.get().entries.filter((entry) => entry.id !== trackId))
    clearSaveToken(trackId, token)
    notify(trackId, 'gone')
    return
  }
  await serializeMutation(async () => {
    const removed = await tx<undefined>([AUDIO_STORE, INDEX_STORE], 'readwrite', (transaction) => [
      transaction.objectStore(AUDIO_STORE).delete(trackId),
      transaction.objectStore(INDEX_STORE).delete(trackId),
    ])
    if (removed === null) throw new Error('IndexedDB unavailable')
    syncIndex(offlineStore.get().entries.filter((entry) => entry.id !== trackId))
  }).finally(() => clearSaveToken(trackId, token))
  notify(trackId, 'gone')
}

export async function clearOffline(): Promise<number> {
  const activeIds = Object.keys(offlineStore.get().saving).map((id) => Number(id))
  const tokens = activeIds.map((id) => [id, invalidateSave(id)] as const)
  offlineStore.set({ saving: {} })
  if (!offlineStore.get().supported) {
    const previous = offlineStore.get().entries
    syncIndex([])
    for (const entry of previous) notify(entry.id, 'gone')
    for (const [id, token] of tokens) clearSaveToken(id, token)
    return previous.length
  }
  try {
    return await serializeMutation(async () => {
      const previous = offlineStore.get().entries
      const cleared = await tx<undefined>([AUDIO_STORE, INDEX_STORE], 'readwrite', (transaction) => [
        transaction.objectStore(AUDIO_STORE).clear(),
        transaction.objectStore(INDEX_STORE).clear(),
      ])
      if (cleared === null) throw new Error('IndexedDB unavailable')
      syncIndex([])
      for (const entry of previous) notify(entry.id, 'gone')
      return previous.length
    })
  } finally {
    for (const [id, token] of tokens) clearSaveToken(id, token)
  }
}

export async function offlineBlobUrl(trackId: number): Promise<string | null> {
  if (!ids.has(trackId)) return null
  let blob: Blob | null
  try {
    blob = await tx<Blob>(AUDIO_STORE, 'readonly', (transaction) => transaction.objectStore(AUDIO_STORE).get(trackId) as IDBRequest<Blob>)
  } catch {
    return null
  }
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
