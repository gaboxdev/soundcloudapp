import type { Track } from '@soundlite/api'
import { getAPI } from '../api'
import { trackRow, skeletonRows } from '../components/trackrow'
import { link, register } from '../core/router'
import { esc, fmtTime } from '../core/utils'
import { player } from '../player/player'
import { artEl } from '../ui/artwork'
import { h, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'
import './home.css'

interface Section {
  title: string
  tracks: Track[]
}

const MAX_SECTIONS = 4
const ROWS_PER_SECTION = 5

register('home', (_route, container) => {
  async function load(): Promise<void> {
    container.innerHTML = ''
    for (const skeleton of skeletonRows(10)) container.appendChild(skeleton)

    let sections: Section[] | null = null
    const api = getAPI()
    try {
      const selections = (await api.mixedSelections()).slice(0, MAX_SECTIONS)
      sections = selections
        .map((selection) => ({ title: selection.title, tracks: selection.items.collection }))
        .filter((section) => section.tracks.length > 0)
    } catch {
      sections = null
    }

    if (!sections || sections.length === 0) {
      try {
        const featured = await api.featured()
        if (featured.collection.length > 0) sections = [{ title: 'Top tracks', tracks: featured.collection }]
      } catch {
        sections = null
      }
    }

    if (!sections || sections.length === 0) {
      renderError()
      return
    }

    document.title = 'Soundlite — Inicio'
    renderSections(sections)
  }

  function renderError(): void {
    container.innerHTML = ''
    const error = h('div', { className: 'page-error' }, [
      h('h2', {}, 'No se pudo cargar el inicio'),
      h('p', { className: 'text-dim' }, 'Comprueba tu conexión e inténtalo de nuevo.'),
      h('div', {}, [h('button', { className: 'btn btn-primary', onclick: () => void load() }, 'Reintentar')]),
    ])
    container.appendChild(error)
  }

  function renderSections(sections: Section[]): void {
    container.innerHTML = ''
    const first = sections[0]
    if (first && first.tracks[0]) container.appendChild(heroEl(first))
    for (const section of sections) container.appendChild(sectionEl(section))
  }

  function heroEl(section: Section): HTMLElement {
    const track = section.tracks[0]

    const art = artEl(track.artwork_url, track.title, { size: 't500x500', blur: true })
    art.className = 'hero-art'

    const fav = h('button', {
      className: 'icon-btn',
      dataset: { liked: String(player.isLiked(track)) },
      title: player.isLiked(track) ? 'Quitar de favoritos' : 'Guardar en favoritos',
      onclick: (event) => {
        event.stopPropagation()
        player.toggleLike(track)
        renderLike()
        toast(player.isLiked(track) ? 'Guardado en favoritos' : 'Quitado de favoritos', 'ok')
      },
    })
    const renderLike = () => {
      const liked = player.isLiked(track)
      fav.dataset.liked = String(liked)
      fav.title = liked ? 'Quitar de favoritos' : 'Guardar en favoritos'
      fav.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 20)
    }
    renderLike()
    const unsub = player.store.subscribe(() => {
      if (!container.isConnected) {
        unsub()
        return
      }
      renderLike()
    })

    const play = h('button', {
      className: 'btn btn-primary',
      onclick: () => player.playQueue(section.tracks, 0),
    })
    play.innerHTML = `${svgIcon('play', 18)} Reproducir`

    return h('section', { className: 'hero card' }, [
      art,
      h('div', { className: 'hero-info' }, [
        h('span', { className: 'hero-kicker' }, 'Destacado'),
        h('h1', { className: 'hero-title truncate' }, esc(track.title)),
        h('div', { className: 'hero-meta' }, [
          h('a', { className: 'link-hover', href: link(`/user/${track.user.id}`) }, esc(track.user.username)),
          h('span', { className: 'hero-dot' }, '•'),
          h('span', {}, fmtTime(track.duration)),
        ]),
        h('div', { className: 'hero-actions' }, [play, fav]),
      ]),
    ])
  }

  function sectionEl(section: Section): HTMLElement {
    const tracks = section.tracks.slice(0, ROWS_PER_SECTION)
    const rows = tracks.map((track) =>
      trackRow(track, {
        showPlays: true,
        onPlay: (clicked) => {
          const index = section.tracks.findIndex((t) => t.id === clicked.id)
          player.playQueue(section.tracks, Math.max(0, index))
        },
      }),
    )
    return h('section', { className: 'home-section' }, [
      h('div', { className: 'h-section' }, [
        h('span', { className: 'truncate' }, esc(section.title)),
        h('a', { className: 'see-more link-hover', href: link('/charts') }, 'Ver más'),
      ]),
      h('div', { className: 'home-list' }, rows),
    ])
  }

  void load()
})
