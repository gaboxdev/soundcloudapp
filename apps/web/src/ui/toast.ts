export type ToastKind = 'info' | 'ok' | 'err'

let wrap: HTMLElement | null = null
const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>()

function ensureWrap(): HTMLElement {
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.className = 'toast-wrap'
    wrap.setAttribute('role', 'status')
    wrap.setAttribute('aria-live', 'polite')
    document.body.appendChild(wrap)
  }
  return wrap
}

function schedule(el: HTMLElement, duration: number): void {
  const previous = timers.get(el)
  if (previous) clearTimeout(previous)
  timers.set(
    el,
    setTimeout(() => {
      timers.delete(el)
      el.remove()
    }, duration),
  )
}

export function toast(message: string, kind: ToastKind = 'info', duration = 2600): void {
  const host = ensureWrap()
  const last = host.lastElementChild
  if (last instanceof HTMLElement && last.textContent === message) {
    last.classList.remove('toast-again')
    void last.offsetWidth
    last.classList.add('toast-again')
    schedule(last, duration)
    return
  }
  const el = document.createElement('div')
  el.className = `toast ${kind === 'info' ? '' : kind}`
  el.textContent = message
  host.appendChild(el)
  schedule(el, duration)
  el.addEventListener('click', () => {
    const timer = timers.get(el)
    if (timer) clearTimeout(timer)
    el.remove()
  })
}

export const toastOK = (message: string): void => toast(message, 'ok')
export const toastErr = (message: string): void => toast(message, 'err')
