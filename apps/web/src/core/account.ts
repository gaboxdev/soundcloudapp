import type { User } from '@soundclear/api'
import { ApiError } from '@soundclear/api'
import { getAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { createStore } from './store'

export type AccountStatus = 'unknown' | 'guest' | 'ready'

export interface AccountState {
  status: AccountStatus
  user: User | null
}

export const accountStore = createStore<AccountState>({ status: 'unknown', user: null })

const GUEST_KEY = 'sl:guest'

let refreshing: Promise<void> | null = null
let guest = readGuest()

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

export function refreshAccount(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      if (!isDesktop()) {
        setAccount('guest', null)
        return
      }
      const user = await getAPI().me()
      if (user) {
        debugLog(`me() ok: ${user.username}`)
        setAccount('ready', user)
      } else {
        debugLog('me() sin sesión')
        setAccount('guest', null)
      }
    } catch (error) {
      debugLog(`me() error: ${String(error)}`)
      if (isAuthError(error)) {
        setAccount('guest', null)
        return
      }
      if (accountStore.get().status === 'ready') return
      setAccount('guest', null)
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export function watchSessionWindow(): void {
  if (!isDesktop()) return
  void import('@tauri-apps/api/event').then(({ listen }) => {
    listen('sl-session-check', () => {
      void refreshAccount()
    }).catch(() => {})
  })
}
