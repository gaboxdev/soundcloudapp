import type { Track } from '@soundlite/api'
import { player } from '../player/player'
import { artEl } from '../ui/artwork'
import { link } from '../core/router'
import { esc, fmtCount, fmtTime } from '../core/utils'
import { h, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'

export interface TrackRowOptions {
  rank?: number
  showPlays?: boolean
  showAlbum?: boolean
  onPlay?: (track: Track) => void
  actionButtons?: boolean
}

function heartButton(track: Track): HTMLElement {
  const btn = h(
    'button',
    {
      className: 'icon-btn like-btn',
      dataset: { liked: String(player.isLiked(track)) },
      title: player.isLiked(track) ? 'Quitar de favoritos' : 'Guardar en favoritos',
    },
  )
  const render = () => {
    const liked = player.isLiked(track)
    btn.dataset.liked = String(liked)
    btn.title = liked ? 'Quitar de favoritos' : 'Guardar en favoritos'
    btn.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 18)
  }
  render()
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    player.toggleLike(track)
    render()
    toast(player.isLiked(track) ? 'Guardado en favoritos' : 'Quitado de favoritos', 'ok')
  })
  return btn
}

function queueButton(track: Track): HTMLElement {
  const btn = h('button', { className: 'icon-btn', title: 'Añadir a la cola' })
  btn.innerHTML = svgIcon('plus', 18)
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    player.addToQueue(track)
    toast(`«${track.title}» añadido a la cola`)
  })
  return btn
}

export function trackRow(track: Track, opts: TrackRowOptions = {}): HTMLElement {
  const row = h('div', { className: 'track-row', dataset: { id: String(track.id) } })

  if (opts.rank !== undefined) {
    const rank = h('div', { className: `rank${opts.rank <= 3 ? ' top' : ''}` }, String(opts.rank))
    row.appendChild(rank)
  }

  const art = artEl(track.artwork_url, track.title, { size: 't120x120' })
  art.className = 'art'
  const overlay = document.createElement('div')
  overlay.className = 'play-overlay'
  overlay.innerHTML = svgIcon('play', 20)
  art.appendChild(overlay)
  row.appendChild(art)

  const meta = h('div', { className: 'meta' })
  const title = h(
    'a',
    { className: 'title link-hover', href: link(`/track/${track.id}`) },
    esc(track.title),
  )
  const artist = h(
    'a',
    { className: 'artist link-hover', href: link(`/user/${track.user.id}`) },
    esc(track.user.username),
  )
  meta.appendChild(title)
  meta.appendChild(artist)
  row.appendChild(meta)

  const actions = h('div', { className: 'row-actions' })
  actions.appendChild(heartButton(track))
  actions.appendChild(queueButton(track))
  row.appendChild(actions)

  const stat = h('div', { className: 'stat' })
  stat.textContent = opts.showPlays ? `${fmtCount(track.playback_count)} plays` : fmtTime(track.duration)
  row.appendChild(stat)

  const playAction = opts.onPlay ?? ((t: Track) => player.playTrack(t))

  row.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) return
    if ((event.target as HTMLElement).closest('.like-btn')) return
    playAction(track)
  })

  const unsub = player.store.subscribe((state) => {
    if (!row.isConnected) {
      unsub()
      return
    }
    const isCurrent = state.current?.id === track.id
    row.classList.toggle('playing', isCurrent && state.playing)
  })

  return row
}

export function trackRowSkeleton(): HTMLElement {
  const row = h('div', { className: 'sk-row' })
  const art = h('div', { className: 'skeleton sk-art' })
  const lines = h('div', { className: 'meta' })
  lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '40%' } }))
  lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '28%' } }))
  row.appendChild(art)
  row.appendChild(lines)
  return row
}

export function skeletonRows(count = 8): HTMLElement[] {
  return Array.from({ length: count }, () => trackRowSkeleton())
}
