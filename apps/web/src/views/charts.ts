import type { Track } from '@soundclear/api'
import { getAPI } from '../api'
import { trackRow } from '../components/trackrow'
import { link, navigate, register } from '../core/router'
import { player } from '../player/player'
import { h, iconEl, svgIcon, titleIcon } from '../ui/el'
import { skMore, skTrackList } from '../ui/skeleton'
import { toastErr } from '../ui/toast'
import './charts.css'
import { t } from '../core/i18n.ts'

const PAGE_SIZE = 20
const MAX_EMPTY_PAGES = 3
const SCROLL_MARGIN = 300
const FILTER_MAX_LOADS = 6

const GENRE_LABELS: Record<string, string> = {
  ambient: 'Ambient',
  breakbeat: 'Breakbeat',
  'chill-hop': 'Chill Hop',
  classical: 'Clásica',
  country: 'Country',
  'drum-and-bass': 'Drum & Bass',
  dubstep: 'Dubstep',
  electro: 'Electro',
  'electro-house': 'Electro House',
  folk: 'Folk',
  funk: 'Funk',
  hiphop: 'Hip-Hop',
  house: 'House',
  indie: 'Indie',
  jazz: 'Jazz',
  latin: 'Latina',
  metal: 'Metal',
  pop: 'Pop',
  punk: 'Punk',
  reggae: 'Reggae',
  rnb: 'R&B',
  rock: 'Rock',
  soul: 'Soul',
  techno: 'Techno',
  trance: 'Trance',
  trap: 'Trap',
  world: 'Música del mundo',
}

function genreLabel(slug: string): string {
  return (
    GENRE_LABELS[slug] ??
    slug
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  )
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function trackMatches(track: Track, terms: string[]): boolean {
  const haystack = fold(`${track.title} ${track.user?.username ?? ''} ${track.genre ?? ''} ${track.tag_list ?? ''}`)
  return terms.every((term) => haystack.includes(term))
}

register('charts', (route, container) => {
  const api = getAPI()
  const slugs = api.genres()
  const requested = route.params.genre ?? ''
  const slug = slugs.includes(requested) ? requested : null
  const heading = slug ? `Novedades de ${t(genreLabel(slug))}` : t('Tendencias')

  document.title = `Charts · ${slug ? t(genreLabel(slug)) : t('Tendencias')} — SoundClear`
  container.innerHTML = ''

  let offset = 0
  let nextHref: string | null = null
  let loading = false
  let done = false
  let failed = false
  let emptyPages = 0
  const loaded: Track[] = []
  const seen = new Set<number>()

  const rows: { track: Track; el: HTMLElement }[] = []
  let query = ''
  let terms: string[] = []
  let filterLoads = 0

  const list = h('div', { className: 'charts-list' })
  const sentinel = h('div', { className: 'load-more' })

  const chips = h('div', { className: 'chip-row charts-genres' })
  chips.appendChild(chipEl(t('Tendencias'), null))
  for (const item of slugs) chips.appendChild(chipEl(t(genreLabel(item)), item))

  const searchBox = h('div', { className: 'search-input charts-search' })
  searchBox.innerHTML = svgIcon('search', 16)
  const searchInput = h('input', {
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: t('Busca dentro de los charts…'),
    'aria-label': t('Buscar dentro de los charts'),
  }) as HTMLInputElement
  const searchClear = h('button', {
    className: 'icon-btn charts-search-clear',
    type: 'button',
    title: t('Limpiar la búsqueda'),
    'aria-label': t('Limpiar la búsqueda'),
  })
  searchClear.innerHTML = svgIcon('close', 15)
  searchClear.hidden = true
  searchBox.append(searchInput, searchClear)

  const head = h('div', { className: 'charts-head' }, [
    h('h1', { className: 'h-section charts-title' }, [titleIcon(slug ? 'tag' : 'trend', 20), h('span', null, heading)]),
    h(
      'span',
      { className: 'chip chip-static' },
      slug ? 'Lo más reciente del género · sin ranking' : t('Ranking real de SoundCloud'),
    ),
    searchBox,
  ])

  const filterInfo = h('div', { className: 'charts-filter' })
  filterInfo.hidden = true
  const filterCount = h('span', { className: 'text-faint' })
  const filterGenre = h('a', { className: 'chip charts-filter-genre' })
  filterGenre.hidden = true
  const filterGlobal = h('button', { className: 'chip charts-filter-global', type: 'button' })
  filterInfo.append(filterCount, filterGenre, filterGlobal)

  const noMatch = h('div', { className: 'empty-state charts-nomatch' }, [
    iconEl('search', 40),
    h('p', {}, t('Nada con ese texto entre los tracks cargados.')),
  ])
  noMatch.hidden = true

  container.append(chips, head, filterInfo, list, noMatch, sentinel)
  list.appendChild(skTrackList(8, { rank: !slug }))

  searchInput.addEventListener('input', () => {
    const next = searchInput.value.trim()
    if (next === query) return
    query = next
    terms = fold(query).split(/\s+/).filter(Boolean)
    filterLoads = 0
    searchClear.hidden = query === ''
    applyFilter()
    renderSentinel()
    pump()
  })

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && query !== '') {
      event.preventDefault()
      clearSearch()
      return
    }
    if (event.key === 'Enter' && query !== '') navigate('/search', { q: query })
  })

  searchClear.addEventListener('click', () => clearSearch())
  filterGlobal.addEventListener('click', () => navigate('/search', { q: query }))

  const observer = new IntersectionObserver(
    (entries) => {
      if (!container.isConnected) {
        observer.disconnect()
        return
      }
      for (const entry of entries) {
        if (entry.isIntersecting) void load()
      }
    },
    { rootMargin: `${SCROLL_MARGIN}px` },
  )
  observer.observe(sentinel)

  void load()

  function clearSearch(): void {
    query = ''
    terms = []
    filterLoads = 0
    searchInput.value = ''
    searchClear.hidden = true
    applyFilter()
    renderSentinel()
    searchInput.focus()
  }

  function genreSuggestion(): string | null {
    if (terms.length === 0) return null
    return (
      slugs.find((item) => item !== slug && terms.some((term) => fold(t(genreLabel(item))) === term || fold(item) === term)) ??
      slugs.find((item) => item !== slug && terms.some((term) => term.length >= 3 && fold(t(genreLabel(item))).includes(term))) ??
      null
    )
  }

  function applyFilter(): void {
    let visible = 0
    for (const row of rows) {
      const on = terms.length === 0 || trackMatches(row.track, terms)
      row.el.hidden = !on
      if (on) visible += 1
    }
    if (query === '') {
      filterInfo.hidden = true
      noMatch.hidden = true
      return
    }
    filterInfo.hidden = false
    filterCount.textContent = `${visible} de ${rows.length} tracks cargados`
    filterGlobal.textContent = `Buscar «${query}» en todo SoundCloud`
    const suggestion = genreSuggestion()
    filterGenre.hidden = suggestion === null
    if (suggestion) {
      filterGenre.textContent = `Ver charts de ${genreLabel(suggestion)}`
      filterGenre.href = link('/charts', { genre: suggestion })
    }
    noMatch.hidden = visible > 0 || loading || !(done || failed || filterLoads >= FILTER_MAX_LOADS)
  }

  function chipEl(text: string, target: string | null): HTMLElement {
    const active = target === slug
    return h(
      'a',
      {
        className: `chip${active ? ' active' : ''}`,
        href: target ? link('/charts', { genre: target }) : link('/charts'),
        'aria-current': active ? 'true' : undefined,
      },
      text,
    )
  }

  async function load(manual = false): Promise<void> {
    if (loading || done || failed || !container.isConnected) return
    if (query !== '' && !manual && filterLoads >= FILTER_MAX_LOADS) return
    if (query !== '') filterLoads += 1
    loading = true
    const first = loaded.length === 0
    renderSentinel()
    try {
      let tracks: Track[]
      let next: string | null
      if (!slug) {
        const response = await api.charts(undefined, undefined, offset, PAGE_SIZE)
        tracks = response.collection.map((item) => item.track).filter((track): track is Track => Boolean(track))
        next = response.next_href
        offset += response.collection.length
      } else if (nextHref) {
        const response = await api.page<Track>(nextHref)
        tracks = response.collection
        next = response.next_href
      } else {
        const response = await api.recentTracks(slug, PAGE_SIZE)
        tracks = response.collection
        next = response.next_href
      }
      if (!container.isConnected) return
      nextHref = next
      if (first) list.innerHTML = ''
      const added = appendTracks(tracks)
      applyFilter()
      if (added === 0) emptyPages += 1
      else emptyPages = 0
      done = !next || emptyPages >= MAX_EMPTY_PAGES
      if (done && loaded.length === 0) renderEmpty()
    } catch {
      if (!container.isConnected) return
      if (first) {
        done = true
        renderError()
      } else {
        failed = true
        toastErr(t('No se pudieron cargar más tracks'))
      }
    } finally {
      loading = false
      applyFilter()
      renderSentinel()
      pump()
    }
  }

  function appendTracks(tracks: Track[]): number {
    let added = 0
    for (const track of tracks) {
      if (!track || seen.has(track.id)) continue
      seen.add(track.id)
      loaded.push(track)
      added += 1
      const row = trackRow(track, {
        rank: slug ? undefined : loaded.length,
        showPlays: true,
        onPlay: (clicked) => {
          const visible = rows.filter((item) => !item.el.hidden).map((item) => item.track)
          const pool = visible.length > 1 ? visible : loaded
          const index = pool.findIndex((item) => item.id === clicked.id)
          player.playQueue(pool, Math.max(0, index))
        },
      })
      rows.push({ track, el: row })
      list.appendChild(row)
    }
    return added
  }

  function pump(): void {
    window.requestAnimationFrame(() => {
      if (loading || done || failed || !container.isConnected || !sentinel.isConnected) return
      if (sentinel.getBoundingClientRect().top <= window.innerHeight + SCROLL_MARGIN) void load()
    })
  }

  function renderSentinel(): void {
    sentinel.innerHTML = ''
    if (loading) {
      if (loaded.length > 0) sentinel.appendChild(skMore(2, { rank: !slug }))
      return
    }
    if (!failed && query !== '' && !done && filterLoads >= FILTER_MAX_LOADS) {
      sentinel.appendChild(
        h('div', { className: 'charts-retry' }, [
          h('span', { className: 'text-dim' }, t('Hemos mirado unas cuantas páginas de los charts.')),
          h(
            'button',
            { className: 'btn btn-ghost btn-sm', onclick: () => void load(true) },
            t('Seguir buscando más abajo'),
          ),
        ]),
      )
      return
    }
    if (!failed) return
    sentinel.appendChild(
      h('div', { className: 'charts-retry' }, [
        h('span', { className: 'text-dim' }, t('Se cortó la carga de más tracks.')),
        h(
          'button',
          {
            className: 'btn btn-ghost btn-sm',
            onclick: () => {
              failed = false
              void load()
            },
          },
          t('Reintentar'),
        ),
      ]),
    )
  }

  function retry(): void {
    offset = 0
    nextHref = null
    done = false
    failed = false
    emptyPages = 0
    filterLoads = 0
    loaded.length = 0
    rows.length = 0
    seen.clear()
    list.replaceChildren(skTrackList(8, { rank: !slug }))
    void load()
  }

  function renderEmpty(): void {
    list.innerHTML = ''
    rows.length = 0
    list.appendChild(
      h('div', { className: 'empty-state' }, [
        iconEl('music', 44),
        h('p', {}, t('SoundCloud no está devolviendo tracks para esta selección.')),
      ]),
    )
  }

  function renderError(): void {
    list.innerHTML = ''
    list.appendChild(
      h('div', { className: 'page-error' }, [
        h('h2', {}, slug ? 'No se pudieron cargar las novedades' : t('No se pudieron cargar los charts')),
        h('p', { className: 'text-dim' }, t('Comprueba tu conexión e inténtalo de nuevo.')),
        h('div', {}, [h('button', { className: 'btn btn-primary', onclick: () => retry() }, t('Reintentar'))]),
      ]),
    )
  }
})
