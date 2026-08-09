import type { User } from '@soundlite/api'
import { getAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { createStore } from './store'

export type AccountStatus = 'unknown' | 'guest' | 'ready'

export interface AccountState {
  status: AccountStatus
  user: User | null
}

export const accountStore = createStore<AccountState>({ status: 'unknown', user: null })

let refreshing: Promise<void> | null = null

function debugLog(message: string): void {
  if (!isDesktop()) return
  desktopInvoke('log_debug', { message }).catch(() => {})
}

export function refreshAccount(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      if (!isDesktop()) {
        accountStore.set({ status: 'guest', user: null })
        return
      }
      const user = await getAPI().me()
      if (user) {
        debugLog(`me() ok: ${user.username}`)
        accountStore.set({ status: 'ready', user })
      } else {
        debugLog('me() sin sesión')
        accountStore.set({ status: 'guest', user: null })
      }
    } catch (error) {
      debugLog(`me() error: ${String(error)}`)
      accountStore.set({ status: 'guest', user: null })
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
