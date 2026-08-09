import type { Playlist, SearchResponse, Track, User } from '@soundclear/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, navigate, register, searchLink } from '../core/router'
import { debounce, fmtCount } from '../core/utils'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toastErr } from '../ui/toast'
import './search.css'

type SearchTab = 'tracks' | 'playlists' | 'albums' | 'users'

const TAB_DEFS: { id: SearchTab; label: string }[] = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Álbumes' },
  { id: 'users', label: 'Usuarios' },
]

const PAGE_SIZE = 20
const SUGGEST_LIST_ID = 'search-suggest-list'

function parseTab(value: string | undefined): SearchTab {
  const found = TAB_DEFS.find((def) => def.id === value)
  return found ? found.id : 'tracks'
}

function isAlbum(pl: Playlist): boolean {
  return pl.is_album === true || pl.set_type === 'album'
}

register('search', (route, container) => {
  const api = getAPI()
  const query = (route.params.q ?? '').trim()
  const tab = parseTab(route.params.tab)

  document.title = query ? `«${query}» — SoundClear` : 'Búsqueda — SoundClear'

  let tracks: Track[] = []
  let next: string | null = null
  let started = false
  let loading = false
  let done = false
  let rendered = 0
  let suggestions: string[] = []
  let activeIndex = -1

  container.innerHTML = ''
  const view = h('div', { className: 'search-view' })

  const input = h('input', {
    className: 'input search-field',
    type: 'search',
    placeholder: 'Busca música, artistas y playlists…',
    value: query,
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': SUGGEST_LIST_ID,
    'aria-autocomplete': 'list',
    'aria-label': 'Buscar en SoundCloud',
  })
  input.addEventListener('input', () => requestSuggestions(input.value))
  input.addEventListener('keydown', (event) => onKeyDown(event))
  input.addEventListener('blur', () => {
    window.setTimeout(hideSuggestions, 150)
  })

  const searchIcon = iconEl('search', 20)
  searchIcon.className = 'search-icon'

  const searchBox = h('div', { className: 'search-box' })
  searchBox.append(searchIcon, input)

  const suggestBox = h('div', {
    className: 'suggest-box',
    id: SUGGEST_LIST_ID,
    role: 'listbox',
    'aria-label': 'Sugerencias de búsqueda',
  })
  const inputWrap = h('div', { className: 'search-input-wrap' })
  inputWrap.append(searchBox, suggestBox)

  const tabs = h('div', { className: 'chip-row search-tabs', role: 'tablist' })
  for (const def of TAB_DEFS) {
    const current = def.id === tab
    tabs.appendChild(
      h(
        'a',
        {
          className: current ? 'chip active' : 'chip',
          href: tabHref(query, def.id),
          role: 'tab',
          'aria-selected': current ? 'true' : 'false',
        },
        def.label,
      ),
    )
  }

  const results = h('div', { className: 'search-results' })
  const sentinel = h('div', { className: 'load-more' })

  view.append(inputWrap, tabs, results, sentinel)
  container.appendChild(view)

  const observer = new IntersectionObserver(
    (entries) => {
      if (!container.isConnected) {
        observer.disconnect()
        return
      }
      for (const entry of entries) {
        if (entry.isIntersecting) void loadMore()
      }
    },
    { rootMargin: '240px' },
  )
  observer.observe(sentinel)

  const debouncedSuggest = debounce((value: string) => {
    api
      .searchSuggestions(value)
      .then((list) => {
        if (!container.isConnected) return
        if (input.value.trim() !== value) return
        renderSuggestions(list)
      })
      .catch(() => {})
  }, 250)

  if (query) {
    for (const skeleton of skeletonRows(6)) results.appendChild(skeleton)
    void loadMore()
  } else {
    done = true
    showEmpty('Busca música, artistas y playlists de SoundCloud', true)
    input.focus()
  }

  function tabHref(value: string, id: SearchTab): string {
    if (!value) return link('/search')
    return id === 'tracks' ? searchLink(value) : link('/search', { q: value, tab: id })
  }

  function submit(value: string): void {
    const trimmed = value.trim()
    hideSuggestions()
    if (!trimmed) {
      navigate('/search')
      return
    }
    navigate('/search', tab === 'tracks' ? { q: trimmed } : { q: trimmed, tab })
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex = activeIndex < 0 ? (step > 0 ? 0 : suggestions.length - 1) : (activeIndex + step + suggestions.length) % suggestions.length
      setActive(nextIndex)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const picked = activeIndex >= 0 ? suggestions[activeIndex] : input.value
      if (activeIndex >= 0) input.value = picked
      submit(picked)
      return
    }
    if (event.key === 'Escape') {
      if (suggestions.length > 0) event.preventDefault()
      hideSuggestions()
    }
  }

  function requestSuggestions(value: string): void {
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      hideSuggestions()
      return
    }
    debouncedSuggest(trimmed)
  }

  function renderSuggestions(list: string[]): void {
    suggestions = list
    activeIndex = -1
    suggestBox.replaceChildren()
    input.removeAttribute('aria-activedescendant')
    input.setAttribute('aria-expanded', list.length > 0 ? 'true' : 'false')
    list.forEach((suggestion, index) => {
      const item = h('button', {
        className: 'suggest-item',
        type: 'button',
        id: `${SUGGEST_LIST_ID}-${index}`,
        role: 'option',
        'aria-selected': 'false',
        onmousedown: (event: MouseEvent) => {
          event.preventDefault()
          input.value = suggestion
          submit(suggestion)
        },
        onmouseenter: () => setActive(index),
      })
      item.appendChild(iconEl('search', 14))
      item.appendChild(document.createTextNode(suggestion))
      suggestBox.appendChild(item)
    })
  }

  function setActive(index: number): void {
    activeIndex = index
    const items = suggestBox.children
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as HTMLElement
      const on = i === index
      item.classList.toggle('active', on)
      item.setAttribute('aria-selected', on ? 'true' : 'false')
    }
    const active = items[index] as HTMLElement | undefined
    if (active) {
      input.setAttribute('aria-activedescendant', active.id)
      active.scrollIntoView({ block: 'nearest' })
    } else {
      input.removeAttribute('aria-activedescendant')
    }
  }

  function hideSuggestions(): void {
    suggestions = []
    activeIndex = -1
    suggestBox.replaceChildren()
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }

  async function fetchPage(): Promise<SearchResponse<Track | Playlist | User>> {
    if (started) {
      if (!next) return { collection: [], next_href: null }
      return api.page<Track | Playlist | User>(next)
    }
    if (tab === 'tracks') return api.searchTracks(query, 0, PAGE_SIZE)
    if (tab === 'playlists') return api.searchPlaylists(query, 0, PAGE_SIZE)
    if (tab === 'albums') return api.searchAlbums(query, 0, PAGE_SIZE)
    return api.searchUsers(query, 0, PAGE_SIZE)
  }

  async function loadMore(): Promise<void> {
    if (loading || done || !query || !container.isConnected) return
    loading = true
    const first = !started
    if (!first) showLoadingMore(true)
    try {
      const res = await fetchPage()
      if (!container.isConnected) return
      started = true
      if (first) results.replaceChildren()
      next = res.next_href ?? null
      done = !next || res.collection.length === 0
      appendResults(res.collection)
      if (done && rendered === 0) showEmpty(`Sin resultados para «${query}» en ${tabLabel()}`)
    } catch {
      if (!container.isConnected) return
      done = true
      if (rendered === 0) {
        results.replaceChildren()
        results.appendChild(pageError('No se pudo completar la búsqueda'))
      } else {
        toastErr('Error al cargar más resultados')
      }
    } finally {
      loading = false
      showLoadingMore(false)
      maybeContinue()
    }
  }

  function maybeContinue(): void {
    if (!container.isConnected || loading || done) return
    window.requestAnimationFrame(() => {
      if (!container.isConnected || loading || done) return
      if (sentinel.getBoundingClientRect().top < window.innerHeight + 240) void loadMore()
    })
  }

  function showLoadingMore(on: boolean): void {
    sentinel.replaceChildren()
    if (!on) return
    for (const skeleton of skeletonRows(2)) sentinel.appendChild(skeleton)
  }

  function appendResults(items: (Track | Playlist | User)[]): void {
    for (const item of items) {
      if (tab === 'users') {
        results.appendChild(userRow(item as User))
      } else if (tab === 'tracks') {
        const track = item as Track
        const index = tracks.length
        tracks.push(track)
        results.appendChild(trackRow(track, { showPlays: true, onPlay: () => player.playQueue(tracks, index) }))
      } else {
        results.appendChild(playlistRow(item as Playlist))
      }
      rendered++
    }
  }

  function playlistRow(pl: Playlist): HTMLElement {
    const title = typeof pl.title === 'string' && pl.title ? pl.title : 'Sin título'
    const row = h('a', { className: 'result-row playlist-row', href: link(`/playlist/${pl.id}`) })
    row.appendChild(artEl(pl.artwork_url, title, { size: 't300x300' }))
    const meta = h('div', { className: 'meta' })
    const titleLine = h('div', { className: 'title-line' })
    titleLine.appendChild(h('span', { className: 'title truncate' }, title))
    titleLine.appendChild(h('span', { className: 'kind-badge' }, isAlbum(pl) ? 'Álbum' : 'Playlist'))
    meta.appendChild(titleLine)
    const author = pl.user?.username ?? 'Artista desconocido'
    meta.appendChild(h('div', { className: 'sub text-dim truncate' }, `${pl.track_count ?? 0} tracks · ${author}`))
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
    const parts = [`${fmtCount(u.followers_count)} seguidores`]
    if (u.track_count) parts.push(`${fmtCount(u.track_count)} tracks`)
    meta.appendChild(h('div', { className: 'sub text-dim' }, parts.join(' · ')))
    row.appendChild(meta)
    return row
  }

  function tabLabel(): string {
    return (TAB_DEFS.find((def) => def.id === tab) ?? TAB_DEFS[0]).label.toLowerCase()
  }

  function showEmpty(message: string, withIcon = false): void {
    results.replaceChildren()
    const empty = h('div', { className: 'empty-state' })
    if (withIcon) empty.appendChild(iconEl('search', 44))
    empty.appendChild(h('div', { className: 'text-dim' }, message))
    results.appendChild(empty)
  }

  function pageError(message: string): HTMLElement {
    const err = h('div', { className: 'page-error' })
    err.appendChild(h('h2', {}, message))
    err.appendChild(
      h(
        'button',
        {
          className: 'btn btn-primary',
          onclick: () => {
            started = false
            done = false
            next = null
            rendered = 0
            tracks = []
            results.replaceChildren()
            for (const skeleton of skeletonRows(6)) results.appendChild(skeleton)
            void loadMore()
          },
        },
        'Reintentar',
      ),
    )
    return err
  }
})
