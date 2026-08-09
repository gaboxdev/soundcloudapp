import { render } from './core/router'
import { renderHeader } from './components/header'
import { renderPlayerBar } from './components/playerbar'
import { renderLoginGate } from './components/logingate'
import { refreshAccount, watchSessionWindow } from './core/account'
import { mountAmbient } from './ui/ambient'
import { mountTopbar } from './ui/topbar'
import { player } from './player/player'

let initialized = false

export function bootstrapApp(): void {
  if (initialized) return
  initialized = true

  const app = document.getElementById('app')
  if (!app) return

  mountAmbient()

  const header = renderHeader()
  app.appendChild(header)
  app.appendChild(mountTopbar(header))

  const main = document.createElement('main')
  main.className = 'app-main'
  const outlet = document.createElement('div')
  outlet.id = 'view-outlet'
  main.appendChild(outlet)
  app.appendChild(main)

  app.appendChild(renderPlayerBar())

  app.appendChild(renderLoginGate())
  watchSessionWindow()
  void refreshAccount()

  window.addEventListener('hashchange', () => render())
  render()

  bindGlobalKeys()
}

const INTERACTIVE = 'input, textarea, select, button, a[href], [role="button"], [contenteditable="true"]'

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return Boolean(target.closest(INTERACTIVE))
}

function bindGlobalKeys(): void {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (isInteractiveTarget(event.target)) return

    if (event.code === 'Space') {
      event.preventDefault()
      player.toggle()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      player.seekTo(player.store.get().progress - 5000)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      player.seekTo(player.store.get().progress + 5000)
    } else if (event.key === 'n' || event.key === 'N') {
      player.next()
    } else if (event.key === 'p' || event.key === 'P') {
      player.prev()
    } else if (event.key === 'm' || event.key === 'M') {
      player.toggleMute()
    }
  })
}
