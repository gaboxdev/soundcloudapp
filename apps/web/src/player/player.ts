import type { Track } from '@soundclear/api'
import { getAPI } from '../api'
import { isDesktop } from '../api/auth'
import { accountStore } from '../core/account'
import { loadHistory, loadLikes, saveHistory, saveLikes, type HistoryEntry } from '../core/library'
import { createStore, type Store } from '../core/store'
import { getSettings, updateSettings } from '../core/settings'
import { shuffle } from '../core/utils'
import { toastErr } from '../ui/toast'

export interface PlayerState {
  queue: Track[]
  index: number
  playing: boolean
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  volume: number
  muted: boolean
  current: Track | null
  duration: number
  progress: number
  buffered: number
  loading: boolean
  error: string | null
  likes: Track[]
  isLiked: boolean
  likesTruncated: boolean
  history: HistoryEntry[]
}

const QUEUE_KEY = 'sl:player:queue'
const LIKES_TTL = 5 * 60 * 1000
const LIKES_PAGE_SIZE = 100
const LIKES_MAX_PAGES = 500

interface PersistedPlayer {
  queue: Track[]
  index: number
  repeat: PlayerState['repeat']
  shuffle: boolean
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

function persist(state: PlayerState): void {
  try {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify({
        queue: state.queue,
        index: state.index,
        repeat: state.repeat,
        shuffle: state.shuffle,
      } satisfies PersistedPlayer),
    )
  } catch {
    return
  }
}

class Player {
  readonly store: Store<PlayerState>

  private audio: HTMLAudioElement
  private hls: { destroy(): void } | null = null
  private order: number[] = []
  private seekRaf = 0
  private lastErrorTrackId: number | null = null
  private likesSync: Promise<void> | null = null
  private likesSyncedFor: number | null = null
  private likesSyncedAt = 0

  constructor() {
    const persisted = loadPersisted()
    const likes = loadLikes()
    const history = loadHistory()
    const volume = getSettings().volume
    const restored = persisted?.queue && persisted.index >= 0 ? persisted.queue[persisted.index] ?? null : null

    this.store = createStore<PlayerState>({
      queue: persisted?.queue ?? [],
      index: persisted?.index ?? -1,
      playing: false,
      repeat: persisted?.repeat ?? 'off',
      shuffle: persisted?.shuffle ?? false,
      volume,
      muted: volume === 0,
      current: restored,
      duration: 0,
      progress: 0,
      buffered: 0,
      loading: false,
      error: null,
      likes,
      isLiked: restored ? likes.some((t) => t.id === restored.id) : false,
      likesTruncated: false,
      history,
    })

    this.audio = new Audio()
    this.audio.preload = 'none'
    this.audio.volume = volume
    this.audio.muted = volume === 0

    if (persisted?.queue && persisted.index >= 0) {
      this.order = persisted.queue.map((_, i) => i)
      if (persisted.shuffle) this.order = shuffle(this.order)
      this.rebuildQueueOrder()
    }

    this.bindAudioEvents()
    this.bindMediaSession()

    accountStore.subscribe((state) => {
      if (state.status === 'ready') void this.syncAccountLikes()
    })
  }

  private get state(): PlayerState {
    return this.store.get()
  }

  private rebuildQueueOrder(): void {
    const { queue, shuffle: enabled } = this.state
    if (enabled && queue.length > 1) {
      const rest = queue.map((_, i) => i).filter((i) => i !== this.state.index)
      this.order = [this.state.index, ...shuffle(rest)]
    } else {
      this.order = queue.map((_, i) => i)
    }
  }

  private bindAudioEvents(): void {
    const audio = this.audio

    audio.addEventListener('timeupdate', () => {
      if (this.seekRaf) cancelAnimationFrame(this.seekRaf)
      this.seekRaf = requestAnimationFrame(() => {
        this.store.set({ progress: audio.currentTime * 1000 })
        this.updatePositionState()
      })
    })

    audio.addEventListener('durationchange', () => {
      this.store.set({ duration: audio.duration * 1000 || 0 })
      this.updatePositionState()
    })

    audio.addEventListener('progress', () => {
      const buffered = audio.buffered
      if (buffered.length === 0) return
      const end = buffered.end(buffered.length - 1)
      const ratio = audio.duration > 0 ? end / audio.duration : 0
      this.store.set({ buffered: ratio })
    })

    audio.addEventListener('waiting', () => this.store.set({ loading: true }))
    audio.addEventListener('playing', () => {
      this.store.set({ loading: false, playing: true, error: null })
      this.updatePlaybackState()
    })
    audio.addEventListener('pause', () => {
      this.store.set({ playing: false })
      this.updatePlaybackState()
    })
    audio.addEventListener('play', () => {
      this.store.set({ playing: true })
      this.updatePlaybackState()
    })

    audio.addEventListener('canplay', () => {
      const state = this.state
      if (state.loading) this.store.set({ loading: false })
    })

    audio.addEventListener('ended', () => this.onEnded())

    audio.addEventListener('error', () => {
      const state = this.state
      const trackId = state.current?.id
      if (trackId !== this.lastErrorTrackId) {
        this.lastErrorTrackId = trackId ?? null
        this.store.set({ error: 'No se pudo reproducir este track', loading: false, playing: false })
        const nextIndex = this.peekNext(true)
        if (nextIndex !== null) {
          this.jumpTo(nextIndex)
        }
      }
    })
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
        artist: current.user?.username ?? 'SoundCloud',
        album: 'SoundClear',
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
    persist(this.state)
    await this.loadAndPlay(q[idx])
  }

  playQueue(tracks: Track[], startIndex = 0): void {
    void this.playTrack(tracks[startIndex], tracks, startIndex)
  }

  playAll(tracks: Track[]): void {
    this.playQueue(tracks, 0)
  }

  private setCurrent(track: Track): void {
    const state = this.state
    this.store.set({
      current: track,
      error: null,
      progress: 0,
      duration: 0,
      buffered: 0,
      isLiked: state.likes.some((t) => t.id === track.id),
    })
    this.updateMediaSession()
  }

  private async loadAndPlay(track: Track): Promise<void> {
    const previous = this.state.current
    this.setCurrent(track)
    this.store.set({ loading: true, playing: false })
    if (previous?.id !== track.id) {
      this.pushHistory(track)
    }

    this.destroyHls()

    try {
      const target = await getAPI().streamUrl(track)
      if (!target) {
        this.store.set({ error: 'Este track no está disponible para streaming', loading: false })
        return
      }
      if (target.protocol === 'hls') {
        await this.attachHls(target.url)
      } else {
        this.audio.src = target.url
      }
      try {
        await this.audio.play()
      } catch {
        this.store.set({ playing: false, loading: false })
      }
    } catch {
      this.store.set({ error: 'No se pudo reproducir este track', loading: false })
    }
  }

  private async attachHls(url: string): Promise<void> {
    if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
      this.audio.src = url
      return
    }
    const { default: Hls } = await import('hls.js')
    if (!Hls.isSupported()) throw new Error('HLS no soportado')
    const hls = new Hls({ maxBufferLength: 60 })
    this.hls = hls
    hls.attachMedia(this.audio)
    hls.loadSource(url)
  }

  private destroyHls(): void {
    if (!this.hls) return
    this.hls.destroy()
    this.hls = null
    this.audio.removeAttribute('src')
    this.audio.load()
  }

  private stopAudio(): void {
    this.audio.pause()
    this.destroyHls()
    this.audio.removeAttribute('src')
    this.audio.load()
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

  private peekNext(allowWrap: boolean): number | null {
    const { repeat, queue } = this.state
    if (queue.length === 0) return null
    if (this.order.length !== queue.length) this.rebuildQueueOrder()
    const pos = this.order.indexOf(this.state.index)
    if (pos === -1) return this.order[0] ?? null
    if (pos + 1 < this.order.length) return this.order[pos + 1]
    if (repeat === 'all' && allowWrap) return this.order[0] ?? null
    return null
  }

  next(): void {
    const target = this.peekNext(true)
    if (target !== null) this.jumpTo(target)
    else this.store.set({ playing: false, progress: 0 })
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
    if (pos > 0) this.jumpTo(this.order[pos - 1])
    else this.jumpTo(this.order[0])
  }

  jumpTo(index: number): void {
    const { queue } = this.state
    if (index < 0 || index >= queue.length) return
    this.store.set({ index })
    persist(this.state)
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
    this.store.set({ progress: target * 1000 })
    this.updatePositionState()
  }

  seekRatio(ratio: number): void {
    this.seekTo(ratio * (this.state.duration || 0))
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume))
    this.audio.volume = clamped
    this.audio.muted = clamped === 0
    this.store.set({ volume: clamped, muted: this.audio.muted })
    updateSettings({ volume: clamped })
  }

  toggleMute(): void {
    if (!this.audio.muted) {
      this.audio.muted = true
      this.store.set({ muted: true })
      return
    }
    this.audio.muted = false
    if (this.state.volume === 0) {
      this.setVolume(0.5)
      return
    }
    this.audio.volume = this.state.volume
    this.store.set({ muted: false })
  }

  isMuted(): boolean {
    return this.audio.muted
  }

  setRepeat(mode: PlayerState['repeat']): void {
    this.store.set({ repeat: mode })
    persist(this.state)
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
    persist(this.state)
  }

  addToQueue(track: Track): boolean {
    const { queue } = this.state
    if (queue.some((t) => t.id === track.id)) return false
    const wasEmpty = queue.length === 0
    this.store.set({ queue: [...queue, track] })
    if (this.state.index === -1) this.store.set({ index: 0 })
    this.order = this.state.queue.map((_, i) => i)
    persist(this.state)
    if (wasEmpty && !this.state.current) this.setCurrent(track)
    return true
  }

  removeFromQueue(index: number): void {
    const { queue, index: current } = this.state
    if (index < 0 || index >= queue.length) return
    const nextQueue = queue.filter((_, i) => i !== index)
    const removedCurrent = index === current
    let nextIndex = current
    let jumpTarget: number | null = null
    if (removedCurrent) {
      if (nextQueue.length === 0) {
        nextIndex = -1
        this.stopAudio()
      } else {
        nextIndex = Math.min(index, nextQueue.length - 1)
        jumpTarget = nextIndex
      }
    } else if (index < current) {
      nextIndex = current - 1
    }
    this.store.set({ queue: nextQueue, index: nextIndex })
    this.order = nextQueue.map((_, i) => i)
    if (this.state.shuffle && nextQueue.length > 1) this.rebuildQueueOrder()
    persist(this.state)
    if (jumpTarget !== null) this.jumpTo(jumpTarget)
  }

  moveInQueue(from: number, to: number): void {
    const { queue, index: current } = this.state
    if (from === to) return
    if (from < 0 || to < 0 || from >= queue.length || to >= queue.length) return
    const nextQueue = [...queue]
    const [moved] = nextQueue.splice(from, 1)
    nextQueue.splice(to, 0, moved)
    let nextIndex = current
    if (current === from) nextIndex = to
    else if (from < current && to >= current) nextIndex = current - 1
    else if (from > current && to <= current) nextIndex = current + 1
    this.store.set({ queue: nextQueue, index: nextIndex })
    this.order = nextQueue.map((_, i) => i)
    if (this.state.shuffle && nextQueue.length > 1) this.rebuildQueueOrder()
    persist(this.state)
  }

  clearQueue(): void {
    this.stopAudio()
    this.store.set({
      queue: [],
      index: -1,
      current: null,
      playing: false,
      progress: 0,
      duration: 0,
      loading: false,
      error: null,
    })
    this.order = []
    persist(this.state)
    this.updatePlaybackState()
  }

  isLiked(track: Track): boolean {
    return this.state.likes.some((t) => t.id === track.id)
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
      this.store.set({
        likes,
        likesTruncated: truncated,
        isLiked: likes.some((t) => t.id === this.state.current?.id),
      })
      saveLikes(likes)
      this.likesSyncedFor = userId
      this.likesSyncedAt = Date.now()
    } catch {
      return
    }
  }

  toggleLike(track: Track): void {
    const { likes } = this.state
    const exists = likes.some((t) => t.id === track.id)
    const next = exists ? likes.filter((t) => t.id !== track.id) : [track, ...likes]
    this.store.set({ likes: next, isLiked: !exists })
    saveLikes(next)
    if (isDesktop() && accountStore.get().status === 'ready') {
      void getAPI()
        .toggleAccountLike(track.id, !exists)
        .catch(() => {
          this.store.set({ likes, isLiked: exists })
          saveLikes(likes)
          toastErr(exists ? 'No se pudo quitar de favoritos' : 'No se pudo guardar en favoritos')
        })
    }
  }
}
export const player = new Player()
