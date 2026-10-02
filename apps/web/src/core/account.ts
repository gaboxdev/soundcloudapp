import type { User } from '@soundclear/api'
import { ApiError } from '@soundclear/api'
import { getAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { createStore } from './store'
import { latestRequest } from './latest'

export type AccountStatus = 'unknown' | 'guest' | 'ready'

export interface AccountState {
  status: AccountStatus
  user: User | null
}

export const accountStore = createStore<AccountState>({ status: 'unknown', user: null })

const GUEST_KEY = 'sl:guest'

let guest = readGuest()
let sessionWatching = false

function readGuest(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === '1'
  } catch {
    return false
  }
}

export function guestAllowed(): boolean {
  return guest
}

export function hasAccount(): boolean {
  return isDesktop() && accountStore.get().status === 'ready' && accountStore.get().user !== null
}

export function allowGuest(): void {
  guest = true
  try {
    localStorage.setItem(GUEST_KEY, '1')
  } catch {
    guest = true
  }
  accountStore.set({ status: accountStore.get().status === 'ready' ? 'ready' : 'guest' })
}

export function revokeGuest(): void {
  guest = false
  try {
    localStorage.removeItem(GUEST_KEY)
  } catch {
    guest = false
  }
  accountStore.set({ status: accountStore.get().status })
}

function debugLog(message: string): void {
  if (!isDesktop()) return
  desktopInvoke('log_debug', { message }).catch(() => {})
}

function setAccount(status: AccountStatus, user: User | null): void {
  const current = accountStore.get()
  if (current.status === status && (current.user?.id ?? null) === (user?.id ?? null)) return
  accountStore.set({ status, user })
}

function isAuthError(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 401 || error.status === 403
  return /\b(401|403)\b/.test(String(error))
}

export const refreshAccount = latestRequest(
  () => isDesktop() ? getAPI().me() : Promise.resolve(null),
  (user) => {
    debugLog(user ? 'me() sesión comprobada' : 'me() sin sesión')
    setAccount(user ? 'ready' : 'guest', user)
  },
  (error) => {
    debugLog('me() no se pudo comprobar la sesión')
    if (isAuthError(error) || accountStore.get().status !== 'ready') setAccount('guest', null)
  },
)

export function watchSessionWindow(): void {
  if (!isDesktop() || sessionWatching) return
  sessionWatching = true
  void import('@tauri-apps/api/event').then(({ listen }) => {
    return listen('sl-session-check', () => {
      void refreshAccount(true)
    })
  }).catch(() => {
    sessionWatching = false
  })
}
