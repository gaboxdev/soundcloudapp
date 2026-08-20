
type Child = Node | string | number | null | undefined | false

interface Attrs {
  [key: string]: unknown
  className?: string
  onclick?: (event: MouseEvent) => void
  oninput?: (event: Event) => void
  onchange?: (event: Event) => void
  onsubmit?: (event: SubmitEvent) => void
  onkeydown?: (event: KeyboardEvent) => void
  onerror?: (event: Event) => void
  onload?: (event: Event) => void
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  children?: Child | Child[],
): HTMLElementTagNameMap[K]

export function h(tag: string, attrs?: Attrs | null, children?: Child | Child[]): HTMLElement {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue
      if (key === 'className') {
        el.className = String(value)
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value)
      } else if (key === 'dataset' && typeof value === 'object') {
        Object.assign(el.dataset, value)
      } else {
        el.setAttribute(key, String(value))
      }
    }
  }
  append(el, children)
  return el
}

export function append(parent: Node, children?: Child | Child[]): void {
  if (children === undefined || children === null || children === false) return
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child)
    return
  }
  if (typeof children === 'string' || typeof children === 'number') {
    parent.appendChild(document.createTextNode(String(children)))
  } else {
    parent.appendChild(children)
  }
}

export function svgIcon(name: string, size = 20): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ''}</svg>`
}

const ICON_PATHS: Record<string, string> = {
  play: '<path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  next: '<path d="M5 5l10 7-10 7V5Z"/><rect x="17" y="4" width="3" height="16" rx="1"/>',
  prev: '<path d="M19 5l-10 7 10 7V5Z"/><rect x="4" y="4" width="3" height="16" rx="1"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  repeatOne: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9.5 9.5 0 0 1 0 14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
  heartFill: '<path fill="currentColor" stroke="none" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  queue: '<path d="M4 7h11"/><path d="M4 12h11"/><path d="M4 17h7"/><path d="m15 13.5 6 3.5-6 3.5Z"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16v-5"/><path d="M12 16V8"/><path d="M17 16v-3"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  settings: '<path d="M4 8h8.5"/><path d="M17.5 8H20"/><circle cx="15" cy="8" r="2.5"/><path d="M4 16h2.5"/><path d="M11.5 16H20"/><circle cx="9" cy="16" r="2.5"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  forward: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  playlist: '<path d="M4 7h12"/><path d="M4 12h8"/><path d="M4 17h8"/><path d="M20 16.5V6l-4 1.2"/><circle cx="17.5" cy="16.5" r="2.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 9 9"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16.5V11.5"/><path d="M12 8h.01"/>',
  headphone: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M3 14h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M21 14h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  repost: '<path d="m16 3 4 4-4 4"/><path d="M20 7H9a5 5 0 0 0-5 5"/><path d="m8 21-4-4 4-4"/><path d="M4 17h11a5 5 0 0 0 5-5"/>',
  expand: '<path d="M15 3h6v6"/><path d="m14 10 7-7"/><path d="M9 21H3v-6"/><path d="m10 14-7 7"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7"/><path d="M15.5 15.5a5 5 0 0 0 0-7"/><path d="M5.5 5.5a9 9 0 0 0 0 13"/><path d="M18.5 18.5a9 9 0 0 0 0-13"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z"/>',
  waves: '<path d="M2 8c2.5-3 5.5-3 8 0s5.5 3 8 0l4-2"/><path d="M2 15c2.5-3 5.5-3 8 0s5.5 3 8 0l4-2"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3.5 6h.01"/><path d="M3.5 12h.01"/><path d="M3.5 18h.01"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  filter: '<path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6Z"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  speed: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="m12 14 4.5-4.5"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/>',
  tag: '<path d="M20.6 12.6 12 21.2l-8.6-8.6V4.4h8.2Z"/><path d="M7.5 8h.01"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M7 14h10"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 4v5h-5"/>',
  trend: '<path d="M3 17 9.5 10.5l3.5 3.5L21 6"/><path d="M21 12V6h-6"/>',
  command: '<path d="M8 8V6.5a2.5 2.5 0 1 0-2.5 2.5H8Zm0 0h8m-8 0v8m8-8V6.5A2.5 2.5 0 1 1 18.5 9H16Zm0 7v1.5a2.5 2.5 0 1 0 2.5-2.5H16Zm0 0H8m0 0v1.5A2.5 2.5 0 1 1 5.5 15H8Z"/>',
}

export function iconEl(name: string, size = 20): HTMLElement {
  const wrap = document.createElement('span')
  wrap.innerHTML = svgIcon(name, size)
  wrap.style.display = 'inline-flex'
  return wrap
}

export function titleIcon(name: string, size = 22): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'title-icon'
  wrap.innerHTML = svgIcon(name, size)
  return wrap
}

export function iconChip(icon: string, label: string, active = false): HTMLButtonElement {
  const chip = h('button', { className: active ? 'chip active' : 'chip', type: 'button' })
  chip.append(iconEl(icon, 15), h('span', { className: 'btn-label' }, label))
  return chip
}

export function labelBtn(className: string, icon: string, label: string): { btn: HTMLButtonElement; label: HTMLElement } {
  const btn = h('button', { className, type: 'button' })
  const text = h('span', { className: 'btn-label' }, label)
  btn.append(iconEl(icon, 15), text)
  return { btn, label: text }
}

export function fmtHtml(template: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.innerHTML = template.trim()
  return wrap.firstElementChild as HTMLElement
}
