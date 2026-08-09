import type { Playlist, Track } from '@soundlite/api'
import { isTrackStub } from '@soundlite/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { esc, fmtTime, formatDate, shuffle } from '../core/utils'
import { player } from '../player/player'
import { artEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'
import './playlist.css'

function errorView(message: string, onRetry?: () => void): HTMLElement {
  const view = h('div', { className: 'page-error' })
  view.appendChild(h('h2', null, 'Ups'))
  view.appendChild(h('p', { className: 'text-dim' }, message))
  if (onRetry) {
    view.appendChild(h('button', { className: 'btn btn-primary', onclick: onRetry }, 'Reintentar'))
  } else {
    view.appendChild(h('a', { className: 'btn btn-primary', href: link('/') }, 'Volver al inicio'))
  }
  return view
}

function skeletonView(): HTMLElement {
  const wrap = h('div', { className: 'playlist-skeleton' })
  const header = h('div', { className: 'card card-pad playlist-header' })
  header.appendChild(h('div', { className: 'skeleton sk-art-big' }))
  const info = h('div', { className: 'playlist-info' })
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '60%', height: '30px' } }))
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '34%' } }))
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '50%' } }))
  header.appendChild(info)
  wrap.appendChild(header)
  const list = h('div', { className: 'track-list' })
  for (const row of skeletonRows(8)) list.appendChild(row)
  wrap.appendChild(list)
  return wrap
}

register('playlist', (route, container) => {
  const id = Number(route.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    document.title = 'Soundlite'
    container.appendChild(errorView('Playlist no encontrada'))
    return
  }
  document.title = 'Cargando… — Soundlite'
  container.appendChild(skeletonView())
  void load()

  async function load(): Promise<void> {
    let playlist: Playlist
    try {
      playlist = await getAPI().playlist(id)
    } catch {
      document.title = 'Soundlite'
      container.innerHTML = ''
      container.appendChild(errorView('No se pudo cargar la playlist', () => void load()))
      return
    }
    if (!container.isConnected) return
    document.title = playlist.title
    container.innerHTML = ''
    renderPlaylist(playlist, container)
  }
})

function renderPlaylist(p: Playlist, container: HTMLElement): void {
  const valid = p.tracks.filter((t): t is Track => !isTrackStub(t))
  const trackCount = p.track_count ?? p.tracks.length

  const header = h('div', { className: 'card card-pad playlist-header' })
  const art = artEl(p.artwork_url, p.title, { size: 't500x500', blur: true })
  art.classList.add('playlist-art')
  header.appendChild(art)

  const info = h('div', { className: 'playlist-info' })
  info.appendChild(h('h1', { className: 'h-display' }, esc(p.title)))
  info.appendChild(
    h('a', { className: 'artist-link link-hover', href: link(`/user/${p.user.id}`) }, esc(p.user.username)),
  )

  const chips = h('div', { className: 'chip-row' })
  chips.appendChild(h('span', { className: 'chip' }, `${trackCount} tracks`))
  if (p.duration) chips.appendChild(h('span', { className: 'chip' }, fmtTime(p.duration)))
  if (p.display_date) chips.appendChild(h('span', { className: 'chip' }, formatDate(p.display_date)))
  info.appendChild(chips)

  if (p.description) {
    info.appendChild(h('p', { className: 'playlist-desc text-dim' }, esc(p.description)))
  }

  const actions = h('div', { className: 'playlist-actions' })
  const playBtn = h('button', { className: 'btn btn-primary', onclick: () => player.playQueue(valid, 0) })
  playBtn.innerHTML = `${svgIcon('play', 18)}<span>Reproducir</span>`
  actions.appendChild(playBtn)

  const shuffleBtn = h('button', { className: 'btn btn-ghost', onclick: () => player.playQueue(shuffle(valid), 0) })
  shuffleBtn.innerHTML = `${svgIcon('shuffle', 18)}<span>Mezclar</span>`
  actions.appendChild(shuffleBtn)

  const favBtn = h('button', { className: 'icon-btn', title: 'Guardar en favoritos' })
  favBtn.innerHTML = svgIcon('heart', 20)
  let fav = false
  favBtn.addEventListener('click', () => {
    fav = !fav
    favBtn.innerHTML = svgIcon(fav ? 'heartFill' : 'heart', 20)
    favBtn.classList.toggle('active', fav)
    favBtn.title = fav ? 'Quitar de favoritos' : 'Guardar en favoritos'
    toast(fav ? 'Playlist añadida a favoritos' : 'Playlist quitada de favoritos', 'ok')
  })
  actions.appendChild(favBtn)
  info.appendChild(actions)
  header.appendChild(info)
  container.appendChild(header)

  if (valid.length === 0) {
    const empty = h('div', { className: 'empty-state' })
    empty.appendChild(iconEl('playlist', 44))
    empty.appendChild(h('p', null, 'Esta playlist está vacía'))
    container.appendChild(empty)
    return
  }

  const list = h('div', { className: 'track-list playlist-tracks' })
  valid.forEach((t, i) => {
    list.appendChild(trackRow(t, { rank: i + 1, onPlay: () => player.playQueue(valid, i) }))
  })
  container.appendChild(list)

  if (trackCount > valid.length) {
    container.appendChild(h('p', { className: 'text-faint playlist-note' }, 'Algunos tracks no están disponibles'))
  }
}
