import type { Playlist, SearchResponse, Track, TrackDuration, TrackFreshness, TrackSearchFilters, User } from '@soundclear/api'
import { getAPI } from '../api'
import { trackRow } from '../components/trackrow'
import { link, navigate, register, searchLink } from '../core/router'
import { debounce, fmtCount } from '../core/utils'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { skMore, skResultRows, skTrackRows } from '../ui/skeleton'
import { toastErr } from '../ui/toast'
import './search.css'
import { t } from '../core/i18n.ts'

type SearchTab = 'tracks' | 'playlists' | 'albums' | 'users'

const TAB_DEFS: { id: SearchTab; label: string; icon: string }[] = [
  { id: 'tracks', label: 'Tracks', icon: 'music' },
  { id: 'playlists', label: 'Playlists', icon: 'playlist' },
  { id: 'albums', label: 'Álbumes', icon: 'disc' },
  { id: 'users', label: 'Usuarios', icon: 'user' },
]

const PAGE_SIZE = 20
const SUGGEST_LIST_ID = 'search-suggest-list'

const DURATIONS: { value: TrackDuration; label: string }[] = [
  { value: 'short', label: 'Cortos' },
  { value: 'medium', label: 'Medios' },
  { value: 'long', label: 'Largos' },
  { value: 'epic', label: 'Sets' },
]

const FRESHNESS: { value: TrackFreshness; label: string }[] = [
  { value: 'last_day', label: 'Hoy' },
  { value: 'last_week', label: 'Esta semana' },
  { value: 'last_month', label: 'Este mes' },
  { value: 'last_year', label: 'Este año' },
]

function parseDuration(value: string | undefined): TrackDuration | undefined {
  return DURATIONS.find((item) => item.value === value)?.value
}

function parseFreshness(value: string | undefined): TrackFreshness | undefined {
  return FRESHNESS.find((item) => item.value === value)?.value
}

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
  const genreOptions = api.searchGenres()
  const requestedGenre = route.params.genre ?? ''
  const filters: TrackSearchFilters = {
    duration: parseDuration(route.params.dur),
    createdAt: parseFreshness(route.params.when),
    genre: genreOptions.find((item) => item.toLowerCase() === requestedGenre.toLowerCase()),
    commercial: route.params.cc === '1',
  }
  const hasFilters = Boolean(filters.duration || filters.createdAt || filters.genre || filters.commercial)

  document.title = query ? `«${query}» — SoundClear` : t('Búsqueda — SoundClear')

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
    placeholder: t('Busca música, artistas y playlists…'),
    value: query,
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-expanded': 'false',
    'aria-controls': SUGGEST_LIST_ID,
    'aria-autocomplete': 'list',
    'aria-label': t('Buscar en SoundCloud'),
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
    'aria-label': t('Sugerencias de búsqueda'),
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
        [iconEl(def.icon, 15), h('span', { className: 'btn-label' }, def.label)],
      ),
    )
  }

  const results = h('div', { className: 'search-results' })
  const sentinel = h('div', { className: 'load-more' })

  view.append(inputWrap, tabs)
  if (tab === 'tracks' && query) view.appendChild(filtersEl())
  view.append(results, sentinel)
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
    showSkeletons(6)
    void loadMore()
  } else {
    done = true
    showEmpty(t('Busca música, artistas y playlists de SoundCloud'), true)
    input.focus()
  }

  function tabSkeletons(count: number): HTMLElement[] {
    if (tab === 'users') return skResultRows('user', count)
    if (tab === 'tracks') return skTrackRows(count)
    return skResultRows('playlist', count)
  }

  function showSkeletons(count: number): void {
    for (const skeleton of tabSkeletons(count)) results.appendChild(skeleton)
  }

  function tabHref(value: string, id: SearchTab): string {
    if (!value) return link('/search')
    if (id !== 'tracks') return link('/search', { q: value, tab: id })
    return hasFilters ? filterHref({}) : searchLink(value)
  }

  function filterHref(patch: Record<string, string | undefined>): string {
    const params: Record<string, string> = { q: query }
    const current: Record<string, string | undefined> = {
      dur: filters.duration,
      when: filters.createdAt,
      genre: filters.genre,
      cc: filters.commercial ? '1' : undefined,
      ...patch,
    }
    for (const [key, value] of Object.entries(current)) {
      if (value) params[key] = value
    }
    return link('/search', params)
  }

  function filtersEl(): HTMLElement {
    const wrap = h('div', { className: 'search-filters' })

    const durRow = h('div', { className: 'filter-row' })
    durRow.appendChild(h('span', { className: 'filter-label' }, t('Duración')))
    for (const item of DURATIONS) {
      const active = filters.duration === item.value
      durRow.appendChild(
        h(
          'a',
          {
            className: active ? 'chip active' : 'chip',
            href: filterHref({ dur: active ? undefined : item.value }),
            'aria-pressed': active ? 'true' : 'false',
          },
          item.label,
        ),
      )
    }
    wrap.appendChild(durRow)

    const whenRow = h('div', { className: 'filter-row' })
    whenRow.appendChild(h('span', { className: 'filter-label' }, t('Subido')))
    for (const item of FRESHNESS) {
      const active = filters.createdAt === item.value
      whenRow.appendChild(
        h(
          'a',
          {
            className: active ? 'chip active' : 'chip',
            href: filterHref({ when: active ? undefined : item.value }),
            'aria-pressed': active ? 'true' : 'false',
          },
          item.label,
        ),
      )
    }
    wrap.appendChild(whenRow)

    const extraRow = h('div', { className: 'filter-row' })
    extraRow.appendChild(h('span', { className: 'filter-label' }, t('Género')))
    const select = h('select', { className: 'select', 'aria-label': t('Filtrar por género') }) as HTMLSelectElement
    select.appendChild(h('option', { value: '' }, t('Cualquiera')))
    for (const genre of genreOptions) {
      const option = h('option', { value: genre }, genre) as HTMLOptionElement
      if (filters.genre === genre) option.selected = true
      select.appendChild(option)
    }
    select.addEventListener('change', () => {
      window.location.hash = filterHref({ genre: select.value || undefined })
    })
    extraRow.appendChild(select)
    const ccActive = filters.commercial === true
    extraRow.appendChild(
      h(
        'a',
        {
          className: ccActive ? 'chip active' : 'chip',
          href: filterHref({ cc: ccActive ? undefined : '1' }),
          title: t('Solo tracks con licencia que permite reutilizar comercialmente'),
          'aria-pressed': ccActive ? 'true' : 'false',
        },
        t('Reutilizable'),
      ),
    )
    if (hasFilters) {
      extraRow.appendChild(
        h('a', { className: 'btn btn-ghost btn-sm filter-clear', href: searchLink(query) }, t('Limpiar filtros')),
      )
    }
    wrap.appendChild(extraRow)
    return wrap
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
    if (tab === 'tracks') return api.searchTracks(query, 0, PAGE_SIZE, filters)
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
      if (done && rendered === 0) {
        showEmpty(
          hasFilters
            ? `Sin resultados para «${query}» con esos filtros`
            : `Sin resultados para «${query}» en ${tabLabel()}`,
        )
      }
    } catch {
      if (!container.isConnected) return
      done = true
      if (rendered === 0) {
        results.replaceChildren()
        results.appendChild(pageError(t('No se pudo completar la búsqueda')))
      } else {
        toastErr(t('Error al cargar más resultados'))
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
    if (tab === 'tracks') {
      sentinel.appendChild(skMore(2))
      return
    }
    const more = h('div', { className: 'sk-more', 'aria-hidden': 'true' }, tabSkeletons(2))
    sentinel.appendChild(more)
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
    const title = typeof pl.title === 'string' && pl.title ? pl.title : t('Sin título')
    const row = h('a', { className: 'result-row playlist-row', href: link(`/playlist/${pl.id}`) })
    row.appendChild(artEl(pl.artwork_url, title, { size: 't300x300' }))
    const meta = h('div', { className: 'meta' })
    const titleLine = h('div', { className: 'title-line' })
    titleLine.appendChild(h('span', { className: 'title truncate' }, title))
    titleLine.appendChild(h('span', { className: 'kind-badge' }, isAlbum(pl) ? 'Álbum' : t('Playlist')))
    meta.appendChild(titleLine)
    const author = pl.user?.username ?? t('Artista desconocido')
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
      const badge = h('span', { className: 'verified', title: t('Verificado') })
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
            showSkeletons(6)
            void loadMore()
          },
        },
        t('Reintentar'),
      ),
    )
    return err
  }
})
