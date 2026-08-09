import type { Track, TrackStub, User } from '@soundlite/api'
import { isTrackStub } from '@soundlite/api'
import type { PlayerState } from '../player/player'
import { player } from '../player/player'
import { artEl } from '../ui/artwork'
import { link } from '../core/router'
import { fmtCount, fmtTime } from '../core/utils'
import { h, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'

export interface TrackRowOptions {
  rank?: number
  showPlays?: boolean
  showAlbum?: boolean
  onPlay?: (track: Track) => void
  actionButtons?: boolean
}

function watchPlayer(el: HTMLElement, render: (state: PlayerState) => void): void {
  let unsub: (() => void) | null = null
  let attached = false
  unsub = player.store.subscribe((state) => {
    if (attached && !el.isConnected) {
      unsub?.()
      return
    }
    attached = true
    render(state)
  })
}

function heartButton(track: Track): HTMLElement {
  const btn = h('button', {
    className: 'icon-btn like-btn',
    dataset: { liked: String(player.isLiked(track)) },
    title: player.isLiked(track) ? 'Quitar de favoritos' : 'Guardar en favoritos',
  })
  const render = (liked: boolean): void => {
    btn.dataset.liked = String(liked)
    btn.title = liked ? 'Quitar de favoritos' : 'Guardar en favoritos'
    btn.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 18)
  }
  render(player.isLiked(track))
  watchPlayer(btn, (state) => {
    const liked = state.likes.some((t) => t.id === track.id)
    if (String(liked) !== btn.dataset.liked) render(liked)
  })
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    player.toggleLike(track)
    const liked = player.isLiked(track)
    render(liked)
    toast(liked ? 'Guardado en favoritos' : 'Quitado de favoritos', 'ok')
  })
  return btn
}

function queueButton(track: Track): HTMLElement {
  const btn = h('button', { className: 'icon-btn', title: 'Añadir a la cola' })
  btn.innerHTML = svgIcon('plus', 18)
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    const added = player.addToQueue(track)
    if (added) toast(`«${track.title}» añadido a la cola`, 'ok')
    else toast('Ya estaba en la cola')
  })
  return btn
}

function unavailableRow(id: number): HTMLElement {
  const row = h('div', {
    className: 'track-row row-disabled',
    dataset: { id: String(id) },
    'aria-disabled': 'true',
  })
  const art = h('div', { className: 'art art-frame' })
  art.appendChild(h('div', { className: 'art-fallback' }, '—'))
  row.appendChild(art)
  const meta = h('div', { className: 'meta' })
  meta.appendChild(h('div', { className: 'title text-dim' }, 'Track no disponible'))
  meta.appendChild(h('div', { className: 'artist text-faint' }, 'Este track ya no está en SoundCloud'))
  row.appendChild(meta)
  return row
}

export function trackRow(track: Track | TrackStub, opts: TrackRowOptions = {}): HTMLElement {
  if (isTrackStub(track)) return unavailableRow(track.id)

  const row = h('div', { className: 'track-row', dataset: { id: String(track.id) } })
  const user = track.user as User | undefined

  if (opts.rank !== undefined) {
    const rank = h('div', { className: `rank${opts.rank <= 3 ? ' top' : ''}` }, String(opts.rank))
    row.appendChild(rank)
  }

  const art = artEl(track.artwork_url, track.title, { size: 't120x120' })
  art.classList.add('art')
  const overlay = document.createElement('div')
  overlay.className = 'play-overlay'
  overlay.innerHTML = svgIcon('play', 20)
  art.appendChild(overlay)
  row.appendChild(art)

  const meta = h('div', { className: 'meta' })
  const titleLine = h('div', { className: 'title-line' })
  titleLine.appendChild(h('a', { className: 'title link-hover', href: link(`/track/${track.id}`) }, track.title))
  if (track.policy === 'SNIP') {
    titleLine.appendChild(h('span', { className: 'snip-badge', title: 'Preview de 30s (exclusivo Go+)' }, '30s'))
  }
  meta.appendChild(titleLine)
  meta.appendChild(
    user
      ? h('a', { className: 'artist link-hover', href: link(`/user/${user.id}`) }, user.username)
      : h('span', { className: 'artist text-faint' }, 'Artista desconocido'),
  )
  if (opts.showAlbum) {
    const album = track.publisher_metadata?.album_title
    if (album) meta.appendChild(h('div', { className: 'album truncate' }, album))
  }
  row.appendChild(meta)

  if (opts.actionButtons !== false) {
    const actions = h('div', { className: 'row-actions' })
    actions.appendChild(heartButton(track))
    actions.appendChild(queueButton(track))
    row.appendChild(actions)
  }

  const stat = h('div', { className: 'stat' })
  stat.textContent = opts.showPlays ? `${fmtCount(track.playback_count)} plays` : fmtTime(track.duration)
  row.appendChild(stat)

  const playAction = opts.onPlay ?? ((t: Track) => void player.playTrack(t))

  row.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) return
    if ((event.target as HTMLElement).closest('.row-actions')) return
    playAction(track)
  })

  watchPlayer(row, (state) => {
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
