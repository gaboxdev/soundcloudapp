import './styles/acrylic.css'
import './styles/design.css'
import './styles/skeleton.css'
import { initSettings } from './core/settings'
import { loadLang } from './core/i18n.ts'
import { isTauri } from '@soundclear/api'

async function boot(): Promise<void> {
  let desktopLabel: string | null = null
  if (isTauri()) {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      desktopLabel = getCurrentWebviewWindow().label
    } catch {}
    if (desktopLabel && desktopLabel !== 'main' && desktopLabel !== 'mini') return
  }
  if (import.meta.env.DEV && desktopLabel === 'main') {
    const keys = ['sl:settings', 'sl:player:queue', 'sl:history', 'sl:likes']
    try {
      const backup = localStorage.getItem('sl:review:backup')
      if (backup) {
        const values = JSON.parse(backup) as Record<string, unknown>
        for (const key of keys) {
          if (typeof values[key] === 'string') localStorage.setItem(key, values[key])
          else if (values[key] === null) localStorage.removeItem(key)
        }
        localStorage.removeItem('sl:review:backup')
      }
    } catch {}
  }
  const settings = initSettings()
  await loadLang(settings.lang)
  if (desktopLabel === 'mini') {
    const { bootstrapMini } = await import('./mini/mini')
    await bootstrapMini()
    return
  }
  const { startApp } = await import('./boot')
  await startApp()
}

void boot()
