export interface VirtualListOptions {
  row: (index: number) => HTMLElement
  rowHeight?: number
  gap?: number
  overscan?: number
}

export interface VirtualList {
  el: HTMLElement
  setCount(count: number): void
  refresh(): void
  mountedCount(): number
  destroy(): void
}

const DEFAULT_ROW_HEIGHT = 60
const DEFAULT_GAP = 2
const DEFAULT_OVERSCAN = 6

export function virtualList(options: VirtualListOptions): VirtualList {
  const gap = options.gap ?? DEFAULT_GAP
  const overscan = options.overscan ?? DEFAULT_OVERSCAN
  const el = document.createElement('div')
  el.className = 'vlist'

  const mounted = new Map<number, HTMLElement>()
  let rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT
  let measured = false
  let count = 0
  let frame = 0
  let destroyed = false
  let attached = false

  const stride = (): number => rowHeight + gap

  const setHeight = (): void => {
    el.style.height = count === 0 ? '0px' : `${count * stride() - gap}px`
  }

  const measure = (): void => {
    if (measured) return
    const first = mounted.values().next().value
    if (!first) return
    const height = first.offsetHeight
    if (height > 0 && Math.abs(height - rowHeight) > 0.5) {
      rowHeight = height
      setHeight()
      schedule()
    }
    if (height > 0) measured = true
  }

  const mount = (index: number): void => {
    if (mounted.has(index)) return
    const node = options.row(index)
    node.classList.add('vlist-row')
    node.style.top = `${index * stride()}px`
    node.dataset.vindex = String(index)
    let before: HTMLElement | null = null
    for (const [other, otherNode] of mounted) {
      if (other > index && (before === null || other < Number(before.dataset.vindex))) before = otherNode
    }
    el.insertBefore(node, before)
    mounted.set(index, node)
  }

  const unmount = (index: number): void => {
    const node = mounted.get(index)
    if (!node) return
    if (node.contains(document.activeElement)) return
    node.remove()
    mounted.delete(index)
  }

  const paint = (): void => {
    if (destroyed) return
    if (!el.isConnected) {
      if (attached) destroy()
      return
    }
    attached = true
    const rect = el.getBoundingClientRect()
    const viewport = window.innerHeight || document.documentElement.clientHeight
    const firstVisible = Math.floor((-rect.top - gap) / stride())
    const visibleRows = Math.ceil(viewport / stride())
    const start = Math.max(0, firstVisible - overscan)
    const end = Math.min(count - 1, firstVisible + visibleRows + overscan)

    for (const index of [...mounted.keys()]) {
      if (index < start || index > end || index >= count) unmount(index)
    }
    for (let index = start; index <= end; index++) mount(index)
    measure()
  }

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    if (frame) window.cancelAnimationFrame(frame)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onResize)
    densityWatcher.disconnect()
    mounted.clear()
    el.replaceChildren()
  }

  const schedule = (): void => {
    if (destroyed || frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      paint()
    })
  }

  const onScroll = (): void => schedule()
  const onResize = (): void => {
    measured = false
    schedule()
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize)

  const densityWatcher = new MutationObserver(() => {
    measured = false
    for (const index of [...mounted.keys()]) unmount(index)
    schedule()
  })
  densityWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] })

  return {
    el,
    setCount(next: number): void {
      count = next
      for (const index of [...mounted.keys()]) unmount(index)
      setHeight()
      paint()
    },
    refresh(): void {
      for (const index of [...mounted.keys()]) unmount(index)
      measured = false
      paint()
    },
    mountedCount(): number {
      return mounted.size
    },
    destroy,
  }
}
