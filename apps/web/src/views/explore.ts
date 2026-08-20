import type { PlaylistSummary, Track } from '@soundclear/api'
import { isPlaylistSummary } from '@soundclear/api'
import { getAPI } from '../api'
import { link, register } from '../core/router'
import { player } from '../player/player'
import { trackRow } from '../components/trackrow'
import { artEl } from '../ui/artwork'
import { h, iconEl, titleIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import { fmtCount } from '../core/utils'
import './views.css'
import { t } from '../core/i18n.ts'

const RADIO_GENRES: readonly { slug: string; label: string }[] = [
  { slug: 'house', label: 'House' },
  { slug: 'techno', label: 'Techno' },
  { slug: 'hiphoprap', label: 'Hip Hop' },
  { slug: 'electronic', label: 'Electronic' },
  { slug: 'ambient', label: 'Ambient' },
  { slug: 'drumbass', label: 'Drum & Bass' },
  { slug: 'rock', label: 'Rock' },
  { slug: 'jazzbluess', label: 'Jazz' },
  { slug: 'latin', label: 'Latin' },
  { slug: 'reggaeton', label: 'Reggaetón' },
]

const SIMILAR_LIMIT = 12
const ALBUM_LIMIT = 12

function section(icon: string, title: string, hint?: string): { el: HTMLElement; body: HTMLElement } {
  const el = h('section', { className: 'explore-section' })
  el.appendChild(h('h2', { className: 'h-section' }, [titleIcon(icon, 18), h('span', null, title)]))
  if (hint) el.appendChild(h('p', { className: 'text-faint explore-hint' }, hint))
  const body = h('div', { className: 'explore-body' })
  el.appendChild(body)
  return { el, body }
}

function albumCard(item: PlaylistSummary): HTMLElement {
  const card = h('a', { className: 'playlist-card', href: link(`/playlist/${item.id}`) })
  card.appendChild(artEl(item.artwork_url, item.title, { size: 't500x500' }))
  const meta = h('div', { className: 'pl-meta' })
  meta.appendChild(h('div', { className: 'pl-title truncate' }, item.title))
  const kind = item.is_album === true || item.set_type === 'album' ? 'Álbum' : t('Playlist')
  meta.appendChild(h('div', { className: 'pl-count text-faint truncate' }, `${kind} · ${item.track_count ?? 0} tracks · ${item.user?.username ?? ''}`))
  card.appendChild(meta)
  return card
}

register('explore', (_route, container) => {
  document.title = t('Explorar — SoundClear')
  const api = getAPI()
  container.innerHTML = ''
  const page = h('div', { className: 'view-page' })
  page.appendChild(h('h1', { className: 'h-display h-icon' }, [titleIcon('radio', 26), h('span', null, t('Explorar'))]))
  page.appendChild(h('p', { className: 'text-dim' }, t('Radios por género, etiquetas que sí filtran y lo que se parece a lo tuyo.')))

  const radios = section('radio', t('Radios por género'), t('Cada una arranca una estación de SoundCloud a partir de lo que suena arriba en ese género.'))
  const chips = h('div', { className: 'chip-row' })
  for (const genre of RADIO_GENRES) {
    const chip = h('button', { className: 'chip', type: 'button' }, t(genre.label))
    chip.addEventListener('click', () => {
      chip.disabled = true
      chip.textContent = `${t(genre.label)}…`
      void api
        .recentTracks(genre.slug, 1)
        .then(async (res) => {
          const semilla = res.collection.find((track) => track && typeof track.id === 'number')
          if (!semilla) throw new Error('sin semilla')
          await player.startRadio(semilla)
          toast(`Radio de ${t(genre.label)} en marcha`, 'ok')
        })
        .catch(() => toastErr(`No se pudo arrancar la radio de ${t(genre.label)}`))
        .finally(() => {
          chip.disabled = false
          chip.textContent = genre.label
        })
    })
    chips.appendChild(chip)
  }
  radios.body.appendChild(chips)
  page.appendChild(radios.el)

  const tags = section('tag', t('Etiquetas que funcionan'), t('Los géneros que el filtro de búsqueda de SoundCloud reconoce de verdad; el resto devuelve cero.'))
  const tagRow = h('div', { className: 'chip-row' })
  for (const genre of api.searchGenres()) {
    tagRow.appendChild(
      h('a', { className: 'chip', href: link(`/search?q=&tab=tracks&genre=${encodeURIComponent(genre)}`) }, genre),
    )
  }
  tags.body.appendChild(tagRow)
  page.appendChild(tags.el)

  const albums = section('disc', t('Álbumes y selecciones'), t('Lo que SoundCloud pone en su portada, sin los carruseles vacíos.'))
  const albumGrid = h('div', { className: 'panel-grid' })
  albums.body.appendChild(albumGrid)
  page.appendChild(albums.el)

  const similar = section('waves', t('Se parece a lo tuyo'), t('Sale del último track de tu historial: su estación, sin lo que ya escuchaste.'))
  const similarList = h('div', { className: 'track-list' })
  similar.body.appendChild(similarList)
  page.appendChild(similar.el)

  container.appendChild(page)

  const vacio = (texto: string): HTMLElement => h('p', { className: 'text-faint explore-hint' }, texto)

  void api
    .mixedSelections()
    .then((selections) => {
      if (!container.isConnected) return
      const items: PlaylistSummary[] = []
      for (const selection of selections) {
        for (const item of selection.items?.collection ?? []) {
          if (isPlaylistSummary(item) && !items.some((existing) => existing.id === item.id)) items.push(item)
        }
      }
      const ordenados = [...items].sort((a, b) => Number(b.is_album ?? false) - Number(a.is_album ?? false))
      if (ordenados.length === 0) {
        albums.body.replaceChildren(vacio(t('SoundCloud no devolvió selecciones esta vez.')))
        return
      }
      for (const item of ordenados.slice(0, ALBUM_LIMIT)) albumGrid.appendChild(albumCard(item))
    })
    .catch(() => {
      if (container.isConnected) albums.body.replaceChildren(vacio(t('SoundCloud no devolvió selecciones esta vez.')))
    })

  const history = player.store.get().history
  const semilla = history[0]?.track ?? player.store.get().current
  if (!semilla) {
    similar.body.replaceChildren(vacio(t('Escucha algo y aquí aparecerá lo que se le parece.')))
  } else {
    similar.body.insertBefore(
      h('p', { className: 'text-faint explore-hint' }, `A partir de «${semilla.title}»`),
      similarList,
    )
    void api
      .stationTracks('track', semilla.id)
      .then((tracks: Track[]) => {
        if (!container.isConnected) return
        const escuchados = new Set(history.map((entry) => entry.track.id))
        const frescos = tracks.filter((track) => track.id !== semilla.id && !escuchados.has(track.id)).slice(0, SIMILAR_LIMIT)
        if (frescos.length === 0) {
          similar.body.replaceChildren(vacio(t('Su estación no trajo nada nuevo ahora mismo.')))
          return
        }
        frescos.forEach((track, index) => {
          similarList.appendChild(
            trackRow(track, { showPlays: true, onPlay: () => player.playQueue(frescos, index) }),
          )
        })
        const playAll = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' })
        playAll.appendChild(iconEl('play', 16))
        playAll.appendChild(document.createTextNode(`Reproducir los ${frescos.length} (${fmtCount(frescos.length)} nuevos)`))
        playAll.addEventListener('click', () => player.playQueue(frescos, 0))
        similar.body.appendChild(playAll)
      })
      .catch(() => {
        if (container.isConnected) similar.body.replaceChildren(vacio(t('Su estación no respondió; prueba más tarde.')))
      })
  }
})
