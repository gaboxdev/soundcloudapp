import type { PlaylistSummary, Selection, StreamPost, Track, User } from '@soundclear/api'
import { isPlaylistSummary } from '@soundclear/api'
import { getAPI } from '../api'
import { hasAccount } from '../core/account'
import { postReason } from './feed'
import { trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { fmtCount, fmtTime } from '../core/utils'
import { player } from '../player/player'
import { artEl, artOverlay } from '../ui/artwork'
import { h, iconEl, svgIcon, titleIcon } from '../ui/el'
import { skHome, skReveal } from '../ui/skeleton'
import { toast } from '../ui/toast'
import './home.css'
import { t } from '../core/i18n.ts'

const TRENDING_LIMIT = 12
const SELECTIONS_LIMIT = 8
const RESUME_LIMIT = 10
const FEED_LIMIT = 10

const GENRE_SHORTCUTS: { slug: string; label: string }[] = [
  { slug: 'house', label: 'House' },
  { slug: 'techno', label: 'Techno' },
  { slug: 'hiphop', label: 'Hip-Hop' },
  { slug: 'trap', label: 'Trap' },
  { slug: 'drum-and-bass', label: 'Drum & Bass' },
  { slug: 'indie', label: 'Indie' },
  { slug: 'pop', label: 'Pop' },
  { slug: 'rock', label: 'Rock' },
  { slug: 'latin', label: 'Latina' },
  { slug: 'ambient', label: 'Ambient' },
  { slug: 'jazz', label: 'Jazz' },
  { slug: 'chill-hop', label: 'Chill Hop' },
]

const SELECTION_TITLES: Record<string, string> = {
  'soundcloud:selections:trending-by-genre-playlists': 'Tendencias por género',
  'soundcloud:selections:buzzing': 'Artistas emergentes',
  'soundcloud:selections:personalised-curated-global': 'Seleccionado por SoundCloud',
  'soundcloud:selections:charts-top': t('Lo más escuchado'),
  'soundcloud:selections:charts-trending': t('Nuevo y en tendencia'),
  'soundcloud:selections:new-for-you': t('Nuevo para ti'),
  'soundcloud:selections:weekly': t('Novedades de la semana'),
}

function selectionTitle(selection: Selection): string {
  return SELECTION_TITLES[selection.urn] ?? selection.title
}

function selectionItems(selection: Selection): PlaylistSummary[] {
  const collection = selection.items?.collection ?? []
  return collection.filter((item): item is PlaylistSummary => isPlaylistSummary(item))
}

register('home', (_route, container) => {
  document.title = t('Inicio — SoundClear')
  const api = getAPI()
  let seq = 0

  async function load(): Promise<void> {
    const mySeq = ++seq
    container.replaceChildren(skHome())

    const [charts, selections, feed] = await Promise.allSettled([
      api.charts(undefined, undefined, 0, TRENDING_LIMIT),
      api.mixedSelections(SELECTIONS_LIMIT),
      hasAccount() ? api.stream(FEED_LIMIT) : Promise.resolve(null),
    ])
    if (mySeq !== seq || !container.isConnected) return
    const feedPosts =
      feed.status === 'fulfilled' && feed.value
        ? feed.value.collection.filter((post): post is StreamPost & { track: Track } => Boolean(post.track))
        : []

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

    renderHome(tracks, ranked, sections, feedPosts)
  }

  function renderHome(
    tracks: Track[],
    ranked: boolean,
    sections: Selection[],
    feedPosts: (StreamPost & { track: Track })[],
  ): void {
    container.innerHTML = ''
    skReveal(container)
    const featured = tracks[0]
    if (featured) container.appendChild(heroEl(featured, tracks))
    if (feedPosts.length > 0) container.appendChild(feedSectionEl(feedPosts))
    const resume = resumeSectionEl()
    if (resume) container.appendChild(resume)
    if (tracks.length > 0) container.appendChild(tracksSectionEl(tracks, ranked))
    container.appendChild(genresSectionEl())
    for (const section of sections) container.appendChild(selectionEl(section))
  }

  function feedSectionEl(posts: (StreamPost & { track: Track })[]): HTMLElement {
    const queue = posts.map((post) => post.track)
    const heading = h('div', { className: 'h-section' }, [titleIcon('user', 18), h('span', { className: 'truncate' }, t('De quien sigues'))])
    heading.appendChild(h('a', { className: 'see-more link-hover', href: link('/feed') }, t('Ver todo')))
    const row = h('div', { className: 'home-carousel' })
    posts.forEach((post, index) => {
      const track = post.track
      const card = h('button', { className: 'home-card resume-card', type: 'button', title: `Reproducir «${track.title}»` })
      const art = artEl(track.artwork_url, track.title, { size: 't300x300' })
      art.classList.add('home-card-art')
      card.append(
        art,
        h('span', { className: 'home-card-title truncate' }, track.title),
        h('span', { className: 'home-card-sub truncate' }, postReason(post)),
      )
      card.addEventListener('click', () => player.playQueue(queue, index))
      row.appendChild(card)
    })
    return h('section', { className: 'home-section' }, [heading, row])
  }

  function resumeSectionEl(): HTMLElement | null {
    const history = player.store.get().history.slice(0, RESUME_LIMIT)
    if (history.length === 0) return null
    const queue = history.map((entry) => entry.track)
    const heading = h('div', { className: 'h-section' }, [titleIcon('clock', 18), h('span', { className: 'truncate' }, t('Sigue escuchando'))])
    const radio = h('button', { className: 'see-more link-hover', type: 'button' }, t('Radio con esto'))
    radio.addEventListener('click', () => void player.startRadio(queue[0]))
    heading.appendChild(radio)
    const row = h('div', { className: 'home-carousel' })
    queue.forEach((track, index) => {
      const card = h('button', { className: 'home-card resume-card', type: 'button', title: `Reproducir «${track.title}»` })
      const art = artEl(track.artwork_url, track.title, { size: 't300x300' })
      art.classList.add('home-card-art')
      card.append(
        art,
        h('span', { className: 'home-card-title truncate' }, track.title),
        h('span', { className: 'home-card-sub truncate' }, track.user?.username ?? t('Artista desconocido')),
      )
      card.addEventListener('click', () => player.playQueue(queue, index))
      row.appendChild(card)
    })
    return h('section', { className: 'home-section' }, [heading, row])
  }

  function genresSectionEl(): HTMLElement {
    const heading = h('div', { className: 'h-section' }, [titleIcon('tag', 18), h('span', { className: 'truncate' }, t('Explora por género'))])
    heading.appendChild(h('a', { className: 'see-more link-hover', href: link('/charts') }, t('Ver charts')))
    const row = h('div', { className: 'chip-row home-genres' })
    for (const genre of GENRE_SHORTCUTS) {
      row.appendChild(h('a', { className: 'chip', href: link('/charts', { genre: genre.slug }) }, genre.label))
    }
    return h('section', { className: 'home-section' }, [heading, row])
  }

  function renderError(): void {
    container.innerHTML = ''
    container.appendChild(
      h('div', { className: 'page-error' }, [
        h('h2', {}, t('No se pudo cargar el inicio')),
        h('p', { className: 'text-dim' }, t('Comprueba tu conexión e inténtalo de nuevo.')),
        h('div', {}, [h('button', { className: 'btn btn-primary', onclick: () => void load() }, t('Reintentar'))]),
      ]),
    )
  }

  function renderEmpty(): void {
    container.innerHTML = ''
    const empty = h('div', { className: 'empty-state' }, [
      iconEl('music', 44),
      h('p', {}, t('SoundCloud no está devolviendo recomendaciones ahora mismo.')),
      h('div', {}, [h('button', { className: 'btn btn-ghost', onclick: () => void load() }, t('Actualizar'))]),
    ])
    container.appendChild(empty)
  }

  function heroEl(track: Track, queue: Track[]): HTMLElement {
    const art = artEl(track.artwork_url, track.title, {
      size: 't500x500',
      href: link(`/track/${track.id}`),
      title: `Abrir «${track.title}»`,
    })
    art.classList.add('hero-art')
    art.appendChild(artOverlay('expand', 22))

    const fav = h('button', { className: 'icon-btn' })
    const paintLike = (liked: boolean): void => {
      fav.dataset.liked = String(liked)
      fav.title = liked ? 'Quitar de favoritos' : t('Guardar en favoritos')
      fav.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 20)
    }
    paintLike(player.isLiked(track))
    fav.addEventListener('click', (event) => {
      event.stopPropagation()
      player.toggleLike(track)
      const liked = player.isLiked(track)
      paintLike(liked)
      toast(liked ? 'Guardado en favoritos' : t('Quitado de favoritos'), 'ok')
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
        : h('span', { className: 'text-faint' }, t('Artista desconocido')),
      h('span', { className: 'hero-dot' }, '•'),
      h('span', {}, fmtTime(track.duration)),
      h('span', { className: 'hero-dot' }, '•'),
      h('span', {}, `${fmtCount(track.playback_count)} plays`),
    ])

    return h('section', { className: 'hero card' }, [
      art,
      h('div', { className: 'hero-info' }, [
        h('span', { className: 'hero-kicker' }, t('Destacado')),
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
      titleIcon(ranked ? 'trend' : 'waves', 18),
      h('span', { className: 'truncate' }, ranked ? 'Tendencias' : t('Destacados')),
    ])
    if (ranked) heading.appendChild(h('a', { className: 'see-more link-hover', href: link('/charts') }, t('Ver más')))
    return h('section', { className: 'home-section' }, [heading, h('div', { className: 'home-list' }, rows)])
  }

  function selectionEl(selection: Selection): HTMLElement {
    const cards = selectionItems(selection).map((item) => cardEl(item))
    return h('section', { className: 'home-section' }, [
      h('div', { className: 'h-section' }, [titleIcon('playlist', 18), h('span', { className: 'truncate' }, selectionTitle(selection))]),
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
