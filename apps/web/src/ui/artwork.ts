import type { Track } from '@soundclear/api'
import { artworkUrl, initials } from '../core/utils'

export interface ArtworkOptions {
  size?: string
  title?: string
  blur?: boolean
}

export function artEl(url: string | null, label: string, opts: ArtworkOptions = {}): HTMLElement {
  const frame = document.createElement('div')
  frame.className = 'art-frame'
  const fallback = document.createElement('div')
  fallback.className = 'art-fallback'
  fallback.textContent = initials(label)
  frame.appendChild(fallback)
  const src = artworkUrl(url, opts.size ?? 't500x500')
  if (src) {
    const img = new Image()
    img.loading = 'lazy'
    img.decoding = 'async'
    if (opts.blur) img.classList.add('art-blur')
    img.alt = ''
    img.addEventListener('load', () => img.classList.add('loaded'))
    img.src = src
    frame.appendChild(img)
  }
  return frame
}

export function avatarEl(url: string | null, label: string, size = 40): HTMLElement {
  const el = document.createElement('div')
  el.className = 'avatar'
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;position:relative;flex-shrink:0;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--text2);`
  el.style.setProperty('--avatar-size', `${size}px`)
  el.textContent = initials(label)
  const src = artworkUrl(url, 't120x120')
  if (src) {
    const img = new Image()
    img.loading = 'lazy'
    img.decoding = 'async'
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;'
    img.alt = ''
    img.addEventListener('load', () => {
      el.textContent = ''
      el.appendChild(img)
    })
    img.src = src
  }
  return el
}

export function trackArtwork(track: Track, opts: ArtworkOptions = {}): HTMLElement {
  return artEl(track.artwork_url, track.title, opts)
}
