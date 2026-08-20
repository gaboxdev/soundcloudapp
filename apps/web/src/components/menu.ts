import { h, svgIcon } from '../ui/el'
import { t } from '../core/i18n.ts'

export interface MenuItem {
  label: string
  icon?: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export type MenuEntry = MenuItem | 'separator'

interface MenuAnchor {
  x: number
  y: number
}

const MARGIN = 8
const MENU_WIDTH = 232

let current: { root: HTMLElement; close: () => void } | null = null

export function closeMenu(): void {
  current?.close()
}

function place(panel: HTMLElement, anchor: MenuAnchor): void {
  const rect = panel.getBoundingClientRect()
  const width = rect.width || MENU_WIDTH
  const height = rect.height
  const left = Math.min(Math.max(MARGIN, anchor.x), window.innerWidth - width - MARGIN)
  const fitsBelow = anchor.y + height + MARGIN <= window.innerHeight
  const top = fitsBelow ? anchor.y : Math.max(MARGIN, anchor.y - height)
  panel.style.left = `${Math.round(left)}px`
  panel.style.top = `${Math.round(top)}px`
}

export function openMenu(entries: MenuEntry[], target: MenuAnchor | HTMLElement): void {
  closeMenu()
  const items = entries.filter((entry): entry is MenuItem => entry !== 'separator')
  if (items.length === 0) return

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const root = h('div', { className: 'menu-layer', role: 'presentation' })
  const panel = h('div', { className: 'menu card', role: 'menu', 'aria-label': t('Acciones') })
  const buttons: HTMLButtonElement[] = []

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    current = null
    document.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('resize', close)
    window.removeEventListener('scroll', close, true)
    root.remove()
    previous?.focus?.()
  }

  const focusAt = (index: number): void => {
    if (buttons.length === 0) return
    const next = (index + buttons.length) % buttons.length
    buttons[next].focus()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusAt(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAt(buttons.length - 1)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      focusAt(index + (event.shiftKey ? -1 : 1))
    }
  }

  for (const entry of entries) {
    if (entry === 'separator') {
      panel.appendChild(h('div', { className: 'menu-sep', role: 'separator' }))
      continue
    }
    const button = h('button', {
      className: `menu-item${entry.danger ? ' danger' : ''}`,
      type: 'button',
      role: 'menuitem',
      disabled: entry.disabled === true,
    }) as HTMLButtonElement
    const icon = h('span', { className: 'menu-icon' })
    icon.innerHTML = svgIcon(entry.icon ?? 'music', 17)
    button.append(icon, h('span', { className: 'menu-label truncate' }, entry.label))
    if (entry.hint) button.appendChild(h('span', { className: 'menu-hint' }, entry.hint))
    if (entry.disabled !== true) {
      button.addEventListener('click', () => {
        close()
        entry.onSelect()
      })
      buttons.push(button)
    }
    panel.appendChild(button)
  }

  root.appendChild(panel)
  root.addEventListener('mousedown', (event) => {
    if (!panel.contains(event.target as Node)) close()
  })
  root.addEventListener('contextmenu', (event) => {
    if (!panel.contains(event.target as Node)) {
      event.preventDefault()
      close()
    }
  })
  document.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('resize', close)
  window.addEventListener('scroll', close, true)
  document.body.appendChild(root)

  const anchor =
    target instanceof HTMLElement
      ? (() => {
          const rect = target.getBoundingClientRect()
          return { x: rect.right - MENU_WIDTH, y: rect.bottom + 6 }
        })()
      : target
  place(panel, anchor)
  current = { root, close }
  buttons[0]?.focus()
}
