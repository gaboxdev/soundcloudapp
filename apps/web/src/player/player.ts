import type { Track } from '@soundlite/api'
import { getAPI } from '../api'
import { loadHistory, loadLikes, saveHistory, saveLikes, type HistoryEntry } from '../core/library'
import { createStore, type Store } from '../core/store'
import { getSettings, updateSettings } from '../core/settings'
import { shuffle } from '../core/utils'

export interface PlayerState {
  queue: Track[]
  index: number
  playing: boolean
  repeat: 'off' | 'all' | 'one'
  shuffle: boolean
  volume: number
  current: Track | null
  duration: number
  progress: number
  buffered: number
  loading: boolean
  error: string | null
  likes: Track[]
  isLiked: boolean
  history: HistoryEntry[]
}

const QUEUE_KEY = 'sl:player:queue'

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
    // ignora
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
    // sin almacenamiento
  }
}

class Player {
  readonly store: Store<PlayerState>

  private audio: HTMLAudioElement
  private hls: { destroy(): void } | null = null
  private order: number[] = []
  private seekRaf = 0
  private lastErrorTrackId: number | null = null

  constructor() {
    const persisted = loadPersisted()
    const likes = loadLikes()
    const history = loadHistory()

    this.store = createStore<PlayerState>({
      queue: persisted?.queue ?? [],
      index: persisted?.index ?? -1,
      playing: false,
      repeat: persisted?.repeat ?? 'off',
      shuffle: persisted?.shuffle ?? false,
      volume: getSettings().volume,
      current: persisted?.queue && persisted.index >= 0 ? persisted.queue[persisted.index] ?? null : null,
      duration: 0,
      progress: 0,
      buffered: 0,
      loading: false,
      error: null,
      likes,
      isLiked: false,
      history,
    })

    this.audio = new Audio()
    this.audio.preload = 'none'
    this.audio.volume = this.store.get().volume

    if (persisted?.queue && persisted.index >= 0) {
      this.order = persisted.queue.map((_, i) => i)
      if (persisted.shuffle) this.order = shuffle(this.order)
      this.rebuildQueueOrder()
    }

    this.bindAudioEvents()
    this.bindMediaSession()
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
      })
    })

    audio.addEventListener('durationchange', () => {
      this.store.set({ duration: audio.duration * 1000 || 0 })
    })

    audio.addEventListener('progress', () => {
      const buffered = audio.buffered
      if (buffered.length === 0) return
      const end = buffered.end(buffered.length - 1)
      const ratio = audio.duration > 0 ? end / audio.duration : 0
      this.store.set({ buffered: ratio })
    })

    audio.addEventListener('waiting', () => this.store.set({ loading: true }))
    audio.addEventListener('playing', () => this.store.set({ loading: false, playing: true, error: null }))
    audio.addEventListener('pause', () => this.store.set({ playing: false }))
    audio.addEventListener('play', () => this.store.set({ playing: true }))

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
    try {
      ms.setActionHandler('play', () => this.play())
      ms.setActionHandler('pause', () => this.pause())
      ms.setActionHandler('previoustrack', () => this.prev())
      ms.setActionHandler('nexttrack', () => this.next())
      ms.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) this.seekTo(details.seekTime * 1000)
      })
    } catch {
      // media session opcional
    }
  }

  private updateMediaSession(): void {
    if (!('mediaSession' in navigator)) return
    const { current, playing } = this.state
    if (!current) return
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.user.username,
        album: 'Soundlite',
        artwork: current.artwork_url
          ? [{ src: current.artwork_url.replace(/-t\d{3,4}x\d{3,4}/, '-t500x500'), sizes: '500x500', type: 'image/jpeg' }]
          : [],
      })
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    } catch {
      // metadata opcional
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
    await this.loadAndPlay(q[idx])
  }

  playQueue(tracks: Track[], startIndex = 0): void {
    void this.playTrack(tracks[startIndex], tracks, startIndex)
  }

  playAll(tracks: Track[]): void {
    this.playQueue(tracks, 0)
  }

  private async loadAndPlay(track: Track): Promise<void> {
    const state = this.state
    const previous = state.current
    this.store.set({
      current: track,
      error: null,
      loading: true,
      playing: false,
      progress: 0,
      duration: 0,
      buffered: 0,
      isLiked: state.likes.some((t) => t.id === track.id),
    })
    if (previous?.id !== track.id) {
      this.pushHistory(track)
    }
    this.updateMediaSession()

    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }

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
    const { default: Hls } = await import('hls.js')
    if (!Hls.isSupported()) throw new Error('HLS no soportado')
    this.audio.src = url
    const hls = new Hls({ maxBufferLength: 60 })
    this.hls = hls
    hls.loadSource(url)
    hls.attachMedia(this.audio)
  }

  toggle(): void {
    if (!this.state.current) return
    if (this.audio.paused) void this.audio.play()
    else this.audio.pause()
  }

  play(): void {
    if (this.state.current) void this.audio.play()
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
  }

  seekRatio(ratio: number): void {
    this.seekTo(ratio * (this.state.duration || 0))
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, volume))
    this.audio.volume = clamped
    this.audio.muted = clamped === 0
    this.store.set({ volume: clamped })
    updateSettings({ volume: clamped })
  }

  toggleMute(): void {
    const { volume } = this.state
    if (this.audio.muted) {
      this.audio.muted = false
      this.audio.volume = volume || 0.5
    } else {
      this.audio.muted = true
    }
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

  addToQueue(track: Track): void {
    const { queue } = this.state
    if (queue.some((t) => t.id === track.id)) return
    this.store.set({ queue: [...queue, track] })
    if (this.state.index === -1) this.store.set({ index: 0 })
    this.order = this.state.queue.map((_, i) => i)
    persist(this.state)
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
        this.audio.pause()
        this.audio.removeAttribute('src')
        this.audio.load()
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

  clearQueue(): void {
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.store.set({ queue: [], index: -1, current: null, progress: 0, duration: 0, loading: false, error: null })
    this.order = []
    persist(this.state)
  }

  isLiked(track: Track): boolean {
    return this.state.likes.some((t) => t.id === track.id)
  }

  toggleLike(track: Track): void {
    const { likes } = this.state
    const exists = likes.some((t) => t.id === track.id)
    const next = exists ? likes.filter((t) => t.id !== track.id) : [track, ...likes]
    this.store.set({ likes: next, isLiked: !exists })
    saveLikes(next)
  }
}
export const player = new Player()
