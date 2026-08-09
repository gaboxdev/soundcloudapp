import { artworkUrl } from '../core/utils'
import { player } from '../player/player'

interface Ambient {
  root: HTMLElement
  setArtwork(url: string | null): void
}

const AMBIENT_SIZE = 't120x120'

function createAmbient(): Ambient {
  const root = document.createElement('div')
  root.className = 'ambient'
  root.setAttribute('aria-hidden', 'true')

  const idle = document.createElement('div')
  idle.className = 'ambient-idle'

  const frames = [document.createElement('div'), document.createElement('div')]
  frames.forEach((frame) => {
    frame.className = 'ambient-frame'
  })

  const veil = document.createElement('div')
  veil.className = 'ambient-veil'
  const sheen = document.createElement('div')
  sheen.className = 'ambient-sheen'
  const vignette = document.createElement('div')
  vignette.className = 'ambient-vignette'

  root.append(idle, frames[0], frames[1], veil, sheen, vignette)

  let front = 0
  let currentUrl: string | null = null

  const clear = (): void => {
    frames.forEach((frame) => frame.classList.remove('on'))
    root.classList.remove('has-art')
  }

  const setArtwork = (url: string | null): void => {
    if (url === currentUrl) return
    currentUrl = url
    if (!url) {
      clear()
      return
    }
    const img = new Image()
    img.decoding = 'async'
    img.addEventListener('load', () => {
      if (currentUrl !== url) return
      const next = front === 0 ? 1 : 0
      frames[next].style.backgroundImage = `url("${url}")`
      frames[next].classList.add('on')
      frames[front].classList.remove('on')
      front = next
      root.classList.add('has-art')
    })
    img.addEventListener('error', () => {
      if (currentUrl !== url) return
      clear()
    })
    img.src = url
  }

  return { root, setArtwork }
}

export function mountAmbient(): HTMLElement {
  const ambient = createAmbient()
  document.body.insertBefore(ambient.root, document.body.firstChild)

  let lastTrackId: number | null = null
  player.store.subscribe((state) => {
    const id = state.current?.id ?? null
    if (id === lastTrackId) return
    lastTrackId = id
    ambient.setArtwork(artworkUrl(state.current?.artwork_url ?? null, AMBIENT_SIZE))
  })

  return ambient.root
}
