const W = 1200
const H = 80
const PLACEHOLDER_BARS = 120
const PLACEHOLDER_VALUE = 0.1

export interface WaveformOptions {
  interactive?: boolean
  showHover?: boolean
  getDuration?: () => number
  onSeek?: (ratio: number) => void
}

export interface WaveformController {
  el: HTMLElement
  setSamples(samples: number[] | null): void
  setProgress(ratio: number): void
  setLoading(loading: boolean): void
  destroy(): void
}

function buildPath(samples: number[]): string {
  if (samples.length === 0) return ''
  const step = W / samples.length
  const parts: string[] = []
  for (let i = 0; i < samples.length; i++) {
    const x = i * step
    const value = Math.max(0.04, Math.min(1, samples[i]))
    const half = Math.max(1, (value * H) / 2)
    parts.push(`M${x.toFixed(1)} ${(H / 2 - half).toFixed(1)}L${x.toFixed(1)} ${(H / 2 + half).toFixed(1)}`)
  }
  return parts.join('')
}

function placeholderPath(): string {
  return buildPath(new Array<number>(PLACEHOLDER_BARS).fill(PLACEHOLDER_VALUE))
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

export function waveformEl(options: WaveformOptions = {}): WaveformController {
  const wrap = document.createElement('div')
  wrap.className = 'waveform loading skeleton'

  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.classList.add('wave-bg')
  wrap.appendChild(svg)

  const fg = svg.cloneNode() as SVGSVGElement
  fg.classList.remove('wave-bg')
  fg.classList.add('wave-fg')
  wrap.appendChild(fg)

  const bgPath = document.createElementNS(ns, 'path')
  bgPath.setAttribute('stroke', 'var(--wave)')
  bgPath.setAttribute('stroke-width', '2.5')
  svg.appendChild(bgPath)

  const fgPath = document.createElementNS(ns, 'path')
  fgPath.setAttribute('stroke', 'var(--wave-progress)')
  fgPath.setAttribute('stroke-width', '2.5')
  fg.appendChild(fgPath)

  const hoverLine = document.createElement('div')
  hoverLine.className = 'wave-hover'
  hoverLine.style.left = '-10%'
  const hoverTime = document.createElement('div')
  hoverTime.className = 'wave-time'
  hoverTime.style.left = '-10%'

  if (options.showHover) {
    wrap.appendChild(hoverLine)
    wrap.appendChild(hoverTime)
  }

  let lastPercent = -1

  function applyProgress(ratio: number): void {
    const clamped = Math.min(1, Math.max(0, ratio))
    const percent = Math.round(clamped * 1000) / 10
    if (percent === lastPercent) return
    lastPercent = percent
    fg.style.setProperty('--wave-p', `${percent}%`)
  }

  function setLoadingState(loading: boolean): void {
    wrap.classList.toggle('loading', loading)
    wrap.classList.toggle('skeleton', loading)
  }

  function ratioFromEvent(event: PointerEvent): number {
    const rect = wrap.getBoundingClientRect()
    if (rect.width === 0) return 0
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  }

  applyProgress(0)

  if (options.interactive) {
    let scrubbing = false

    const showHoverAt = (ratio: number): void => {
      if (!options.showHover) return
      hoverLine.style.left = `${ratio * 100}%`
      const duration = options.getDuration?.() ?? 0
      if (duration > 0) {
        hoverTime.textContent = fmt(ratio * duration)
        hoverTime.style.left = `${Math.min(96, Math.max(4, ratio * 100))}%`
      }
    }

    const hideHover = (): void => {
      if (!options.showHover) return
      hoverLine.style.left = '-10%'
      hoverTime.style.left = '-10%'
    }

    const seekFromEvent = (event: PointerEvent): void => {
      const ratio = ratioFromEvent(event)
      applyProgress(ratio)
      options.onSeek?.(ratio)
    }

    const endScrub = (event: PointerEvent): void => {
      if (!scrubbing) return
      scrubbing = false
      wrap.classList.remove('scrubbing')
      if (wrap.hasPointerCapture(event.pointerId)) wrap.releasePointerCapture(event.pointerId)
      seekFromEvent(event)
    }

    wrap.addEventListener('pointermove', (event) => {
      const rect = wrap.getBoundingClientRect()
      if (rect.width === 0) return
      showHoverAt(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)))
      if (scrubbing) seekFromEvent(event)
    })

    wrap.addEventListener('pointerleave', () => {
      if (!scrubbing) hideHover()
    })

    wrap.addEventListener('pointerdown', (event) => {
      if (event.button > 0) return
      if (wrap.classList.contains('loading')) return
      event.preventDefault()
      scrubbing = true
      wrap.classList.add('scrubbing')
      wrap.setPointerCapture(event.pointerId)
      seekFromEvent(event)
    })

    wrap.addEventListener('pointerup', endScrub)
    wrap.addEventListener('pointercancel', endScrub)
  }

  return {
    el: wrap,
    setSamples(samples) {
      const hasData = samples !== null && samples.length > 0
      const d = hasData ? buildPath(samples) : placeholderPath()
      bgPath.setAttribute('d', d)
      fgPath.setAttribute('d', d)
      wrap.classList.toggle('wave-empty', !hasData)
      setLoadingState(false)
    },
    setProgress(ratio) {
      applyProgress(ratio)
    },
    setLoading(loading) {
      setLoadingState(loading)
    },
    destroy() {
      wrap.replaceChildren()
    },
  }
}
