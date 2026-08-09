import type { Track } from '@soundlite/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { player } from '../player/player'
import { h, iconEl } from '../ui/el'
import { toastErr } from '../ui/toast'
import './charts.css'

const PAGE_SIZE = 20
const MAX_EMPTY_PAGES = 3
const SCROLL_MARGIN = 300

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

register('charts', (route, container) => {
  const api = getAPI()
  const slugs = api.genres()
  const requested = route.params.genre ?? ''
  const slug = slugs.includes(requested) ? requested : null
  const heading = slug ? `Novedades de ${genreLabel(slug)}` : 'Tendencias'

  document.title = `Charts · ${slug ? genreLabel(slug) : 'Tendencias'} — Soundlite`
  container.innerHTML = ''

  let offset = 0
  let nextHref: string | null = null
  let loading = false
  let done = false
  let failed = false
  let emptyPages = 0
  const loaded: Track[] = []
  const seen = new Set<number>()

  const list = h('div', { className: 'charts-list' })
  const sentinel = h('div', { className: 'load-more' })

  const chips = h('div', { className: 'chip-row charts-genres' })
  chips.appendChild(chipEl('Tendencias', null))
  for (const item of slugs) chips.appendChild(chipEl(genreLabel(item), item))

  const head = h('div', { className: 'charts-head' }, [
    h('h1', { className: 'h-section charts-title' }, heading),
    h(
      'span',
      { className: 'chip chip-static' },
      slug ? 'Lo más reciente del género · sin ranking' : 'Ranking real de SoundCloud',
    ),
  ])

  container.append(chips, head, list, sentinel)
  for (const skeleton of skeletonRows(8)) list.appendChild(skeleton)

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

  async function load(): Promise<void> {
    if (loading || done || failed || !container.isConnected) return
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
        toastErr('No se pudieron cargar más tracks')
      }
    } finally {
      loading = false
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
      list.appendChild(
        trackRow(track, {
          rank: slug ? undefined : loaded.length,
          showPlays: true,
          onPlay: (clicked) => {
            const index = loaded.findIndex((item) => item.id === clicked.id)
            player.playQueue(loaded, Math.max(0, index))
          },
        }),
      )
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
      sentinel.appendChild(h('div', { className: 'spinner' }))
      return
    }
    if (!failed) return
    sentinel.appendChild(
      h('div', { className: 'charts-retry' }, [
        h('span', { className: 'text-dim' }, 'Se cortó la carga de más tracks.'),
        h(
          'button',
          {
            className: 'btn btn-ghost btn-sm',
            onclick: () => {
              failed = false
              void load()
            },
          },
          'Reintentar',
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
    loaded.length = 0
    seen.clear()
    list.innerHTML = ''
    for (const skeleton of skeletonRows(8)) list.appendChild(skeleton)
    void load()
  }

  function renderEmpty(): void {
    list.innerHTML = ''
    list.appendChild(
      h('div', { className: 'empty-state' }, [
        iconEl('music', 44),
        h('p', {}, 'SoundCloud no está devolviendo tracks para esta selección.'),
      ]),
    )
  }

  function renderError(): void {
    list.innerHTML = ''
    list.appendChild(
      h('div', { className: 'page-error' }, [
        h('h2', {}, slug ? 'No se pudieron cargar las novedades' : 'No se pudieron cargar los charts'),
        h('p', { className: 'text-dim' }, 'Comprueba tu conexión e inténtalo de nuevo.'),
        h('div', {}, [h('button', { className: 'btn btn-primary', onclick: () => retry() }, 'Reintentar')]),
      ]),
    )
  }
})
