export function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function fmtTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function fmtCount(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'ahora mismo'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `hace ${days} d`
  const months = Math.floor(days / 30)
  if (months < 12) return `hace ${months} mes${months > 1 ? 'es' : ''}`
  const years = Math.floor(months / 12)
  return `hace ${years} año${years > 1 ? 's' : ''}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
}

const ARTWORK_SIZE = /-(t\d{2,4}x\d{2,4}|original|large|badge|small|mini|tiny)(\.\w+)$/

export function artworkUrl(url: string | null | undefined, size = 't500x500'): string | null {
  if (!url) return null
  const match = url.match(ARTWORK_SIZE)
  if (match) return url.replace(match[0], `-${size}${match[2]}`)
  return url
}

export function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = [...parts[0]]
  if (parts.length === 1) return first.slice(0, 2).join('').toUpperCase()
  const second = [...parts[1]]
  return (first[0] + second[0]).toUpperCase()
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args: A) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (mb < 1024) return `${mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)} MB`
  return `${Math.round((mb / 1024) * 10) / 10} GB`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function shuffle<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
