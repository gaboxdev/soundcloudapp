import { render } from './core/router'
import { renderHeader } from './components/header'
import { renderPlayerBar } from './components/playerbar'
import { renderLoginGate } from './components/logingate'
import { openWelcome, welcomePending } from './components/welcome'
import { openPalette } from './components/palette'
import { openShortcuts } from './components/shortcuts'
import { closeMenu } from './components/menu'
import { refreshAccount, watchSessionWindow } from './core/account'
import { initSocial } from './core/social'
import { initOffline } from './core/offline'
import { mountAmbient } from './ui/ambient'
import { mountTopbar } from './ui/topbar'
import { toast } from './ui/toast'
import { player } from './player/player'
import { t } from './core/i18n.ts'

let initialized = false

export function remountApp(): void {
  const app = document.getElementById('app')
  if (!app) return
  app.replaceChildren()
  initialized = false
  bootstrapApp()
}

export function bootstrapApp(): void {
  if (initialized) return
  initialized = true

  const app = document.getElementById('app')
  if (!app) return

  mountAmbient()

  const skip = document.createElement('a')
  skip.className = 'skip-link'
  skip.href = '#view-outlet'
  skip.textContent = t('Saltar al contenido')
  app.appendChild(skip)

  const header = renderHeader()
  app.appendChild(header)
  app.appendChild(mountTopbar(header))

  const main = document.createElement('main')
  main.className = 'app-main'
  const outlet = document.createElement('div')
  outlet.id = 'view-outlet'
  outlet.tabIndex = -1
  main.appendChild(outlet)
  app.appendChild(main)

  app.appendChild(renderPlayerBar())

  app.appendChild(renderLoginGate())
  if (welcomePending()) openWelcome()
  watchSessionWindow()
  initSocial()
  initOffline()
  void refreshAccount()

  window.addEventListener('hashchange', () => {
    closeMenu()
    render()
  })
  render()

  bindGlobalKeys()
}

const INTERACTIVE = 'input, textarea, select, button, a[href], [role="button"], [contenteditable="true"]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return Boolean(target.closest(INTERACTIVE))
}

function overlayOpen(): boolean {
  return document.querySelector('.sl-modal, .menu-layer') !== null
}

function focusSearch(): void {
  const input = document.querySelector<HTMLInputElement>('.header-search input')
  if (!input) {
    window.location.hash = '#/search'
    return
  }
  input.focus()
  input.select()
}

function bindGlobalKeys(): void {
  window.addEventListener('keydown', (event) => {
    const meta = event.metaKey || event.ctrlKey

    if (meta && !event.altKey && (event.key === 'k' || event.key === 'K')) {
      event.preventDefault()
      openPalette()
      return
    }
    if (meta || event.altKey) return
    if (overlayOpen()) return

    if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
      event.preventDefault()
      openShortcuts()
      return
    }
    if (event.key === '/' && !isInteractiveTarget(event.target)) {
      event.preventDefault()
      focusSearch()
      return
    }
    if (isInteractiveTarget(event.target)) return

    const state = player.store.get()

    switch (event.key) {
      case ' ':
        event.preventDefault()
        player.toggle()
        return
      case 'ArrowLeft':
        event.preventDefault()
        player.seekBy(event.shiftKey ? -15000 : -5000)
        return
      case 'ArrowRight':
        event.preventDefault()
        player.seekBy(event.shiftKey ? 15000 : 5000)
        return
      case 'ArrowUp':
        event.preventDefault()
        player.nudgeVolume(0.05)
        return
      case 'ArrowDown':
        event.preventDefault()
        player.nudgeVolume(-0.05)
        return
      default:
        break
    }

    switch (event.key.toLowerCase()) {
      case 'n':
        player.next()
        return
      case 'p':
        player.prev()
        return
      case 'm':
        player.toggleMute()
        return
      case 'f': {
        if (!state.current) return
        player.toggleLike(state.current)
        toast(player.isLiked(state.current) ? 'Guardado en favoritos' : t('Quitado de favoritos'), 'ok')
        return
      }
      case 's':
        player.toggleShuffle()
        toast(player.store.get().shuffle ? 'Aleatorio activado' : t('Aleatorio desactivado'))
        return
      case 'r': {
        player.cycleRepeat()
        const mode = player.store.get().repeat
        toast(mode === 'one' ? 'Repetir una vez' : mode === 'all' ? 'Repetir toda la cola' : t('Repetir desactivado'))
        return
      }
      case 'x': {
        if (!state.current) return
        void player.startRadio(state.current)
        return
      }
      case 'q':
        window.location.hash = '#/queue'
        return
      case 'a':
        window.location.hash = '#/now'
        return
      case ',':
        window.location.hash = '#/settings'
        return
      default:
        return
    }
  })
}
