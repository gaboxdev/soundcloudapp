import type { Playlist, PlaylistSummary, Searchable } from '@soundlite/api'
import { register } from '../core/router'
import { player, type PlayerState } from '../player/player'
import { getAPI } from '../api'
import { accountStore, type AccountState } from '../core/account'
import { saveHistory } from '../core/library'
import { desktopInvoke, isDesktop } from '../api/auth'
import { trackRow } from '../components/trackrow'
import { fmtTime, timeAgo } from '../core/utils'
import { avatarEl, artEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import './views.css'

type Tab = 'likes' | 'playlists' | 'history' | 'account'

const CHUNK = 40

function emptyState(icon: string, text: string, cta?: HTMLElement): HTMLElement {
  const el = h('div', { className: 'empty-state' })
  el.appendChild(iconEl(icon, 44))
  el.appendChild(h('p', null, text))
  if (cta) el.appendChild(cta)
  return el
}

function loadingState(text: string): HTMLElement {
  const el = h('div', { className: 'empty-state' })
  el.appendChild(h('div', { className: 'spinner' }))
  el.appendChild(h('p', null, text))
  return el
}

function isPlaylistLike(item: Searchable): item is Playlist {
  return item.kind === 'playlist' || item.kind === 'album'
}

register('likes', (_route, container) => {
  document.title = 'Favoritos — Soundlite'

  const desktop = isDesktop()
  let tab: Tab = 'likes'

  const page = h('div', { className: 'view-page' })

  const head = h('div', { className: 'page-head' })
  head.appendChild(h('h1', { className: 'h-display' }, 'Favoritos'))
  const headCount = h('div', { className: 'text-faint' })
  head.appendChild(headCount)
  page.appendChild(head)

  const tabs = h('div', { className: 'chip-row' })
  const likesTab = h('button', { className: 'chip active' }, 'Favoritos')
  tabs.appendChild(likesTab)
  const playlistsTab = desktop ? h('button', { className: 'chip' }, 'Tus playlists') : null
  if (playlistsTab) tabs.appendChild(playlistsTab)
  const historyTab = h('button', { className: 'chip' }, 'Historial')
  tabs.appendChild(historyTab)
  const accountTab = desktop ? h('button', { className: 'chip' }, 'Tu cuenta') : null
  if (accountTab) tabs.appendChild(accountTab)
  page.appendChild(tabs)

  const toolbar = h('div', { className: 'page-toolbar' })
  const playAllBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Reproducir todo')
  const syncBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Actualizar')
  const clearHistoryBtn = h('button', { className: 'btn btn-danger btn-sm' }, 'Borrar historial')
  toolbar.appendChild(playAllBtn)
  if (desktop) toolbar.appendChild(syncBtn)
  toolbar.appendChild(clearHistoryBtn)
  page.appendChild(toolbar)

  const notice = h('div', { className: 'view-notice', hidden: true })
  page.appendChild(notice)

  const list = h('div', { className: 'track-list' })
  page.appendChild(list)

  const sentinel = h('div', { className: 'load-more', hidden: true })
  page.appendChild(sentinel)

  container.appendChild(page)

  let account: AccountState = accountStore.get()
  let syncing = false
  let playlists: PlaylistSummary[] | null = null
  let playlistsFor: number | null = null
  let playlistsLoading = false
  let playlistsFailed = false
  let lastKey = ''
  let shown = 0
  let source: { count: number; row: (index: number) => HTMLElement } | null = null

  function updateSentinel(): void {
    const pending = source ? source.count - shown : 0
    sentinel.hidden = pending <= 0
    sentinel.replaceChildren()
    if (pending > 0) sentinel.appendChild(h('div', { className: 'spinner' }))
  }

  function appendChunk(): void {
    if (!source || shown >= source.count) return
    const end = Math.min(shown + CHUNK, source.count)
    const fragment = document.createDocumentFragment()
    for (let i = shown; i < end; i++) fragment.appendChild(source.row(i))
    list.appendChild(fragment)
    shown = end
    updateSentinel()
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) appendChunk()
      }
    },
    { rootMargin: '300px' },
  )
  observer.observe(sentinel)

  function resetList(): void {
    source = null
    shown = 0
    list.replaceChildren()
    updateSentinel()
  }

  function startSync(force = false): void {
    if (!desktop || syncing) return
    if (account.status !== 'ready' || !account.user) return
    syncing = true
    lastKey = ''
    render()
    void player
      .syncAccountLikes(force)
      .catch(() => {})
      .then(() => {
        syncing = false
        if (!container.isConnected) return
        lastKey = ''
        render()
      })
  }

  function setTab(next: Tab): void {
    if (tab === next) return
    tab = next
    lastKey = ''
    likesTab.classList.toggle('active', tab === 'likes')
    playlistsTab?.classList.toggle('active', tab === 'playlists')
    historyTab.classList.toggle('active', tab === 'history')
    accountTab?.classList.toggle('active', tab === 'account')
    render()
  }

  likesTab.addEventListener('click', () => setTab('likes'))
  playlistsTab?.addEventListener('click', () => setTab('playlists'))
  historyTab.addEventListener('click', () => setTab('history'))
  accountTab?.addEventListener('click', () => setTab('account'))

  playAllBtn.addEventListener('click', () => {
    const state = player.store.get()
    if (tab === 'history') {
      const tracks = state.history.map((entry) => entry.track)
      if (tracks.length > 0) player.playQueue(tracks, 0)
      return
    }
    if (state.likes.length > 0) player.playQueue([...state.likes], 0)
  })

  syncBtn.addEventListener('click', () => startSync(true))

  clearHistoryBtn.addEventListener('click', () => {
    if (player.store.get().history.length === 0) return
    player.store.set({ history: [] })
    saveHistory([])
    toast('Historial borrado', 'ok')
  })

  function stateKey(state: PlayerState): string {
    const likes = state.likes
    const history = state.history
    return [
      tab,
      likes.length,
      likes[0]?.id ?? 0,
      likes[likes.length - 1]?.id ?? 0,
      state.likesTruncated ? 1 : 0,
      history.length,
      history[0]?.track.id ?? 0,
      history[0]?.playedAt ?? 0,
      account.status,
      account.user?.id ?? 0,
      syncing ? 1 : 0,
      playlistsFailed ? 1 : 0,
      playlists?.length ?? -1,
    ].join('|')
  }

  function setNotice(text: string | null): void {
    if (!text) {
      notice.hidden = true
      notice.replaceChildren()
      return
    }
    notice.hidden = false
    notice.replaceChildren()
    const icon = h('span', { className: 'view-notice-icon' })
    icon.innerHTML = svgIcon('info', 16)
    notice.appendChild(icon)
    notice.appendChild(h('span', null, text))
  }

  function likesEmpty(): HTMLElement {
    if (!desktop) {
      return emptyState(
        'heart',
        'Todavía no tienes favoritos en este navegador',
        h('a', { className: 'btn btn-ghost', href: '#/search' }, 'Buscar música'),
      )
    }
    if (account.status !== 'ready') {
      return emptyState('heart', 'Conecta tu cuenta de SoundCloud para ver tus favoritos')
    }
    if (syncing) return loadingState('Sincronizando tus favoritos con tu cuenta…')
    return emptyState(
      'heart',
      'Pulsa el corazón en cualquier track para guardarlo aquí',
      h('a', { className: 'btn btn-ghost', href: '#/search' }, 'Buscar música'),
    )
  }

  function renderLikes(state: PlayerState): void {
    playAllBtn.hidden = false
    playAllBtn.disabled = state.likes.length === 0
    syncBtn.hidden = !desktop
    syncBtn.disabled = syncing || account.status !== 'ready'
    syncBtn.textContent = syncing ? 'Sincronizando…' : 'Actualizar'
    clearHistoryBtn.hidden = true
    headCount.textContent =
      state.likes.length === 0 ? '' : `${state.likes.length} ${state.likes.length === 1 ? 'track' : 'tracks'}`
    setNotice(
      state.likesTruncated
        ? 'Tienes tantos favoritos que Soundlite solo ha cargado los más recientes. Usa la búsqueda para encontrar el resto.'
        : null,
    )
    if (state.likes.length === 0) {
      list.appendChild(likesEmpty())
      return
    }
    const likes = state.likes
    source = {
      count: likes.length,
      row: (i) => trackRow(likes[i], { showPlays: true, onPlay: () => player.playQueue([...likes], i) }),
    }
    appendChunk()
  }

  function renderHistory(state: PlayerState): void {
    playAllBtn.hidden = false
    playAllBtn.disabled = state.history.length === 0
    syncBtn.hidden = true
    clearHistoryBtn.hidden = false
    clearHistoryBtn.disabled = state.history.length === 0
    headCount.textContent = ''
    setNotice(null)
    if (state.history.length === 0) {
      list.appendChild(emptyState('clock', 'Aún no has escuchado nada'))
      return
    }
    const history = state.history
    source = {
      count: history.length,
      row: (i) => {
        const entry = history[i]
        const row = trackRow(entry.track, {
          onPlay: () => player.playQueue(history.map((item) => item.track), i),
        })
        const stat = row.querySelector('.stat')
        if (stat) stat.textContent = fmtTime(entry.track.duration)
        row.appendChild(h('div', { className: 'stat played-at' }, timeAgo(new Date(entry.playedAt).toISOString())))
        return row
      },
    }
    appendChunk()
  }

  function renderPlaylists(): void {
    playAllBtn.hidden = true
    syncBtn.hidden = true
    clearHistoryBtn.hidden = true
    headCount.textContent = ''
    setNotice('Se listan las playlists que creaste. Las que solo sigues no aparecen aquí.')
    const user = account.user
    if (!user) {
      list.appendChild(
        account.status === 'unknown'
          ? loadingState('Comprobando tu cuenta…')
          : emptyState('playlist', 'Conecta tu cuenta para ver tus playlists'),
      )
      return
    }
    if (playlists && playlistsFor === user.id) {
      if (playlists.length === 0) {
        list.appendChild(
          emptyState(
            'music',
            'Aún no creaste playlists públicas en SoundCloud',
            h(
              'a',
              { className: 'btn btn-ghost', href: 'https://soundcloud.com/upload/playlist', target: '_blank', rel: 'noopener' },
              'Crear una en soundcloud.com',
            ),
          ),
        )
        return
      }
      const grid = h('div', { className: 'grid-tracks' })
      for (const pl of playlists) {
        const card = h('a', { className: 'playlist-card', href: `#/playlist/${pl.id}` })
        card.appendChild(artEl(pl.artwork_url, pl.title, { size: 't500x500' }))
        const meta = h('div', { className: 'pl-meta' })
        meta.appendChild(h('div', { className: 'pl-title truncate' }, pl.title))
        const kind = pl.kind === 'album' || pl.is_album ? 'Álbum' : 'Playlist'
        meta.appendChild(h('div', { className: 'pl-count text-faint' }, `${kind} · ${pl.track_count ?? 0} tracks`))
        card.appendChild(meta)
        grid.appendChild(card)
      }
      list.appendChild(grid)
      return
    }
    if (playlistsFailed) {
      const retry = h('button', { className: 'btn btn-ghost' }, 'Reintentar')
      retry.addEventListener('click', () => {
        playlistsFailed = false
        lastKey = ''
        render()
      })
      list.appendChild(emptyState('playlist', 'No se pudieron cargar tus playlists', retry))
      return
    }
    list.appendChild(loadingState('Cargando tus playlists…'))
    loadPlaylists()
  }

  function loadPlaylists(): void {
    const user = account.user
    if (!user || playlistsLoading) return
    if (playlists && playlistsFor === user.id) return
    playlistsLoading = true
    const api = getAPI()
    void api
      .mePlaylists(user.id, 50)
      .catch(() => api.userContent(user.id, 'playlists', 0, 50))
      .then((res) => {
        playlists = res.collection.filter(isPlaylistLike)
        playlistsFor = user.id
        playlistsFailed = false
      })
      .catch(() => {
        playlistsFailed = true
      })
      .finally(() => {
        playlistsLoading = false
        if (!container.isConnected) return
        lastKey = ''
        render()
      })
  }

  function renderAccountTab(): void {
    playAllBtn.hidden = true
    syncBtn.hidden = true
    clearHistoryBtn.hidden = true
    headCount.textContent = ''
    setNotice(null)
    if (account.status === 'unknown') {
      list.appendChild(loadingState('Comprobando tu cuenta…'))
      return
    }
    const user = account.user
    if (!user) {
      const loginBtn = h('button', { className: 'btn btn-primary' }, 'Iniciar sesión con SoundCloud')
      loginBtn.addEventListener('click', () => {
        void desktopInvoke('login_window').catch(() => toastErr('No se pudo abrir la ventana de sesión'))
      })
      list.appendChild(emptyState('user', 'Conecta tu cuenta para ver tus likes de SoundCloud', loginBtn))
      return
    }
    const card = h('div', { className: 'card card-pad account-card' })
    const row = h('div', { className: 'account-row' })
    row.appendChild(avatarEl(user.avatar_url, user.username, 56))
    const info = h('div', { className: 'account-info' })
    info.appendChild(h('strong', { className: 'truncate' }, `${user.username}${user.verified ? ' ✓' : ''}`))
    info.appendChild(h('span', { className: 'text-faint' }, 'Tus likes de SoundCloud se sincronizan con esta cuenta'))
    row.appendChild(info)
    card.appendChild(row)
    const stats = h('div', { className: 'chip-row account-stats' })
    stats.appendChild(h('span', { className: 'chip chip-static' }, `${user.likes_count ?? 0} likes`))
    stats.appendChild(h('span', { className: 'chip chip-static' }, `${user.followers_count ?? 0} seguidores`))
    stats.appendChild(h('span', { className: 'chip chip-static' }, `${user.followings_count ?? 0} siguiendo`))
    card.appendChild(stats)
    const actions = h('div', { className: 'account-actions' })
    actions.appendChild(h('a', { className: 'btn btn-ghost btn-sm', href: `#/user/${user.id}` }, 'Ver tu perfil'))
    actions.appendChild(h('a', { className: 'btn btn-ghost btn-sm', href: '#/settings' }, 'Gestionar la sesión'))
    card.appendChild(actions)
    list.appendChild(card)
  }

  function render(): void {
    const state = player.store.get()
    const key = stateKey(state)
    if (key === lastKey) return
    lastKey = key
    resetList()
    toolbar.hidden = tab === 'playlists' || tab === 'account'
    if (tab === 'likes') {
      renderLikes(state)
      return
    }
    if (tab === 'history') {
      renderHistory(state)
      return
    }
    if (tab === 'playlists') {
      renderPlaylists()
      return
    }
    renderAccountTab()
  }

  let playerAttached = false
  let unsubPlayer: (() => void) | null = null
  unsubPlayer = player.store.subscribe(() => {
    if (playerAttached && !container.isConnected) {
      observer.disconnect()
      unsubPlayer?.()
      return
    }
    playerAttached = true
    render()
  })

  let accountAttached = false
  let unsubAccount: (() => void) | null = null
  unsubAccount = accountStore.subscribe((state) => {
    if (accountAttached && !container.isConnected) {
      unsubAccount?.()
      return
    }
    accountAttached = true
    const changed = state.status !== account.status || (state.user?.id ?? 0) !== (account.user?.id ?? 0)
    account = state
    if (!changed) return
    if ((state.user?.id ?? 0) !== playlistsFor) {
      playlists = null
      playlistsFor = null
      playlistsFailed = false
    }
    lastKey = ''
    render()
    startSync()
  })

  startSync()
})
