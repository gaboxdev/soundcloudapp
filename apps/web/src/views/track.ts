import type { Comment, Track, User } from '@soundclear/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { fmtCount, fmtTime, formatDate, timeAgo } from '../core/utils'
import type { PlayerState } from '../player/player'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import { waveformEl } from '../ui/waveform'
import './track.css'

const DESC_MAX_LINES = 6
const DESC_MAX_CHARS = 420
const COMMENT_PAGE = 30
const RELATED_PAGE = 12
const MAX_WAVE_MARKERS = 80
const SEEK_TIMEOUT_MS = 4000
const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"«»]+$/

interface SnipInfo {
  snipped: boolean
  previewMs: number
  timelineMs: number
}

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
  const wrap = h('div', { className: 'track-skeleton' })
  const header = h('div', { className: 'track-header' })
  header.appendChild(h('div', { className: 'skeleton sk-art-big' }))
  const info = h('div', { className: 'track-info' })
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '70%', height: '30px' } }))
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '38%' } }))
  info.appendChild(h('div', { className: 'skeleton sk-chips' }))
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '56%' } }))
  info.appendChild(h('div', { className: 'skeleton sk-actions' }))
  header.appendChild(info)
  wrap.appendChild(header)
  wrap.appendChild(h('div', { className: 'skeleton sk-wave' }))
  const list = h('div', { className: 'track-list' })
  for (const row of skeletonRows(6)) list.appendChild(row)
  wrap.appendChild(list)
  return wrap
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

function safeHref(raw: string): string | null {
  const candidate = raw.startsWith('www.') ? `https://${raw}` : raw
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

function linkifyInto(parent: HTMLElement, text: string): void {
  URL_PATTERN.lastIndex = 0
  let cursor = 0
  for (let match = URL_PATTERN.exec(text); match !== null; match = URL_PATTERN.exec(text)) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, '')
    if (raw.length === 0) {
      URL_PATTERN.lastIndex = match.index + match[0].length
      continue
    }
    if (match.index > cursor) parent.appendChild(document.createTextNode(text.slice(cursor, match.index)))
    const href = safeHref(raw)
    if (href) {
      parent.appendChild(
        h('a', { className: 'link-hover', href, target: '_blank', rel: 'noopener noreferrer' }, raw),
      )
    } else {
      parent.appendChild(document.createTextNode(raw))
    }
    cursor = match.index + raw.length
    URL_PATTERN.lastIndex = cursor
  }
  if (cursor < text.length) parent.appendChild(document.createTextNode(text.slice(cursor)))
}

function descriptionBlock(text: string): HTMLElement {
  const wrap = h('div', { className: 'track-desc-box' })
  const body = h('p', { className: 'track-desc text-dim' })
  linkifyInto(body, text)
  wrap.appendChild(body)
  const isLong = text.split('\n').length > DESC_MAX_LINES || text.length > DESC_MAX_CHARS
  if (!isLong) return wrap
  body.classList.add('desc-clamped')
  const toggle = h('button', { className: 'btn btn-ghost btn-sm track-desc-toggle' }, 'Ver más')
  toggle.addEventListener('click', () => {
    const clamped = body.classList.toggle('desc-clamped')
    toggle.textContent = clamped ? 'Ver más' : 'Ver menos'
  })
  wrap.appendChild(toggle)
  return wrap
}

function stillVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const rect = el.getBoundingClientRect()
  return rect.top < window.innerHeight && rect.bottom > 0
}

function snipInfo(track: Track): SnipInfo {
  const transcodings = track.media?.transcodings ?? []
  const snippedTranscoding = transcodings.length > 0 && transcodings.every((t) => t.snipped === true)
  const access = track.access
  const blockedAccess = access ? access.play === false : false
  const snipped = track.policy === 'SNIP' || snippedTranscoding || blockedAccess
  const full = typeof track.full_duration === 'number' ? track.full_duration : 0
  const timelineMs = snipped && full > track.duration ? full : track.duration
  return { snipped, previewMs: track.duration, timelineMs }
}

register('track', (route, container) => {
  container.classList.add('track-view')
  const id = Number(route.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    document.title = 'SoundClear'
    container.appendChild(errorView('Este enlace de track no es válido'))
    return
  }
  document.title = 'Cargando… — SoundClear'
  container.appendChild(skeletonView())
  void load()

  async function load(): Promise<void> {
    let track: Track
    try {
      track = await getAPI().track(id)
    } catch {
      if (!container.isConnected) return
      document.title = 'SoundClear'
      container.innerHTML = ''
      container.appendChild(errorView('No se pudo cargar el track', () => void load()))
      return
    }
    if (!container.isConnected) return
    document.title = `${track.title} — SoundClear`
    container.innerHTML = ''
    renderTrack(track, container)
  }
})

function renderTrack(track: Track, container: HTMLElement): void {
  const snip = snipInfo(track)
  const user = track.user as User | undefined
  const secondaryArtist = track.publisher_metadata?.artist?.trim() ?? ''
  const albumTitle = track.publisher_metadata?.album_title?.trim() ?? ''
  const showSecondaryArtist =
    secondaryArtist.length > 0 &&
    secondaryArtist.toLowerCase() !== (user?.username ?? '').trim().toLowerCase()

  const header = h('div', { className: 'track-header' })
  const art = artEl(track.artwork_url, track.title, { size: 't500x500', blur: true })
  art.classList.add('track-art')
  header.appendChild(art)

  const info = h('div', { className: 'track-info' })
  info.appendChild(h('h1', { className: 'h-display' }, track.title))
  info.appendChild(
    user
      ? h('a', { className: 'artist-link link-hover', href: link(`/user/${user.id}`) }, user.username)
      : h('span', { className: 'artist-link text-faint' }, 'Artista desconocido'),
  )

  if (showSecondaryArtist || albumTitle.length > 0) {
    const credits = h('div', { className: 'track-credits text-dim' })
    if (showSecondaryArtist) {
      const line = h('span', { className: 'track-credit' })
      line.appendChild(iconEl('user', 14))
      line.appendChild(document.createTextNode(secondaryArtist))
      credits.appendChild(line)
    }
    if (albumTitle.length > 0) {
      const line = h('span', { className: 'track-credit' })
      line.appendChild(iconEl('disc', 14))
      line.appendChild(document.createTextNode(albumTitle))
      credits.appendChild(line)
    }
    info.appendChild(credits)
  }

  const chips = h('div', { className: 'chip-row' })
  if (track.genre) chips.appendChild(h('span', { className: 'chip chip-static' }, track.genre))
  if (track.display_date) chips.appendChild(h('span', { className: 'chip chip-static' }, formatDate(track.display_date)))
  chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(track.playback_count)} plays`))
  chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(track.likes_count)} likes`))
  chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(track.comment_count)} comentarios`))
  chips.appendChild(h('span', { className: 'chip chip-static' }, `${fmtCount(track.reposts_count)} reposts`))
  info.appendChild(chips)

  if (track.description) info.appendChild(descriptionBlock(track.description))

  const actions = h('div', { className: 'track-actions' })
  const playBtn = h('button', { className: 'btn btn-primary' })
  const playIcon = h('span')
  const playLabel = h('span')
  playBtn.appendChild(playIcon)
  playBtn.appendChild(playLabel)
  actions.appendChild(playBtn)

  const queueBtn = h('button', { className: 'btn btn-ghost' })
  queueBtn.innerHTML = `${svgIcon('plus', 18)}<span>Añadir a la cola</span>`
  queueBtn.addEventListener('click', () => {
    const added = player.addToQueue(track)
    toast(added ? 'Añadido a la cola' : 'Ya estaba en la cola', added ? 'ok' : 'info')
  })
  actions.appendChild(queueBtn)

  const likeBtn = h('button', { className: 'icon-btn', title: 'Guardar en favoritos' })
  actions.appendChild(likeBtn)

  if (track.downloadable) {
    const exhausted = track.has_downloads_left === false
    const dlBtn = h('button', {
      className: 'btn btn-ghost',
      title: exhausted ? 'El artista agotó el cupo de descargas' : 'Descargar el archivo original',
    })
    dlBtn.innerHTML = `${svgIcon('download', 18)}<span>Descargar</span>`
    if (exhausted) {
      dlBtn.setAttribute('disabled', 'true')
    } else {
      dlBtn.addEventListener('click', () => void download())
    }
    actions.appendChild(dlBtn)
  }

  if (track.permalink_url) {
    const shareBtn = h('button', { className: 'btn btn-ghost', title: 'Copiar el enlace del track' })
    shareBtn.innerHTML = `${svgIcon('link', 18)}<span>Compartir</span>`
    shareBtn.addEventListener('click', () => void share())
    actions.appendChild(shareBtn)

    const openLink = h('a', {
      className: 'btn btn-ghost',
      href: track.permalink_url,
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

  const waveBlock = h('div', { className: 'track-wave' })
  const waveBox = h('div', { className: 'track-wave-box' })
  const wave = waveformEl({
    interactive: true,
    showHover: true,
    getDuration: () => snip.timelineMs,
    onSeek: (ratio) => void seekFromWave(ratio),
  })
  waveBox.appendChild(wave.el)
  const markerLayer = h('div', { className: 'wave-markers' })
  waveBox.appendChild(markerLayer)
  if (snip.snipped && snip.timelineMs > snip.previewMs) {
    const boundary = (snip.previewMs / snip.timelineMs) * 100
    const mask = h('div', { className: 'wave-locked' })
    mask.style.left = `${boundary}%`
    mask.title = 'Solo disponible con SoundCloud Go+'
    waveBox.appendChild(mask)
    const edge = h('div', { className: 'wave-snip-edge' })
    edge.style.left = `${boundary}%`
    waveBox.appendChild(edge)
  }
  waveBlock.appendChild(waveBox)
  if (snip.snipped) {
    const note = h('div', { className: 'text-accent track-snip' })
    note.appendChild(iconEl('info', 15))
    note.appendChild(
      document.createTextNode(
        snip.timelineMs > snip.previewMs
          ? `Preview de ${fmtTime(snip.previewMs)} de ${fmtTime(snip.timelineMs)} · exclusivo Go+`
          : 'Preview de 30s (exclusivo Go+)',
      ),
    )
    waveBlock.appendChild(note)
  }
  container.appendChild(waveBlock)

  function currentRatio(state: PlayerState): number {
    if (state.current?.id !== track.id) return 0
    if (snip.snipped && snip.timelineMs > 0) return Math.min(1, state.progress / snip.timelineMs)
    if (state.duration <= 0) return 0
    return state.progress / state.duration
  }

  let pendingSeekMs: number | null = null
  let seekWatching = false
  let startingPlayback = false

  function flushSeek(): void {
    const ms = pendingSeekMs
    pendingSeekMs = null
    if (ms === null) return
    player.seekTo(ms)
  }

  function watchForSeek(): void {
    if (seekWatching) return
    seekWatching = true
    let unsubscribe: (() => void) | null = null
    const stop = (): void => {
      seekWatching = false
      unsubscribe?.()
    }
    unsubscribe = player.store.subscribe(() => {
      if (!seekWatching) return
      if (!container.isConnected) {
        pendingSeekMs = null
        stop()
        return
      }
      const state = player.store.get()
      if (state.current?.id !== track.id || state.duration <= 0) return
      stop()
      flushSeek()
    })
    if (!seekWatching) unsubscribe()
    window.setTimeout(() => {
      if (!seekWatching) return
      stop()
      if (container.isConnected) flushSeek()
      else pendingSeekMs = null
    }, SEEK_TIMEOUT_MS)
  }

  async function playAt(ms: number): Promise<void> {
    const target = Math.max(0, Math.min(ms, snip.previewMs))
    const state = player.store.get()
    if (state.current?.id === track.id && state.duration > 0) {
      player.seekTo(target)
      return
    }
    pendingSeekMs = target
    watchForSeek()
    if (startingPlayback) return
    if (state.current?.id === track.id && (state.playing || state.loading)) return
    startingPlayback = true
    try {
      await player.playTrack(track)
    } finally {
      startingPlayback = false
    }
  }

  async function seekFromWave(ratio: number): Promise<void> {
    const ms = ratio * snip.timelineMs
    if (snip.snipped && ms > snip.previewMs) {
      wave.setProgress(currentRatio(player.store.get()))
      toast('Esa parte solo está disponible con SoundCloud Go+')
      return
    }
    await playAt(ms)
  }

  const renderPlay = (): void => {
    const state = player.store.get()
    const isCurrent = state.current?.id === track.id
    const playing = isCurrent && state.playing
    playIcon.innerHTML = svgIcon(playing ? 'pause' : 'play', 18)
    playLabel.textContent = playing ? 'Pausar' : 'Reproducir'
  }
  const renderLike = (): void => {
    const liked = player.isLiked(track)
    likeBtn.dataset.liked = String(liked)
    likeBtn.title = liked ? 'Quitar de favoritos' : 'Guardar en favoritos'
    likeBtn.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 20)
  }
  renderPlay()
  renderLike()

  playBtn.addEventListener('click', () => {
    const state = player.store.get()
    if (state.current?.id === track.id) player.toggle()
    else void player.playTrack(track)
  })
  likeBtn.addEventListener('click', () => {
    player.toggleLike(track)
    toast(player.isLiked(track) ? 'Guardado en favoritos' : 'Quitado de favoritos', 'ok')
  })

  async function share(): Promise<void> {
    const copied = await copyToClipboard(track.permalink_url)
    if (copied) toast('Enlace copiado al portapapeles', 'ok')
    else toastErr('No se pudo copiar el enlace')
  }

  async function download(): Promise<void> {
    try {
      const url = await getAPI().downloadUrl(track)
      if (url) window.open(url, '_blank', 'noopener')
      else toastErr('La descarga no está disponible')
    } catch {
      toastErr('Error al descargar el track')
    }
  }

  void getAPI()
    .waveformSamples(track)
    .then((samples) => {
      if (container.isConnected) wave.setSamples(samples)
    })

  function addMarker(comment: Comment): void {
    if (markerLayer.childElementCount >= MAX_WAVE_MARKERS) return
    const at = comment.timestamp
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > snip.timelineMs) return
    const marker = h('button', {
      className: 'wave-marker',
      title: `${comment.user?.username ?? 'Alguien'} en ${fmtTime(at)}: ${comment.body}`,
    })
    marker.style.left = `${(at / snip.timelineMs) * 100}%`
    marker.addEventListener('click', (event) => {
      event.stopPropagation()
      void playAt(at)
    })
    markerLayer.appendChild(marker)
  }

  function commentRow(comment: Comment): HTMLElement {
    const author = comment.user as User | undefined
    const name = author?.username ?? 'Usuario desconocido'
    const row = h('div', { className: 'comment' })
    row.appendChild(avatarEl(author?.avatar_url ?? null, name, 36))
    const body = h('div', { className: 'body' })
    const head = h('div', { className: 'comment-head' })
    head.appendChild(
      author && Number.isFinite(author.id)
        ? h('a', { className: 'link-hover', href: link(`/user/${author.id}`) }, name)
        : h('span', { className: 'text-faint' }, name),
    )
    const at = comment.timestamp
    if (typeof at === 'number' && Number.isFinite(at) && at >= 0) {
      const jump = h('button', {
        className: 'comment-at',
        title: `Reproducir desde ${fmtTime(at)}`,
      })
      jump.appendChild(iconEl('play', 11))
      jump.appendChild(document.createTextNode(fmtTime(at)))
      jump.addEventListener('click', () => void playAt(at))
      head.appendChild(jump)
    }
    head.appendChild(h('span', { className: 'text-faint' }, timeAgo(comment.created_at)))
    body.appendChild(head)
    body.appendChild(h('p', { className: 'comment-text' }, comment.body ?? ''))
    row.appendChild(body)
    return row
  }

  const commentsSection = h('section', { className: 'track-section' })
  const commentsTitle = h('h2', { className: 'h-section' })
  commentsTitle.appendChild(iconEl('comment', 18))
  commentsTitle.appendChild(document.createTextNode('Comentarios'))
  commentsSection.appendChild(commentsTitle)
  const commentList = h('div', { className: 'comment-list' })
  commentsSection.appendChild(commentList)
  const commentSkeleton = h('div', { className: 'comment-skeleton' })
  for (const row of skeletonRows(3)) commentSkeleton.appendChild(row)
  commentsSection.appendChild(commentSkeleton)
  const emptyComments = h('div', { className: 'empty-state' })
  emptyComments.appendChild(iconEl('comment', 44))
  emptyComments.appendChild(h('p', null, 'Sin comentarios'))
  emptyComments.style.display = 'none'
  commentsSection.appendChild(emptyComments)
  const commentsRetry = h('div', { className: 'load-error' })
  commentsRetry.appendChild(h('p', { className: 'text-dim' }, 'No se pudieron cargar más comentarios'))
  const commentsRetryBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Reintentar')
  commentsRetry.appendChild(commentsRetryBtn)
  commentsRetry.style.display = 'none'
  commentsSection.appendChild(commentsRetry)
  const commentSentinel = h('div', { className: 'load-more' })
  commentsSection.appendChild(commentSentinel)
  container.appendChild(commentsSection)

  let commentOffset = 0
  let commentsLoading = false
  let commentsDone = false
  let commentsEmpty = true

  function finishComments(): void {
    commentSkeleton.remove()
    commentSentinel.remove()
    commentObserver.disconnect()
    if (commentsEmpty) emptyComments.style.display = ''
  }

  async function loadComments(): Promise<void> {
    if (commentsLoading || commentsDone) return
    commentsLoading = true
    commentsRetry.style.display = 'none'
    commentSkeleton.style.display = ''
    try {
      const res = await getAPI().trackComments(track.id, commentOffset, COMMENT_PAGE)
      if (!container.isConnected) return
      commentsDone = !res.next_href || res.collection.length === 0
      commentOffset += res.collection.length
      if (res.collection.length > 0) commentsEmpty = false
      for (const comment of res.collection) {
        try {
          commentList.appendChild(commentRow(comment))
          addMarker(comment)
        } catch {
          continue
        }
      }
      if (commentsDone) {
        finishComments()
      } else {
        commentSkeleton.style.display = 'none'
        window.setTimeout(() => {
          if (container.isConnected && stillVisible(commentSentinel)) void loadComments()
        }, 0)
      }
    } catch {
      if (!container.isConnected) return
      commentSkeleton.style.display = 'none'
      commentsRetry.style.display = ''
      commentObserver.disconnect()
    } finally {
      commentsLoading = false
    }
  }

  commentsRetryBtn.addEventListener('click', () => {
    commentsRetry.style.display = 'none'
    commentObserver.observe(commentSentinel)
    void loadComments()
  })

  const commentObserver = new IntersectionObserver((entries) => {
    if (!container.isConnected) {
      commentObserver.disconnect()
      return
    }
    if (entries[0]?.isIntersecting) void loadComments()
  })
  commentObserver.observe(commentSentinel)
  void loadComments()

  const relatedSection = h('section', { className: 'track-section' })
  const relatedTitle = h('h2', { className: 'h-section' })
  relatedTitle.appendChild(iconEl('music', 18))
  relatedTitle.appendChild(document.createTextNode('Tracks relacionados'))
  relatedSection.appendChild(relatedTitle)
  const relatedList = h('div', { className: 'track-list' })
  relatedSection.appendChild(relatedList)
  const relatedSkeleton = h('div', { className: 'related-skeleton' })
  for (const row of skeletonRows(3)) relatedSkeleton.appendChild(row)
  relatedSection.appendChild(relatedSkeleton)
  const relatedRetry = h('div', { className: 'load-error' })
  relatedRetry.appendChild(h('p', { className: 'text-dim' }, 'No se pudieron cargar más tracks'))
  const relatedRetryBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Reintentar')
  relatedRetry.appendChild(relatedRetryBtn)
  relatedRetry.style.display = 'none'
  relatedSection.appendChild(relatedRetry)
  const relatedSentinel = h('div', { className: 'load-more' })
  relatedSection.appendChild(relatedSentinel)
  container.appendChild(relatedSection)

  const relatedTracks: Track[] = []
  let relatedOffset = 0
  let relatedLoading = false
  let relatedDone = false

  async function loadRelated(): Promise<void> {
    if (relatedLoading || relatedDone) return
    relatedLoading = true
    relatedRetry.style.display = 'none'
    relatedSkeleton.style.display = ''
    const start = relatedTracks.length
    try {
      const res = await getAPI().trackRelated(track.id, relatedOffset, RELATED_PAGE)
      if (!container.isConnected) return
      relatedDone = !res.next_href || res.collection.length === 0
      relatedOffset += res.collection.length
      relatedTracks.push(...res.collection)
      res.collection.forEach((item, i) => {
        relatedList.appendChild(trackRow(item, { onPlay: () => player.playQueue(relatedTracks, start + i) }))
      })
      relatedSkeleton.style.display = 'none'
      if (!relatedDone) {
        window.setTimeout(() => {
          if (container.isConnected && stillVisible(relatedSentinel)) void loadRelated()
        }, 0)
      }
      if (relatedDone) {
        relatedSkeleton.remove()
        relatedSentinel.remove()
        relatedObserver.disconnect()
        if (relatedTracks.length === 0) {
          const empty = h('div', { className: 'empty-state' })
          empty.appendChild(iconEl('music', 44))
          empty.appendChild(h('p', null, 'Sin tracks relacionados'))
          relatedList.appendChild(empty)
        }
      }
    } catch {
      if (!container.isConnected) return
      relatedSkeleton.style.display = 'none'
      relatedRetry.style.display = ''
      relatedObserver.disconnect()
    } finally {
      relatedLoading = false
    }
  }

  relatedRetryBtn.addEventListener('click', () => {
    relatedRetry.style.display = 'none'
    relatedObserver.observe(relatedSentinel)
    void loadRelated()
  })

  const relatedObserver = new IntersectionObserver((entries) => {
    if (!container.isConnected) {
      relatedObserver.disconnect()
      return
    }
    if (entries[0]?.isIntersecting) void loadRelated()
  })
  relatedObserver.observe(relatedSentinel)
  void loadRelated()

  let attached = false
  const unsub = player.store.subscribe((state) => {
    if (attached && !container.isConnected) {
      unsub()
      commentObserver.disconnect()
      relatedObserver.disconnect()
      return
    }
    attached = true
    wave.setProgress(currentRatio(state))
    renderPlay()
    renderLike()
  })
}
