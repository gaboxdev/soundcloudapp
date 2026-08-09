import type { Track } from '@soundlite/api'

const LIKES_KEY = 'sl:likes'
const HISTORY_KEY = 'sl:history'
const HISTORY_MAX = 200

export interface HistoryEntry {
  track: Track
  playedAt: number
}

export function loadLikes(): Track[] {
  try {
    const raw = localStorage.getItem(LIKES_KEY)
    if (raw) return JSON.parse(raw) as Track[]
  } catch {
    // ignora
  }
  return []
}

export function saveLikes(likes: Track[]): void {
  try {
    localStorage.setItem(LIKES_KEY, JSON.stringify(likes))
  } catch {
    // sin almacenamiento
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) return JSON.parse(raw) as HistoryEntry[]
  } catch {
    // ignora
  }
  return []
}

export function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_MAX)))
  } catch {
    // sin almacenamiento
  }
}
