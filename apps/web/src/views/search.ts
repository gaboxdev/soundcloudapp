import type { Playlist, Searchable, Track, User } from '@soundlite/api'
import { isPlaylist, isTrack, isUser } from '@soundlite/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { debounce, fmtCount } from '../core/utils'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toastErr } from '../ui/toast'
import './search.css'

type SearchTab = 'tracks' | 'playlists' | 'users'

const TAB_DEFS: { id: SearchTab; label: string }[] = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'users', label: 'Usuarios' },
]

register('search', (route, container) => {
  document.title = 'Búsqueda — Soundlite'
  const api = getAPI()

  let q = route.params.q ?? ''
  let tab: SearchTab = 'tracks'
  let tracks: Track[] = []
  let offset = 0
  let loading = false
  let done = false
  let seq = 0

  container.innerHTML = ''
  const view = h('div', { className: 'search-view' })

  const input = h('input', {
    className: 'input search-field',
    type: 'search',
    placeholder: 'Busca música, artistas y playlists…',
    value: q,
    autofocus: q ? true : undefined,
    oninput: (event) => {
      q = (event.target as HTMLInputElement).value
      requestSuggestions(q)
    },
    onkeydown: (event) => {
      if (event.key === 'Enter') {
        hideSuggestions()
        startSearch()
      } else if (event.key === 'Escape') {
        hideSuggestions()
      }
    },
  })
  input.addEventListener('blur', () => {
    setTimeout(hideSuggestions, 150)
  })

  const searchBox = h('div', { className: 'search-box' })
  searchBox.appendChild(iconEl('search', 20))
  searchBox.appendChild(input)

  const suggestBox = h('div', { className: 'suggest-box' })
  const inputWrap = h('div', { className: 'search-input-wrap' })
  inputWrap.append(searchBox, suggestBox)

  const tabs = h('div', { className: 'chip-row search-tabs' })
  const tabButtons = new Map<SearchTab, HTMLElement>()
  for (const def of TAB_DEFS) {
    const chip = h(
      'button',
      {
        className: 'chip',
        onclick: () => {
          if (tab === def.id) return
          tab = def.id
          for (const [key, btn] of tabButtons) btn.classList.toggle('active', key === def.id)
          startSearch()
        },
      },
      def.label,
    )
    tabButtons.set(def.id, chip)
    tabs.appendChild(chip)
  }
  tabButtons.get('tracks')?.classList.add('active')

  const results = h('div', { className: 'search-results' })
  const sentinel = h('div', { className: 'load-more' })

  view.append(inputWrap, tabs, results, sentinel)
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

  if (q.trim()) {
    startSearch()
  } else {
    showEmpty('Busca música, artistas y playlists de SoundCloud', true)
  }

  const debouncedSuggest = debounce((query: string) => {
    api
      .searchSuggestions(query)
      .then((list) => renderSuggestions(list))
      .catch(() => {})
  }, 250)

  function requestSuggestions(value: string): void {
    const query = value.trim()
    if (query.length < 2) {
      hideSuggestions()
      return
    }
    debouncedSuggest(query)
  }

  function renderSuggestions(list: string[]): void {
    suggestBox.innerHTML = ''
    for (const suggestion of list) {
      const item = h('button', {
        className: 'suggest-item',
        onmousedown: (event: MouseEvent) => {
          event.preventDefault()
          q = suggestion
          input.value = suggestion
          hideSuggestions()
          startSearch()
        },
      })
      item.appendChild(iconEl('search', 14))
      item.appendChild(document.createTextNode(suggestion))
      suggestBox.appendChild(item)
    }
  }

  function hideSuggestions(): void {
    suggestBox.innerHTML = ''
  }

  function startSearch(): void {
    seq++
    offset = 0
    done = false
    loading = false
    tracks = []
    sentinel.innerHTML = ''
    hideSuggestions()
    results.innerHTML = ''
    const query = q.trim()
    if (!query) {
      showEmpty('Busca música, artistas y playlists de SoundCloud', true)
      return
    }
    for (const sk of skeletonRows(6)) results.appendChild(sk)
    void loadMore()
  }

  async function loadMore(): Promise<void> {
    const query = q.trim()
    if (loading || done || !query) return
    loading = true
    sentinel.innerHTML = '<div class="spinner"></div>'
    const mySeq = seq
    try {
      const filters =
        tab === 'tracks' ? { track: true } : tab === 'playlists' ? { playlist: true, album: true } : { user: true }
      const res = await api.search(query, offset, 20, filters)
      if (mySeq !== seq) return
      const list = res.collection.filter((item) =>
        tab === 'tracks' ? isTrack(item) : tab === 'playlists' ? isPlaylist(item) : isUser(item),
      )
      offset += res.collection.length
      done = !res.next_href || res.collection.length === 0
      if (list.length === 0 && offset === 0) {
        done = true
        sentinel.innerHTML = ''
        showEmpty(`Sin resultados para «${query}»`)
        return
      }
      appendResults(list)
      sentinel.innerHTML = ''
    } catch {
      if (mySeq !== seq) return
      if (offset === 0) {
        done = true
        sentinel.innerHTML = ''
        results.innerHTML = ''
        results.appendChild(pageError('No se pudo completar la búsqueda', () => startSearch()))
      } else {
        toastErr('Error al cargar más resultados')
      }
    } finally {
      if (mySeq === seq) loading = false
    }
  }

  function appendResults(items: Searchable[]): void {
    if (tab === 'tracks') {
      const start = tracks.length
      const list = items as Track[]
      tracks.push(...list)
      list.forEach((track, index) => {
        const idx = start + index
        results.appendChild(trackRow(track, { showPlays: true, onPlay: () => player.playQueue(tracks, idx) }))
      })
      return
    }
    if (tab === 'playlists') {
      for (const item of items) results.appendChild(playlistRow(item as Playlist))
      return
    }
    for (const item of items) results.appendChild(userRow(item as User))
  }

  function playlistRow(pl: Playlist): HTMLElement {
    const row = h('a', { className: 'result-row playlist-row', href: link(`/playlist/${pl.id}`) })
    row.appendChild(artEl(pl.artwork_url, pl.title, { size: 't300x300' }))
    const meta = h('div', { className: 'meta' })
    meta.appendChild(h('div', { className: 'title truncate' }, pl.title))
    meta.appendChild(h('div', { className: 'sub text-dim' }, `${pl.track_count ?? 0} tracks · ${pl.user.username}`))
    row.appendChild(meta)
    return row
  }

  function userRow(u: User): HTMLElement {
    const row = h('a', { className: 'result-row user-row', href: link(`/user/${u.id}`) })
    row.appendChild(avatarEl(u.avatar_url, u.username, 48))
    const meta = h('div', { className: 'meta' })
    const title = h('div', { className: 'title truncate' }, u.username)
    if (u.verified) {
      const badge = h('span', { className: 'verified', title: 'Verificado' })
      badge.innerHTML = svgIcon('check', 14)
      title.appendChild(badge)
    }
    meta.appendChild(title)
    meta.appendChild(h('div', { className: 'sub text-dim' }, `${fmtCount(u.followers_count)} seguidores`))
    row.appendChild(meta)
    return row
  }

  function showEmpty(message: string, withIcon = false): void {
    results.innerHTML = ''
    const empty = h('div', { className: 'empty-state' })
    if (withIcon) empty.appendChild(iconEl('search', 44))
    empty.appendChild(h('div', { className: 'text-dim' }, message))
    results.appendChild(empty)
  }

  function pageError(message: string, onRetry: () => void): HTMLElement {
    const err = h('div', { className: 'page-error' })
    err.appendChild(h('h2', {}, message))
    err.appendChild(h('button', { className: 'btn btn-primary', onclick: onRetry }, 'Reintentar'))
    return err
  }
})
