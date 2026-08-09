const W = 1200
const H = 80

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
    const value = Math.max(0.04, Math.min(1, samples[i] / 255))
    const half = Math.max(1, (value * H) / 2)
    parts.push(`M${x.toFixed(1)} ${(H / 2 - half).toFixed(1)}L${x.toFixed(1)} ${(H / 2 + half).toFixed(1)}`)
  }
  return parts.join('')
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

export function waveformEl(options: WaveformOptions = {}): WaveformController {
  const wrap = document.createElement('div')
  wrap.className = 'waveform loading'

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

  function ratioFromEvent(event: MouseEvent | PointerEvent): number {
    const rect = wrap.getBoundingClientRect()
    if (rect.width === 0) return 0
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  }

  if (options.interactive) {
    const move = (event: MouseEvent | PointerEvent) => {
      const rect = wrap.getBoundingClientRect()
      if (rect.width === 0) return
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      if (options.showHover) {
        hoverLine.style.left = `${ratio * 100}%`
        const duration = options.getDuration?.() ?? 0
        if (duration > 0) {
          hoverTime.textContent = fmt(ratio * duration)
          hoverTime.style.left = `${Math.min(96, Math.max(4, ratio * 100))}%`
        }
      }
    }
    wrap.addEventListener('pointermove', move)
    wrap.addEventListener('pointerleave', () => {
      if (options.showHover) {
        hoverLine.style.left = '-10%'
        hoverTime.style.left = '-10%'
      }
    })
    wrap.addEventListener('pointerdown', (event) => {
      if (wrap.classList.contains('loading')) return
      const ratio = ratioFromEvent(event)
      if (options.onSeek) options.onSeek(ratio)
    })
  }

  return {
    el: wrap,
    setSamples(samples) {
      wrap.classList.toggle('loading', !samples || samples.length === 0)
      const d = samples ? buildPath(samples) : ''
      bgPath.setAttribute('d', d)
      fgPath.setAttribute('d', d)
    },
    setProgress(ratio) {
      fg.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`
    },
    setLoading(loading) {
      wrap.classList.toggle('loading', loading)
    },
    destroy() {
      wrap.replaceChildren()
    },
  }
}
