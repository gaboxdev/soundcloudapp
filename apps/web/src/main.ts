import './styles/acrylic.css'
import './styles/design.css'
import './styles/skeleton.css'
import { initSettings } from './core/settings'
import { loadLang } from './core/i18n.ts'
import { isTauri } from '@soundclear/api'

async function boot(): Promise<void> {
  const settings = initSettings()
  await loadLang(settings.lang)
  if (isTauri()) {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const label = getCurrentWebviewWindow().label
      if (label === 'mini') {
        const { bootstrapMini } = await import('./mini/mini')
        await bootstrapMini()
        return
      }
      if (label && label !== 'main') return
    } catch {}
  }
  const { startApp } = await import('./boot')
  await startApp()
}

void boot()
