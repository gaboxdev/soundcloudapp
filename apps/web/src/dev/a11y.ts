export interface A11yFinding {
  tipo: 'sin-nombre' | 'objetivo-pequeño' | 'img-sin-alt' | 'id-duplicado' | 'sin-region-viva'
  selector: string
  detalle: string
}

const INTERACTIVOS =
  'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])'
const OBJETIVO_MIN = 24

function selectorDe(el: Element): string {
  const clases = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''
  return `${el.tagName.toLowerCase()}${clases ? `.${clases}` : ''}`
}

function visible(el: HTMLElement): boolean {
  const cs = getComputedStyle(el)
  if (cs.display === 'none' || cs.visibility === 'hidden') return false
  if (el.closest('[hidden]')) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0
}

function nombreDe(el: HTMLElement): string {
  const partes = [
    el.getAttribute('aria-label'),
    el.getAttribute('title'),
    el.textContent,
    el.getAttribute('alt'),
    el.getAttribute('aria-labelledby') ? 'aria-labelledby' : '',
    el.getAttribute('placeholder'),
  ]
  for (const parte of partes) {
    const valor = (parte ?? '').trim()
    if (valor) return valor
  }
  return ''
}

function esEnlaceEnLinea(el: HTMLElement): boolean {
  return el.tagName === 'A' && (el.classList.contains('title') || el.classList.contains('artist') || el.classList.contains('link-hover'))
}

export function auditA11y(): A11yFinding[] {
  const hallazgos: A11yFinding[] = []
  for (const el of document.querySelectorAll<HTMLElement>(INTERACTIVOS)) {
    if (el.getAttribute('aria-hidden') === 'true') continue
    const enFila = el.closest('.track-row') !== null
    if (!visible(el) && !enFila) continue
    if (!nombreDe(el)) {
      hallazgos.push({ tipo: 'sin-nombre', selector: selectorDe(el), detalle: el.outerHTML.slice(0, 70) })
    }
    const rect = el.getBoundingClientRect()
    const lado = Math.min(rect.width, rect.height)
    if (lado > 0 && lado < OBJETIVO_MIN && !esEnlaceEnLinea(el)) {
      hallazgos.push({
        tipo: 'objetivo-pequeño',
        selector: selectorDe(el),
        detalle: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      })
    }
  }
  for (const img of document.querySelectorAll('img')) {
    if (!img.hasAttribute('alt')) hallazgos.push({ tipo: 'img-sin-alt', selector: 'img', detalle: img.currentSrc.slice(-30) })
  }
  const repetidos = new Map<string, number>()
  for (const el of document.querySelectorAll('[id]')) repetidos.set(el.id, (repetidos.get(el.id) ?? 0) + 1)
  for (const [id, veces] of repetidos) {
    if (veces > 1) hallazgos.push({ tipo: 'id-duplicado', selector: `#${id}`, detalle: `${veces} veces` })
  }
  if (document.querySelectorAll('[aria-live]').length === 0) {
    hallazgos.push({ tipo: 'sin-region-viva', selector: 'document', detalle: 'nadie anuncia los cambios de track' })
  }
  return hallazgos
}

export async function auditRoutes(rutas: string[] = []): Promise<Record<string, string | A11yFinding[]>> {
  const objetivo = rutas.length > 0 ? rutas : [
    '#/home',
    '#/charts',
    '#/search?q=jazz',
    '#/likes',
    '#/queue',
    '#/now',
    '#/settings',
    '#/feed',
  ]
  const salida: Record<string, string | A11yFinding[]> = {}
  for (const ruta of objetivo) {
    location.hash = ruta
    await new Promise((resolve) => window.setTimeout(resolve, 1600))
    const hallazgos = auditA11y()
    salida[ruta] = hallazgos.length === 0 ? 'limpio' : hallazgos
  }
  return salida
}
