import { artEl } from '../ui/artwork'
import { h, svgIcon } from '../ui/el'
import { fmtTime } from '../core/utils'
import './mini.css'
import { t } from '../core/i18n.ts'

interface MiniState {
  title: string
  artist: string
  artwork: string | null
  playing: boolean
  liked: boolean
  progress: number
  duration: number
}

const empty: MiniState = {
  title: '',
  artist: '',
  artwork: null,
  playing: false,
  liked: false,
  progress: 0,
  duration: 0,
}

export async function bootstrapMini(): Promise<void> {
  document.documentElement.dataset.window = 'mini'
  document.title = t('SoundClear mini')
  const api = await import('@tauri-apps/api/event')
  const send = (cmd: string, value?: number): void => {
    void api.emit('sl:cmd', value === undefined ? cmd : { cmd, value })
  }

  const card = h('div', { className: 'mini-card', dataset: { tauriDragRegion: 'true' } })
  const art = h('div', { className: 'mini-art art-frame' })
  const meta = h('div', { className: 'mini-meta' })
  const title = h('div', { className: 'mini-title truncate' }, t('Nada suena'))
  const artist = h('div', { className: 'mini-artist truncate text-faint' }, t('SoundClear'))
  const bar = h('div', { className: 'mini-bar', role: 'progressbar', 'aria-label': t('Progreso') })
  const fill = h('span', { className: 'mini-fill' })
  bar.appendChild(fill)
  const times = h('div', { className: 'mini-times text-faint' })
  const now = h('span', {}, '0:00')
  const total = h('span', {}, '0:00')
  times.append(now, total)
  meta.append(title, artist, bar, times)

  const controls = h('div', { className: 'mini-controls' })
  const iconBtn = (icon: string, label: string, onClick: () => void, size = 16): HTMLButtonElement => {
    const btn = h('button', { className: 'icon-btn mini-btn', type: 'button', title: label, 'aria-label': label }) as HTMLButtonElement
    btn.innerHTML = svgIcon(icon, size)
    btn.addEventListener('click', onClick)
    return btn
  }
  const prevBtn = iconBtn('prev', t('Anterior'), () => send('prev'))
  const playBtn = iconBtn('play', t('Reproducir o pausar'), () => send('toggle'), 20)
  playBtn.classList.add('mini-play')
  const nextBtn = iconBtn('next', t('Siguiente'), () => send('next'))
  const likeBtn = iconBtn('heart', t('Favorito'), () => send('like'))
  const expandBtn = iconBtn('expand', t('Abrir SoundClear'), () => send('main'))
  controls.append(prevBtn, playBtn, nextBtn, likeBtn, expandBtn)

  card.append(art, meta, controls)
  document.body.replaceChildren(card)

  let current = empty
  let lastArtwork = 'init'

  const paint = (state: MiniState): void => {
    current = state
    const hasTrack = state.title !== ''
    title.textContent = hasTrack ? state.title : t('Nada suena')
    artist.textContent = hasTrack ? state.artist || 'Artista desconocido' : t('Abre SoundClear y elige algo')
    if (state.artwork !== lastArtwork) {
      lastArtwork = state.artwork ?? ''
      art.replaceChildren(...artEl(state.artwork, state.title || t('SoundClear'), { size: 't120x120' }).children)
    }
    playBtn.innerHTML = svgIcon(state.playing ? 'pause' : 'play', 20)
    likeBtn.classList.toggle('active', state.liked)
    likeBtn.innerHTML = svgIcon(state.liked ? 'heartFill' : 'heart', 16)
    const ratio = state.duration > 0 ? Math.min(1, state.progress / state.duration) : 0
    fill.style.width = `${ratio * 100}%`
    bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
    now.textContent = fmtTime(state.progress)
    total.textContent = fmtTime(state.duration)
  }

  bar.addEventListener('click', (event) => {
    if (current.duration <= 0) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    send('seek', ratio)
  })

  await api.listen<MiniState>('sl:state', (event) => {
    if (event.payload) paint(event.payload)
  })
  paint(empty)
  void api.emit('sl:mini-ready')
  window.addEventListener('pagehide', () => {
    void api.emit('sl:mini-bye')
  })
}
