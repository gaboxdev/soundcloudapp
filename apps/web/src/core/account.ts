import type { User } from '@soundlite/api'
import { getAPI } from '../api'
import { isDesktop } from '../api/auth'
import { createStore } from './store'

export type AccountStatus = 'unknown' | 'guest' | 'ready'

export interface AccountState {
  status: AccountStatus
  user: User | null
}

export const accountStore = createStore<AccountState>({ status: 'unknown', user: null })

let refreshing: Promise<void> | null = null

export function refreshAccount(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      if (!isDesktop()) {
        accountStore.set({ status: 'guest', user: null })
        return
      }
      const user = await getAPI().me()
      accountStore.set(user ? { status: 'ready', user } : { status: 'guest', user: null })
    } catch {
      accountStore.set({ status: 'guest', user: null })
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export function watchSessionWindow(): void {
  if (!isDesktop()) return
  void import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
    getCurrentWebviewWindow()
      .listen('tauri://window-closed', (event) => {
        const payload = event.payload as { label?: string }
        if (payload.label === 'sl-login') void refreshAccount()
      })
      .catch(() => {})
  })
}
