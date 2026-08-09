import type { Playlist, Searchable, Track, User } from '@soundlite/api'
import { isPlaylist, isTrack } from '@soundlite/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { fmtCount } from '../core/utils'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toastErr } from '../ui/toast'
import './user.css'

type UserTab = 'tracks' | 'playlists' | 'likes'

const TAB_DEFS: { id: UserTab; label: string }[] = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'likes', label: 'Likes' },
]

function pageError(message: string, onRetry?: () => void): HTMLElement {
  const err = h('div', { className: 'page-error' })
  err.appendChild(h('h2', {}, message))
  if (onRetry) err.appendChild(h('button', { className: 'btn btn-primary', onclick: onRetry }, 'Reintentar'))
  return err
}

register('user', (route, container) => {
  document.title = 'Perfil — Soundlite'
  const id = Number(route.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    container.innerHTML = ''
    container.appendChild(pageError('Perfil no encontrado'))
    return
  }

  const api = getAPI()

  let tab: UserTab = 'tracks'
  let tracks: Track[] = []
  let offset = 0
  let loading = false
  let done = false
  let seq = 0

  container.innerHTML = ''
  const view = h('div', { className: 'user-view' })

  const head = h('div', { className: 'profile-head card card-pad' })
  head.appendChild(skeletonHeader())

  const tabs = h('div', { className: 'chip-row user-tabs' })
  const tabButtons = new Map<UserTab, HTMLElement>()
  for (const def of TAB_DEFS) {
    const chip = h(
      'button',
      {
        className: 'chip',
        onclick: () => {
          if (tab === def.id) return
          tab = def.id
          for (const [key, btn] of tabButtons) btn.classList.toggle('active', key === def.id)
          resetAndLoad()
        },
      },
      def.label,
    )
    tabButtons.set(def.id, chip)
    tabs.appendChild(chip)
  }
  tabButtons.get('tracks')?.classList.add('active')

  const results = h('div', { className: 'user-results' })
  const sentinel = h('div', { className: 'load-more' })

  view.append(head, tabs, results, sentinel)
  container.appendChild(view)

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) void loadMore()
      }
    },
    { rootMargin: '200px' },
  )
  observer.observe(sentinel)

  void loadUser()

  async function loadUser(): Promise<void> {
    try {
      const u = await api.user(id)
      if (!container.isConnected) return
      renderHeader(u)
      resetAndLoad()
    } catch {
      if (!container.isConnected) return
      head.innerHTML = ''
      head.appendChild(
        pageError('No se pudo cargar el perfil', () => {
          head.innerHTML = ''
          head.appendChild(skeletonHeader())
          void loadUser()
        }),
      )
    }
  }

  function renderHeader(u: User): void {
    head.innerHTML = ''
    const avatar = avatarEl(u.avatar_url, u.username, 90)
    avatar.className = 'profile-avatar'
    head.appendChild(avatar)

    const info = h('div', { className: 'profile-info' })

    const name = h('h2', { className: 'profile-name' }, u.username)
    if (u.verified) {
      const badge = h('span', { className: 'verified', title: 'Verificado' })
      badge.innerHTML = svgIcon('check', 16)
      name.appendChild(badge)
    }
    info.appendChild(name)

    if (u.full_name && u.full_name !== u.username) {
      info.appendChild(h('div', { className: 'profile-fullname text-dim' }, u.full_name))
    }

    const meta = h('div', { className: 'profile-meta' })
    meta.appendChild(h('span', { className: 'text-dim' }, `${fmtCount(u.followers_count)} seguidores`))
    if (u.city) {
      const city = h('span', { className: 'profile-city text-dim' })
      city.appendChild(iconEl('music', 14))
      city.appendChild(document.createTextNode(u.city))
      meta.appendChild(city)
    }
    info.appendChild(meta)

    const chips = h('div', { className: 'profile-chips' })
    chips.appendChild(h('span', { className: 'chip chip-static' }, `${u.track_count ?? 0} tracks`))
    chips.appendChild(h('span', { className: 'chip chip-static' }, `${u.playlist_count ?? 0} playlists`))
    chips.appendChild(h('span', { className: 'chip chip-static' }, `${u.likes_count ?? 0} likes`))
    info.appendChild(chips)

    const playBtn = h('button', { className: 'btn btn-primary', onclick: () => void playAllTracks() })
    playBtn.appendChild(iconEl('play', 16))
    playBtn.appendChild(document.createTextNode('Reproducir tracks'))
    info.appendChild(playBtn)

    head.appendChild(info)
  }

  async function playAllTracks(): Promise<void> {
    try {
      const res = await api.userContent(id, 'tracks', 0, 50)
      const list = res.collection.filter(isTrack)
      if (list.length === 0) {
        toastErr('Este usuario no tiene tracks')
        return
      }
      player.playQueue(list, 0)
    } catch {
      toastErr('No se pudieron cargar los tracks')
    }
  }

  function resetAndLoad(): void {
    seq++
    offset = 0
    done = false
    loading = false
    tracks = []
    sentinel.innerHTML = ''
    results.classList.toggle('playlist-grid', tab === 'playlists')
    results.innerHTML = ''
    for (const sk of skeletonRows(6)) results.appendChild(sk)
    void loadMore()
  }

  async function loadMore(): Promise<void> {
    if (loading || done) return
    loading = true
    sentinel.innerHTML = '<div class="spinner"></div>'
    const mySeq = seq
    try {
      const res = await api.userContent(id, tab, offset)
      if (mySeq !== seq) return
      const fresh = offset === 0
      offset += res.collection.length
      done = !res.next_href || res.collection.length === 0
      if (fresh) results.innerHTML = ''
      if (res.collection.length > 0) appendContent(res.collection)
      sentinel.innerHTML = ''
      if (done && results.children.length === 0) showEmpty(emptyText())
    } catch {
      if (mySeq !== seq) return
      if (offset === 0) {
        done = true
        sentinel.innerHTML = ''
        results.innerHTML = ''
        results.appendChild(pageError('No se pudo cargar el contenido', () => resetAndLoad()))
      } else {
        toastErr('Error al cargar más contenido')
      }
    } finally {
      if (mySeq === seq) loading = false
    }
  }

  function appendContent(items: Searchable[]): void {
    if (tab === 'playlists') {
      for (const item of items) {
        if (isPlaylist(item)) results.appendChild(playlistCard(item))
      }
      return
    }
    const start = tracks.length
    const list = items.filter(isTrack)
    tracks.push(...list)
    list.forEach((track, index) => {
      const idx = start + index
      results.appendChild(trackRow(track, { showPlays: true, onPlay: () => player.playQueue(tracks, idx) }))
    })
    if (tab === 'likes') {
      for (const item of items) {
        if (isPlaylist(item)) results.appendChild(playlistCard(item))
      }
    }
  }

  function playlistCard(pl: Playlist): HTMLElement {
    const card = h('a', { className: 'playlist-card', href: link(`/playlist/${pl.id}`) })
    card.appendChild(artEl(pl.artwork_url, pl.title, { size: 't500x500' }))
    const meta = h('div', { className: 'pl-meta' })
    meta.appendChild(h('div', { className: 'pl-title truncate' }, pl.title))
    meta.appendChild(h('div', { className: 'pl-count text-faint' }, `${pl.track_count ?? 0} tracks`))
    card.appendChild(meta)
    return card
  }

  function showEmpty(message: string): void {
    results.innerHTML = ''
    const empty = h('div', { className: 'empty-state' })
    empty.appendChild(h('div', { className: 'text-dim' }, message))
    results.appendChild(empty)
  }

  function emptyText(): string {
    if (tab === 'tracks') return 'Este usuario aún no tiene tracks'
    if (tab === 'playlists') return 'Este usuario aún no tiene playlists'
    return 'Este usuario aún no tiene likes'
  }

  function skeletonHeader(): HTMLElement {
    const sk = h('div', { className: 'profile-skel' })
    sk.appendChild(h('div', { className: 'skeleton sk-avatar' }))
    const lines = h('div', { className: 'sk-lines' })
    lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '50%', height: '16px' } }))
    lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '34%' } }))
    lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '42%' } }))
    sk.appendChild(lines)
    return sk
  }
})
