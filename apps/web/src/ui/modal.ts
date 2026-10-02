import { h, svgIcon } from './el'
import { t } from '../core/i18n.ts'

export interface ModalOptions {
  title: string
  className?: string
  labelledBy?: string
  onClose?: () => void
}

export interface Modal {
  root: HTMLElement
  body: HTMLElement
  head: HTMLElement
  close(): void
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let openModals = 0

export function trapFocus(panel: HTMLElement, onEscape: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((node) => !node.hidden && node.getClientRects().length > 0)
    if (dialogs.at(-1) !== panel) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      onEscape()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !node.closest('[hidden], [inert]') && node.getClientRects().length > 0)
    if (!items.length) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const outside = !panel.contains(document.activeElement)
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || outside)) {
      event.preventDefault()
      first.focus()
    }
  }
  document.addEventListener('keydown', onKeyDown, true)
  return () => document.removeEventListener('keydown', onKeyDown, true)
}

export function openModal(options: ModalOptions): Modal {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

  const root = h('div', { className: `sl-modal${options.className ? ` ${options.className}` : ''}`, role: 'presentation' })
  const panel = h('div', {
    className: 'sl-modal-panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': options.title,
  })

  const head = h('div', { className: 'sl-modal-head' }, [h('h2', { className: 'sl-modal-title' }, options.title)])
  const closeBtn = h('button', { className: 'icon-btn', type: 'button', title: t('Cerrar'), 'aria-label': t('Cerrar') })
  closeBtn.innerHTML = svgIcon('close', 18)
  head.appendChild(closeBtn)

  const body = h('div', { className: 'sl-modal-body' })
  panel.append(head, body)
  root.appendChild(panel)

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    openModals = Math.max(0, openModals - 1)
    if (openModals === 0) document.documentElement.classList.remove('modal-open')
    releaseFocus()
    root.remove()
    options.onClose?.()
    previous?.focus?.()
  }

  const releaseFocus = trapFocus(panel, close)

  closeBtn.addEventListener('click', close)
  root.addEventListener('mousedown', (event) => {
    if (event.target === root) close()
  })

  openModals += 1
  document.documentElement.classList.add('modal-open')
  document.body.appendChild(root)
  window.requestAnimationFrame(() => {
    if (!closed && !panel.contains(document.activeElement)) closeBtn.focus()
  })

  return { root, body, head, close }
}
