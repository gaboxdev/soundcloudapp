export interface Route {
  view: string
  params: Record<string, string>
}

export type RouteHandler = (route: Route, container: HTMLElement) => void | Promise<void>

interface HistoryMark {
  slIndex?: number
}

const handlers = new Map<string, RouteHandler>()
const scrollPositions = new Map<string, number>()
const RESTORE_FRAMES = 40

let currentKey = ''
let historyIndex = 0
let restoreFrame = 0
let restoring = false
let scrollBound = false

function parse(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [pathPart, queryPart] = hash.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const view = segments[0] || 'home'
  const params: Record<string, string> = {}
  if (segments[1]) params.id = segments[1]
  if (segments[2]) params.sub = segments[2]
  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => {
      params[key] = value
    })
  }
  return { view, params }
}

export function register(view: string, handler: RouteHandler): void {
  handlers.set(view, handler)
}

export function queryString(params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return query ? `?${query}` : ''
}

export function link(path: string, params?: Record<string, string>): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `#${normalized}${params ? queryString(params) : ''}`
}

export function searchLink(q: string): string {
  return link('/search', { q })
}

export function navigate(path: string, params?: Record<string, string>): void {
  const target = link(path, params)
  if (window.location.hash === target) {
    render()
    return
  }
  window.location.hash = target
}

function scrollKey(): string {
  return window.location.hash || '#/'
}

function cancelRestore(): void {
  if (restoreFrame) window.cancelAnimationFrame(restoreFrame)
  restoreFrame = 0
  restoring = false
}

function bindScroll(): void {
  if (scrollBound) return
  scrollBound = true
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  window.addEventListener(
    'scroll',
    () => {
      if (!restoring) scrollPositions.set(currentKey, window.scrollY)
    },
    { passive: true },
  )
  window.addEventListener('wheel', cancelRestore, { passive: true })
  window.addEventListener('touchstart', cancelRestore, { passive: true })
  window.addEventListener('keydown', cancelRestore, { passive: true })
}

function restoreScroll(target: number): void {
  cancelRestore()
  restoring = true
  let attempts = 0
  const step = (): void => {
    window.scrollTo(0, target)
    attempts += 1
    if (attempts >= RESTORE_FRAMES || Math.abs(window.scrollY - target) <= 1) {
      cancelRestore()
      return
    }
    restoreFrame = window.requestAnimationFrame(step)
  }
  step()
}

function isRevisit(): boolean {
  const state = (window.history.state ?? null) as HistoryMark | null
  if (state && typeof state.slIndex === 'number') return true
  historyIndex += 1
  try {
    window.history.replaceState({ ...(state ?? {}), slIndex: historyIndex }, '')
  } catch {
    return false
  }
  return false
}

function syncScroll(): void {
  bindScroll()
  const key = scrollKey()
  const revisited = isRevisit()
  currentKey = key
  cancelRestore()
  const saved = scrollPositions.get(key)
  if (revisited && saved && saved > 0) {
    restoreScroll(saved)
    return
  }
  scrollPositions.set(key, 0)
  window.scrollTo(0, 0)
}

function notFoundEl(): HTMLElement {
  const box = document.createElement('div')
  box.className = 'page-error'
  box.innerHTML =
    '<h2>Página no encontrada</h2><p class="text-dim">Esa ruta no existe en SoundClear.</p><div><a class="btn btn-primary" href="#/">Volver al inicio</a></div>'
  return box
}

function showViewError(host: HTMLElement): void {
  if (!host.isConnected) return
  const box = document.createElement('div')
  box.className = 'page-error'
  const title = document.createElement('h2')
  title.textContent = 'No se pudo cargar esta página'
  const text = document.createElement('p')
  text.className = 'text-dim'
  text.textContent = 'Ha ocurrido un error inesperado. Comprueba tu conexión e inténtalo de nuevo.'
  const actions = document.createElement('div')
  const retry = document.createElement('button')
  retry.className = 'btn btn-primary'
  retry.textContent = 'Reintentar'
  retry.addEventListener('click', () => render())
  actions.appendChild(retry)
  box.append(title, text, actions)
  host.replaceChildren(box)
}

export function render(): void {
  const main = document.getElementById('view-outlet')
  if (!main) return
  const route = parse()
  syncScroll()
  main.classList.remove('view-enter')
  void main.offsetWidth
  main.classList.add('view-enter')

  const host = document.createElement('div')
  host.className = 'view-host'
  host.style.display = 'contents'
  main.replaceChildren(host)

  const handler = handlers.get(route.view)
  if (!handler) {
    host.appendChild(notFoundEl())
    return
  }
  try {
    const result = handler(route, host)
    if (result instanceof Promise) void result.catch(() => showViewError(host))
  } catch {
    showViewError(host)
  }
}

export function currentRoute(): Route {
  return parse()
}
