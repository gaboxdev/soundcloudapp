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
    document.removeEventListener('keydown', onKeyDown, true)
    root.remove()
    options.onClose?.()
    previous?.focus?.()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  closeBtn.addEventListener('click', close)
  root.addEventListener('mousedown', (event) => {
    if (event.target === root) close()
  })
  document.addEventListener('keydown', onKeyDown, true)

  openModals += 1
  document.documentElement.classList.add('modal-open')
  document.body.appendChild(root)

  return { root, body, head, close }
}
