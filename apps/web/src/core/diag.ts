export interface CallSample {
  ruta: string
  ms: number
  ok: boolean
  cuando: number
}

const MAX_MUESTRAS = 25
const muestras: CallSample[] = []

export function recordCall(url: string, ms: number, ok: boolean): void {
  let ruta = url
  try {
    const parsed = new URL(url)
    ruta = `${parsed.pathname}${parsed.searchParams.has('q') ? '?q=…' : ''}`
  } catch {
    ruta = url.slice(0, 60)
  }
  muestras.unshift({ ruta: ruta.replace(/\d{5,}/g, '{id}'), ms: Math.round(ms), ok, cuando: Date.now() })
  if (muestras.length > MAX_MUESTRAS) muestras.length = MAX_MUESTRAS
}

export function calls(): CallSample[] {
  return [...muestras]
}

export function latency(): { n: number; mediana: number; peor: number; fallos: number } {
  if (muestras.length === 0) return { n: 0, mediana: 0, peor: 0, fallos: 0 }
  const ms = muestras.map((m) => m.ms).sort((a, b) => a - b)
  return {
    n: muestras.length,
    mediana: ms[Math.floor(ms.length / 2)],
    peor: ms[ms.length - 1],
    fallos: muestras.filter((m) => !m.ok).length,
  }
}

export function localStorageBytes(): number {
  let total = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      total += key.length + (localStorage.getItem(key)?.length ?? 0)
    }
  } catch {
    return 0
  }
  return total * 2
}

export async function cacheBytes(): Promise<{ nombres: string[]; estimado: number; cuota: number }> {
  let nombres: string[] = []
  try {
    if (typeof caches !== 'undefined') nombres = await caches.keys()
  } catch {
    nombres = []
  }
  let estimado = 0
  let cuota = 0
  try {
    const e = await navigator.storage?.estimate?.()
    estimado = e?.usage ?? 0
    cuota = e?.quota ?? 0
  } catch {
    estimado = 0
  }
  return { nombres, estimado, cuota }
}
