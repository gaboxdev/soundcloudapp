import type { PlaylistSummary, Selection, Track, User } from '@soundclear/api'
import { isPlaylistSummary } from '@soundclear/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { fmtCount, fmtTime } from '../core/utils'
import { player } from '../player/player'
import { artEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'
import './home.css'

const TRENDING_LIMIT = 12
const SELECTIONS_LIMIT = 8

const SELECTION_TITLES: Record<string, string> = {
  'soundcloud:selections:trending-by-genre-playlists': 'Tendencias por género',
  'soundcloud:selections:buzzing': 'Artistas emergentes',
  'soundcloud:selections:personalised-curated-global': 'Seleccionado por SoundCloud',
  'soundcloud:selections:charts-top': 'Lo más escuchado',
  'soundcloud:selections:charts-trending': 'Nuevo y en tendencia',
  'soundcloud:selections:new-for-you': 'Nuevo para ti',
  'soundcloud:selections:weekly': 'Novedades de la semana',
}

function selectionTitle(selection: Selection): string {
  return SELECTION_TITLES[selection.urn] ?? selection.title
}

function selectionItems(selection: Selection): PlaylistSummary[] {
  const collection = selection.items?.collection ?? []
  return collection.filter((item): item is PlaylistSummary => isPlaylistSummary(item))
}

register('home', (_route, container) => {
  document.title = 'Inicio — SoundClear'
  const api = getAPI()
  let seq = 0

  async function load(): Promise<void> {
    const mySeq = ++seq
    container.innerHTML = ''
    for (const skeleton of skeletonRows(8)) container.appendChild(skeleton)

    const [charts, selections] = await Promise.allSettled([
      api.charts(undefined, undefined, 0, TRENDING_LIMIT),
      api.mixedSelections(SELECTIONS_LIMIT),
    ])
    if (mySeq !== seq || !container.isConnected) return

    let tracks: Track[] = []
    let ranked = true
    if (charts.status === 'fulfilled') {
      tracks = charts.value.collection.map((item) => item.track).filter((track): track is Track => Boolean(track))
    }

    let fallbackFailed = false
    if (tracks.length === 0) {
      ranked = false
      try {
        tracks = (await api.featured()).collection
      } catch {
        fallbackFailed = true
      }
      if (mySeq !== seq || !container.isConnected) return
    }

    const sections = selections.status === 'fulfilled' ? selections.value.filter((item) => selectionItems(item).length > 0) : []

    if (tracks.length === 0 && sections.length === 0) {
      if (charts.status === 'rejected' && selections.status === 'rejected' && fallbackFailed) renderError()
      else renderEmpty()
      return
    }

    renderHome(tracks, ranked, sections)
  }

  function renderHome(tracks: Track[], ranked: boolean, sections: Selection[]): void {
    container.innerHTML = ''
    const featured = tracks[0]
    if (featured) container.appendChild(heroEl(featured, tracks))
    if (tracks.length > 0) container.appendChild(tracksSectionEl(tracks, ranked))
    for (const section of sections) container.appendChild(selectionEl(section))
  }

  function renderError(): void {
    container.innerHTML = ''
    container.appendChild(
      h('div', { className: 'page-error' }, [
        h('h2', {}, 'No se pudo cargar el inicio'),
        h('p', { className: 'text-dim' }, 'Comprueba tu conexión e inténtalo de nuevo.'),
        h('div', {}, [h('button', { className: 'btn btn-primary', onclick: () => void load() }, 'Reintentar')]),
      ]),
    )
  }

  function renderEmpty(): void {
    container.innerHTML = ''
    const empty = h('div', { className: 'empty-state' }, [
      iconEl('music', 44),
      h('p', {}, 'SoundCloud no está devolviendo recomendaciones ahora mismo.'),
      h('div', {}, [h('button', { className: 'btn btn-ghost', onclick: () => void load() }, 'Actualizar')]),
    ])
    container.appendChild(empty)
  }

  function heroEl(track: Track, queue: Track[]): HTMLElement {
    const art = artEl(track.artwork_url, track.title, { size: 't500x500', blur: true })
    art.classList.add('hero-art')

    const fav = h('button', { className: 'icon-btn' })
    const paintLike = (liked: boolean): void => {
      fav.dataset.liked = String(liked)
      fav.title = liked ? 'Quitar de favoritos' : 'Guardar en favoritos'
      fav.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 20)
    }
    paintLike(player.isLiked(track))
    fav.addEventListener('click', (event) => {
      event.stopPropagation()
      player.toggleLike(track)
      const liked = player.isLiked(track)
      paintLike(liked)
      toast(liked ? 'Guardado en favoritos' : 'Quitado de favoritos', 'ok')
    })

    let unsub: (() => void) | null = null
    let attached = false
    unsub = player.store.subscribe((state) => {
      if (attached && !fav.isConnected) {
        unsub?.()
        return
      }
      attached = true
      const liked = state.likes.some((item) => item.id === track.id)
      if (String(liked) !== fav.dataset.liked) paintLike(liked)
    })

    const play = h('button', { className: 'btn btn-primary', onclick: () => player.playQueue(queue, 0) })
    play.innerHTML = `${svgIcon('play', 18)} Reproducir`

    const user = track.user as User | undefined
    const meta = h('div', { className: 'hero-meta' }, [
      user
        ? h('a', { className: 'link-hover', href: link(`/user/${user.id}`) }, user.username)
        : h('span', { className: 'text-faint' }, 'Artista desconocido'),
      h('span', { className: 'hero-dot' }, '•'),
      h('span', {}, fmtTime(track.duration)),
      h('span', { className: 'hero-dot' }, '•'),
      h('span', {}, `${fmtCount(track.playback_count)} plays`),
    ])

    return h('section', { className: 'hero card' }, [
      art,
      h('div', { className: 'hero-info' }, [
        h('span', { className: 'hero-kicker' }, 'Destacado'),
        h('a', { className: 'hero-title truncate link-hover', href: link(`/track/${track.id}`) }, track.title),
        meta,
        h('div', { className: 'hero-actions' }, [play, fav]),
      ]),
    ])
  }

  function tracksSectionEl(tracks: Track[], ranked: boolean): HTMLElement {
    const rows = tracks.map((track, index) =>
      trackRow(track, {
        rank: ranked ? index + 1 : undefined,
        showPlays: true,
        onPlay: (clicked) => {
          const position = tracks.findIndex((item) => item.id === clicked.id)
          player.playQueue(tracks, Math.max(0, position))
        },
      }),
    )
    const heading = h('div', { className: 'h-section' }, [
      h('span', { className: 'truncate' }, ranked ? 'Tendencias' : 'Destacados'),
    ])
    if (ranked) heading.appendChild(h('a', { className: 'see-more link-hover', href: link('/charts') }, 'Ver más'))
    return h('section', { className: 'home-section' }, [heading, h('div', { className: 'home-list' }, rows)])
  }

  function selectionEl(selection: Selection): HTMLElement {
    const cards = selectionItems(selection).map((item) => cardEl(item))
    return h('section', { className: 'home-section' }, [
      h('div', { className: 'h-section' }, [h('span', { className: 'truncate' }, selectionTitle(selection))]),
      h('div', { className: 'home-carousel' }, cards),
    ])
  }

  function cardEl(item: PlaylistSummary): HTMLElement {
    const art = artEl(item.artwork_url, item.title, { size: 't300x300' })
    art.classList.add('home-card-art')
    const count = item.track_count ?? 0
    const owner = item.user?.username
    const parts = [`${count} ${count === 1 ? 'track' : 'tracks'}`]
    if (owner) parts.push(owner)
    return h('a', { className: 'home-card', href: link(`/playlist/${item.id}`), title: item.title }, [
      art,
      h('span', { className: 'home-card-title truncate' }, item.title),
      h('span', { className: 'home-card-sub truncate' }, parts.join(' · ')),
    ])
  }

  void load()
})
