export type ToastKind = 'info' | 'ok' | 'err'

let wrap: HTMLElement | null = null

function ensureWrap(): HTMLElement {
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.className = 'toast-wrap'
    document.body.appendChild(wrap)
  }
  return wrap
}

export function toast(message: string, kind: ToastKind = 'info', duration = 2600): void {
  const el = document.createElement('div')
  el.className = `toast ${kind === 'info' ? '' : kind}`
  el.textContent = message
  ensureWrap().appendChild(el)
  const remove = () => el.remove()
  setTimeout(remove, duration)
  el.addEventListener('click', remove)
}

export const toastOK = (message: string): void => toast(message, 'ok')
export const toastErr = (message: string): void => toast(message, 'err')
