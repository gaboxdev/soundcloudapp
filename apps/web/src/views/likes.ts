import type { Playlist, PlaylistSummary, Searchable, Track } from '@soundclear/api'
import { register } from '../core/router'
import { player, type PlayerState } from '../player/player'
import { getAPI } from '../api'
import { accountStore, type AccountState } from '../core/account'
import { saveHistory, type HistoryEntry } from '../core/library'
import { desktopInvoke, isDesktop } from '../api/auth'
import { trackRow } from '../components/trackrow'
import { fmtTime, timeAgo } from '../core/utils'
import { avatarEl, artEl } from '../ui/artwork'
import { h, iconChip, iconEl, labelBtn, svgIcon, titleIcon } from '../ui/el'
import { skAccountCard, skCardGrid, skMore, skTrackList } from '../ui/skeleton'
import { toast, toastErr } from '../ui/toast'
import { virtualList, type VirtualList } from '../ui/virtuallist'
import './views.css'
import { t } from '../core/i18n.ts'

type Tab = 'likes' | 'playlists' | 'history' | 'account'

const CHUNK = 40
const VIRTUAL_MIN = 60

function emptyState(icon: string, text: string, cta?: HTMLElement): HTMLElement {
  const el = h('div', { className: 'empty-state' })
  el.appendChild(iconEl(icon, 44))
  el.appendChild(h('p', null, text))
  if (cta) el.appendChild(cta)
  return el
}

function isPlaylistLike(item: Searchable): item is Playlist {
  return item.kind === 'playlist' || item.kind === 'album'
}

register('likes', (_route, container) => {
  document.title = t('Favoritos — SoundClear')

  const desktop = isDesktop()
  let tab: Tab = 'likes'

  const page = h('div', { className: 'view-page' })

  const head = h('div', { className: 'page-head' })
  head.appendChild(h('h1', { className: 'h-display h-icon' }, [titleIcon('heart', 26), h('span', null, t('Favoritos'))]))
  const headCount = h('div', { className: 'text-faint' })
  head.appendChild(headCount)
  page.appendChild(head)

  const tabs = h('div', { className: 'chip-row' })
  const likesTab = iconChip('heart', t('Favoritos'), true)
  tabs.appendChild(likesTab)
  const playlistsTab = desktop ? iconChip('playlist', t('Tus playlists')) : null
  if (playlistsTab) tabs.appendChild(playlistsTab)
  const historyTab = iconChip('clock', t('Historial'))
  tabs.appendChild(historyTab)
  const accountTab = desktop ? iconChip('user', t('Tu cuenta')) : null
  if (accountTab) tabs.appendChild(accountTab)
  page.appendChild(tabs)

  const toolbar = h('div', { className: 'page-toolbar' })
  const playAllBtn = labelBtn('btn btn-ghost btn-sm', 'play', t('Reproducir todo')).btn
  const sync = labelBtn('btn btn-ghost btn-sm', 'refresh', t('Actualizar'))
  const syncBtn = sync.btn
  const syncLabel = sync.label
  const clearHistoryBtn = labelBtn('btn btn-danger btn-sm', 'trash', t('Borrar historial')).btn
  toolbar.appendChild(playAllBtn)
  if (desktop) toolbar.appendChild(syncBtn)
  toolbar.appendChild(clearHistoryBtn)
  page.appendChild(toolbar)

  const sourceRow = h('div', { className: 'chip-row history-source', hidden: true })
  const accountChip = iconChip('user', t('Tu cuenta'), true)
  const localChip = iconChip('layout', t('Este dispositivo'))
  sourceRow.append(accountChip, localChip)
  page.appendChild(sourceRow)

  const notice = h('div', { className: 'view-notice', hidden: true })
  page.appendChild(notice)

  function setHistorySource(next: 'account' | 'local'): void {
    if (historySource === next) return
    historySource = next
    accountChip.classList.toggle('active', next === 'account')
    localChip.classList.toggle('active', next === 'local')
    lastKey = ''
    render()
  }

  accountChip.addEventListener('click', () => setHistorySource('account'))
  localChip.addEventListener('click', () => setHistorySource('local'))

  function loadAccountHistory(): void {
    const user = account.user
    if (!user || accountHistoryLoading) return
    if (accountHistory && accountHistoryFor === user.id) return
    accountHistoryLoading = true
    accountHistoryFailed = false
    void getAPI()
      .playHistory(60)
      .then((res) => {
        accountHistory = res.collection
          .map((entry) => ({ track: entry.track as Track, playedAt: entry.played_at ?? 0 }))
          .filter((entry) => Boolean(entry.track))
        accountHistoryFor = user.id
      })
      .catch(() => {
        accountHistoryFailed = true
      })
      .finally(() => {
        accountHistoryLoading = false
        if (!container.isConnected) return
        lastKey = ''
        render()
      })
  }

  const list = h('div', { className: 'track-list' })
  page.appendChild(list)

  const sentinel = h('div', { className: 'load-more', hidden: true })
  page.appendChild(sentinel)

  container.appendChild(page)

  let account: AccountState = accountStore.get()
  let syncing = false
  let historySource: 'account' | 'local' = 'account'
  let accountHistory: HistoryEntry[] | null = null
  let accountHistoryFor: number | null = null
  let accountHistoryLoading = false
  let accountHistoryFailed = false
  let playlists: PlaylistSummary[] | null = null
  let playlistsFor: number | null = null
  let playlistsLoading = false
  let playlistsFailed = false
  let lastKey = ''
  let shown = 0
  let source: { count: number; row: (index: number) => HTMLElement } | null = null
  let virtual: VirtualList | null = null

  function updateSentinel(): void {
    const pending = virtual || !source ? 0 : source.count - shown
    sentinel.hidden = pending <= 0
    sentinel.replaceChildren()
    if (pending > 0) sentinel.appendChild(skMore(2))
  }

  function appendChunk(): void {
    if (!source) return
    if (source.count > VIRTUAL_MIN) {
      if (!virtual) {
        const rows = source
        virtual = virtualList({ row: (index) => rows.row(index) })
        list.appendChild(virtual.el)
      }
      virtual.setCount(source.count)
      shown = source.count
      updateSentinel()
      return
    }
    if (shown >= source.count) return
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
    if (virtual) {
      virtual.destroy()
      virtual = null
    }
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
      const useAccount = desktop && account.status === 'ready' && historySource === 'account'
      const entries = useAccount ? accountHistory ?? [] : state.history
      const tracks = entries.map((entry) => entry.track)
      if (tracks.length > 0) player.playQueue(tracks, 0)
      return
    }
    if (state.likes.length > 0) player.playQueue([...state.likes], 0)
  })

  syncBtn.addEventListener('click', () => {
    if (tab === 'history') {
      accountHistory = null
      accountHistoryFor = null
      lastKey = ''
      render()
      return
    }
    startSync(true)
  })

  clearHistoryBtn.addEventListener('click', () => {
    if (player.store.get().history.length === 0) return
    player.store.set({ history: [] })
    saveHistory([])
    toast(t('Historial borrado'), 'ok')
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
      historySource,
      accountHistory?.length ?? -1,
      accountHistoryLoading ? 1 : 0,
      accountHistoryFailed ? 1 : 0,
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
        t('Todavía no tienes favoritos en este navegador'),
        h('a', { className: 'btn btn-ghost', href: '#/search' }, t('Buscar música')),
      )
    }
    if (account.status !== 'ready') {
      return emptyState('heart', t('Conecta tu cuenta de SoundCloud para ver tus favoritos'))
    }
    if (syncing) return skTrackList(8)
    return emptyState(
      'heart',
      t('Pulsa el corazón en cualquier track para guardarlo aquí'),
      h('a', { className: 'btn btn-ghost', href: '#/search' }, t('Buscar música')),
    )
  }

  function renderLikes(state: PlayerState): void {
    playAllBtn.hidden = false
    playAllBtn.disabled = state.likes.length === 0
    syncBtn.hidden = !desktop
    syncBtn.disabled = syncing || account.status !== 'ready'
    syncLabel.textContent = syncing ? 'Sincronizando…' : t('Actualizar')
    clearHistoryBtn.hidden = true
    headCount.textContent =
      state.likes.length === 0 ? '' : `${state.likes.length} ${state.likes.length === 1 ? 'track' : 'tracks'}`
    setNotice(
      state.likesTruncated
        ? t('Tienes tantos favoritos que SoundClear solo ha cargado los más recientes. Usa la búsqueda para encontrar el resto.')
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
    const useAccount = desktop && account.status === 'ready' && historySource === 'account'
    sourceRow.hidden = !(desktop && account.status === 'ready')
    playAllBtn.hidden = false
    syncBtn.hidden = !useAccount
    if (useAccount) {
      syncBtn.disabled = accountHistoryLoading
      syncLabel.textContent = accountHistoryLoading ? 'Cargando…' : t('Actualizar')
    }
    clearHistoryBtn.hidden = useAccount
    clearHistoryBtn.disabled = state.history.length === 0
    headCount.textContent = ''
    setNotice(useAccount ? 'Este historial vive en tu cuenta de SoundCloud y cruza dispositivos.' : null)

    if (useAccount) {
      if (accountHistoryFailed) {
        const retry = h('button', { className: 'btn btn-ghost' }, t('Reintentar'))
        retry.addEventListener('click', () => {
          accountHistory = null
          accountHistoryFor = null
          lastKey = ''
          render()
        })
        playAllBtn.disabled = true
        list.appendChild(emptyState('clock', t('No se pudo cargar el historial de tu cuenta'), retry))
        return
      }
      if (!accountHistory || accountHistoryFor !== (account.user?.id ?? -1)) {
        playAllBtn.disabled = true
        list.appendChild(skTrackList(8))
        loadAccountHistory()
        return
      }
      if (accountHistory.length === 0) {
        playAllBtn.disabled = true
        list.appendChild(emptyState('clock', t('Tu cuenta todavía no tiene historial')))
        return
      }
      renderHistoryRows(accountHistory)
      return
    }

    playAllBtn.disabled = state.history.length === 0
    if (state.history.length === 0) {
      list.appendChild(emptyState('clock', t('Aún no has escuchado nada en este dispositivo')))
      return
    }
    renderHistoryRows(state.history)
  }

  function renderHistoryRows(history: HistoryEntry[]): void {
    playAllBtn.disabled = history.length === 0
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
    setNotice(t('Se listan las playlists que creaste. Las que solo sigues no aparecen aquí.'))
    const user = account.user
    if (!user) {
      list.appendChild(
        account.status === 'unknown'
          ? skCardGrid(6, 'row')
          : emptyState('playlist', t('Conecta tu cuenta para ver tus playlists')),
      )
      return
    }
    if (playlists && playlistsFor === user.id) {
      if (playlists.length === 0) {
        list.appendChild(
          emptyState(
            'music',
            t('Aún no creaste playlists públicas en SoundCloud'),
            h(
              'a',
              { className: 'btn btn-ghost', href: 'https://soundcloud.com/upload/playlist', target: '_blank', rel: 'noopener' },
              t('Crear una en soundcloud.com'),
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
        const kind = pl.kind === 'album' || pl.is_album ? 'Álbum' : t('Playlist')
        meta.appendChild(h('div', { className: 'pl-count text-faint' }, `${kind} · ${pl.track_count ?? 0} tracks`))
        card.appendChild(meta)
        grid.appendChild(card)
      }
      list.appendChild(grid)
      return
    }
    if (playlistsFailed) {
      const retry = h('button', { className: 'btn btn-ghost' }, t('Reintentar'))
      retry.addEventListener('click', () => {
        playlistsFailed = false
        lastKey = ''
        render()
      })
      list.appendChild(emptyState('playlist', t('No se pudieron cargar tus playlists'), retry))
      return
    }
    list.appendChild(skCardGrid(6, 'row'))
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
      list.appendChild(skAccountCard())
      return
    }
    const user = account.user
    if (!user) {
      const loginBtn = h('button', { className: 'btn btn-primary' }, t('Iniciar sesión con SoundCloud'))
      loginBtn.addEventListener('click', () => {
        void desktopInvoke('login_window').catch(() => toastErr(t('No se pudo abrir la ventana de sesión')))
      })
      list.appendChild(emptyState('user', t('Conecta tu cuenta para ver tus likes de SoundCloud'), loginBtn))
      return
    }
    const card = h('div', { className: 'card card-pad account-card' })
    const row = h('div', { className: 'account-row' })
    row.appendChild(avatarEl(user.avatar_url, user.username, 56))
    const info = h('div', { className: 'account-info' })
    info.appendChild(h('strong', { className: 'truncate' }, `${user.username}${user.verified ? ' ✓' : ''}`))
    info.appendChild(h('span', { className: 'text-faint' }, t('Tus likes de SoundCloud se sincronizan con esta cuenta')))
    row.appendChild(info)
    card.appendChild(row)
    const stats = h('div', { className: 'chip-row account-stats' })
    stats.appendChild(h('span', { className: 'chip chip-static' }, `${user.likes_count ?? 0} likes`))
    stats.appendChild(h('span', { className: 'chip chip-static' }, `${user.followers_count ?? 0} seguidores`))
    stats.appendChild(h('span', { className: 'chip chip-static' }, `${user.followings_count ?? 0} siguiendo`))
    card.appendChild(stats)
    const actions = h('div', { className: 'account-actions' })
    actions.appendChild(h('a', { className: 'btn btn-ghost btn-sm', href: `#/user/${user.id}` }, t('Ver tu perfil')))
    actions.appendChild(h('a', { className: 'btn btn-ghost btn-sm', href: '#/settings' }, t('Gestionar la sesión')))
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
    if (tab !== 'history') sourceRow.hidden = true
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
      virtual?.destroy()
      virtual = null
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
