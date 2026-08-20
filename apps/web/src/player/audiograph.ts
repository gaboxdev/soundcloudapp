export interface EqBand {
  type: BiquadFilterType
  freq: number
  q: number
  label: string
}

export interface EqPreset {
  id: string
  label: string
  gains: readonly number[]
}

export const EQ_BANDS: readonly EqBand[] = [
  { type: 'lowshelf', freq: 60, q: 0.7, label: '60' },
  { type: 'peaking', freq: 250, q: 0.9, label: '250' },
  { type: 'peaking', freq: 1000, q: 0.9, label: '1k' },
  { type: 'peaking', freq: 4000, q: 0.9, label: '4k' },
  { type: 'highshelf', freq: 12000, q: 0.7, label: '12k' },
]

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 'plano', label: 'Plano', gains: [0, 0, 0, 0, 0] },
  { id: 'realce', label: 'Realce', gains: [4, 1, -1, 2, 4] },
  { id: 'graves', label: 'Graves', gains: [7, 3, 0, -1, -2] },
  { id: 'voz', label: 'Voz', gains: [-3, 0, 3, 3, 0] },
  { id: 'agudos', label: 'Agudos', gains: [-2, -1, 0, 3, 6] },
  { id: 'cinta', label: 'Cinta', gains: [3, 1, -2, -3, -6] },
]

export const EQ_MAX_DB = 12
export const CROSSFADE_MAX_S = 12

const LIMITER_DRIVE = 1.6
const LIMITER_TRIM = 1.25
const LIMITER_CURVE_POINTS = 2048
const RAMP_S = 0.04

const FADE_POINTS = 65
const FADE_FLOOR = 0.0001

let fadeCurves: { out: Float32Array<ArrayBuffer>; enter: Float32Array<ArrayBuffer> } | null = null

export function equalPowerCurves(): { out: Float32Array<ArrayBuffer>; enter: Float32Array<ArrayBuffer> } {
  if (fadeCurves) return fadeCurves
  const out = new Float32Array(new ArrayBuffer(FADE_POINTS * 4))
  const enter = new Float32Array(new ArrayBuffer(FADE_POINTS * 4))
  for (let index = 0; index < FADE_POINTS; index++) {
    const phase = (index / (FADE_POINTS - 1)) * (Math.PI / 2)
    out[index] = Math.max(FADE_FLOOR, Math.cos(phase))
    enter[index] = Math.max(FADE_FLOOR, Math.sin(phase))
  }
  fadeCurves = { out, enter }
  return fadeCurves
}

export function flatGains(): number[] {
  return EQ_BANDS.map(() => 0)
}

export function normalizeGains(input: unknown): number[] {
  const source = Array.isArray(input) ? input : []
  return EQ_BANDS.map((_, index) => {
    const value = typeof source[index] === 'number' ? (source[index] as number) : Number(source[index])
    if (!Number.isFinite(value)) return 0
    return Math.round(Math.min(EQ_MAX_DB, Math.max(-EQ_MAX_DB, value)) * 10) / 10
  })
}

export function presetIdFor(gains: readonly number[]): string | null {
  const found = EQ_PRESETS.find((preset) => preset.gains.every((gain, index) => Math.abs(gain - (gains[index] ?? 0)) < 0.05))
  return found ? found.id : null
}

export function isEqFlat(gains: readonly number[]): boolean {
  return gains.every((gain) => Math.abs(gain) < 0.05)
}

export interface AudioGraph {
  route(el: HTMLMediaElement): GainNode | null
  setEq(gains: readonly number[]): void
  setLeveling(on: boolean): void
  setVolume(gain: number): void
  resume(): Promise<void>
  now(): number
  level(): number
  suspended(): boolean
}

type Ctor = typeof AudioContext

function contextCtor(): Ctor | null {
  const scope = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

export function audioGraphSupported(): boolean {
  return contextCtor() !== null
}

function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(LIMITER_CURVE_POINTS * 4))
  for (let index = 0; index < LIMITER_CURVE_POINTS; index++) {
    const x = (index * 2) / (LIMITER_CURVE_POINTS - 1) - 1
    curve[index] = Math.tanh(drive * x) / drive
  }
  return curve
}

export function createAudioGraph(gains: readonly number[], leveling: boolean, volume: number): AudioGraph | null {
  const Ctor = contextCtor()
  if (!Ctor) return null

  let ctx: AudioContext
  try {
    ctx = new Ctor()
  } catch {
    return null
  }

  const filters = EQ_BANDS.map((band) => {
    const filter = ctx.createBiquadFilter()
    filter.type = band.type
    filter.frequency.value = band.freq
    filter.Q.value = band.q
    filter.gain.value = 0
    return filter
  })

  const entry = ctx.createGain()
  const limiter = ctx.createWaveShaper()
  limiter.curve = softClipCurve(LIMITER_DRIVE)
  limiter.oversample = '4x'
  const makeup = ctx.createGain()
  makeup.gain.value = LIMITER_TRIM
  const master = ctx.createGain()
  master.gain.value = Math.min(1, Math.max(0, volume))
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  const samples = new Float32Array(analyser.fftSize)

  let last: AudioNode = entry
  for (const filter of filters) {
    last.connect(filter)
    last = filter
  }
  const eqOut = last

  const wire = (on: boolean): void => {
    eqOut.disconnect()
    limiter.disconnect()
    makeup.disconnect()
    if (on) {
      eqOut.connect(limiter)
      limiter.connect(makeup)
      makeup.connect(master)
    } else {
      eqOut.connect(master)
    }
  }
  wire(leveling)
  master.connect(analyser)
  analyser.connect(ctx.destination)

  const setEq = (next: readonly number[]): void => {
    const at = ctx.currentTime
    filters.forEach((filter, index) => {
      const value = Math.min(EQ_MAX_DB, Math.max(-EQ_MAX_DB, next[index] ?? 0))
      filter.gain.cancelScheduledValues(at)
      filter.gain.setValueAtTime(filter.gain.value, at)
      filter.gain.linearRampToValueAtTime(value, at + RAMP_S)
    })
  }
  setEq(gains)

  const resume = async (): Promise<void> => {
    if (ctx.state === 'running') return
    try {
      await ctx.resume()
    } catch {
      return
    }
  }

  const unlock = (): void => {
    void resume()
  }
  document.addEventListener('pointerdown', unlock)
  document.addEventListener('keydown', unlock)

  const sources = new WeakMap<HTMLMediaElement, GainNode>()

  return {
    route(el: HTMLMediaElement): GainNode | null {
      const existing = sources.get(el)
      if (existing) return existing
      try {
        const source = ctx.createMediaElementSource(el)
        const gain = ctx.createGain()
        gain.gain.value = 1
        source.connect(gain)
        gain.connect(entry)
        sources.set(el, gain)
        return gain
      } catch {
        return null
      }
    },
    setEq,
    setLeveling(on: boolean): void {
      wire(on)
    },
    setVolume(gain: number): void {
      const value = Math.min(1, Math.max(0, gain))
      const at = ctx.currentTime
      master.gain.cancelScheduledValues(at)
      master.gain.setValueAtTime(master.gain.value, at)
      master.gain.linearRampToValueAtTime(value, at + RAMP_S)
    },
    resume,
    now(): number {
      return ctx.currentTime
    },
    level(): number {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const value of samples) sum += value * value
      return Math.sqrt(sum / samples.length)
    },
    suspended(): boolean {
      return ctx.state !== 'running'
    },
  }
}
