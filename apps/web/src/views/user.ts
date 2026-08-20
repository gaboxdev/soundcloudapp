import type { Playlist, SearchResponse, Searchable, Track, User } from '@soundclear/api'
import { isPlaylist, isTrack } from '@soundclear/api'
import { getAPI } from '../api'
import { accountStore } from '../core/account'
import { trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { canWrite, isBusy, isFollowing, loadSocial, socialStore, toggleFollow } from '../core/social'
import { fmtCount } from '../core/utils'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon, titleIcon } from '../ui/el'
import { skAvatarRow, skMore, skPlaylistCards, skProfileHead, skReveal, skTrackRows } from '../ui/skeleton'
import { toast, toastErr } from '../ui/toast'
import { virtualList, type VirtualList } from '../ui/virtuallist'
import './user.css'
import { t } from '../core/i18n.ts'

type UserTab = 'top' | 'tracks' | 'playlists' | 'reposts' | 'likes'

type TabEntry = { kind: 'track'; track: Track; index: number } | { kind: 'playlist'; playlist: Playlist }

interface TabState {
  node: HTMLElement
  tracks: Track[]
  entries: TabEntry[]
  rendered: number
  mixed: boolean
  grid: boolean
  virtual: VirtualList | null
  next: string | null
  started: boolean
  done: boolean
  failed: boolean
  pending: Promise<void> | null
}

const TAB_DEFS: { id: UserTab; label: string }[] = [
  { id: 'top', label: 'Populares' },
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'reposts', label: 'Publicaciones' },
  { id: 'likes', label: 'Likes' },
]

const PAGE_SIZE = 30
const VIRTUAL_MIN = 60
const QUEUE_LIMIT = 200
const QUEUE_PAGES = 12
const DESC_LIMIT = 320
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g

function accountId(): number | null {
  return accountStore.get().user?.id ?? null
}

function pageError(message: string, onRetry?: () => void): HTMLElement {
  const err = h('div', { className: 'page-error' })
  err.appendChild(h('h2', {}, message))
  if (onRetry) err.appendChild(h('button', { className: 'btn btn-primary', onclick: onRetry }, t('Reintentar')))
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
    const toggle = h('button', { className: 'desc-toggle', type: 'button' }, t('Mostrar más'))
    toggle.addEventListener('click', () => {
      const clamped = body.classList.toggle('clamped')
      toggle.textContent = clamped ? 'Mostrar más' : t('Mostrar menos')
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
  document.title = t('Perfil — SoundClear')
  const id = Number(route.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    container.innerHTML = ''
    container.appendChild(pageError(t('Perfil no encontrado')))
    return
  }

  const api = getAPI()
  let tab: UserTab = 'top'
  let profile: User | null = null

  container.innerHTML = ''
  const view = h('div', { className: 'user-view' })

  const head = h('div', { className: 'profile-head card' })
  head.appendChild(skProfileHead())

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
      entries: [],
      rendered: 0,
      mixed: false,
      grid: def.id === 'playlists',
      virtual: null,
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

  const related = h('section', { className: 'related-artists' })

  view.append(head, tabs, results, sentinel)
  container.appendChild(view)

  const observer = new IntersectionObserver(
    (entries) => {
      if (!container.isConnected) {
        observer.disconnect()
        for (const def of TAB_DEFS) tabStates[def.id].virtual?.destroy()
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
    state.virtual?.refresh()
    if (!state.started && !state.failed) {
      showTabSkeletons(next)
      void loadTab(next)
    } else {
      syncSentinel()
      maybeContinue()
    }
  }

  function clearPanel(state: TabState): void {
    if (state.virtual) {
      state.virtual.destroy()
      state.virtual = null
    }
    state.rendered = 0
    state.node.replaceChildren()
  }

  function showTabSkeletons(tabId: UserTab): void {
    const state = tabStates[tabId]
    clearPanel(state)
    const skeletons = tabId === 'playlists' ? skPlaylistCards(8, 'tile') : skTrackRows(6)
    for (const skeleton of skeletons) state.node.appendChild(skeleton)
  }

  async function loadUser(): Promise<void> {
    try {
      const u = await api.user(id)
      if (!container.isConnected) return
      profile = u
      document.title = `${u.username} — SoundClear`
      renderHeader(u)
    } catch {
      if (!container.isConnected) return
      head.replaceChildren(
        wrapBody(
          pageError(t('No se pudo cargar el perfil'), () => {
            head.replaceChildren(skProfileHead())
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
    skReveal(head)
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
      const badge = h('span', { className: 'verified', title: t('Verificado') })
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
    playBtn.appendChild(document.createTextNode(t('Reproducir tracks')))
    playBtn.addEventListener('click', () => void playAllTracks(playBtn))
    actions.appendChild(playBtn)

    if (canWrite() && u.id !== accountId()) {
      const followBtn = h('button', { className: 'btn btn-ghost profile-follow', type: 'button' }) as HTMLButtonElement
      const paintFollow = (): void => {
        const following = isFollowing(u.id)
        const busy = isBusy(u.id)
        followBtn.disabled = busy
        followBtn.classList.toggle('active', following)
        followBtn.setAttribute('aria-pressed', String(following))
        followBtn.replaceChildren(
          iconEl(following ? 'check' : 'plus', 16),
          document.createTextNode(busy ? 'Guardando…' : following ? 'Siguiendo' : t('Seguir')),
        )
      }
      paintFollow()
      followBtn.addEventListener('click', () => void toggleFollow(u))
      let followAttached = false
      let unsubFollow: (() => void) | null = null
      unsubFollow = socialStore.subscribe(() => {
        if (followAttached && !followBtn.isConnected) {
          unsubFollow?.()
          return
        }
        followAttached = true
        paintFollow()
      })
      actions.appendChild(followBtn)
      void loadSocial()
    }

    if (u.permalink_url) {
      const external = h('a', {
        className: 'btn btn-ghost',
        href: u.permalink_url,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: t('Abrir el perfil en soundcloud.com'),
      })
      external.appendChild(iconEl('external', 16))
      external.appendChild(document.createTextNode(t('Ver en SoundCloud')))
      actions.appendChild(external)
    }
    info.appendChild(actions)

    body.appendChild(info)
    head.appendChild(body)
    loadRelated()
  }

  function loadRelated(): void {
    if (related.isConnected) return
    related.replaceChildren(
      h('div', { className: 'h-section' }, [titleIcon('user', 18), h('span', null, t('Artistas relacionados'))]),
      skAvatarRow(6),
    )
    view.insertBefore(related, tabs)
    void api
      .relatedArtists(id, 10)
      .then((users) => {
        if (!container.isConnected) return
        if (users.length === 0) {
          related.remove()
          return
        }
        related.replaceChildren(h('div', { className: 'h-section' }, [titleIcon('user', 18), h('span', null, t('Artistas relacionados'))]))
        const row = h('div', { className: 'related-row' })
        for (const user of users) {
          const card = h('a', { className: 'related-card', href: link(`/user/${user.id}`), title: user.username })
          const avatar = avatarEl(user.avatar_url, user.username, 72)
          avatar.classList.add('related-avatar')
          card.append(avatar, h('span', { className: 'related-name truncate' }, user.username))
          card.appendChild(h('span', { className: 'related-sub truncate' }, `${fmtCount(user.followers_count)} seguidores`))
          row.appendChild(card)
        }
        related.appendChild(row)
        skReveal(row)
      })
      .catch(() => {
        related.remove()
      })
  }

  async function playAllTracks(button: HTMLButtonElement): Promise<void> {
    const state = tabStates.tracks
    if (!state.started && !state.failed) showTabSkeletons('tracks')
    button.disabled = true
    try {
      let guard = 0
      while (!state.done && state.tracks.length < QUEUE_LIMIT && guard < QUEUE_PAGES) {
        guard++
        await loadTab('tracks')
        if (!container.isConnected) return
      }
      if (state.failed) {
        toastErr(t('No se pudieron cargar los tracks'))
        return
      }
      if (state.tracks.length === 0) {
        toastErr(t('Este usuario no tiene tracks'))
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
      const res = await fetchTab(tabId, state)
      if (!container.isConnected) return
      state.started = true
      if (first) clearPanel(state)
      state.next = res.next_href ?? null
      state.done = !state.next || res.collection.length === 0
      appendContent(state, res.collection)
      if (state.done && state.rendered === 0) {
        clearPanel(state)
        state.node.appendChild(emptyEl(tabId))
      }
    } catch {
      if (!container.isConnected) return
      state.done = true
      if (state.rendered === 0) {
        state.failed = true
        state.started = false
        state.next = null
        clearPanel(state)
        state.node.appendChild(
          pageError(t('No se pudo cargar el contenido'), () => {
            state.failed = false
            state.done = false
            showTabSkeletons(tabId)
            void loadTab(tabId)
          }),
        )
      } else {
        toastErr(t('Error al cargar más contenido'))
      }
    }
  }

  async function fetchTab(tabId: UserTab, state: TabState): Promise<SearchResponse<Searchable>> {
    if (state.started && state.next) return api.page<Searchable>(state.next)
    if (tabId === 'top') {
      const tracks = await api.userTopTracks(id, PAGE_SIZE)
      return { collection: tracks, next_href: null }
    }
    if (tabId === 'reposts') {
      const res = await api.userPosts(id, 0, PAGE_SIZE)
      return { collection: res.collection as unknown as Searchable[], next_href: res.next_href }
    }
    return api.userContent(id, tabId, 0, PAGE_SIZE)
  }

  function appendContent(state: TabState, items: unknown[]): void {
    for (const raw of items) {
      const item = unwrapItem(raw)
      if (!item) continue
      if (isTrack(item)) {
        state.entries.push({ kind: 'track', track: item, index: state.tracks.length })
        state.tracks.push(item)
      } else if (isPlaylist(item)) {
        state.entries.push({ kind: 'playlist', playlist: item })
        state.mixed = true
      }
    }
    renderEntries(state)
  }

  function rowFor(state: TabState, index: number): HTMLElement {
    const entry = state.entries[index]
    if (!entry) return h('div')
    if (entry.kind === 'playlist') return playlistCard(entry.playlist)
    return trackRow(entry.track, {
      showPlays: true,
      onPlay: () => player.playQueue(state.tracks, entry.index),
    })
  }

  function renderEntries(state: TabState): void {
    if (!state.grid && !state.mixed && state.entries.length > VIRTUAL_MIN) {
      let list = state.virtual
      if (!list) {
        const owner = state
        list = virtualList({ row: (index) => rowFor(owner, index) })
        state.virtual = list
        state.node.replaceChildren(list.el)
      }
      list.setCount(state.entries.length)
      state.rendered = state.entries.length
      return
    }
    if (state.virtual) clearPanel(state)
    if (state.rendered >= state.entries.length) return
    const fragment = document.createDocumentFragment()
    for (let index = state.rendered; index < state.entries.length; index++) {
      fragment.appendChild(rowFor(state, index))
    }
    state.node.appendChild(fragment)
    state.rendered = state.entries.length
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
    sentinel.appendChild(skMore(2))
  }

  function playlistCard(pl: Playlist): HTMLElement {
    const title = typeof pl.title === 'string' && pl.title ? pl.title : t('Sin título')
    const card = h('a', { className: 'playlist-card', href: link(`/playlist/${pl.id}`) })
    card.appendChild(artEl(pl.artwork_url, title, { size: 't500x500' }))
    const meta = h('div', { className: 'pl-meta' })
    meta.appendChild(h('div', { className: 'pl-title truncate' }, title))
    const kind = pl.is_album === true || pl.set_type === 'album' ? 'Álbum' : t('Playlist')
    const author = pl.user?.username
    const sub = author && author !== profile?.username ? `${kind} · ${pl.track_count ?? 0} tracks · ${author}` : `${kind} · ${pl.track_count ?? 0} tracks`
    meta.appendChild(h('div', { className: 'pl-count text-faint truncate' }, sub))
    card.appendChild(meta)
    return card
  }

  function emptyEl(tabId: UserTab): HTMLElement {
    const empty = h('div', { className: 'empty-state' })
    const icon =
      tabId === 'likes' ? 'heart' : tabId === 'playlists' ? 'playlist' : tabId === 'reposts' ? 'repost' : 'music'
    empty.appendChild(iconEl(icon, 40))
    empty.appendChild(h('div', { className: 'text-dim' }, emptyText(tabId)))
    return empty
  }

  function emptyText(tabId: UserTab): string {
    if (tabId === 'top') return t('Este usuario aún no tiene tracks populares')
    if (tabId === 'tracks') return t('Este usuario aún no tiene tracks')
    if (tabId === 'playlists') return t('Este usuario aún no tiene playlists')
    if (tabId === 'reposts') return t('Este usuario aún no ha publicado nada')
    return t('Este usuario aún no tiene likes')
  }

})
