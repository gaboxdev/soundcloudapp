import './styles/acrylic.css'
import './styles/design.css'
import { bootstrapApp } from './app'
import { initSettings } from './core/settings'
import { isTauri } from '@soundlite/api'
import './views/home'
import './views/charts'
import './views/search'
import './views/track'
import './views/playlist'
import './views/user'
import './views/queue'
import './views/likes'
import './views/settings'

async function boot(): Promise<void> {
  initSettings()
  if (isTauri()) {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const label = getCurrentWebviewWindow().label
      if (label && label !== 'main') return
    } catch {}
  }
  bootstrapApp()
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}

void boot()
