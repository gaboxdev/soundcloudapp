import type { Playlist, Searchable, Track, User } from '@soundlite/api'
import { isPlaylist, isTrack } from '@soundlite/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { fmtCount } from '../core/utils'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import './user.css'

type UserTab = 'tracks' | 'playlists' | 'likes'

interface TabState {
  node: HTMLElement
  tracks: Track[]
  rendered: number
  next: string | null
  started: boolean
  done: boolean
  failed: boolean
  pending: Promise<void> | null
}

const TAB_DEFS: { id: UserTab; label: string }[] = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'likes', label: 'Likes' },
]

const PAGE_SIZE = 30
const QUEUE_LIMIT = 200
const QUEUE_PAGES = 12
const DESC_LIMIT = 320
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g

function pageError(message: string, onRetry?: () => void): HTMLElement {
  const err = h('div', { className: 'page-error' })
  err.appendChild(h('h2', {}, message))
  if (onRetry) err.appendChild(h('button', { className: 'btn btn-primary', onclick: onRetry }, 'Reintentar'))
  return err
}

function unwrapItem(item: unknown): Searchable | null {
  const rec = item as { track?: unknown; playlist?: unknown; system_playlist?: unknown }
  if (rec.track && typeof rec.track === 'object') return rec.track as Searchable
  if (rec.playlist && typeof rec.playlist === 'object') return rec.playlist as Searchable
  if (rec.system_playlist && typeof rec.system_playlist === 'object') return rec.system_playlist as Searchable
  if (isTrack(item) || isPlaylist(item)) return item
  return null
}

function appendLinked(parent: HTMLElement, line: string): void {
  let cursor = 0
  for (const match of line.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const raw = match[0].replace(/[.,;:!?)\]]+$/, '')
    if (start > cursor) parent.appendChild(document.createTextNode(line.slice(cursor, start)))
    parent.appendChild(
      h('a', { className: 'link-hover text-accent', href: raw, target: '_blank', rel: 'noopener noreferrer' }, raw),
    )
    cursor = start + raw.length
  }
  if (cursor < line.length) parent.appendChild(document.createTextNode(line.slice(cursor)))
}

function descriptionEl(text: string): HTMLElement {
  const box = h('div', { className: 'profile-desc-box' })
  const body = h('p', { className: 'profile-desc text-dim' })
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (index > 0) body.appendChild(h('br'))
    appendLinked(body, line)
  })
  box.appendChild(body)
  if (text.length > DESC_LIMIT || lines.length > 4) {
    body.classList.add('clamped')
    const toggle = h('button', { className: 'desc-toggle', type: 'button' }, 'Mostrar más')
    toggle.addEventListener('click', () => {
      const clamped = body.classList.toggle('clamped')
      toggle.textContent = clamped ? 'Mostrar más' : 'Mostrar menos'
    })
    box.appendChild(toggle)
  }
  return box
}

function bannerEl(url: string): HTMLElement {
  const banner = h('div', { className: 'profile-banner' })
  const img = new Image()
  img.loading = 'lazy'
  img.decoding = 'async'
  img.alt = ''
  img.addEventListener('load', () => img.classList.add('loaded'))
  img.src = url
  banner.appendChild(img)
  return banner
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
  let profile: User | null = null

  container.innerHTML = ''
  const view = h('div', { className: 'user-view' })

  const head = h('div', { className: 'profile-head card' })
  head.appendChild(skeletonHeader())

  const tabs = h('div', { className: 'chip-row user-tabs', role: 'tablist' })
  const tabButtons = new Map<UserTab, HTMLElement>()

  const results = h('div', { className: 'user-results' })
  const sentinel = h('div', { className: 'load-more' })

  const tabStates = {} as Record<UserTab, TabState>
  for (const def of TAB_DEFS) {
    const node = h('div', {
      className: def.id === 'playlists' ? 'tab-panel panel-grid' : 'tab-panel',
      role: 'tabpanel',
      'aria-label': def.label,
    })
    node.hidden = def.id !== tab
    results.appendChild(node)
    tabStates[def.id] = {
      node,
      tracks: [],
      rendered: 0,
      next: null,
      started: false,
      done: false,
      failed: false,
      pending: null,
    }

    const chip = h(
      'button',
      {
        className: def.id === tab ? 'chip active' : 'chip',
        type: 'button',
        role: 'tab',
        'aria-selected': def.id === tab ? 'true' : 'false',
        onclick: () => selectTab(def.id),
      },
      def.label,
    )
    tabButtons.set(def.id, chip)
    tabs.appendChild(chip)
  }

  view.append(head, tabs, results, sentinel)
  container.appendChild(view)

  const observer = new IntersectionObserver(
    (entries) => {
      if (!container.isConnected) {
        observer.disconnect()
        return
      }
      for (const entry of entries) {
        if (entry.isIntersecting) void loadTab(tab)
      }
    },
    { rootMargin: '240px' },
  )
  observer.observe(sentinel)

  void loadUser()
  showTabSkeletons(tab)
  void loadTab(tab)

  function selectTab(next: UserTab): void {
    if (next === tab) return
    tab = next
    for (const [key, chip] of tabButtons) {
      const on = key === next
      chip.classList.toggle('active', on)
      chip.setAttribute('aria-selected', on ? 'true' : 'false')
    }
    for (const def of TAB_DEFS) tabStates[def.id].node.hidden = def.id !== next
    const state = tabStates[next]
    if (!state.started && !state.failed) {
      showTabSkeletons(next)
      void loadTab(next)
    } else {
      syncSentinel()
      maybeContinue()
    }
  }

  function showTabSkeletons(tabId: UserTab): void {
    const state = tabStates[tabId]
    state.node.replaceChildren()
    if (tabId === 'playlists') {
      for (let i = 0; i < 8; i++) state.node.appendChild(cardSkeleton())
      return
    }
    for (const skeleton of skeletonRows(6)) state.node.appendChild(skeleton)
  }

  async function loadUser(): Promise<void> {
    try {
      const u = await api.user(id)
      if (!container.isConnected) return
      profile = u
      document.title = `${u.username} — Soundlite`
      renderHeader(u)
    } catch {
      if (!container.isConnected) return
      head.replaceChildren(
        wrapBody(
          pageError('No se pudo cargar el perfil', () => {
            head.replaceChildren(skeletonHeader())
            void loadUser()
          }),
        ),
      )
    }
  }

  function wrapBody(child: HTMLElement): HTMLElement {
    const body = h('div', { className: 'profile-body profile-body-plain' })
    body.appendChild(child)
    return body
  }

  function renderHeader(u: User): void {
    head.replaceChildren()
    const visual = u.visuals?.visuals?.[0]?.visual_url
    if (visual) {
      head.classList.add('has-banner')
      head.appendChild(bannerEl(visual))
    }

    const body = h('div', { className: 'profile-body' })
    const avatar = avatarEl(u.avatar_url, u.username, 96)
    avatar.classList.add('profile-avatar')
    body.appendChild(avatar)

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
    if (typeof u.followings_count === 'number') {
      meta.appendChild(h('span', { className: 'text-dim' }, `${fmtCount(u.followings_count)} siguiendo`))
    }
    const place = [u.city, u.country_code].filter((part) => typeof part === 'string' && part.trim() !== '').join(', ')
    if (place) meta.appendChild(h('span', { className: 'profile-place text-dim' }, place))
    info.appendChild(meta)

    if (u.description && u.description.trim()) info.appendChild(descriptionEl(u.description.trim()))

    const chips = h('div', { className: 'profile-chips' })
    chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(u.track_count)} tracks`))
    chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(u.playlist_count)} playlists`))
    chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(u.likes_count)} likes`))
    info.appendChild(chips)

    const actions = h('div', { className: 'profile-actions' })
    const playBtn = h('button', { className: 'btn btn-primary', type: 'button' })
    playBtn.appendChild(iconEl('play', 16))
    playBtn.appendChild(document.createTextNode('Reproducir tracks'))
    playBtn.addEventListener('click', () => void playAllTracks(playBtn))
    actions.appendChild(playBtn)

    if (u.permalink_url) {
      const external = h('a', {
        className: 'btn btn-ghost',
        href: u.permalink_url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'Abrir el perfil en soundcloud.com',
      })
      external.appendChild(iconEl('external', 16))
      external.appendChild(document.createTextNode('Ver en SoundCloud'))
      actions.appendChild(external)
    }
    info.appendChild(actions)

    body.appendChild(info)
    head.appendChild(body)
  }

  async function playAllTracks(button: HTMLButtonElement): Promise<void> {
    const state = tabStates.tracks
    button.disabled = true
    try {
      let guard = 0
      while (!state.done && state.tracks.length < QUEUE_LIMIT && guard < QUEUE_PAGES) {
        guard++
        await loadTab('tracks')
        if (!container.isConnected) return
      }
      if (state.failed) {
        toastErr('No se pudieron cargar los tracks')
        return
      }
      if (state.tracks.length === 0) {
        toastErr('Este usuario no tiene tracks')
        return
      }
      player.playQueue(state.tracks, 0)
      if (!state.done) toast(`Reproduciendo los primeros ${state.tracks.length} tracks`, 'ok')
    } finally {
      if (container.isConnected) button.disabled = false
    }
  }

  function loadTab(tabId: UserTab): Promise<void> {
    const state = tabStates[tabId]
    if (state.pending) return state.pending
    if (state.done || state.failed || !container.isConnected) return Promise.resolve()
    const running = runLoad(tabId).finally(() => {
      state.pending = null
      if (container.isConnected && tabId === tab) {
        syncSentinel()
        maybeContinue()
      }
    })
    state.pending = running
    return running
  }

  async function runLoad(tabId: UserTab): Promise<void> {
    const state = tabStates[tabId]
    const first = !state.started
    if (tabId === tab && !first) syncSentinel(true)
    try {
      const res =
        state.started && state.next
          ? await api.page<Searchable>(state.next)
          : await api.userContent(id, tabId, 0, PAGE_SIZE)
      if (!container.isConnected) return
      state.started = true
      if (first) state.node.replaceChildren()
      state.next = res.next_href ?? null
      state.done = !state.next || res.collection.length === 0
      appendContent(state, res.collection)
      if (state.done && state.rendered === 0) state.node.replaceChildren(emptyEl(tabId))
    } catch {
      if (!container.isConnected) return
      state.done = true
      if (state.rendered === 0) {
        state.failed = true
        state.started = false
        state.next = null
        state.node.replaceChildren(
          pageError('No se pudo cargar el contenido', () => {
            state.failed = false
            state.done = false
            showTabSkeletons(tabId)
            void loadTab(tabId)
          }),
        )
      } else {
        toastErr('Error al cargar más contenido')
      }
    }
  }

  function appendContent(state: TabState, items: unknown[]): void {
    for (const raw of items) {
      const item = unwrapItem(raw)
      if (!item) continue
      if (isTrack(item)) {
        const index = state.tracks.length
        state.tracks.push(item)
        state.node.appendChild(
          trackRow(item, { showPlays: true, onPlay: () => player.playQueue(state.tracks, index) }),
        )
        state.rendered++
      } else if (isPlaylist(item)) {
        state.node.appendChild(playlistCard(item))
        state.rendered++
      }
    }
  }

  function maybeContinue(): void {
    const state = tabStates[tab]
    if (!container.isConnected || state.pending || state.done) return
    window.requestAnimationFrame(() => {
      const current = tabStates[tab]
      if (!container.isConnected || current.pending || current.done) return
      if (sentinel.getBoundingClientRect().top < window.innerHeight + 240) void loadTab(tab)
    })
  }

  function syncSentinel(loadingMore = false): void {
    sentinel.replaceChildren()
    if (!loadingMore) return
    for (const skeleton of skeletonRows(2)) sentinel.appendChild(skeleton)
  }

  function playlistCard(pl: Playlist): HTMLElement {
    const title = typeof pl.title === 'string' && pl.title ? pl.title : 'Sin título'
    const card = h('a', { className: 'playlist-card', href: link(`/playlist/${pl.id}`) })
    card.appendChild(artEl(pl.artwork_url, title, { size: 't500x500' }))
    const meta = h('div', { className: 'pl-meta' })
    meta.appendChild(h('div', { className: 'pl-title truncate' }, title))
    const kind = pl.is_album === true || pl.set_type === 'album' ? 'Álbum' : 'Playlist'
    const author = pl.user?.username
    const sub = author && author !== profile?.username ? `${kind} · ${pl.track_count ?? 0} tracks · ${author}` : `${kind} · ${pl.track_count ?? 0} tracks`
    meta.appendChild(h('div', { className: 'pl-count text-faint truncate' }, sub))
    card.appendChild(meta)
    return card
  }

  function emptyEl(tabId: UserTab): HTMLElement {
    const empty = h('div', { className: 'empty-state' })
    empty.appendChild(iconEl(tabId === 'likes' ? 'heart' : tabId === 'playlists' ? 'playlist' : 'music', 40))
    empty.appendChild(h('div', { className: 'text-dim' }, emptyText(tabId)))
    return empty
  }

  function emptyText(tabId: UserTab): string {
    if (tabId === 'tracks') return 'Este usuario aún no tiene tracks'
    if (tabId === 'playlists') return 'Este usuario aún no tiene playlists'
    return 'Este usuario aún no tiene likes'
  }

  function cardSkeleton(): HTMLElement {
    const card = h('div', { className: 'sk-card' })
    card.appendChild(h('div', { className: 'skeleton sk-card-art' }))
    card.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '70%' } }))
    card.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '45%' } }))
    return card
  }

  function skeletonHeader(): HTMLElement {
    const body = h('div', { className: 'profile-body' })
    const sk = h('div', { className: 'profile-skel' })
    sk.appendChild(h('div', { className: 'skeleton sk-avatar' }))
    const lines = h('div', { className: 'sk-lines' })
    lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '50%', height: '16px' } }))
    lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '34%' } }))
    lines.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '42%' } }))
    sk.appendChild(lines)
    body.appendChild(sk)
    return body
  }
})
