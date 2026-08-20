import { bootstrapApp } from './app'
import { getSettings, updateSettings } from './core/settings'
import { isTauri } from '@soundclear/api'
import './views/home'
import './views/charts'
import './views/explore'
import './views/search'
import './views/track'
import './views/playlist'
import './views/user'
import './views/queue'
import './views/now'
import './views/feed'
import './views/likes'
import './views/settings'

export async function startApp(): Promise<void> {
  bootstrapApp()
  const { consumeSharedLink, openSoundcloudLink } = await import('./core/links')
  const compartido = consumeSharedLink()
  if (compartido) void openSoundcloudLink(compartido)
  if (isTauri()) {
    const { initNative } = await import('./api/native')
    void initNative()
  }
  if (import.meta.env.DEV) {
    const { player } = await import('./player/player')
    const offline = await import('./core/offline')
    const a11y = await import('./dev/a11y')
    ;(window as unknown as { soundclear?: unknown }).soundclear = {
      player,
      offline,
      settings: getSettings,
      update: updateSettings,
      audit: a11y.auditA11y,
      auditRoutes: a11y.auditRoutes,
    }
  }
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}
