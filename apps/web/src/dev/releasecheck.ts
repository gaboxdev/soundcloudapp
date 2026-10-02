import {
  SoundCloudAPI,
  isDrmOnly,
  isTauri,
  type StreamTarget,
  type Track,
  type Transport,
  type User,
} from '@soundclear/api'
import { getAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { accountStore } from '../core/account'
import { loadLang } from '../core/i18n.ts'
import { auditRoutes } from './a11y'
import {
  offlineBlobUrl,
  offlineHas,
  offlineStore,
  initOffline,
  removeOffline,
  saveOffline,
} from '../core/offline'
import { getSettings, updateSettings, type Settings, type Theme } from '../core/settings'
import { remountApp } from '../app'
import { equalPowerCurves } from '../player/audiograph'
import { player } from '../player/player'

const REVIEW_TIMEOUT = 28_000
const REVIEW_STORAGE_KEYS = ['sl:settings', 'sl:player:queue', 'sl:history', 'sl:likes'] as const
const REVIEW_BACKUP_KEY = 'sl:review:backup'
const REVIEW_EXPECTED_RESULTS = 20
const REVIEW_QUERY = 'review=1'

interface ReviewResult {
  name: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  detail: string
  durationMs: number
}

export interface DesktopReviewReport {
  startedAt: string
  finishedAt: string
  desktop: boolean
  results: ReviewResult[]
  summary: { pass: number; fail: number; skip: number; total: number }
}

interface ReviewSettingsSnapshot {
  settings: Settings
  storage: Record<string, string | null>
  hash: string
}

interface ReviewPlayerSnapshot extends ReviewSettingsSnapshot {
  queue: Track[]
  index: number
  current: Track | null
  duration: number
  playing: boolean
  volume: number
  muted: boolean
  rate: number
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  history: ReturnType<typeof player.store.get>['history']
  progress: number
  buffered: number
  radioIds: number[]
  radioLoading: boolean
  sleepAt: number | null
}

class ReviewSkip extends Error {}

function assertReview(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, stepMs = 50): Promise<boolean> {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    if (predicate()) return true
    await wait(stepMs)
  }
  return predicate()
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer = 0
  const pending = promise.catch((error: unknown) => {
    throw error
  })
  return await new Promise<T>((resolve, reject) => {
    timer = window.setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs)
    void pending.then(resolve, reject).finally(() => window.clearTimeout(timer))
  })
}

function patchMethod(target: object, name: string, replacement: unknown): () => void {
  const record = target as unknown as Record<string, unknown>
  const previous = record[name]
  record[name] = replacement
  return () => {
    record[name] = previous
  }
}

function reviewTrack(id: number, label: string, duration = 4000): Track {
  const user: User = {
    id: id - 1000,
    kind: 'user',
    username: 'SoundClear review fixture',
    full_name: 'SoundClear review fixture',
    first_name: 'SoundClear',
    last_name: 'review',
    permalink: 'soundclear-review-fixture',
    permalink_url: 'https://soundcloud.com/soundclear-review-fixture',
    uri: 'https://api-v2.soundcloud.com/users/review-fixture',
    urn: `soundcloud:users:${id - 1000}`,
    avatar_url: null,
    city: null,
    country_code: null,
    followers_count: 0,
    followings_count: 0,
    likes_count: 0,
    track_count: 1,
    playlist_count: 0,
    verified: false,
  }
  return {
    id,
    kind: 'track',
    title: label,
    description: null,
    permalink: 'soundclear-review-fixture',
    permalink_url: 'https://soundcloud.com/soundclear-review-fixture/review',
    uri: `https://api-v2.soundcloud.com/tracks/${id}`,
    urn: `soundcloud:tracks:${id}`,
    user,
    user_id: user.id,
    artwork_url: null,
    waveform_url: null,
    duration,
    full_duration: duration,
    genre: 'Ambient',
    tag_list: '',
    streamable: true,
    downloadable: false,
    comment_count: 0,
    playback_count: 0,
    likes_count: 0,
    reposts_count: 0,
    media: { transcodings: [] },
    monetization_model: null,
    policy: 'ALLOW',
    access: null,
  }
}

function wavBytes(seconds = 3): Uint8Array {
  const sampleRate = 8000
  const frames = Math.max(1, Math.floor(sampleRate * seconds))
  const bytes = new Uint8Array(44 + frames * 2)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, frames * 2, true)
  for (let index = 0; index < frames; index++) {
    const sample = Math.sin((index / sampleRate) * Math.PI * 2 * 440) * 0.26
    view.setInt16(44 + index * 2, sample * 32767, true)
  }
  return bytes
}

function wavUri(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + chunk, bytes.length)))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

function snapshotStorage(): Record<string, string | null> {
  const storage: Record<string, string | null> = {}
  for (const key of REVIEW_STORAGE_KEYS) {
    try {
      storage[key] = localStorage.getItem(key)
    } catch {
      storage[key] = null
    }
  }
  return storage
}

function restoreStorage(storage: Record<string, string | null>): void {
  for (const key of REVIEW_STORAGE_KEYS) {
    try {
      const value = storage[key]
      if (value === null || value === undefined) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    } catch {
      continue
    }
  }
}

function persistReviewBackup(): boolean {
  try {
    localStorage.setItem(REVIEW_BACKUP_KEY, JSON.stringify(snapshotStorage()))
    return true
  } catch {
    return false
  }
}

function clearReviewBackup(): void {
  try {
    localStorage.removeItem(REVIEW_BACKUP_KEY)
  } catch {
    return
  }
}

function snapshotSettings(): ReviewSettingsSnapshot {
  return { settings: clone(getSettings()), storage: snapshotStorage(), hash: window.location.hash }
}

function snapshotPlayer(): ReviewPlayerSnapshot {
  const state = player.store.get()
  return {
    ...snapshotSettings(),
    queue: clone(state.queue),
    index: state.index,
    current: state.current ? clone(state.current) : null,
    duration: state.duration,
    playing: state.playing,
    volume: state.volume,
    muted: state.muted,
    rate: state.rate,
    repeat: state.repeat,
    shuffle: state.shuffle,
    history: clone(state.history),
    progress: player.progressMs(),
    buffered: player.tick.get().buffered,
    radioIds: [...state.radioIds],
    radioLoading: state.radioLoading,
    sleepAt: state.sleepAt,
  }
}

async function restoreSettings(snapshot: ReviewSettingsSnapshot): Promise<void> {
  updateSettings({ ...snapshot.settings, eq: [...snapshot.settings.eq] })
  await loadLang(snapshot.settings.lang)
  restoreStorage(snapshot.storage)
  if (window.location.hash !== snapshot.hash) window.location.hash = snapshot.hash
}

async function restorePlayer(snapshot: ReviewPlayerSnapshot): Promise<void> {
  player.pause()
  player.clearQueue()
  if (snapshot.queue.length > 0) player.addManyToQueue(snapshot.queue)
  player.store.set({
    queue: clone(snapshot.queue),
    index: snapshot.index,
    current: snapshot.current ? clone(snapshot.current) : null,
    duration: snapshot.duration,
    playing: false,
    loading: false,
    error: null,
    volume: snapshot.volume,
    muted: snapshot.muted,
    rate: snapshot.rate,
    repeat: snapshot.repeat,
    shuffle: snapshot.shuffle,
    history: clone(snapshot.history),
    sleepAt: snapshot.sleepAt,
    radioIds: [...snapshot.radioIds],
    radioLoading: snapshot.radioLoading,
  })
  player.tick.set({ progress: snapshot.progress, buffered: snapshot.buffered })
  player.setSleepTimer(null)
  if (snapshot.sleepAt !== null && snapshot.sleepAt > Date.now()) {
    player.setSleepTimer((snapshot.sleepAt - Date.now()) / 60_000)
    player.store.set({ sleepAt: snapshot.sleepAt })
  } else if (snapshot.sleepAt !== null) {
    player.store.set({ sleepAt: snapshot.sleepAt })
  }
  player.setVolume(snapshot.volume)
  player.setRate(snapshot.rate)
  await restoreSettings(snapshot)
  const cancelAndRestoreState = (): void => {
    player.clearQueue()
    if (snapshot.queue.length > 0) player.addManyToQueue(snapshot.queue)
    player.store.set({
      queue: clone(snapshot.queue),
      index: snapshot.index,
      current: snapshot.current ? clone(snapshot.current) : null,
      duration: snapshot.duration,
      playing: false,
      loading: false,
      error: null,
      volume: snapshot.volume,
      muted: snapshot.muted,
      rate: snapshot.rate,
      repeat: snapshot.repeat,
      shuffle: snapshot.shuffle,
      history: clone(snapshot.history),
      sleepAt: snapshot.sleepAt,
      radioIds: [...snapshot.radioIds],
      radioLoading: snapshot.radioLoading,
    })
    player.tick.set({ progress: snapshot.progress, buffered: snapshot.buffered })
  }
  if (snapshot.playing && snapshot.current && snapshot.queue.length > 0 && snapshot.index >= 0 && snapshot.index < snapshot.queue.length) {
    try {
      await withTimeout(player.playTrack(snapshot.current, snapshot.queue, snapshot.index), 5000)
      if (snapshot.progress > 0) player.seekTo(snapshot.progress)
    } catch {
      cancelAndRestoreState()
    }
  } else if (snapshot.current && snapshot.queue.length > 0 && snapshot.index >= 0 && snapshot.index < snapshot.queue.length) {
    player.setVolume(0)
    try {
      await withTimeout(player.playTrack(snapshot.current, snapshot.queue, snapshot.index), 5000)
      await waitUntil(() => player.store.get().duration > 0 || player.store.get().error !== null, 1500)
      player.pause()
      if (snapshot.progress > 0 && player.store.get().duration > 0) player.seekTo(snapshot.progress)
      player.setVolume(snapshot.volume)
      if (player.isMuted() !== snapshot.muted) player.toggleMute()
    } catch {
      cancelAndRestoreState()
    }
  }
  player.setVolume(snapshot.volume)
  if (player.isMuted() !== snapshot.muted) player.toggleMute()
  player.setRate(snapshot.rate)
  if (!snapshot.playing) player.store.set({ playing: false, loading: false, error: null })
  restoreStorage(snapshot.storage)
  player.store.set({ history: clone(snapshot.history) })
  for (const key of REVIEW_STORAGE_KEYS) {
    const expected = snapshot.storage[key] ?? null
    const actual = (() => {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    })()
    if (actual !== expected) throw new Error(`storage restore falló en ${key}`)
  }
}

function ensureReviewPanel(): HTMLElement {
  const existing = document.getElementById('sl-review-panel')
  if (existing) return existing
  const panel = document.createElement('section')
  panel.id = 'sl-review-panel'
  panel.setAttribute('aria-label', 'SoundClear desktop review')
  panel.setAttribute('aria-live', 'polite')
  panel.style.cssText = [
    'position:fixed',
    'left:12px',
    'right:12px',
    'bottom:108px',
    'z-index:2147483000',
    'max-height:38vh',
    'overflow:auto',
    'padding:12px 14px',
    'border:1px solid color-mix(in srgb, var(--accent, #7857ff) 45%, transparent)',
    'border-radius:12px',
    'background:color-mix(in srgb, var(--bg, #08080b) 92%, var(--accent, #7857ff))',
    'box-shadow:0 12px 30px rgb(0 0 0 / 35%)',
    'color:var(--text, #fff)',
    'font:12px/1.35 ui-monospace, SFMono-Regular, Consolas, monospace',
  ].join(';')
  document.body.appendChild(panel)
  return panel
}

function renderReviewPanel(results: ReviewResult[], running = ''): void {
  const panel = ensureReviewPanel()
  panel.replaceChildren()
  const heading = document.createElement('div')
  heading.style.fontWeight = '700'
  heading.textContent = running ? `Desktop review · ${running}` : 'Desktop review'
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = 'Cerrar'
  dismiss.setAttribute('aria-label', 'Cerrar informe de pruebas')
  dismiss.style.cssText = 'float:right;min-height:24px;min-width:44px;color:inherit;font:inherit'
  dismiss.addEventListener('click', () => panel.remove())
  heading.appendChild(dismiss)
  panel.appendChild(heading)
  for (const result of results) {
    const row = document.createElement('div')
    row.style.display = 'flex'
    row.style.gap = '8px'
    row.style.paddingTop = '3px'
    const status = document.createElement('strong')
    status.style.color = result.status === 'PASS' ? 'var(--accent-text, #9f9)' : result.status === 'SKIP' ? 'var(--text2, #ccf)' : '#ff9b9b'
    status.textContent = result.status
    const detail = document.createElement('span')
    detail.textContent = `${result.name} · ${result.detail} · ${result.durationMs}ms`
    row.append(status, detail)
    panel.appendChild(row)
  }
}

function safeLogDetail(detail: string): string {
  return detail.replace(/\b\d{3,}\b/g, '#').replace(/https?:\/\/\S+/gi, 'url').slice(0, 180)
}

function logReview(result: ReviewResult): void {
  const detail = safeLogDetail(result.detail)
  void desktopInvoke('log_debug', { message: `REVIEW ${result.status} ${result.name}${detail ? ` · ${detail}` : ''}` }).catch(() => {})
}

function routeCheckSelector(selector: string): number {
  return document.querySelectorAll(selector).length
}

function parseRgb(value: string): [number, number, number, number] | null {
  const hex = value.trim().match(/^#([\da-f]{3,8})$/i)
  if (hex) {
    const raw = hex[1]
    const expanded = raw.length <= 4 ? raw.split('').map((part) => part + part).join('') : raw
    const alpha = expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1
    return [parseInt(expanded.slice(0, 2), 16), parseInt(expanded.slice(2, 4), 16), parseInt(expanded.slice(4, 6), 16), alpha]
  }
  const match = value.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[, /]+\s*([\d.]+))?\s*\)/i)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
}

function luminance(rgb: [number, number, number]): number {
  return rgb.reduce((sum, value, index) => {
    const channel = value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4
    return sum + channel * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

function visualTextScan(): string {
  const root = getComputedStyle(document.documentElement)
  const text = root.getPropertyValue('--text').trim()
  const bg = root.getPropertyValue('--bg').trim()
  const textRgb = parseRgb(text)
  const bgRgb = parseRgb(bg)
  const visible = [...document.querySelectorAll<HTMLElement>('body *')].filter((element) => {
    const value = element.textContent?.trim() ?? ''
    if (value.length < 2 || element.children.length > 0) return false
    const style = getComputedStyle(element)
    return element.getClientRects().length > 0 && !element.closest('[hidden]') && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
  })
  const transparent = visible.filter((element) => {
    const style = getComputedStyle(element)
    if ((style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text') && style.backgroundImage !== 'none') return false
    const color = parseRgb(style.color)
    return color !== null && color[3] < 0.35
  })
  if (!textRgb || !bgRgb) throw new ReviewSkip('tokens de color no legibles para el escaneo')
  const textColor: [number, number, number] = [textRgb[0], textRgb[1], textRgb[2]]
  const bgColor: [number, number, number] = [bgRgb[0], bgRgb[1], bgRgb[2]]
  const ratio = (Math.max(luminance(textColor), luminance(bgColor)) + 0.05) / (Math.min(luminance(textColor), luminance(bgColor)) + 0.05)
  assertReview(transparent.length === 0, `${transparent.length} textos casi transparentes: ${transparent.map((element) => `${element.tagName.toLowerCase()}.${element.className}`).join(', ')}`)
  assertReview(ratio >= 3, `contraste base ${ratio.toFixed(1)}:1`)
  return `${visible.length} nodos de texto; contraste base ${ratio.toFixed(1)}:1`
}

async function runPublicReadSurface(context: { api: ReturnType<typeof getAPI>; track: Track | null; target: StreamTarget | null }): Promise<string> {
  const [tracks, suggestions, charts] = await Promise.all([
    context.api.searchTracks('music', 0, 6),
    context.api.searchSuggestions('music', 4),
    context.api.charts('soundcloud:genres:all-music', 'trending', 0, 4),
  ])
  assertReview(Array.isArray(tracks.collection), 'search/tracks no devolvió colección')
  assertReview(Array.isArray(suggestions), 'search/queries no devolvió sugerencias')
  assertReview(Array.isArray(charts.collection), 'charts no devolvió colección')
  const candidates = tracks.collection.filter((item): item is Track => item.kind === 'track' && typeof item.id === 'number')
  if (candidates.length === 0) throw new ReviewSkip('la búsqueda pública no trajo tracks')
  for (const candidate of candidates.slice(0, 4)) {
    const target = await context.api.streamUrl(candidate)
    if (target) {
      context.track = candidate
      context.target = target
      break
    }
  }
  if (!context.track) context.track = candidates[0]
  return `search=${tracks.collection.length}, suggestions=${suggestions.length}, charts=${charts.collection.length}, stream=${context.target ? context.target.protocol : 'SKIP'}`
}

async function runAccountReadSurface(api: ReturnType<typeof getAPI>): Promise<string> {
  const user = await api.me()
  if (!user) throw new ReviewSkip('sin sesión de escritorio')
  const [likes, stream, history, playlists] = await Promise.all([
    api.meLikes(user.id, 3),
    api.stream(3),
    api.playHistory(3),
    api.mePlaylists(user.id, 3),
  ])
  assertReview(Array.isArray(likes.collection), 'likes no devolvió colección')
  assertReview(Array.isArray(stream.collection), 'stream no devolvió colección')
  assertReview(Array.isArray(history.collection), 'play-history no devolvió colección')
  assertReview(Array.isArray(playlists.collection), 'playlists no devolvió colección')
  return `likes=${likes.collection.length}, stream=${stream.collection.length}, history=${history.collection.length}, playlists=${playlists.collection.length}`
}

async function runEntityReadSurface(api: ReturnType<typeof getAPI>, track: Track | null): Promise<string> {
  if (!track) throw new ReviewSkip('sin track público de prueba')
  const full = await api.track(track.id)
  const user = await api.user(full.user.id)
  const station = await api.stationTracks('track', full.id)
  assertReview(full.id === track.id, 'track devolvió un id distinto')
  assertReview(user.id === full.user.id, 'user devolvió un id distinto')
  assertReview(station.length > 0, 'station no devolvió tracks')
  let waveform: number[] | null = await api.waveformSamples(full)
  if (!waveform) {
    for (const candidate of station.slice(0, 4)) {
      waveform = await api.waveformSamples(candidate)
      if (waveform) break
    }
  }
  if (!waveform) throw new ReviewSkip('ningún track público de prueba tiene waveform')
  assertReview(waveform.length > 0 && waveform.every((value) => value >= 0 && value <= 1), 'waveform fuera de 0..1')
  return `track/user/station OK, station=${station.length}, waveform=${waveform.length}`
}

async function runPlaylistHydration(api: ReturnType<typeof getAPI>, track: Track | null): Promise<string> {
  if (!track) throw new ReviewSkip('sin track público de prueba')
  const related = await api.trackPlaylists(track.id, 3)
  if (related.length === 0) throw new ReviewSkip('el track no aparece en una playlist pública')
  const playlist = await api.playlist(related[0].id)
  assertReview(Array.isArray(playlist.tracks), 'playlist sin tracks')
  const ids = playlist.tracks
    .filter((item) => typeof item.id === 'number' && typeof item.title !== 'string')
    .slice(0, 10)
    .map((item) => item.id)
  const hydrated = ids.length > 0 ? await api.tracksByIds(ids) : []
  if (ids.length > 0) assertReview(hydrated.length > 0, 'tracksByIds no hidrató stubs')
  return `playlist tracks=${playlist.tracks.length}, hydrated=${hydrated.length}`
}

async function runHlsFallback(): Promise<string> {
  const track = reviewTrack(-901101, 'HLS fallback')
  track.media.transcodings = [
    {
      url: 'https://api-v2.soundcloud.com/review-dead',
      format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
      quality: 'sq',
    },
    {
      url: 'https://api-v2.soundcloud.com/review-hls',
      format: { protocol: 'hls', mime_type: 'application/vnd.apple.mpegurl' },
      quality: 'sq',
    },
  ]
  const transport: Transport = {
    getClientId: async () => 'review-client',
    getJSON: async (url: string) => (url.includes('review-dead') ? {} : { url: 'https://cdn.invalid/review.m3u8' }),
    rewriteHref: (href: string) => href,
    authedRequest: async () => ({}),
  }
  const result = await new SoundCloudAPI(transport).streamUrl(track)
  assertReview(result?.protocol === 'hls' && result.url.includes('review.m3u8'), 'no saltó de progressive vacío a HLS')
  const drm = clone(track)
  drm.media.transcodings = [
    {
      ...track.media.transcodings[0],
      is_legacy_transcoding: true,
    },
    {
      url: 'https://api-v2.soundcloud.com/review-drm',
      format: { protocol: 'cbc-encrypted-hls' as 'hls', mime_type: 'application/vnd.apple.mpegurl' },
      quality: 'sq',
      is_legacy_transcoding: true,
    },
  ]
  assertReview(isDrmOnly(drm), 'fixture encrypted HLS no fue marcado DRM')
  return 'envelope vacío → HLS y detección DRM fixture OK'
}

async function runPlayerPlayback(context: { api: ReturnType<typeof getAPI> }): Promise<string> {
  const snapshot = snapshotPlayer()
  const bytes = wavBytes()
  const url = wavUri(bytes)
  const first = reviewTrack(-901201, 'Player A')
  const second = reviewTrack(-901202, 'Player B')
  const third = reviewTrack(-901203, 'Player C')
  const restoreStream = patchMethod(context.api, 'streamUrl', async () => ({ url, protocol: 'progressive', mimeType: 'audio/wav', snipped: false }))
  try {
    player.clearQueue()
    player.setDsp(true)
    player.setVolume(Math.max(0.55, Math.min(0.9, snapshot.volume)))
    player.setRate(1)
    await player.playTrack(first, [first], 0)
    const started = await waitUntil(() => player.store.get().playing || player.store.get().error !== null, 6000)
    await wait(650)
    const diagnostics = player.diagnostics()
    if (!started || player.store.get().error) throw new ReviewSkip('WebView bloqueó el audio sintético')
    const progress = player.progressMs()
    assertReview(progress > 0, 'el progreso no avanzó')
    if (!diagnostics.graph || diagnostics.suspended) throw new ReviewSkip('AudioContext no disponible o suspendido')
    assertReview(diagnostics.level > 0.0001, 'RMS del grafo quedó en cero')
    player.setEqGains([3, 0, 0, 0, 0])
    player.setLeveling(true)
    player.setRate(1.25)
    player.seekTo(240)
    player.setSleepTimer(1)
    assertReview(player.store.get().sleepAt !== null, 'temporizador no se armó')
    player.setSleepTimer(null)
    assertReview(player.store.get().sleepAt === null, 'temporizador no se canceló')
    assertReview(player.store.get().rate === 1.25, 'rate no se aplicó')
    assertReview(player.progressMs() >= 200, 'seek no avanzó')
    const curves = equalPowerCurves()
    assertReview(curves.out.every((value, index) => Math.abs(value * value + curves.enter[index] * curves.enter[index] - 1) < 0.002), 'curvas no son de potencia constante')
    player.clearQueue()
    player.addManyToQueue([first, second, third])
    assertReview(player.store.get().queue.length === 3, 'addMany no añadió la cola')
    player.moveInQueue(2, 1)
    assertReview(player.store.get().queue[1]?.id === third.id, 'moveInQueue no reordenó')
    player.removeFromQueue(1)
    assertReview(player.store.get().queue.length === 2, 'removeFromQueue no quitó')
    player.next()
    await wait(300)
    assertReview(player.store.get().current?.id === second.id, 'next no avanzó')
    return `progress=${Math.round(progress)}ms, RMS=${diagnostics.level.toFixed(4)}, DSP=${diagnostics.graph}`
  } finally {
    restoreStream()
    await restorePlayer(snapshot)
  }
}

async function runPublicPlayback(context: { api: ReturnType<typeof getAPI>; track: Track | null; target: StreamTarget | null }): Promise<string> {
  if (!context.track || !context.target) throw new ReviewSkip('sin target público reproducible')
  const snapshot = snapshotPlayer()
  try {
    player.clearQueue()
    player.setDsp(true)
    player.setVolume(Math.max(0.55, Math.min(0.9, snapshot.volume)))
    await player.playTrack(context.track, [context.track], 0)
    const started = await waitUntil(() => player.store.get().playing || player.store.get().error !== null, 9000)
    await wait(1000)
    const diagnostics = player.diagnostics()
    if (!started || player.store.get().error) throw new ReviewSkip('el WebView no inició el audio público')
    const progress = player.progressMs()
    assertReview(progress > 250, 'el audio público no acumuló progreso')
    if (!diagnostics.graph || diagnostics.suspended) throw new ReviewSkip('AudioContext público no disponible o suspendido')
    assertReview(diagnostics.level > 0.0001, 'RMS público quedó en cero')
    return `public ${diagnostics.decks[diagnostics.active]?.trackId === context.track.id ? 'activo' : 'cargado'}, progress=${Math.round(progress)}ms, RMS=${diagnostics.level.toFixed(4)}`
  } finally {
    await restorePlayer(snapshot)
  }
}

async function runDelayedLoadSupersession(context: { api: ReturnType<typeof getAPI> }): Promise<string> {
  const snapshot = snapshotPlayer()
  const a = reviewTrack(-901211, 'Delayed A')
  const b = reviewTrack(-901212, 'Delayed B')
  const url = wavUri(wavBytes(1))
  const restoreStream = patchMethod(context.api, 'streamUrl', (track: Track) =>
    new Promise<StreamTarget>((resolve) => window.setTimeout(() => resolve({ url, protocol: 'progressive', mimeType: 'audio/wav' }), track.id === a.id ? 420 : 70)),
  )
  try {
    player.clearQueue()
    const first = player.playTrack(a)
    await wait(25)
    const second = player.playTrack(b)
    await Promise.all([first, second])
    await wait(350)
    assertReview(player.store.get().current?.id === b.id, 'una carga retrasada pisó el track más nuevo')
    assertReview(player.store.get().error === null, 'la carga retrasada dejó error')
    return 'A retrasado / B rápido conservó B'
  } finally {
    restoreStream()
    await restorePlayer(snapshot)
  }
}

async function runRadioSupersession(context: { api: ReturnType<typeof getAPI> }): Promise<string> {
  const snapshot = snapshotPlayer()
  const seed = reviewTrack(-901221, 'Radio seed')
  const radio = [reviewTrack(-901222, 'Radio one'), reviewTrack(-901223, 'Radio two')]
  const url = wavUri(wavBytes(1))
  const restoreStream = patchMethod(context.api, 'streamUrl', async () => ({ url, protocol: 'progressive', mimeType: 'audio/wav' }))
  const restoreStation = patchMethod(context.api, 'stationTracks', () => new Promise<Track[]>((resolve) => window.setTimeout(() => resolve(radio), 480)))
  try {
    player.clearQueue()
    const pending = player.startRadio(seed)
    await wait(55)
    player.clearQueue()
    await pending
    assertReview(player.store.get().queue.length === 0, 'radio tardía reintrodujo tracks tras clearQueue')
    assertReview(!player.store.get().radioLoading, 'radioLoading quedó atascado')
    return 'respuesta de radio tardía descartada por generación'
  } finally {
    restoreStation()
    restoreStream()
    await restorePlayer(snapshot)
  }
}

async function runLikeRollback(context: { api: ReturnType<typeof getAPI> }): Promise<string> {
  const account = accountStore.get()
  if (account.status !== 'ready' || !account.user) throw new ReviewSkip('sin cuenta desktop para mock de rollback')
  const before = player.store.get().likes.map((track) => track.id)
  const synthetic = reviewTrack(-901231, 'Like rollback')
  if (player.isLiked(synthetic)) throw new ReviewSkip('fixture de likes ya estaba presente')
  const restoreWrite = patchMethod(context.api, 'toggleAccountLike', async () => {
    throw new Error('review mocked account write')
  })
  try {
    player.toggleLike(synthetic)
    const rolledBack = await waitUntil(() => !player.isLiked(synthetic), 2500)
    assertReview(rolledBack, 'rollback de favorito no terminó')
    assertReview(JSON.stringify(before) === JSON.stringify(player.store.get().likes.map((track) => track.id)), 'rollback alteró favoritos existentes')
    return 'escritura mock rechazada, estado local restaurado sin red'
  } finally {
    restoreWrite()
  }
}

async function runOfflineDurability(context: { api: ReturnType<typeof getAPI> }): Promise<string> {
  if (!offlineStore.get().supported) throw new ReviewSkip('IndexedDB no está disponible')
  const snapshot = snapshotPlayer()
  const settings = snapshot.settings
  const fixtureA = reviewTrack(-901241, 'Offline A')
  const fixtureB = reviewTrack(-901242, 'Offline B')
  const bytesA = wavBytes(1)
  const bytesB = wavBytes(1)
  const urlA = 'https://offline-review.invalid/audio-a.wav'
  const urlB = 'https://offline-review.invalid/audio-b.wav'
  const restoreStream = patchMethod(context.api, 'streamUrl', async (track: Track) => ({
    url: track.id === fixtureA.id ? urlA : urlB,
    protocol: 'progressive',
    mimeType: 'audio/wav',
    snipped: false,
  }))
  const originalFetch = window.fetch
  let releaseA: ((response: Response) => void) | null = null
  let fetchAStarted = false
  const pendingA = new Promise<Response>((resolve) => {
    releaseA = resolve
  })
  let saveAPromise: Promise<{ ok: boolean; message: string }> | null = null
  let aResolved = false
  const responseFor = (bytes: Uint8Array): Response => new Response(bytes.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: { 'content-type': 'audio/wav', 'content-length': String(bytes.byteLength) },
  })
  const fetchReview = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(input) === urlA) {
      fetchAStarted = true
      return pendingA
    }
    if (String(input) === urlB) return Promise.resolve(responseFor(bytesB))
    return originalFetch(input, init)
  }
  window.fetch = fetchReview
  try {
    initOffline()
    assertReview(await waitUntil(() => offlineStore.get().ready, 2500), 'IndexedDB no terminó de inicializar')
    await removeOffline(fixtureA.id)
    await removeOffline(fixtureB.id)
    if (settings.offlineBudget === 0) updateSettings({ offlineBudget: 250 })
    saveAPromise = saveOffline(fixtureA)
    assertReview(await waitUntil(() => fetchAStarted, 2500), 'fetch offline A no empezó')
    await removeOffline(fixtureA.id)
    const savedB = await saveOffline(fixtureB)
    assertReview(savedB.ok, `guardado offline B falló: ${savedB.message.slice(0, 80)}`)
    assertReview(offlineHas(fixtureB.id), 'IndexedDB no dejó índice offline B')
    assertReview(releaseA !== null, 'fixture offline A no creó resolución')
    const resolveA = releaseA as unknown as (response: Response) => void
    resolveA(responseFor(bytesA))
    aResolved = true
    const pendingSaveA = saveAPromise
    if (!pendingSaveA) throw new Error('fixture offline A no inició guardado')
    const savedA = await pendingSaveA
    assertReview(!savedA.ok && !offlineHas(fixtureA.id), 'offline A tardío volvió a aparecer')
    const blobUrl = await offlineBlobUrl(fixtureB.id)
    assertReview(blobUrl !== null, 'IndexedDB no devolvió Blob URL')
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    player.clearQueue()
    await player.playTrack(fixtureB, [fixtureB], 0)
    const local = await waitUntil(() => player.diagnostics().decks.some((deck) => deck.trackId === fixtureB.id && deck.local), 2500)
    assertReview(local, 'playback no eligió el Blob offline')
    assertReview(offlineHas(fixtureB.id) && !offlineHas(fixtureA.id), 'el índice final no conservó solo B')
    return `offline A tardío descartado, B=${offlineHas(fixtureB.id)}, playback local=${local}`
  } finally {
    window.fetch = originalFetch
    restoreStream()
    if (saveAPromise && !aResolved) {
      const resolveA = releaseA as unknown as ((response: Response) => void) | null
      if (resolveA !== null) {
        aResolved = true
        resolveA(responseFor(bytesA))
      }
    }
    if (saveAPromise) await withTimeout(saveAPromise, 3000).catch(() => {})
    await removeOffline(fixtureA.id)
    await removeOffline(fixtureB.id)
    await restorePlayer(snapshot)
    if (settings.offlineBudget === 0) updateSettings({ offlineBudget: 0 })
  }
}

async function nativeInvoke<T>(command: string, args?: Record<string, unknown>, timeoutMs = 4500): Promise<T> {
  return withTimeout(desktopInvoke<T>(command, args), timeoutMs)
}

async function runNativeClientId(): Promise<string> {
  const id = await nativeInvoke<string>('get_client_id', { refresh: false })
  assertReview(typeof id === 'string' && id.length > 5, 'get_client_id devolvió un id vacío')
  return 'get_client_id OK'
}

async function runNativeWhitelist(): Promise<string> {
  let rejected = false
  try {
    await nativeInvoke('proxy_fetch', { url: 'https://example.invalid/' })
  } catch {
    rejected = true
  }
  assertReview(rejected, 'proxy_fetch aceptó un host fuera de la whitelist')
  return 'proxy_fetch hostile rechazado'
}

async function runNativeMini(): Promise<string> {
  let miniOpened = false
  try {
    await nativeInvoke('mini_window', { show: true })
    miniOpened = true
    await wait(350)
  } finally {
    if (miniOpened) await nativeInvoke('mini_window', { show: false }).catch(() => {})
  }
  return 'mini open/close OK'
}

async function runNativeLogin(): Promise<string> {
  let loginOpened = false
  try {
    await nativeInvoke('login_window')
    loginOpened = true
    await wait(450)
  } finally {
    if (loginOpened) await nativeInvoke('close_login_windows').catch(() => {})
  }
  return 'login open/close OK'
}

async function runNativeCommand(context: { api: ReturnType<typeof getAPI> }): Promise<string> {
  const snapshot = snapshotPlayer()
  const fixture = reviewTrack(-901251, 'Native command fixture')
  const url = wavUri(wavBytes(1))
  const restoreStream = patchMethod(context.api, 'streamUrl', async () => ({ url, protocol: 'progressive', mimeType: 'audio/wav' }))
  try {
    if (!player.store.get().current || !player.store.get().playing) {
      player.clearQueue()
      await player.playTrack(fixture, [fixture], 0)
      await waitUntil(() => player.store.get().playing || player.store.get().error !== null, 4000)
    }
    const state = player.store.get()
    if (!state.current || !state.playing) throw new ReviewSkip('WebView no dejó playback para probar sl:cmd')
    const currentId = state.current.id
    const { emit } = await import('@tauri-apps/api/event')
    await emit('sl:cmd', 'pause')
    const paused = await waitUntil(() => !player.store.get().playing, 1800)
    assertReview(paused, 'sl:cmd pause no cambió el estado')
    assertReview(player.store.get().current?.id === currentId, 'sl:cmd pause alteró el track')
    player.play()
    return 'un emit sl:cmd=pause produjo un único efecto observable'
  } finally {
    restoreStream()
    await restorePlayer(snapshot)
  }
}

async function runRoutesAndA11y(): Promise<string> {
  const previous = window.location.hash
  const routes = ['#/home', '#/charts', '#/search?q=music', '#/track/1', '#/playlist/1', '#/user/1', '#/queue', '#/now', '#/feed', '#/likes', '#/settings']
  try {
    const report = await auditRoutes(routes)
    const findings = Object.entries(report).flatMap(([route, value]) => (Array.isArray(value) ? value.map((finding) => `${route}:${finding.tipo}`) : []))
    assertReview(findings.length === 0, `${findings.length} hallazgos a11y`)
    return `${routes.length} rutas auditadas`
  } finally {
    if (window.location.hash !== previous) window.location.hash = previous
  }
}

async function runOverlaysThemeAndLanguage(): Promise<string> {
  const snapshot = snapshotSettings()
  const previousHash = window.location.hash
  try {
    const { openShortcuts } = await import('../components/shortcuts')
    const { openPalette } = await import('../components/palette')
    openShortcuts()
    const shortcuts = document.querySelectorAll('.sl-modal')
    assertReview(shortcuts.length === 1, 'atajos no abrió un modal')
    openShortcuts()
    assertReview(document.querySelectorAll('.sl-modal').length === 1, 'atajos duplicó modal')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wait(50)
    assertReview(document.querySelector('.sl-modal') === null, 'Escape no cerró atajos')
    openPalette('')
    await wait(50)
    const palette = document.querySelector('.sl-modal')
    assertReview(palette !== null, 'paleta no abrió modal')
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    assertReview(document.activeElement === palette?.querySelector('.palette-input'), 'paleta no conservó foco exacto tras dos RAF')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wait(50)
    const theme: Theme = snapshot.settings.theme === 'light' ? 'dark' : 'light'
    const lang = snapshot.settings.lang === 'en' ? 'es' : 'en'
    updateSettings({ theme, lang })
    await loadLang(lang)
    remountApp()
    await wait(120)
    assertReview(routeCheckSelector('.ambient') === 1, 'remount duplicó ambient')
    assertReview(routeCheckSelector('.app-header') === 1, 'remount duplicó header')
    assertReview(routeCheckSelector('.app-player') === 1, 'remount duplicó player')
    assertReview(document.documentElement.lang === lang, 'remount no aplicó idioma')
    openShortcuts()
    assertReview(document.querySelectorAll('.sl-modal').length === 1, 'atajos duplicó listeners tras remount')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    return `theme=${theme}, lang=${lang}, ambient/header/player únicos`
  } finally {
    await restoreSettings(snapshot)
    if (window.location.hash !== previousHash) window.location.hash = previousHash
    if (document.querySelector('.sl-modal')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    remountApp()
  }
}

async function runVisualScan(): Promise<string> {
  return visualTextScan()
}

function queryReviewHold(): { route?: string; theme?: Theme; hold: boolean } {
  const params = new URLSearchParams(window.location.search)
  const route = params.get('review_route')
  const requestedTheme = params.get('review_theme')
  const theme: Theme | undefined = requestedTheme === 'dark' || requestedTheme === 'light' || requestedTheme === 'system' ? requestedTheme : undefined
  return { route: route ? (route.startsWith('#') ? route : `#/${route.replace(/^\//, '')}`) : undefined, theme, hold: params.get('review_hold') === '1' }
}

export function holdDesktopReview(route?: string, theme?: Theme): void {
  if (theme) updateSettings({ theme })
  if (route) window.location.hash = route.startsWith('#') ? route : `#/${route.replace(/^\//, '')}`
}

export function installDesktopReview(): {
  runDesktopReview: () => Promise<DesktopReviewReport>
  results: () => DesktopReviewReport | null
  hold: typeof holdDesktopReview
  shouldAutoRun: boolean
} {
  let report: DesktopReviewReport | null = null
  let running: Promise<DesktopReviewReport> | null = null
  const context = { api: getAPI(), track: null as Track | null, target: null as StreamTarget | null }
  const hold = queryReviewHold()
  if (hold.route || hold.theme) holdDesktopReview(hold.route, hold.theme)
  const runDesktopReview = (): Promise<DesktopReviewReport> => {
    if (running) return running
    running = (async () => {
      const startedAt = new Date().toISOString()
      const results: ReviewResult[] = []
      const backupStarted = performance.now()
      const backupReady = persistReviewBackup()
      const backupResult: ReviewResult = {
        name: 'review · backup durable',
        status: backupReady ? 'PASS' : 'FAIL',
        detail: backupReady ? 'localStorage snapshot preparado' : 'no se pudo preparar snapshot durable',
        durationMs: Math.round(performance.now() - backupStarted),
      }
      results.push(backupResult)
      renderReviewPanel(results)
      logReview(backupResult)
      if (!backupReady) {
        report = { startedAt, finishedAt: new Date().toISOString(), desktop: isDesktop() && isTauri(), results, summary: { pass: 0, fail: 1, skip: 0, total: 1 } }
        return report
      }
      const originalSettings = clone(getSettings())
      updateSettings({ autoplay: false })
      const run = async (name: string, task: () => Promise<string>, timeout = REVIEW_TIMEOUT): Promise<void> => {
        renderReviewPanel(results, name)
        const start = performance.now()
        let result: ReviewResult
        try {
          const detail = await withTimeout(task(), timeout)
          result = { name, status: 'PASS', detail, durationMs: Math.round(performance.now() - start) }
        } catch (error) {
          const status = error instanceof ReviewSkip ? 'SKIP' : 'FAIL'
          const detail = error instanceof Error ? error.message : String(error)
          result = { name, status, detail: safeLogDetail(detail), durationMs: Math.round(performance.now() - start) }
        }
        results.push(result)
        renderReviewPanel(results)
        logReview(result)
      }
      await run('desktop API pública', () => runPublicReadSurface(context))
      await run('desktop API cuenta lectura', () => runAccountReadSurface(context.api))
      await run('track · user · station · waveform', () => runEntityReadSurface(context.api, context.track))
      await run('playlist hydration', () => runPlaylistHydration(context.api, context.track))
      await run('stream HLS fallback controlado', runHlsFallback, 8000)
      await run('player · progreso · DSP · cola', () => runPlayerPlayback(context), 18_000)
      await run('player · SoundCloud público · progreso + RMS', () => runPublicPlayback(context), 14_000)
      await run('player · carga fuera de orden A→B', () => runDelayedLoadSupersession(context), 10_000)
      await run('player · radio supersession', () => runRadioSupersession(context), 10_000)
      await run('favorito · rollback mock sin escritura', () => runLikeRollback(context), 6000)
      await run('offline · IndexedDB + playback local', () => runOfflineDurability(context), 14_000)
      await run('Tauri · client id', runNativeClientId, 6000)
      await run('Tauri · whitelist', runNativeWhitelist, 6000)
      await run('Tauri · mini open/close', runNativeMini, 7000)
      await run('Tauri · login open/close', runNativeLogin, 7000)
      await run('Tauri · evento global sl:cmd', () => runNativeCommand(context), 9000)
      await run('rutas nativas · a11y', runRoutesAndA11y, 25_000)
      await run('overlays · foco · remount · idioma', runOverlaysThemeAndLanguage, 12_000)
      await run('escaneo visual · texto sobre cristal', runVisualScan, 4000)
      updateSettings(originalSettings)
      const summary = {
        pass: results.filter((item) => item.status === 'PASS').length,
        fail: results.filter((item) => item.status === 'FAIL').length,
        skip: results.filter((item) => item.status === 'SKIP').length,
        total: results.length,
      }
      const finishedAt = new Date().toISOString()
      const next: DesktopReviewReport = { startedAt, finishedAt, desktop: isDesktop() && isTauri(), results: [...results], summary }
      report = next
      renderReviewPanel(results)
      void desktopInvoke('log_debug', { message: `REVIEW REPORT ${JSON.stringify(summary)}` }).catch(() => {})
      if (results.length === REVIEW_EXPECTED_RESULTS && results.every((item) => item.status === 'PASS')) clearReviewBackup()
      if (hold.hold) holdDesktopReview(hold.route, hold.theme)
      return next
    })().finally(() => {
      running = null
    })
    return running
  }
  return { runDesktopReview, results: () => report, hold: holdDesktopReview, shouldAutoRun: window.location.search.includes(REVIEW_QUERY) }
}
