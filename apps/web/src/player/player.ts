import type { Track } from '@soundclear/api'
import { isDrmOnly } from '@soundclear/api'
import { getAPI } from '../api'
import { isDesktop } from '../api/auth'
import { accountStore } from '../core/account'
import { loadHistory, loadLikes, saveHistory, saveLikes, type HistoryEntry } from '../core/library'
import { createStore, type Store } from '../core/store'
import { offlineBlobUrl } from '../core/offline'
import { getSettings, updateSettings } from '../core/settings'
import { aheadOf, buildOrder, dedupeById, dropPlayed, moveInList, nextInOrder, removeAt, shuffleWith } from './queueops'
import { toast, toastErr } from '../ui/toast'
import { audioGraphSupported, createAudioGraph, equalPowerCurves, normalizeGains, type AudioGraph } from './audiograph'
import { t } from '../core/i18n.ts'

export interface PlayerState {
  queue: Track[]
  index: number
  playing: boolean
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  volume: number
  muted: boolean
  rate: number
  current: Track | null
  duration: number
  loading: boolean
  error: string | null
  likes: Track[]
  likesRev: number
  isLiked: boolean
  likesTruncated: boolean
  history: HistoryEntry[]
  radioIds: number[]
  radioLoading: boolean
  sleepAt: number | null
}

export interface PlaybackTick {
  progress: number
  buffered: number
}

const QUEUE_KEY = 'sl:player:queue'
const FAIL_STREAK_MAX = 5
const RESUME_MIN_MS = 5000
const RESUME_TAIL_S = 5
const PROGRESS_SAVE_MS = 5000
const LIKES_TTL = 5 * 60 * 1000
const LIKES_PAGE_SIZE = 100
const LIKES_MAX_PAGES = 500
const RADIO_APPEND = 15
const RADIO_MIN_AHEAD = 2
const RADIO_IDS_MAX = 120
const RADIO_PREFETCH_S = 25
const RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2]
const PRELOAD_LEAD_S = 20
const GAPLESS_LEAD_S = 0.18
const FADE_FLOOR = 0.0001
const SILENCE_RMS = 0.002
const SILENCE_MIN_GAIN = 0.02
const SILENCE_TICKS = 8
const SILENCE_WINDOW_S = 6

interface Deck {
  el: HTMLAudioElement
  gain: GainNode | null
  hls: { destroy(): void } | null
  trackId: number | null
  ready: boolean
  localUrl: string | null
}

interface PersistedPlayer {
  queue: Track[]
  index: number
  repeat: PlayerState['repeat']
  shuffle: boolean
  trackId: number | null
  progress: number
}

function loadPersisted(): PersistedPlayer | null {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (raw) return JSON.parse(raw) as PersistedPlayer
  } catch {
    return null
  }
  return null
}

class Player {
  readonly store: Store<PlayerState>
  readonly tick: Store<PlaybackTick>

  private decks: Deck[] = []
  private activeDeck = 0
  private graph: AudioGraph | null = null
  private graphOff = false
  private preloaded: { deck: number; trackId: number; index: number } | null = null
  private fading = false
  private fadeTimer: ReturnType<typeof setTimeout> | null = null
  private silentTicks = 0
  private order: number[] = []
  private seekRaf = 0
  private lastErrorTrackId: number | null = null
  private failStreak = 0
  private likesSync: Promise<void> | null = null
  private likesSyncedFor: number | null = null
  private likesSyncedAt = 0
  private likeIds = new Set<number>()
  private pendingResume: { trackId: number; progress: number } | null = null
  private lastProgressSave = 0
  private radioSeeds = new Set<number>()
  private radioPending: Promise<void> | null = null
  private sleepTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    const persisted = loadPersisted()
    const likes = loadLikes()
    const history = loadHistory()
    const settings = getSettings()
    const volume = settings.volume
    const restored = persisted?.queue && persisted.index >= 0 ? persisted.queue[persisted.index] ?? null : null
    const resumeMs =
      restored && persisted?.trackId === restored.id && (persisted.progress ?? 0) >= RESUME_MIN_MS
        ? persisted.progress
        : 0
    if (restored && resumeMs > 0) this.pendingResume = { trackId: restored.id, progress: resumeMs }
    for (const track of likes) this.likeIds.add(track.id)

    this.store = createStore<PlayerState>({
      queue: persisted?.queue ?? [],
      index: persisted?.index ?? -1,
      playing: false,
      repeat: persisted?.repeat ?? 'off',
      shuffle: persisted?.shuffle ?? false,
      volume,
      muted: volume === 0,
      rate: settings.rate,
      current: restored,
      duration: 0,
      loading: false,
      error: null,
      likes,
      likesRev: 0,
      isLiked: restored ? this.likeIds.has(restored.id) : false,
      likesTruncated: false,
      history,
      radioIds: [],
      radioLoading: false,
      sleepAt: null,
    })

    this.tick = createStore<PlaybackTick>({ progress: resumeMs, buffered: 0 })

    this.buildDecks(settings.dsp && audioGraphSupported() ? 2 : 1)

    if (persisted?.queue && persisted.index >= 0) {
      this.order = persisted.queue.map((_, i) => i)
      if (persisted.shuffle) this.order = shuffleWith(this.order)
      this.rebuildQueueOrder()
    }

    this.bindMediaSession()
    this.bindWindowEvents()

    accountStore.subscribe((state) => {
      if (state.status === 'ready') void this.syncAccountLikes()
    })
  }

  private get state(): PlayerState {
    return this.store.get()
  }

  private get deck(): Deck {
    return this.decks[this.activeDeck]
  }

  private get audio(): HTMLAudioElement {
    return this.decks[this.activeDeck].el
  }

  private buildDecks(count: number): void {
    const settings = getSettings()
    this.decks = []
    this.activeDeck = 0
    this.preloaded = null
    for (let index = 0; index < count; index++) {
      const el = new Audio()
      el.preload = 'none'
      if (count > 1) el.crossOrigin = 'anonymous'
      el.playbackRate = settings.rate
      const deck: Deck = { el, gain: null, hls: null, trackId: null, ready: false, localUrl: null }
      this.decks.push(deck)
      this.bindDeck(deck, index)
    }
    this.applyVolume(this.state.volume, this.state.muted)
  }

  private persist(): void {
    const state = this.state
    try {
      localStorage.setItem(
        QUEUE_KEY,
        JSON.stringify({
          queue: state.queue,
          index: state.index,
          repeat: state.repeat,
          shuffle: state.shuffle,
          trackId: state.current?.id ?? null,
          progress: this.tick.get().progress,
        } satisfies PersistedPlayer),
      )
    } catch {
      return
    }
  }

  private applyVolume(volume: number, muted: boolean): void {
    const perceptual = volume * volume
    for (const deck of this.decks) {
      deck.el.volume = this.graph ? 1 : perceptual
      deck.el.muted = muted
    }
    this.graph?.setVolume(perceptual)
  }

  private rebuildQueueOrder(): void {
    const { queue, shuffle: enabled, index } = this.state
    this.order = buildOrder(queue.length, index, enabled)
  }

  private bindDeck(deck: Deck, index: number): void {
    const audio = deck.el
    const active = (): boolean => this.activeDeck === index

    audio.addEventListener('timeupdate', () => {
      if (!active()) return
      if (this.seekRaf) cancelAnimationFrame(this.seekRaf)
      this.seekRaf = requestAnimationFrame(() => {
        this.tick.set({ progress: audio.currentTime * 1000 })
        this.updatePositionState()
        this.saveProgressThrottled()
        this.maybePrefetchRadio()
        this.watchSilence()
        this.maybePreloadNext()
        this.maybeCrossfade()
      })
    })

    audio.addEventListener('durationchange', () => {
      if (!active()) return
      this.store.set({ duration: audio.duration * 1000 || 0 })
      this.updatePositionState()
    })

    audio.addEventListener('progress', () => {
      if (!active()) return
      const buffered = audio.buffered
      if (buffered.length === 0) return
      const end = buffered.end(buffered.length - 1)
      const ratio = audio.duration > 0 ? end / audio.duration : 0
      this.tick.set({ buffered: ratio })
    })

    audio.addEventListener('waiting', () => {
      if (active()) this.store.set({ loading: true })
    })
    audio.addEventListener('playing', () => {
      if (!active()) return
      this.store.set({ loading: false, playing: true, error: null })
      this.updatePlaybackState()
    })
    audio.addEventListener('pause', () => {
      if (!active() || this.fading) return
      this.store.set({ playing: false })
      this.updatePlaybackState()
      this.savePlayback()
    })
    audio.addEventListener('play', () => {
      if (!active()) return
      this.store.set({ playing: true })
      this.updatePlaybackState()
    })

    audio.addEventListener('canplay', () => {
      if (active() && this.state.loading) this.store.set({ loading: false })
    })

    audio.addEventListener('ended', () => {
      if (active()) this.onEnded()
    })

    audio.addEventListener('error', () => {
      if (!active()) {
        this.dropPreload()
        return
      }
      const trackId = this.state.current?.id
      if (trackId !== this.lastErrorTrackId) {
        this.lastErrorTrackId = trackId ?? null
        this.store.set({ error: t('No se pudo reproducir este track'), loading: false, playing: false })
        const nextIndex = this.peekNext(true)
        if (nextIndex !== null) this.jumpTo(nextIndex)
      }
    })

  }

  private bindWindowEvents(): void {
    window.addEventListener('pagehide', () => this.savePlayback())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.savePlayback()
    })
  }

  private savePlayback(): void {
    if (this.state.current && this.hasSource()) {
      const seconds = this.audio.currentTime
      if (Number.isFinite(seconds) && seconds > 0) this.tick.set({ progress: seconds * 1000 })
    }
    this.lastProgressSave = Date.now()
    this.persist()
  }

  private saveProgressThrottled(): void {
    const now = Date.now()
    if (now - this.lastProgressSave < PROGRESS_SAVE_MS) return
    this.lastProgressSave = now
    this.persist()
  }

  private applyPendingSeek(track: Track, resumeMs: number): void {
    if (resumeMs <= 0) return
    const audio = this.audio
    const seek = (): void => {
      if (this.state.current?.id !== track.id) return
      const seconds = resumeMs / 1000
      const duration = audio.duration
      if (Number.isFinite(duration) && duration > 0 && seconds >= duration - RESUME_TAIL_S) return
      audio.currentTime = seconds
      this.tick.set({ progress: seconds * 1000 })
      this.updatePositionState()
    }
    if (audio.readyState >= 1) seek()
    else audio.addEventListener('loadedmetadata', seek, { once: true })
  }

  private bindMediaSession(): void {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        return
      }
    }
    bind('play', () => this.play())
    bind('pause', () => this.pause())
    bind('previoustrack', () => this.prev())
    bind('nexttrack', () => this.next())
    bind('seekto', (details) => {
      if (details.seekTime != null) this.seekTo(details.seekTime * 1000)
    })
    bind('seekbackward', (details) => {
      const offset = (details.seekOffset ?? 10) * 1000
      this.seekTo(this.audio.currentTime * 1000 - offset)
    })
    bind('seekforward', (details) => {
      const offset = (details.seekOffset ?? 10) * 1000
      this.seekTo(this.audio.currentTime * 1000 + offset)
    })
    bind('stop', () => {
      this.pause()
      this.seekTo(0)
    })
  }

  private updateMediaSession(): void {
    if (!('mediaSession' in navigator)) return
    const { current } = this.state
    if (!current) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.user?.username ?? t('SoundCloud'),
        album: t('SoundClear'),
        artwork: current.artwork_url
          ? [{ src: current.artwork_url.replace(/-t\d{3,4}x\d{3,4}/, '-t500x500'), sizes: '500x500', type: 'image/jpeg' }]
          : [],
      })
    } catch {
      return
    }
    this.updatePlaybackState()
  }

  private updatePlaybackState(): void {
    if (!('mediaSession' in navigator)) return
    try {
      navigator.mediaSession.playbackState = this.state.current ? (this.state.playing ? 'playing' : 'paused') : 'none'
    } catch {
      return
    }
    this.updatePositionState()
  }

  private updatePositionState(): void {
    if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return
    const duration = this.audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(Math.max(0, this.audio.currentTime), duration),
      })
    } catch {
      return
    }
  }

  private pushHistory(track: Track): void {
    const { history } = this.state
    const next = [{ track, playedAt: Date.now() }, ...history.filter((entry) => entry.track.id !== track.id)]
    this.store.set({ history: next })
    saveHistory(next)
  }

  progressMs(): number {
    return this.tick.get().progress
  }

  async playTrack(track: Track, queue?: Track[], startIndex = -1): Promise<void> {
    let q = queue
    let idx = startIndex
    if (!q) {
      q = this.state.queue
      idx = q.findIndex((t) => t.id === track.id)
      if (idx === -1) {
        q = [...this.state.queue, track]
        idx = q.length - 1
      }
    }
    this.store.set({ queue: q, index: idx })
    this.order = q.map((_, i) => i)
    if (this.state.shuffle && q.length > 1) this.rebuildQueueOrder()
    this.persist()
    await this.loadAndPlay(q[idx])
  }

  playQueue(tracks: Track[], startIndex = 0): void {
    if (tracks.length === 0) return
    const start = Math.min(Math.max(0, startIndex), tracks.length - 1)
    this.store.set({ radioIds: [] })
    this.radioSeeds.clear()
    void this.playTrack(tracks[start], tracks, start)
  }

  playAll(tracks: Track[]): void {
    this.playQueue(tracks, 0)
  }

  private setCurrent(track: Track, startAt = 0): void {
    this.store.set({
      current: track,
      error: null,
      duration: 0,
      isLiked: this.likeIds.has(track.id),
    })
    this.tick.set({ progress: startAt, buffered: 0 })
    this.updateMediaSession()
  }

  private async loadAndPlay(track: Track): Promise<void> {
    const previous = this.state.current
    const resumeMs = this.pendingResume?.trackId === track.id ? this.pendingResume.progress : 0
    this.pendingResume = null
    this.setCurrent(track, resumeMs)
    this.store.set({ loading: true, playing: false })
    if (previous?.id !== track.id) this.pushHistory(track)

    this.cancelFade()
    this.dropPreload()
    this.ensureGraph()
    const deck = this.deck
    this.destroyHls(deck)
    deck.trackId = track.id
    deck.ready = false
    this.silentTicks = 0

    if (isDrmOnly(track)) {
      this.failCurrent(t('SoundCloud entrega este track cifrado (DRM): solo suena en su propia app'))
      return
    }

    try {
      const local = await offlineBlobUrl(track.id)
      const target = local ? null : await getAPI().streamUrl(track)
      if (!local && !target) {
        this.failCurrent(t('SoundCloud no entregó audio para este track'))
        return
      }
      this.failStreak = 0
      deck.el.preload = 'auto'
      if (local) {
        deck.localUrl = local
        deck.el.src = local
      } else if (target && target.protocol === 'hls') {
        await this.attachHls(deck, target.url)
      } else if (target) {
        deck.el.src = target.url
      }
      deck.el.playbackRate = this.state.rate
      this.applyPendingSeek(track, resumeMs)
      await this.graph?.resume()
      try {
        await deck.el.play()
      } catch {
        this.store.set({ playing: false, loading: false })
      }
    } catch {
      this.failCurrent(t('No se pudo reproducir este track'))
    }
  }

  private crossfadeSeconds(): number {
    if (!this.graph || this.decks.length < 2) return 0
    return getSettings().crossfade
  }

  private maybePreloadNext(): void {
    if (!this.graph || this.decks.length < 2 || this.fading) return
    const { current, repeat } = this.state
    if (!current || repeat === 'one') return
    if (this.preloaded) {
      const pendingIndex = this.peekNext(true)
      const stillNext = pendingIndex !== null && this.state.queue[pendingIndex]?.id === this.preloaded.trackId
      if (stillNext) return
      this.dropPreload()
    }
    const el = this.audio
    const duration = el.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    const lead = Math.max(PRELOAD_LEAD_S, this.crossfadeSeconds() + 2)
    if (duration - el.currentTime > lead) return
    const index = this.peekNext(true)
    if (index === null) return
    const track = this.state.queue[index]
    if (!track || track.id === current.id || isDrmOnly(track)) return
    const deckIndex = this.activeDeck === 0 ? 1 : 0
    this.preloaded = { deck: deckIndex, trackId: track.id, index }
    void this.prepareDeck(deckIndex, track)
  }

  private async prepareDeck(deckIndex: number, track: Track): Promise<void> {
    const deck = this.decks[deckIndex]
    if (!deck) return
    try {
      const local = await offlineBlobUrl(track.id)
      const target = local ? null : await getAPI().streamUrl(track)
      if (!local && !target) throw new Error('sin audio')
      if (this.preloaded?.trackId !== track.id || this.preloaded.deck !== deckIndex) {
        if (local) URL.revokeObjectURL(local)
        return
      }
      this.destroyHls(deck)
      deck.trackId = track.id
      deck.el.preload = 'auto'
      if (deck.gain) deck.gain.gain.value = 0
      if (local) {
        deck.localUrl = local
        deck.el.src = local
      } else if (target && target.protocol === 'hls') {
        await this.attachHls(deck, target.url)
      } else if (target) {
        deck.el.src = target.url
      }
      deck.el.playbackRate = this.state.rate
      deck.ready = true
    } catch {
      if (this.preloaded?.deck === deckIndex) this.preloaded = null
      this.resetDeck(deck)
    }
  }

  private maybeCrossfade(): void {
    if (!this.graph || this.fading) return
    const pending = this.preloaded
    if (!pending) return
    const incoming = this.decks[pending.deck]
    if (!incoming?.ready) return
    const el = this.audio
    const duration = el.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    const remaining = duration - el.currentTime
    const configured = this.crossfadeSeconds()
    const trigger = configured > 0 ? configured : GAPLESS_LEAD_S
    if (remaining > trigger) return
    const span = configured > 0 ? Math.min(configured, Math.max(0.2, remaining)) : GAPLESS_LEAD_S
    this.startCrossfade(pending, span)
  }

  private startCrossfade(pending: { deck: number; trackId: number; index: number }, span: number): void {
    const graph = this.graph
    if (!graph) return
    const outgoing = this.deck
    const incoming = this.decks[pending.deck]
    if (!outgoing.gain || !incoming.gain) return
    const track = this.state.queue[pending.index]
    if (!track || track.id !== pending.trackId) {
      this.dropPreload()
      return
    }
    const at = graph.now()
    const curves = equalPowerCurves()
    incoming.gain.gain.cancelScheduledValues(at)
    outgoing.gain.gain.cancelScheduledValues(at)
    try {
      incoming.gain.gain.setValueCurveAtTime(curves.enter, at, span)
      outgoing.gain.gain.setValueCurveAtTime(curves.out, at, span)
    } catch {
      incoming.gain.gain.setValueAtTime(FADE_FLOOR, at)
      incoming.gain.gain.linearRampToValueAtTime(1, at + span)
      outgoing.gain.gain.setValueAtTime(outgoing.gain.gain.value, at)
      outgoing.gain.gain.linearRampToValueAtTime(FADE_FLOOR, at + span)
    }
    this.fading = true
    this.preloaded = null
    void incoming.el.play().catch(() => {})
    this.activeDeck = pending.deck
    this.silentTicks = 0
    this.adoptDeck(track, pending.index)
    this.fadeTimer = setTimeout(
      () => {
        this.fadeTimer = null
        this.fading = false
        if (this.deck !== outgoing) this.resetDeck(outgoing)
      },
      span * 1000 + 150,
    )
  }

  private adoptDeck(track: Track, index: number): void {
    this.pendingResume = null
    this.failStreak = 0
    this.lastErrorTrackId = null
    this.store.set({
      index,
      current: track,
      error: null,
      loading: false,
      playing: true,
      duration: this.audio.duration * 1000 || 0,
      isLiked: this.likeIds.has(track.id),
    })
    this.tick.set({ progress: this.audio.currentTime * 1000, buffered: 0 })
    this.pushHistory(track)
    this.persist()
    this.updateMediaSession()
  }

  private watchSilence(): void {
    const graph = this.graph
    if (!graph || this.fading) return
    const el = this.audio
    const gain = this.state.volume * this.state.volume
    if (!this.state.playing || el.muted || gain < SILENCE_MIN_GAIN) return
    if (el.currentTime < 1 || el.currentTime > SILENCE_WINDOW_S) return
    if (graph.level() >= SILENCE_RMS * gain) {
      this.silentTicks = 0
      return
    }
    this.silentTicks++
    if (this.silentTicks < SILENCE_TICKS) return
    this.dropGraph(t('El motor de audio avanzado no daba sonido en este sistema: lo he desactivado (Ajustes › Audio)'))
  }

  private dropGraph(message: string): void {
    const track = this.state.current
    const at = this.audio.currentTime
    const wasPlaying = this.state.playing
    this.cancelFade()
    for (const deck of this.decks) this.resetDeck(deck)
    this.graph = null
    this.graphOff = true
    this.silentTicks = 0
    updateSettings({ dsp: false })
    this.buildDecks(1)
    toastErr(message)
    if (!track) return
    this.pendingResume = { trackId: track.id, progress: at * 1000 }
    if (wasPlaying) void this.loadAndPlay(track)
  }

  graphActive(): boolean {
    return this.graph !== null
  }

  diagnostics(): {
    graph: boolean
    suspended: boolean
    active: number
    level: number
    crossfade: number
    fading: boolean
    eq: number[]
    leveling: boolean
    decks: { trackId: number | null; ready: boolean; gain: number; paused: boolean; time: number; duration: number; local: boolean }[]
  } {
    const settings = getSettings()
    return {
      graph: this.graph !== null,
      suspended: this.graph?.suspended() ?? false,
      active: this.activeDeck,
      level: this.graph?.level() ?? 0,
      crossfade: settings.crossfade,
      fading: this.fading,
      eq: [...settings.eq],
      leveling: settings.leveling,
      decks: this.decks.map((deck) => ({
        trackId: deck.trackId,
        ready: deck.ready,
        gain: deck.gain ? Math.round(deck.gain.gain.value * 1000) / 1000 : -1,
        paused: deck.el.paused,
        time: Math.round(deck.el.currentTime * 100) / 100,
        duration: Number.isFinite(deck.el.duration) ? Math.round(deck.el.duration * 100) / 100 : 0,
        local: deck.localUrl !== null,
      })),
    }
  }

  audioLevel(): number {
    return this.graph?.level() ?? 0
  }

  setDsp(on: boolean): void {
    updateSettings({ dsp: on })
    if (on === (this.decks.length > 1)) return
    const track = this.state.current
    const at = this.audio.currentTime
    const wasPlaying = this.state.playing
    this.cancelFade()
    for (const deck of this.decks) this.resetDeck(deck)
    this.graph = null
    this.graphOff = false
    this.buildDecks(on && audioGraphSupported() ? 2 : 1)
    if (!track) return
    this.pendingResume = { trackId: track.id, progress: at * 1000 }
    if (wasPlaying) void this.loadAndPlay(track)
  }

  previewEq(gains: readonly number[]): void {
    this.graph?.setEq(normalizeGains(gains))
  }

  setEqGains(gains: readonly number[]): void {
    const next = normalizeGains(gains)
    updateSettings({ eq: next })
    this.graph?.setEq(next)
  }

  setLeveling(on: boolean): void {
    updateSettings({ leveling: on })
    this.graph?.setLeveling(on)
  }

  setCrossfade(seconds: number): void {
    updateSettings({ crossfade: seconds })
  }

  private failCurrent(message: string): void {
    this.failStreak++
    this.store.set({ error: message, loading: false, playing: false })
    if (this.failStreak >= FAIL_STREAK_MAX || this.state.queue.length < 2) return
    const target = this.peekNext(true)
    if (target !== null) this.jumpTo(target)
  }

  private async attachHls(deck: Deck, url: string): Promise<void> {
    if (!this.graph && deck.el.canPlayType('application/vnd.apple.mpegurl')) {
      deck.el.src = url
      return
    }
    const { default: Hls } = await import('hls.js')
    if (!Hls.isSupported()) {
      if (!deck.el.canPlayType('application/vnd.apple.mpegurl')) throw new Error(t('HLS no soportado'))
      deck.el.src = url
      return
    }
    const hls = new Hls({ maxBufferLength: 60 })
    deck.hls = hls
    hls.attachMedia(deck.el)
    hls.loadSource(url)
  }

  private destroyHls(deck: Deck): void {
    if (!deck.hls) return
    deck.hls.destroy()
    deck.hls = null
    deck.el.removeAttribute('src')
    deck.el.load()
  }

  private resetDeck(deck: Deck): void {
    deck.el.pause()
    this.destroyHls(deck)
    deck.el.removeAttribute('src')
    deck.el.load()
    if (deck.localUrl) {
      URL.revokeObjectURL(deck.localUrl)
      deck.localUrl = null
    }
    deck.trackId = null
    deck.ready = false
    if (deck.gain) deck.gain.gain.cancelScheduledValues(this.graph?.now() ?? 0)
    if (deck.gain) deck.gain.gain.value = deck === this.deck ? 1 : 0
  }

  private stopAudio(): void {
    this.cancelFade()
    for (const deck of this.decks) this.resetDeck(deck)
  }

  private dropPreload(): void {
    const pending = this.preloaded
    this.preloaded = null
    if (!pending) return
    const deck = this.decks[pending.deck]
    if (deck && deck !== this.deck) this.resetDeck(deck)
  }

  private cancelFade(): void {
    if (this.fadeTimer) {
      clearTimeout(this.fadeTimer)
      this.fadeTimer = null
    }
    this.fading = false
    const at = this.graph?.now() ?? 0
    for (const deck of this.decks) {
      if (!deck.gain) continue
      const param = deck.gain.gain
      try {
        param.cancelAndHoldAtTime?.(at)
      } catch {
        param.cancelScheduledValues(at)
      }
      param.cancelScheduledValues(at)
      param.setValueAtTime(deck === this.deck ? 1 : 0, at)
    }
    for (const deck of this.decks) {
      if (deck !== this.deck && deck.trackId !== null && !deck.ready) this.resetDeck(deck)
    }
  }

  private ensureGraph(): void {
    if (this.graph || this.graphOff) return
    if (!getSettings().dsp || !audioGraphSupported() || this.decks.length < 2) return
    const settings = getSettings()
    const graph = createAudioGraph(settings.eq, settings.leveling, this.state.volume * this.state.volume)
    if (!graph) {
      this.graphOff = true
      return
    }
    const gains: (GainNode | null)[] = this.decks.map((deck) => graph.route(deck.el))
    if (gains.some((gain) => gain === null)) {
      this.graphOff = true
      this.buildDecks(1)
      return
    }
    this.decks.forEach((deck, index) => {
      deck.gain = gains[index]
      if (deck.gain) deck.gain.gain.value = index === this.activeDeck ? 1 : 0
    })
    this.graph = graph
    this.applyVolume(this.state.volume, this.state.muted)
    void graph.resume()
  }

  private hasSource(): boolean {
    return this.audio.currentSrc !== '' || this.audio.getAttribute('src') !== null
  }

  toggle(): void {
    const { current } = this.state
    if (!current) return
    if (!this.hasSource()) {
      void this.loadAndPlay(current)
      return
    }
    if (this.audio.paused) void this.audio.play()
    else this.audio.pause()
  }

  play(): void {
    const { current } = this.state
    if (!current) return
    if (!this.hasSource()) {
      void this.loadAndPlay(current)
      return
    }
    void this.audio.play()
  }

  pause(): void {
    this.audio.pause()
  }

  retry(): void {
    const { current } = this.state
    if (!current) return
    this.lastErrorTrackId = null
    this.failStreak = 0
    this.store.set({ error: null })
    void this.loadAndPlay(current)
  }

  clearError(): void {
    if (this.state.error) this.store.set({ error: null })
  }

  private peekNext(allowWrap: boolean): number | null {
    const { repeat, queue } = this.state
    if (queue.length === 0) return null
    if (this.order.length !== queue.length) this.rebuildQueueOrder()
    return nextInOrder(this.order, this.state.index, repeat, allowWrap)
  }

  private aheadCount(): number {
    const { queue } = this.state
    if (queue.length === 0) return 0
    if (this.order.length !== queue.length) this.rebuildQueueOrder()
    return aheadOf(this.order, this.state.index)
  }

  next(): void {
    const target = this.peekNext(true)
    if (target !== null) {
      this.jumpTo(target)
      return
    }
    if (this.tryRadioContinue()) return
    this.store.set({ playing: false })
    this.tick.set({ progress: 0 })
  }

  prev(): void {
    const { current } = this.state
    if (current && this.audio.currentTime > 4) {
      this.seekTo(0)
      return
    }
    const { queue } = this.state
    if (queue.length === 0) return
    if (this.order.length !== queue.length) this.rebuildQueueOrder()
    const pos = this.order.indexOf(this.state.index)
    if (pos > 0) {
      this.jumpTo(this.order[pos - 1])
      return
    }
    this.seekTo(0)
  }

  jumpTo(index: number): void {
    const { queue } = this.state
    if (index < 0 || index >= queue.length) return
    this.store.set({ index })
    this.persist()
    void this.loadAndPlay(queue[index])
  }

  private onEnded(): void {
    if (this.state.repeat === 'one') {
      this.seekTo(0)
      void this.audio.play()
      return
    }
    this.next()
  }

  seekTo(ms: number): void {
    if (!this.state.current) return
    const target = Math.min(Math.max(0, ms / 1000), this.audio.duration || Number.MAX_SAFE_INTEGER)
    this.audio.currentTime = target
    this.tick.set({ progress: target * 1000 })
    this.updatePositionState()
  }

  seekRatio(ratio: number): void {
    this.seekTo(ratio * (this.state.duration || 0))
  }

  seekBy(ms: number): void {
    this.seekTo(this.tick.get().progress + ms)
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume))
    this.applyVolume(clamped, clamped === 0)
    this.store.set({ volume: clamped, muted: this.audio.muted })
    updateSettings({ volume: clamped })
  }

  nudgeVolume(delta: number): void {
    this.setVolume(this.state.volume + delta)
  }

  toggleMute(): void {
    if (!this.audio.muted) {
      for (const deck of this.decks) deck.el.muted = true
      this.store.set({ muted: true })
      return
    }
    for (const deck of this.decks) deck.el.muted = false
    if (this.state.volume === 0) {
      this.setVolume(0.5)
      return
    }
    this.applyVolume(this.state.volume, false)
    this.store.set({ muted: false })
  }

  isMuted(): boolean {
    return this.audio.muted
  }

  rates(): number[] {
    return [...RATES]
  }

  setRate(rate: number): void {
    const allowed = RATES.includes(rate) ? rate : 1
    for (const deck of this.decks) deck.el.playbackRate = allowed
    this.store.set({ rate: allowed })
    updateSettings({ rate: allowed })
    this.updatePositionState()
  }

  cycleRate(): void {
    const index = RATES.indexOf(this.state.rate)
    this.setRate(RATES[(index + 1) % RATES.length])
  }

  setSleepTimer(minutes: number | null): void {
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer)
      this.sleepTimer = null
    }
    if (minutes === null || minutes <= 0) {
      if (this.state.sleepAt !== null) this.store.set({ sleepAt: null })
      return
    }
    const ms = minutes * 60_000
    this.store.set({ sleepAt: Date.now() + ms })
    this.sleepTimer = setTimeout(() => {
      this.sleepTimer = null
      this.store.set({ sleepAt: null })
      this.pause()
      toast(t('Temporizador terminado · reproducción en pausa'))
    }, ms)
  }

  setRepeat(mode: PlayerState['repeat']): void {
    this.store.set({ repeat: mode })
    this.persist()
  }

  cycleRepeat(): void {
    const order: PlayerState['repeat'][] = ['off', 'all', 'one']
    const next = order[(order.indexOf(this.state.repeat) + 1) % order.length]
    this.setRepeat(next)
  }

  toggleShuffle(): void {
    const enabled = !this.state.shuffle
    this.store.set({ shuffle: enabled })
    this.rebuildQueueOrder()
    this.persist()
  }

  addToQueue(track: Track): boolean {
    const { queue } = this.state
    if (queue.some((t) => t.id === track.id)) return false
    const wasEmpty = queue.length === 0
    this.store.set({ queue: [...queue, track] })
    if (this.state.index === -1) this.store.set({ index: 0 })
    this.order = this.state.queue.map((_, i) => i)
    if (this.state.shuffle && this.state.queue.length > 1) this.rebuildQueueOrder()
    this.persist()
    if (wasEmpty && !this.state.current) this.setCurrent(track)
    return true
  }

  playNext(track: Track): boolean {
    const { queue, index } = this.state
    if (queue.length === 0 || index < 0) return this.addToQueue(track)
    const existing = queue.findIndex((t) => t.id === track.id)
    const target = index + 1
    if (existing === target) return false
    const next = queue.filter((t) => t.id !== track.id)
    const insertAt = existing >= 0 && existing < index ? index : index + 1
    next.splice(insertAt, 0, track)
    const nextIndex = existing >= 0 && existing < index ? index - 1 : index
    this.store.set({ queue: next, index: nextIndex })
    this.order = next.map((_, i) => i)
    if (this.state.shuffle && next.length > 1) this.rebuildQueueOrder()
    this.persist()
    return true
  }

  addManyToQueue(tracks: Track[], fromRadio = false): number {
    const known = new Set(this.state.queue.map((t) => t.id))
    const fresh = tracks.filter((track) => track && !known.has(track.id))
    if (fresh.length === 0) return 0
    const wasEmpty = this.state.queue.length === 0
    const radioIds = fromRadio
      ? [...this.state.radioIds, ...fresh.map((track) => track.id)].slice(-RADIO_IDS_MAX)
      : this.state.radioIds
    this.store.set({ queue: [...this.state.queue, ...fresh], radioIds })
    if (this.state.index === -1) this.store.set({ index: 0 })
    this.order = this.state.queue.map((_, i) => i)
    if (this.state.shuffle && this.state.queue.length > 1) this.rebuildQueueOrder()
    this.persist()
    if (wasEmpty && !this.state.current) this.setCurrent(fresh[0])
    return fresh.length
  }

  removeFromQueue(index: number): void {
    const { queue, index: current } = this.state
    if (index < 0 || index >= queue.length) return
    const change = removeAt(queue, index, current)
    const nextQueue = change.queue
    const nextIndex = change.index
    let jumpTarget: number | null = null
    if (index === current) {
      if (nextQueue.length === 0) this.stopAudio()
      else jumpTarget = nextIndex
    }
    this.store.set({ queue: nextQueue, index: nextIndex })
    if (nextQueue.length === 0) {
      this.store.set({ current: null, playing: false, duration: 0, loading: false, error: null })
      this.tick.set({ progress: 0, buffered: 0 })
      this.updatePlaybackState()
    }
    this.order = nextQueue.map((_, i) => i)
    if (this.state.shuffle && nextQueue.length > 1) this.rebuildQueueOrder()
    this.persist()
    if (jumpTarget !== null) this.jumpTo(jumpTarget)
  }

  moveInQueue(from: number, to: number): void {
    const { queue, index: current } = this.state
    if (from === to) return
    if (from < 0 || to < 0 || from >= queue.length || to >= queue.length) return
    const change = moveInList(queue, from, to, current)
    const nextQueue = change.queue
    this.store.set({ queue: nextQueue, index: change.index })
    this.order = nextQueue.map((_, i) => i)
    if (this.state.shuffle && nextQueue.length > 1) this.rebuildQueueOrder()
    this.persist()
  }

  removePlayed(): number {
    const { queue, index } = this.state
    const change = dropPlayed(queue, index)
    if (change.removed === 0) return 0
    const nextQueue = change.queue
    this.store.set({ queue: nextQueue, index: change.index })
    this.order = nextQueue.map((_, i) => i)
    if (this.state.shuffle && nextQueue.length > 1) this.rebuildQueueOrder()
    this.persist()
    return change.removed
  }

  dedupeQueue(): number {
    const { queue, index } = this.state
    const change = dedupeById(queue, index)
    const removed = change.removed
    if (removed === 0) return 0
    const nextQueue = change.queue
    this.store.set({ queue: nextQueue, index: change.index })
    this.order = nextQueue.map((_, i) => i)
    if (this.state.shuffle && nextQueue.length > 1) this.rebuildQueueOrder()
    this.persist()
    return removed
  }

  clearQueue(): void {
    this.stopAudio()
    this.store.set({
      queue: [],
      index: -1,
      current: null,
      playing: false,
      duration: 0,
      loading: false,
      error: null,
      radioIds: [],
    })
    this.tick.set({ progress: 0, buffered: 0 })
    this.order = []
    this.radioSeeds.clear()
    this.persist()
    this.updatePlaybackState()
  }

  async startRadio(seed: Track, kind: 'track' | 'artist' = 'track'): Promise<void> {
    const seedId = kind === 'artist' ? seed.user?.id ?? seed.id : seed.id
    this.store.set({ radioLoading: true })
    void this.playTrack(seed, [seed], 0)
    try {
      const tracks = await getAPI().stationTracks(kind, seedId)
      const fresh = tracks.filter((track) => track.id !== seed.id)
      if (fresh.length === 0) {
        toastErr(t('No hay radio disponible para esto'))
        return
      }
      this.radioSeeds.add(seedId)
      this.store.set({ radioIds: [] })
      const added = this.addManyToQueue(fresh, true)
      toast(`Radio activa · ${added} temas parecidos en la cola`, 'ok')
    } catch {
      toastErr(t('No se pudo iniciar la radio'))
    } finally {
      this.store.set({ radioLoading: false })
    }
  }

  private tryRadioContinue(): boolean {
    if (!getSettings().autoplay) return false
    const current = this.state.current
    if (!current) return false
    if (this.radioSeeds.has(current.id) && !this.radioPending) return false
    void this.extendRadio(current, true)
    return true
  }

  private maybePrefetchRadio(): void {
    if (this.radioPending) return
    if (this.state.repeat !== 'off' || this.state.queue.length === 0) return
    const duration = this.audio.duration
    if (!Number.isFinite(duration) || duration <= 0) return
    if (duration - this.audio.currentTime > RADIO_PREFETCH_S) return
    const current = this.state.current
    if (!current || this.radioSeeds.has(current.id)) return
    if (!getSettings().autoplay) return
    if (this.aheadCount() >= RADIO_MIN_AHEAD) return
    void this.extendRadio(current, false)
  }

  private async extendRadio(seed: Track, advance: boolean): Promise<void> {
    if (this.radioPending) {
      await this.radioPending
      if (advance) {
        const target = this.peekNext(false)
        if (target !== null) this.jumpTo(target)
      }
      return
    }
    if (this.radioSeeds.has(seed.id)) {
      if (!advance) return
      const target = this.peekNext(false)
      if (target !== null) this.jumpTo(target)
      else this.store.set({ playing: false })
      return
    }
    this.radioSeeds.add(seed.id)
    this.store.set({ radioLoading: true })
    const run = (async () => {
      try {
        const tracks = await getAPI().stationTracks('track', seed.id)
        const fresh = tracks.filter((track) => track.id !== seed.id).slice(0, RADIO_APPEND)
        this.addManyToQueue(fresh, true)
      } catch {
        return
      } finally {
        this.store.set({ radioLoading: false })
      }
    })()
    this.radioPending = run
    try {
      await run
    } finally {
      this.radioPending = null
    }
    if (!advance) return
    const target = this.peekNext(false)
    if (target !== null) this.jumpTo(target)
    else this.store.set({ playing: false })
  }

  isRadioTrack(id: number): boolean {
    return this.state.radioIds.includes(id)
  }

  isLiked(track: Track): boolean {
    return this.likeIds.has(track.id)
  }

  clearLocalLikes(): void {
    this.likeIds.clear()
    saveLikes([])
    this.store.set((state) => ({ likes: [], isLiked: false, likesRev: state.likesRev + 1, likesTruncated: false }))
    this.likesSyncedFor = null
    this.likesSyncedAt = 0
  }

  async syncAccountLikes(force = false): Promise<void> {
    if (!isDesktop()) return
    const user = accountStore.get().user
    if (!user) return
    if (this.likesSync) {
      await this.likesSync
      return
    }
    const fresh = this.likesSyncedFor === user.id && Date.now() - this.likesSyncedAt < LIKES_TTL
    if (fresh && !force) return
    const run = this.fetchAccountLikes(user.id)
    this.likesSync = run
    try {
      await run
    } finally {
      this.likesSync = null
    }
  }

  private async fetchAccountLikes(userId: number): Promise<void> {
    try {
      const api = getAPI()
      const likes: Track[] = []
      let next: string | null = null
      let truncated = false
      for (let page = 0; page < LIKES_MAX_PAGES; page++) {
        const res = await api.meLikes(userId, LIKES_PAGE_SIZE, next)
        for (const item of res.collection) {
          if (item.kind === 'track') likes.push(item as Track)
        }
        next = res.next_href
        if (!next || res.collection.length === 0) break
        if (page === LIKES_MAX_PAGES - 1) truncated = true
      }
      this.likeIds = new Set(likes.map((track) => track.id))
      this.store.set((state) => ({
        likes,
        likesTruncated: truncated,
        likesRev: state.likesRev + 1,
        isLiked: state.current ? this.likeIds.has(state.current.id) : false,
      }))
      saveLikes(likes)
      this.likesSyncedFor = userId
      this.likesSyncedAt = Date.now()
    } catch {
      return
    }
  }

  toggleLike(track: Track): void {
    const { likes } = this.state
    const exists = this.likeIds.has(track.id)
    const next = exists ? likes.filter((t) => t.id !== track.id) : [track, ...likes]
    if (exists) this.likeIds.delete(track.id)
    else this.likeIds.add(track.id)
    this.store.set((state) => ({
      likes: next,
      isLiked: state.current?.id === track.id ? !exists : state.isLiked,
      likesRev: state.likesRev + 1,
    }))
    saveLikes(next)
    if (isDesktop() && accountStore.get().status === 'ready') {
      void getAPI()
        .toggleAccountLike(track.id, !exists, accountStore.get().user?.id)
        .catch(() => {
          if (exists) this.likeIds.add(track.id)
          else this.likeIds.delete(track.id)
          this.store.set((state) => ({
            likes,
            isLiked: state.current?.id === track.id ? exists : state.isLiked,
            likesRev: state.likesRev + 1,
          }))
          saveLikes(likes)
          toastErr(exists ? 'No se pudo quitar de favoritos' : t('No se pudo guardar en favoritos'))
        })
    }
  }
}
export const player = new Player()
