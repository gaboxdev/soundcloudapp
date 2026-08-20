import type { Track } from '@soundclear/api'
import { artworkUrl, initials } from '../core/utils'
import { svgIcon } from './el'

export interface ArtworkOptions {
  size?: string
  title?: string
  href?: string
}

export function artEl(url: string | null, label: string, opts: ArtworkOptions = {}): HTMLElement {
  const frame = document.createElement(opts.href ? 'a' : 'div')
  frame.className = 'art-frame'
  if (opts.href) {
    ;(frame as HTMLAnchorElement).href = opts.href
    frame.classList.add('art-open')
  }
  if (opts.title) frame.title = opts.title
  const fallback = document.createElement('div')
  fallback.className = 'art-fallback'
  fallback.textContent = initials(label)
  frame.appendChild(fallback)
  const src = artworkUrl(url, opts.size ?? 't500x500')
  if (src) {
    const img = new Image()
    img.loading = 'lazy'
    img.decoding = 'async'
    img.alt = ''
    frame.classList.add('art-loading')
    img.addEventListener('load', () => {
      img.classList.add('loaded')
      frame.classList.remove('art-loading')
    })
    img.addEventListener('error', () => frame.classList.remove('art-loading'))
    img.src = src
    frame.appendChild(img)
  }
  return frame
}

export function artOverlay(icon = 'expand', size = 18): HTMLElement {
  const overlay = document.createElement('div')
  overlay.className = 'art-overlay'
  overlay.innerHTML = svgIcon(icon, size)
  return overlay
}

export function avatarEl(url: string | null, label: string, size = 40): HTMLElement {
  const el = document.createElement('div')
  el.className = 'avatar'
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;position:relative;flex-shrink:0;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--text2);`
  el.style.setProperty('--avatar-size', `${size}px`)
  el.textContent = initials(label)
  const src = artworkUrl(url, size > 60 ? 't300x300' : 't120x120')
  if (src) {
    const img = new Image()
    img.decoding = 'async'
    img.alt = ''
    el.classList.add('art-loading')
    img.addEventListener('load', () => {
      img.classList.add('loaded')
      el.classList.remove('art-loading')
    })
    img.addEventListener('error', () => el.classList.remove('art-loading'))
    img.src = src
    el.appendChild(img)
  }
  return el
}

export function trackArtwork(track: Track, opts: ArtworkOptions = {}): HTMLElement {
  return artEl(track.artwork_url, track.title, opts)
}
