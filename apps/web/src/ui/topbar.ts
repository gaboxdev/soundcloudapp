import { isDesktop } from '../api/auth'

const SCROLL_STEP = 6
const TOP_ZONE = 4

export function mountTopbar(header: HTMLElement): HTMLElement {
  const edge = document.createElement('div')
  edge.className = 'topbar-edge'
  if (isDesktop()) edge.setAttribute('data-tauri-drag-region', '')

  let lastY = Math.max(0, window.scrollY)
  let scrolledAway = false
  let hovering = false
  let focused = false

  const mode = (): string => document.documentElement.dataset.topbar ?? 'fija'

  const paint = (): void => {
    const current = mode()
    const hidden =
      current === 'oculta' ? !hovering && !focused : current === 'auto' ? scrolledAway && !hovering && !focused : false
    header.classList.toggle('topbar-off', hidden)
  }

  const onScroll = (): void => {
    const y = Math.max(0, window.scrollY)
    const delta = y - lastY
    if (y <= TOP_ZONE) scrolledAway = false
    else if (delta > SCROLL_STEP) scrolledAway = true
    else if (delta < -SCROLL_STEP) scrolledAway = false
    lastY = y
    paint()
  }

  const setHover = (on: boolean): void => {
    if (hovering === on) return
    hovering = on
    paint()
  }

  edge.addEventListener('pointerenter', () => setHover(true))
  edge.addEventListener('pointerleave', () => {
    if (!header.matches(':hover')) setHover(false)
  })
  header.addEventListener('pointerenter', () => setHover(true))
  header.addEventListener('pointerleave', () => {
    if (!edge.matches(':hover')) setHover(false)
  })
  header.addEventListener('focusin', () => {
    focused = true
    paint()
  })
  header.addEventListener('focusout', () => {
    focused = false
    paint()
  })

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('hashchange', () => {
    lastY = 0
    scrolledAway = false
    paint()
  })
  new MutationObserver(paint).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-topbar'],
  })

  paint()
  return edge
}
