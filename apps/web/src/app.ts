import { render } from './core/router'
import { renderHeader } from './components/header'
import { renderPlayerBar } from './components/playerbar'
import { player } from './player/player'

let initialized = false

export function bootstrapApp(): void {
  if (initialized) return
  initialized = true

  const app = document.getElementById('app')
  if (!app) return

  app.appendChild(renderHeader())

  const main = document.createElement('main')
  main.className = 'app-main'
  const outlet = document.createElement('div')
  outlet.id = 'view-outlet'
  main.appendChild(outlet)
  app.appendChild(main)

  app.appendChild(renderPlayerBar())

  window.addEventListener('hashchange', () => render())
  render()

  bindGlobalKeys()
}

function bindGlobalKeys(): void {
  window.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement
    const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
    if (typing) return

    if (event.code === 'Space') {
      event.preventDefault()
      player.toggle()
    } else if (event.key === 'ArrowLeft' && !event.metaKey) {
      event.preventDefault()
      player.seekTo(player.store.get().progress - 5000)
    } else if (event.key === 'ArrowRight' && !event.metaKey) {
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
