import type { Playlist, Track, User } from '@soundclear/api'
import { isTrackStub } from '@soundclear/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { fmtCount, formatDate } from '../core/utils'
import { player } from '../player/player'
import { artEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import './playlist.css'

const PAGE_SIZE = 40
const SKELETON_ROWS = 6

function errorView(message: string, onRetry?: () => void): HTMLElement {
  const view = h('div', { className: 'page-error' })
  view.appendChild(h('h2', null, 'Ups'))
  view.appendChild(h('p', { className: 'text-dim' }, message))
  if (onRetry) {
    view.appendChild(h('button', { className: 'btn btn-primary', onclick: onRetry }, 'Reintentar'))
  } else {
    view.appendChild(h('a', { className: 'btn btn-primary', href: link('/') }, 'Volver al inicio'))
  }
  return view
}

function skeletonView(): HTMLElement {
  const wrap = h('div', { className: 'playlist-skeleton' })
  const header = h('div', { className: 'card card-pad playlist-header' })
  header.appendChild(h('div', { className: 'skeleton sk-art-big' }))
  const info = h('div', { className: 'playlist-info' })
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '60%', height: '30px' } }))
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '34%' } }))
  info.appendChild(h('div', { className: 'skeleton sk-chips' }))
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '50%' } }))
  info.appendChild(h('div', { className: 'skeleton sk-actions' }))
  header.appendChild(info)
  wrap.appendChild(header)
  const list = h('div', { className: 'track-list' })
  for (const row of skeletonRows(8)) list.appendChild(row)
  wrap.appendChild(list)
  return wrap
}

function stillVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const rect = el.getBoundingClientRect()
  return rect.top < window.innerHeight && rect.bottom > 0
}

function fmtLongDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`
  const totalMinutes = Math.round(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

function releaseYear(p: Playlist): string {
  const source = p.release_date ?? p.display_date ?? p.created_at
  if (!source) return ''
  const date = new Date(source)
  if (Number.isNaN(date.getTime())) return ''
  return String(date.getFullYear())
}

function fallbackCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', 'true')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  area.remove()
  return copied
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return fallbackCopy(text)
  }
  return fallbackCopy(text)
}

register('playlist', (route, container) => {
  container.classList.add('playlist-view')
  const id = Number(route.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    document.title = 'SoundClear'
    container.appendChild(errorView('Este enlace no es válido'))
    return
  }
  document.title = 'Cargando… — SoundClear'
  container.appendChild(skeletonView())
  void load()

  async function load(): Promise<void> {
    let playlist: Playlist
    try {
      playlist = await getAPI().playlist(id)
    } catch {
      if (!container.isConnected) return
      document.title = 'SoundClear'
      container.innerHTML = ''
      container.appendChild(errorView('No se pudo cargar este contenido', () => void load()))
      return
    }
    if (!container.isConnected) return
    document.title = `${playlist.title} — SoundClear`
    container.innerHTML = ''
    renderPlaylist(playlist, container)
  }
})

function renderPlaylist(p: Playlist, container: HTMLElement): void {
  const isAlbum = p.kind === 'album' || p.is_album === true || p.set_type === 'album'
  const noun = isAlbum ? 'álbum' : 'playlist'
  const entries = Array.isArray(p.tracks) ? p.tracks : []
  const order = entries.map((t) => t.id)
  const declaredCount = p.track_count ?? entries.length
  const owner = p.user as User | undefined

  const resolved = new Map<number, Track>()
  for (const item of entries) {
    if (!isTrackStub(item)) resolved.set(item.id, item)
  }
  const unavailable = new Set<number>()

  const header = h('div', { className: 'card card-pad playlist-header' })
  const art = artEl(p.artwork_url, p.title, { size: 't500x500', blur: true })
  art.classList.add('playlist-art')
  header.appendChild(art)

  const info = h('div', { className: 'playlist-info' })
  info.appendChild(h('h1', { className: 'h-display' }, p.title))
  info.appendChild(
    owner
      ? h('a', { className: 'artist-link link-hover', href: link(`/user/${owner.id}`) }, owner.username)
      : h('span', { className: 'artist-link text-faint' }, 'Artista desconocido'),
  )

  const chips = h('div', { className: 'chip-row' })
  if (isAlbum) chips.appendChild(h('span', { className: 'chip chip-static playlist-kind' }, 'Álbum'))
  chips.appendChild(h('span', { className: 'chip chip-static' }, declaredCount === 1 ? '1 track' : `${declaredCount} tracks`))
  const durationChip = h('span', { className: 'chip chip-static' })
  durationChip.style.display = 'none'
  chips.appendChild(durationChip)
  const label = p.label_name?.trim() ?? ''
  if (label.length > 0) chips.appendChild(h('span', { className: 'chip chip-static' }, label))
  if (p.genre) chips.appendChild(h('span', { className: 'chip chip-static' }, p.genre))
  const year = releaseYear(p)
  if (p.release_date && year.length > 0) chips.appendChild(h('span', { className: 'chip chip-static' }, year))
  else if (p.display_date) chips.appendChild(h('span', { className: 'chip chip-static' }, formatDate(p.display_date)))
  if (p.likes_count != null) chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(p.likes_count)} likes`))
  if (p.playback_count != null) {
    chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(p.playback_count)} plays`))
  }
  info.appendChild(chips)

  function knownDurationMs(): number {
    if (typeof p.duration === 'number' && p.duration > 0) return p.duration
    let total = 0
    for (const id of order) {
      const track = resolved.get(id)
      if (track) total += track.duration
    }
    return total
  }

  function updateDurationChip(): void {
    const text = fmtLongDuration(knownDurationMs())
    if (text.length === 0) {
      durationChip.style.display = 'none'
      return
    }
    durationChip.style.display = ''
    durationChip.textContent = text
  }
  updateDurationChip()

  if (p.description) {
    info.appendChild(h('p', { className: 'playlist-desc text-dim' }, p.description))
  }

  const actions = h('div', { className: 'playlist-actions' })
  const playBtn = h('button', { className: 'btn btn-primary' })
  const playIcon = h('span')
  const playLabel = h('span')
  playBtn.appendChild(playIcon)
  playBtn.appendChild(playLabel)
  actions.appendChild(playBtn)

  const shuffleBtn = h('button', { className: 'btn btn-ghost' })
  shuffleBtn.innerHTML = `${svgIcon('shuffle', 18)}<span>Mezclar</span>`
  actions.appendChild(shuffleBtn)

  if (p.permalink_url) {
    const shareBtn = h('button', { className: 'btn btn-ghost', title: `Copiar el enlace de la ${noun}` })
    shareBtn.innerHTML = `${svgIcon('link', 18)}<span>Compartir</span>`
    shareBtn.addEventListener('click', () => void share())
    actions.appendChild(shareBtn)

    const openLink = h('a', {
      className: 'btn btn-ghost',
      href: p.permalink_url,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: 'Abrir en SoundCloud',
    })
    openLink.innerHTML = `${svgIcon('external', 18)}<span>Abrir en SoundCloud</span>`
    actions.appendChild(openLink)
  }

  info.appendChild(actions)
  header.appendChild(info)
  container.appendChild(header)

  async function share(): Promise<void> {
    const copied = await copyToClipboard(p.permalink_url)
    if (copied) toast('Enlace copiado al portapapeles', 'ok')
    else toastErr('No se pudo copiar el enlace')
  }

  if (declaredCount === 0 || entries.length === 0) {
    const empty = h('div', { className: 'empty-state' })
    empty.appendChild(iconEl('playlist', 44))
    empty.appendChild(h('p', null, isAlbum ? 'Este álbum está vacío' : 'Esta playlist está vacía'))
    container.appendChild(empty)
    renderPlayButton()
    playBtn.disabled = true
    shuffleBtn.disabled = true
    return
  }

  const list = h('div', { className: 'track-list playlist-tracks' })
  container.appendChild(list)
  const pageSkeleton = h('div', { className: 'page-skeleton' })
  for (const row of skeletonRows(SKELETON_ROWS)) pageSkeleton.appendChild(row)
  pageSkeleton.style.display = 'none'
  container.appendChild(pageSkeleton)

  const loadError = h('div', { className: 'load-error' })
  loadError.appendChild(h('p', { className: 'text-dim' }, 'No se pudieron cargar los tracks'))
  const loadErrorBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Reintentar')
  loadError.appendChild(loadErrorBtn)
  loadError.style.display = 'none'
  container.appendChild(loadError)

  const note = h('p', { className: 'text-faint playlist-note' })
  note.style.display = 'none'
  container.appendChild(note)

  const sentinel = h('div', { className: 'load-more' })
  container.appendChild(sentinel)

  let rendered = 0
  let pageLoading = false

  function updateNote(): void {
    if (unavailable.size === 0) {
      note.style.display = 'none'
      return
    }
    note.style.display = ''
    note.textContent =
      unavailable.size === 1
        ? '1 track ya no está disponible en SoundCloud'
        : `${unavailable.size} tracks ya no están disponibles en SoundCloud`
  }

  function orderedTracks(): Track[] {
    const out: Track[] = []
    for (const id of order) {
      const track = resolved.get(id)
      if (track) out.push(track)
    }
    return out
  }

  async function hydrate(ids: number[]): Promise<void> {
    const pending = ids.filter((id) => !resolved.has(id) && !unavailable.has(id))
    if (pending.length === 0) return
    const found = await getAPI().tracksByIds(pending)
    for (const track of found) resolved.set(track.id, track)
    for (const id of pending) {
      if (!resolved.has(id)) unavailable.add(id)
    }
  }

  async function ensureAll(): Promise<Track[]> {
    await hydrate(order)
    updateDurationChip()
    updateNote()
    return orderedTracks()
  }

  async function renderNextPage(): Promise<void> {
    if (pageLoading || rendered >= order.length) return
    pageLoading = true
    loadError.style.display = 'none'
    const slice = order.slice(rendered, rendered + PAGE_SIZE)
    const needsHydration = slice.some((id) => !resolved.has(id) && !unavailable.has(id))
    if (needsHydration) pageSkeleton.style.display = ''
    try {
      await hydrate(slice)
    } catch {
      if (!container.isConnected) return
      pageSkeleton.style.display = 'none'
      loadError.style.display = ''
      observer.disconnect()
      pageLoading = false
      return
    }
    if (!container.isConnected) return
    pageSkeleton.style.display = 'none'
    for (const id of slice) {
      const track = resolved.get(id)
      if (!track) continue
      list.appendChild(trackRow(track, { rank: list.childElementCount + 1, onPlay: () => void startFrom(track.id) }))
    }
    rendered += slice.length
    updateDurationChip()
    updateNote()
    if (rendered >= order.length) {
      sentinel.remove()
      observer.disconnect()
      if (list.childElementCount === 0) {
        loadError.style.display = ''
        note.style.display = 'none'
      }
    } else {
      window.setTimeout(() => {
        if (container.isConnected && stillVisible(sentinel)) void renderNextPage()
      }, 0)
    }
    pageLoading = false
  }

  loadErrorBtn.addEventListener('click', () => {
    loadError.style.display = 'none'
    if (list.childElementCount === 0) {
      unavailable.clear()
      rendered = 0
    }
    if (!sentinel.isConnected) container.appendChild(sentinel)
    observer.observe(sentinel)
    void renderNextPage()
  })

  const observer = new IntersectionObserver((records) => {
    if (!container.isConnected) {
      observer.disconnect()
      return
    }
    if (records[0]?.isIntersecting) void renderNextPage()
  })
  observer.observe(sentinel)
  void renderNextPage()

  let starting = false

  function setStarting(busy: boolean): void {
    starting = busy
    playBtn.disabled = busy
    shuffleBtn.disabled = busy
    renderPlayButton()
  }

  async function collectQueue(): Promise<Track[]> {
    try {
      return await ensureAll()
    } catch {
      toastErr('No se pudieron cargar todos los tracks')
      return orderedTracks()
    }
  }

  async function startFrom(trackId: number): Promise<void> {
    if (starting) return
    setStarting(true)
    const queue = await collectQueue()
    setStarting(false)
    if (!container.isConnected) return
    if (queue.length === 0) {
      toastErr('No hay tracks disponibles')
      return
    }
    const index = queue.findIndex((t) => t.id === trackId)
    player.playQueue(queue, index >= 0 ? index : 0)
  }

  async function startShuffled(): Promise<void> {
    if (starting) return
    setStarting(true)
    const queue = await collectQueue()
    setStarting(false)
    if (!container.isConnected) return
    if (queue.length === 0) {
      toastErr('No hay tracks disponibles')
      return
    }
    if (!player.store.get().shuffle) player.toggleShuffle()
    player.playQueue(queue, Math.floor(Math.random() * queue.length))
  }

  function isPlayingThis(): boolean {
    const state = player.store.get()
    const current = state.current
    if (!current) return false
    return state.playing && order.includes(current.id)
  }

  function renderPlayButton(): void {
    const playing = isPlayingThis()
    playIcon.innerHTML = svgIcon(starting ? 'clock' : playing ? 'pause' : 'play', 18)
    playLabel.textContent = starting ? 'Cargando…' : playing ? 'Pausar' : 'Reproducir'
  }

  playBtn.addEventListener('click', () => {
    if (starting) return
    const current = player.store.get().current
    if (current && order.includes(current.id)) {
      player.toggle()
      return
    }
    void startFrom(order[0])
  })
  shuffleBtn.addEventListener('click', () => void startShuffled())
  renderPlayButton()

  let attached = false
  const unsub = player.store.subscribe(() => {
    if (attached && !container.isConnected) {
      unsub()
      observer.disconnect()
      return
    }
    attached = true
    renderPlayButton()
  })
}
