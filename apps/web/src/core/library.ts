import type { Track } from '@soundclear/api'

const LIKES_KEY = 'sl:likes'
const HISTORY_KEY = 'sl:history'
const HISTORY_MAX = 200
const LIKES_MAX = 500
const LIKES_FALLBACK_SIZES = [200, 50]

export interface HistoryEntry {
  track: Track
  playedAt: number
}

function isTrack(value: unknown): value is Track {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number'
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as { track?: unknown; playedAt?: unknown }
  return isTrack(entry.track) && typeof entry.playedAt === 'number' && Number.isFinite(entry.playedAt)
}

function readArray(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown): boolean {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadLikes(): Track[] {
  return readArray(LIKES_KEY).filter(isTrack).slice(0, LIKES_MAX)
}

export function saveLikes(likes: Track[]): void {
  const valid = likes.filter(isTrack).slice(0, LIKES_MAX)
  if (write(LIKES_KEY, valid)) return
  for (const size of LIKES_FALLBACK_SIZES) {
    if (write(LIKES_KEY, valid.slice(0, size))) return
  }
  write(LIKES_KEY, null)
}

export function loadHistory(): HistoryEntry[] {
  return readArray(HISTORY_KEY).filter(isHistoryEntry).slice(0, HISTORY_MAX)
}

export function saveHistory(history: HistoryEntry[]): void {
  const valid = history.filter(isHistoryEntry).slice(0, HISTORY_MAX)
  if (write(HISTORY_KEY, valid)) return
  write(HISTORY_KEY, valid.slice(0, 50))
}
