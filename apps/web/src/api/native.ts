import { desktopInvoke, isDesktop } from './auth'
import { getSettings } from '../core/settings'
import { player } from '../player/player'

export interface NativeState {
  title: string
  artist: string
  artwork: string | null
  playing: boolean
  liked: boolean
  progress: number
  duration: number
}

type NativeCommand = string | { cmd?: string; value?: number }

const TICK_MS = 500

let started = false
let miniOpen = false
let lastNow = ''
let lastNotified = 0
let lastTick = 0

function snapshot(): NativeState {
  const state = player.store.get()
  const current = state.current
  return {
    title: current?.title ?? '',
    artist: current?.user?.username ?? '',
    artwork: current?.artwork_url ?? null,
    playing: state.playing,
    liked: state.isLiked,
    progress: player.progressMs(),
    duration: state.duration,
  }
}

export function applyNativeCommand(payload: NativeCommand): void {
  const cmd = typeof payload === 'string' ? payload : payload?.cmd
  const value = typeof payload === 'object' && payload !== null ? payload.value : undefined
  if (isDesktop()) {
    void desktopInvoke('log_debug', { message: `nativo: comando recibido ${String(cmd)}` }).catch(() => {})
  }
  switch (cmd) {
    case 'toggle':
      player.toggle()
      return
    case 'play':
      player.play()
      return
    case 'pause':
      player.pause()
      return
    case 'next':
      player.next()
      return
    case 'prev':
      player.prev()
      return
    case 'like': {
      const current = player.store.get().current
      if (current) player.toggleLike(current)
      return
    }
    case 'seek':
      if (typeof value === 'number') player.seekRatio(value)
      return
    case 'main':
      void desktopInvoke('mini_window', { show: false })
      return
    default:
      return
  }
}

export async function toggleMiniPlayer(): Promise<boolean> {
  if (!isDesktop()) return false
  try {
    return await desktopInvoke<boolean>('toggle_mini')
  } catch {
    return false
  }
}

export async function shortcutStatus(): Promise<[string, string, boolean][]> {
  if (!isDesktop()) return []
  try {
    return await desktopInvoke<[string, string, boolean][]>('shortcut_status')
  } catch {
    return []
  }
}

export async function initNative(): Promise<void> {
  if (started || !isDesktop()) return
  started = true
  let emitEvent: (event: string, payload?: unknown) => Promise<void>
  try {
    const api = await import('@tauri-apps/api/event')
    emitEvent = api.emit
    await api.listen<NativeCommand>('sl:cmd', (event) => applyNativeCommand(event.payload))
    await api.listen('sl:mini-ready', () => {
      miniOpen = true
      void emitEvent('sl:state', snapshot())
    })
    await api.listen('sl:mini-bye', () => {
      miniOpen = false
    })
    await api.listen<string>('sl:link', (event) => {
      const bruto = String(event.payload ?? '')
      const url = bruto.startsWith('soundclear://') ? bruto.replace('soundclear://', 'https://soundcloud.com/') : bruto
      void import('../core/links').then(({ openSoundcloudLink }) => openSoundcloudLink(url))
    })
  } catch {
    return
  }

  const pushState = (): void => {
    if (!miniOpen) return
    void emitEvent('sl:state', snapshot())
  }

  player.store.subscribe((state) => {
    const current = state.current
    const now = current ? `${current.title} — ${current.user?.username ?? ''}`.trim() : ''
    if (now !== lastNow) {
      lastNow = now
      void desktopInvoke('set_now_playing', { text: now }).catch(() => {})
      if (current && getSettings().notifyTrack && state.playing && Date.now() - lastNotified > 2000) {
        lastNotified = Date.now()
        void desktopInvoke('notify_track', {
          title: current.title,
          body: current.user?.username ?? 'SoundClear',
        }).catch(() => {})
      }
    }
    pushState()
  })

  player.tick.subscribe(() => {
    if (!miniOpen) return
    const now = Date.now()
    if (now - lastTick < TICK_MS) return
    lastTick = now
    pushState()
  })
}
