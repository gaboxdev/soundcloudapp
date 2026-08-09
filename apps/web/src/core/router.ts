export interface Route {
  view: string
  params: Record<string, string>
}

export type RouteHandler = (route: Route, container: HTMLElement) => void | Promise<void>

const handlers = new Map<string, RouteHandler>()

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

export function navigate(path: string): void {
  if (window.location.hash === `#${path}` || window.location.hash === `#/${path.replace(/^\//, '')}`) {
    render()
    return
  }
  window.location.hash = path.startsWith('/') ? `#${path}` : `#/${path}`
}

export function render(): void {
  const route = parse()
  const main = document.getElementById('view-outlet')
  if (!main) return
  main.classList.remove('view-enter')
  void main.offsetWidth
  main.classList.add('view-enter')
  const handler = handlers.get(route.view)
  if (!handler) {
    main.innerHTML = ''
    const notFound = document.createElement('div')
    notFound.className = 'page-error'
    notFound.innerHTML = '<h2>Página no encontrada</h2><p class="text-dim">Esa ruta no existe en Soundlite.</p><div><a class="btn btn-primary" href="#/">Volver al inicio</a></div>'
    main.appendChild(notFound)
    return
  }
  main.innerHTML = ''
  void handler(route, main)
}

export function currentRoute(): Route {
  return parse()
}

export function link(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`
}
