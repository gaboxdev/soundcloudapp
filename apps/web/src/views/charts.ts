import type { Track } from '@soundlite/api'
import { getAPI } from '../api'
import { trackRow, skeletonRows } from '../components/trackrow'
import { register } from '../core/router'
import { player } from '../player/player'
import { h, iconEl } from '../ui/el'
import './charts.css'

type Tab = 'trending' | 'top50'

const GENRES = [
  'all-music',
  'hiphop',
  'electro-house',
  'house',
  'techno',
  'dubstep',
  'drum-and-bass',
  'trap',
  'trance',
  'ambient',
  'pop',
  'rnb',
  'rock',
  'indie',
  'metal',
  'jazz',
  'classical',
  'latin',
  'reggae',
  'soul',
  'funk',
]

const GENRE_LABELS: Record<string, string> = {
  'all-music': 'Todos',
  'drum-and-bass': 'Drum & Bass',
  'electro-house': 'Electro House',
  hiphop: 'Hip-Hop',
  rnb: 'R&B',
}

const TAB_LABELS: Record<Tab, string> = {
  trending: 'Tendencias',
  top50: 'Top 50',
}

function genreLabel(slug: string): string {
  return GENRE_LABELS[slug] ?? slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

register('charts', (_route, container) => {
  container.innerHTML = ''
  document.title = 'Charts — Soundlite'

  let slug = 'all-music'
  let tab: Tab = 'trending'
  let offset = 0
  let loading = false
  let done = false
  let loaded: Track[] = []
  let observer: IntersectionObserver | null = null
  let seq = 0

  const list = h('div', { className: 'charts-list' })
  const sentinel = h('div', { className: 'load-more' })
  const tabChips = new Map<Tab, HTMLButtonElement>()
  const genreChips = new Map<string, HTMLButtonElement>()

  function start(): void {
    observer = new IntersectionObserver((entries) => {
      if (!container.isConnected) {
        observer?.disconnect()
        return
      }
      for (const entry of entries) {
        if (entry.isIntersecting) void load()
      }
    })
    observer.observe(sentinel)
    reset()
  }

  function reset(): void {
    seq++
    offset = 0
    done = false
    loaded = []
    loading = false
    list.innerHTML = ''
    for (const skeleton of skeletonRows(8)) list.appendChild(skeleton)
    void load()
  }

  async function load(): Promise<void> {
    if (loading || done || !container.isConnected) return
    loading = true
    const mySeq = seq
    syncSentinel()
    try {
      const api = getAPI()
      const limit = tab === 'trending' ? 20 : 50
      let tracks: Track[]
      let nextHref: string | null
      if (tab === 'trending') {
        const response = await api.charts(api.genreUrn(slug), 'trending', offset, limit)
        tracks = response.collection.map((item) => item.track)
        nextHref = response.next_href
      } else {
        const response = await api.featured(slug, offset, limit)
        tracks = response.collection
        nextHref = response.next_href
      }
      if (mySeq !== seq) return
      if (offset === 0) list.innerHTML = ''
      const base = loaded.length
      for (const track of tracks) {
        loaded.push(track)
        const row = trackRow(track, {
          rank: base + loaded.length,
          showPlays: true,
          onPlay: (clicked) => {
            const index = loaded.findIndex((t) => t.id === clicked.id)
            player.playQueue(loaded, Math.max(0, index))
          },
        })
        list.appendChild(row)
      }
      offset += tracks.length
      done = !nextHref || tracks.length === 0
      if (done && loaded.length === 0) renderEmpty()
    } catch {
      if (mySeq !== seq) return
      done = true
      if (loaded.length === 0) renderError()
    } finally {
      if (mySeq === seq) {
        loading = false
        syncSentinel()
      }
    }
  }

  function syncSentinel(): void {
    sentinel.innerHTML = ''
    if (loading) {
      const spinner = document.createElement('div')
      spinner.className = 'spinner'
      sentinel.appendChild(spinner)
    }
  }

  function renderError(): void {
    list.innerHTML = ''
    const error = h('div', { className: 'page-error' }, [
      h('h2', {}, 'No se pudieron cargar los charts'),
      h('p', { className: 'text-dim' }, 'Comprueba tu conexión e inténtalo de nuevo.'),
      h('div', {}, [h('button', { className: 'btn btn-primary', onclick: () => reset() }, 'Reintentar')]),
    ])
    list.appendChild(error)
  }

  function renderEmpty(): void {
    list.innerHTML = ''
    const empty = h('div', { className: 'empty-state' }, [
      iconEl('music', 44),
      h('p', {}, 'No hay tracks para esta selección.'),
    ])
    list.appendChild(empty)
  }

  function selectTab(next: Tab): void {
    if (next === tab) return
    tab = next
    for (const [key, chip] of tabChips) chip.classList.toggle('active', key === tab)
    reset()
  }

  function selectGenre(next: string): void {
    if (next === slug) return
    slug = next
    for (const [key, chip] of genreChips) chip.classList.toggle('active', key === slug)
    reset()
  }

  const tabs = h('div', { className: 'chip-row charts-tabs' })
  for (const key of ['trending', 'top50'] as Tab[]) {
    const chip = h('button', {
      className: 'chip' + (key === tab ? ' active' : ''),
      onclick: () => selectTab(key),
    }, TAB_LABELS[key])
    tabChips.set(key, chip)
    tabs.appendChild(chip)
  }

  const genres = h('div', { className: 'chip-row charts-genres' })
  for (const genre of GENRES) {
    const chip = h('button', {
      className: 'chip' + (genre === slug ? ' active' : ''),
      onclick: () => selectGenre(genre),
    }, genreLabel(genre))
    genreChips.set(genre, chip)
    genres.appendChild(chip)
  }

  container.appendChild(tabs)
  container.appendChild(genres)
  container.appendChild(list)
  container.appendChild(sentinel)
  start()
})
