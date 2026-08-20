type Rgb = [number, number, number]

export interface AccentTone {
  accent: string
  accent2: string
  text: string
  textLight: string
}

const WHITE: Rgb = [255, 255, 255]
const AMBIENT_DARK: Rgb = [58, 58, 61]
const AMBIENT_LIGHT: Rgb = [209, 209, 211]
const STEP = 0.004
const STYLE_ID = 'sl-accent-tone'
const CSS_KEY = 'sl:accent-css'

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function linear(lightness: number, chroma: number, hue: number): Rgb {
  const rad = (hue * Math.PI) / 180
  const a = chroma * Math.cos(rad)
  const b = chroma * Math.sin(rad)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function encode(channel: number): number {
  const value = clamp01(channel)
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

function toRgb(lightness: number, chroma: number, hue: number): Rgb {
  const [r, g, b] = linear(lightness, chroma, hue)
  return [Math.round(encode(r) * 255), Math.round(encode(g) * 255), Math.round(encode(b) * 255)]
}

function inGamut(lightness: number, chroma: number, hue: number): boolean {
  return linear(lightness, chroma, hue).every((channel) => channel >= -0.001 && channel <= 1.001)
}

function maxChroma(lightness: number, hue: number): number {
  let low = 0
  let high = 0.4
  for (let i = 0; i < 20; i += 1) {
    const mid = (low + high) / 2
    if (inGamut(lightness, mid, hue)) low = mid
    else high = mid
  }
  return low
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const first = luminance(a)
  const second = luminance(b)
  return first > second ? (first + 0.05) / (second + 0.05) : (second + 0.05) / (first + 0.05)
}

function hex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function search(hue: number, from: number, to: number, scale: number, ok: (rgb: Rgb) => boolean): number {
  const steps = Math.round(Math.abs(to - from) / STEP)
  const delta = from < to ? STEP : -STEP
  for (let i = 0; i <= steps; i += 1) {
    const lightness = from + delta * i
    if (ok(toRgb(lightness, scale * maxChroma(lightness, hue), hue))) return lightness
  }
  return to
}

export function normalizeHue(value: unknown, fallback: number): number {
  const hue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(hue)) return fallback
  return ((Math.round(hue) % 360) + 360) % 360
}

export function toneTokens(hue: number): AccentTone {
  const base = search(hue, 0.72, 0.3, 0.96, (rgb) => contrast(rgb, WHITE) >= 4.6)
  const chroma = 0.96 * maxChroma(base, hue)
  const deep = base - 0.062
  const text = search(hue, 0.56, 0.95, 0.85, (rgb) => contrast(rgb, AMBIENT_DARK) >= 4.9)
  const light = search(hue, 0.62, 0.2, 0.9, (rgb) => contrast(rgb, AMBIENT_LIGHT) >= 4.9)
  return {
    accent: hex(toRgb(base, chroma, hue)),
    accent2: hex(toRgb(deep, Math.min(chroma, 0.96 * maxChroma(deep, hue)), hue)),
    text: hex(toRgb(text, 0.85 * maxChroma(text, hue), hue)),
    textLight: hex(toRgb(light, 0.9 * maxChroma(light, hue), hue)),
  }
}

export function toneCss(hue: number): string {
  const tone = toneTokens(hue)
  return (
    `:root[data-accent='tono']{--accent:${tone.accent};--accent2:${tone.accent2};` +
    `--accent-text:${tone.text};--wave-progress:${tone.text}}` +
    `:root[data-accent='tono'][data-theme='light']{--accent-text:${tone.textLight};--wave-progress:${tone.textLight}}`
  )
}

export function applyTone(hue: number): void {
  const css = toneCss(hue)
  let style = document.getElementById(STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  if (style.textContent !== css) style.textContent = css
  try {
    localStorage.setItem(CSS_KEY, css)
  } catch {}
}
