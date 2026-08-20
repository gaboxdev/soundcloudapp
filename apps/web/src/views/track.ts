import type { Comment, Playlist, Track, User } from '@soundclear/api'
import { isDrmOnly } from '@soundclear/api'
import { getAPI } from '../api'
import { toggleOffline, trackRow } from '../components/trackrow'
import { offlineHas, offlineReason, offlineSaving, offlineStore } from '../core/offline'
import { downloadTrackFile } from '../core/download'
import { shareLink } from '../core/links'
import { link, register } from '../core/router'
import { artworkUrl, fmtCount, fmtTime, formatDate, timeAgo } from '../core/utils'
import type { PlayerState } from '../player/player'
import { player } from '../player/player'
import { artEl, artOverlay, avatarEl } from '../ui/artwork'
import { openMenu, type MenuEntry } from '../components/menu'
import { openPlaylistPicker } from '../components/playlistpicker'
import { canWrite, isBusy, isReposted, loadSocial, socialStore, toggleRepost } from '../core/social'
import { h, iconEl, svgIcon, titleIcon } from '../ui/el'
import { skAppearsRow, skComments, skReveal, skTrackList, skTrackPage } from '../ui/skeleton'
import { toast } from '../ui/toast'
import { waveformEl } from '../ui/waveform'
import './track.css'
import { t } from '../core/i18n.ts'

const DESC_MAX_LINES = 6
const DESC_MAX_CHARS = 420
const COMMENT_PAGE = 30
const RELATED_PAGE = 12
const MAX_WAVE_MARKERS = 80
const SEEK_TIMEOUT_MS = 4000
const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi
const TAGS_MAX = 12
const APPEARS_MAX = 12
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"«»]+$/

interface SnipInfo {
  snipped: boolean
  previewMs: number
  timelineMs: number
}

function errorView(message: string, onRetry?: () => void): HTMLElement {
  const view = h('div', { className: 'page-error' })
  view.appendChild(h('h2', null, t('Ups')))
  view.appendChild(h('p', { className: 'text-dim' }, message))
  if (onRetry) {
    view.appendChild(h('button', { className: 'btn btn-primary', onclick: onRetry }, t('Reintentar')))
  } else {
    view.appendChild(h('a', { className: 'btn btn-primary', href: link('/') }, t('Volver al inicio')))
  }
  return view
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
  const toggle = h('button', { className: 'btn btn-ghost btn-sm track-desc-toggle' }, t('Ver más'))
  toggle.addEventListener('click', () => {
    const clamped = body.classList.toggle('desc-clamped')
    toggle.textContent = clamped ? 'Ver más' : t('Ver menos')
  })
  wrap.appendChild(toggle)
  return wrap
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return []
  const tags: string[] = []
  const pattern = /"([^"]+)"|(\S+)/g
  for (let match = pattern.exec(raw); match !== null; match = pattern.exec(raw)) {
    const tag = (match[1] ?? match[2] ?? '').trim()
    if (tag.length > 0 && tag.length < 40) tags.push(tag)
    if (tags.length >= TAGS_MAX) break
  }
  return tags
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
    document.title = t('SoundClear')
    container.appendChild(errorView(t('Este enlace de track no es válido')))
    return
  }
  document.title = t('Cargando… — SoundClear')
  container.appendChild(skTrackPage())
  void load()

  async function load(): Promise<void> {
    let track: Track
    try {
      track = await getAPI().track(id)
    } catch {
      if (!container.isConnected) return
      document.title = t('SoundClear')
      container.innerHTML = ''
      container.appendChild(errorView(t('No se pudo cargar el track'), () => void load()))
      return
    }
    if (!container.isConnected) return
    document.title = `${track.title} — SoundClear`
    container.innerHTML = ''
    skReveal(container)
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

  const hero = h('div', { className: 'card card-pad track-hero' })

  const artCol = h('div', { className: 'track-art-col' })
  const glowSrc = artworkUrl(track.artwork_url, 't500x500')
  if (glowSrc) {
    const glow = h('div', { className: 'track-art-glow' })
    glow.style.backgroundImage = `url("${glowSrc}")`
    artCol.appendChild(glow)
  }
  const art = artEl(track.artwork_url, track.title, { size: 't500x500' })
  art.classList.add('track-art', 'art-open')
  const artPlay = artOverlay('play', 34)
  art.appendChild(artPlay)
  art.addEventListener('click', () => togglePlay())
  artCol.appendChild(art)
  hero.appendChild(artCol)

  const info = h('div', { className: 'track-info' })

  const tags = h('div', { className: 'track-tags' })
  if (track.genre) tags.appendChild(h('span', { className: 'chip chip-static' }, track.genre))
  if (track.display_date) tags.appendChild(h('span', { className: 'chip chip-static' }, formatDate(track.display_date)))
  if (albumTitle.length > 0) {
    const albumChip = h('span', { className: 'chip chip-static' })
    albumChip.appendChild(iconEl('disc', 13))
    albumChip.appendChild(document.createTextNode(albumTitle))
    tags.appendChild(albumChip)
  }
  if (isDrmOnly(track)) {
    const drmChip = h('span', {
      className: 'chip chip-static',
      title: t('SoundCloud entrega este track cifrado (DRM): solo suena en su propia app'),
    })
    drmChip.appendChild(iconEl('info', 13))
    drmChip.appendChild(document.createTextNode(t('DRM · no se puede reproducir aquí')))
    tags.appendChild(drmChip)
  }
  if (tags.childElementCount > 0) info.appendChild(tags)

  info.appendChild(h('h1', { className: 'h-display track-title' }, track.title))

  const by = h('div', { className: 'track-by' })
  if (user) {
    const artistLink = h('a', { className: 'track-by-link link-hover', href: link(`/user/${user.id}`) })
    artistLink.appendChild(avatarEl(user.avatar_url, user.username, 30))
    artistLink.appendChild(h('span', { className: 'truncate' }, user.username))
    by.appendChild(artistLink)
  } else {
    by.appendChild(h('span', { className: 'track-by-link text-faint' }, t('Artista desconocido')))
  }
  if (showSecondaryArtist) {
    by.appendChild(h('span', { className: 'track-dot' }, '·'))
    by.appendChild(h('span', { className: 'text-dim truncate' }, secondaryArtist))
  }
  info.appendChild(by)

  const stats = h('div', { className: 'track-stats' })
  const statEl = (icon: string, value: string, label: string): HTMLElement => {
    const item = h('span', { className: 'track-stat', title: label })
    item.appendChild(iconEl(icon, 15))
    item.appendChild(h('span', null, value))
    return item
  }
  stats.appendChild(statEl('play', fmtCount(track.playback_count), t('Reproducciones')))
  stats.appendChild(statEl('heart', fmtCount(track.likes_count), t('Favoritos')))
  stats.appendChild(statEl('comment', fmtCount(track.comment_count), t('Comentarios')))
  stats.appendChild(statEl('repost', fmtCount(track.reposts_count), t('Reposts')))
  stats.appendChild(statEl('clock', fmtTime(snip.timelineMs), t('Duración')))
  info.appendChild(stats)

  const actions = h('div', { className: 'track-actions' })
  const playBtn = h('button', { className: 'btn btn-primary track-play' })
  const playIcon = h('span')
  const playLabel = h('span')
  playBtn.appendChild(playIcon)
  playBtn.appendChild(playLabel)
  actions.appendChild(playBtn)

  const queueBtn = h('button', { className: 'btn btn-ghost' })
  queueBtn.innerHTML = `${svgIcon('plus', 18)}<span>Añadir a la cola</span>`
  queueBtn.addEventListener('click', () => {
    const added = player.addToQueue(track)
    toast(added ? 'Añadido a la cola' : t('Ya estaba en la cola'), added ? 'ok' : 'info')
  })
  actions.appendChild(queueBtn)

  const likeBtn = h('button', { className: 'icon-btn', title: t('Guardar en favoritos') })
  actions.appendChild(likeBtn)

  const radioBtn = h('button', {
    className: 'icon-btn',
    title: t('Empezar una radio a partir de este track'),
    'aria-label': t('Empezar radio'),
  })
  radioBtn.innerHTML = svgIcon('radio', 19)
  radioBtn.addEventListener('click', () => void player.startRadio(track))
  actions.appendChild(radioBtn)

  if (canWrite()) {
    const repostBtn = h('button', { className: 'icon-btn' }) as HTMLButtonElement
    const paintRepost = (): void => {
      const reposted = isReposted(track.id)
      repostBtn.disabled = isBusy(track.id)
      repostBtn.classList.toggle('active', reposted)
      repostBtn.title = reposted ? 'Quitar el repost' : t('Repostear en tu perfil')
      repostBtn.setAttribute('aria-label', repostBtn.title)
      repostBtn.setAttribute('aria-pressed', String(reposted))
      repostBtn.innerHTML = svgIcon('repost', 19)
    }
    paintRepost()
    repostBtn.addEventListener('click', () => void toggleRepost(track))
    let repostAttached = false
    let unsubRepost: (() => void) | null = null
    unsubRepost = socialStore.subscribe(() => {
      if (repostAttached && !repostBtn.isConnected) {
        unsubRepost?.()
        return
      }
      repostAttached = true
      paintRepost()
    })
    actions.appendChild(repostBtn)

    const playlistBtn = h('button', {
      className: 'icon-btn',
      title: t('Añadir a una playlist'),
      'aria-label': t('Añadir a una playlist'),
    })
    playlistBtn.innerHTML = svgIcon('playlist', 19)
    playlistBtn.addEventListener('click', () => openPlaylistPicker(track))
    actions.appendChild(playlistBtn)
    void loadSocial()
  }

  const offlineBtn = h('button', { className: 'icon-btn', type: 'button' }) as HTMLButtonElement
  const paintOffline = (): void => {
    const saving = offlineSaving(track.id) !== null
    const saved = offlineHas(track.id)
    const blocked = offlineReason(track)
    offlineBtn.classList.toggle('active', saved)
    offlineBtn.disabled = saving || (blocked !== null && !saved)
    offlineBtn.title = saving
      ? t('Guardando…')
      : saved
        ? t('Quitar de sin conexión')
        : (blocked ?? t('Guardar en este dispositivo para escuchar sin conexión'))
    offlineBtn.setAttribute('aria-label', saved ? 'Quitar de sin conexión' : t('Guardar sin conexión'))
    offlineBtn.setAttribute('aria-pressed', String(saved))
    offlineBtn.innerHTML = svgIcon(saved ? 'check' : 'download', 19)
  }
  paintOffline()
  offlineBtn.addEventListener('click', () => void toggleOffline(track).then(paintOffline))
  let offlineAttached = false
  let unsubOffline: (() => void) | null = null
  unsubOffline = offlineStore.subscribe(() => {
    if (offlineAttached && !offlineBtn.isConnected) {
      unsubOffline?.()
      return
    }
    offlineAttached = true
    paintOffline()
  })
  actions.appendChild(offlineBtn)

  if (track.downloadable) {
    const exhausted = track.has_downloads_left === false
    const dlBtn = h('button', {
      className: 'icon-btn',
      title: exhausted ? 'El artista agotó el cupo de descargas' : t('Descargar el archivo original'),
      'aria-label': t('Descargar'),
    })
    dlBtn.innerHTML = svgIcon('download', 19)
    if (exhausted) {
      dlBtn.setAttribute('disabled', 'true')
    } else {
      dlBtn.addEventListener('click', () => void downloadTrackFile(track))
    }
    actions.appendChild(dlBtn)
  }

  if (track.permalink_url) {
    const shareBtn = h('button', {
      className: 'icon-btn',
      title: t('Copiar el enlace del track'),
      'aria-label': t('Compartir'),
    })
    shareBtn.innerHTML = svgIcon('link', 19)
    shareBtn.addEventListener('click', () => void share())
    actions.appendChild(shareBtn)

    const openLink = h('a', {
      className: 'icon-btn',
      href: track.permalink_url,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: t('Abrir en SoundCloud'),
      'aria-label': t('Abrir en SoundCloud'),
    })
    openLink.innerHTML = svgIcon('external', 19)
    actions.appendChild(openLink)
  }

  const moreBtn = h('button', { className: 'icon-btn', title: t('Más opciones'), 'aria-label': t('Más opciones') })
  moreBtn.innerHTML = svgIcon('more', 19)
  moreBtn.addEventListener('click', () => {
    const entries: MenuEntry[] = [
      {
        label: t('Reproducir a continuación'),
        icon: 'next',
        onSelect: () => {
          player.playNext(track)
          toast(t('Suena a continuación'), 'ok')
        },
      },
      {
        label: t('Añadir a la cola'),
        icon: 'plus',
        onSelect: () => {
          toast(player.addToQueue(track) ? 'Añadido a la cola' : t('Ya estaba en la cola'))
        },
      },
      { label: t('Empezar radio'), icon: 'radio', onSelect: () => void player.startRadio(track) },
    ]
    if (user) {
      entries.push('separator', {
        label: `Radio de ${user.username}`,
        icon: 'radio',
        onSelect: () => void player.startRadio(track, 'artist'),
      })
    }
    openMenu(entries, moreBtn)
  })
  actions.appendChild(moreBtn)

  info.appendChild(actions)

  const trackTags = parseTags(track.tag_list)
  if (trackTags.length > 0) {
    const tagRow = h('div', { className: 'chip-row track-tag-row' })
    for (const tag of trackTags) {
      const chip = h('a', { className: 'chip track-tag', href: link('/search', { q: tag }), title: `Buscar «${tag}»` })
      chip.appendChild(iconEl('tag', 12))
      chip.appendChild(document.createTextNode(tag))
      tagRow.appendChild(chip)
    }
    info.appendChild(tagRow)
  }

  hero.appendChild(info)
  container.appendChild(hero)

  const waveBlock = h('div', { className: 'card card-pad track-wave' })
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
    mask.title = t('Solo disponible con SoundCloud Go+')
    waveBox.appendChild(mask)
    const edge = h('div', { className: 'wave-snip-edge' })
    edge.style.left = `${boundary}%`
    waveBox.appendChild(edge)
  }
  waveBlock.appendChild(waveBox)
  const waveTimes = h('div', { className: 'track-wave-times' })
  const timeNow = h('span', { className: 'track-time' }, '0:00')
  const timeTotal = h('span', { className: 'track-time' }, fmtTime(snip.timelineMs))
  waveTimes.appendChild(timeNow)
  waveTimes.appendChild(timeTotal)
  waveBlock.appendChild(waveTimes)
  if (snip.snipped) {
    const note = h('div', { className: 'text-accent track-snip' })
    note.appendChild(iconEl('info', 15))
    note.appendChild(
      document.createTextNode(
        snip.timelineMs > snip.previewMs
          ? `Preview de ${fmtTime(snip.previewMs)} de ${fmtTime(snip.timelineMs)} · exclusivo Go+`
          : t('Preview de 30s (exclusivo Go+)'),
      ),
    )
    waveBlock.appendChild(note)
  }
  container.appendChild(waveBlock)

  if (track.description) {
    const descCard = h('div', { className: 'card card-pad track-desc-card' })
    const descTitle = h('h2', { className: 'h-section' })
    descTitle.appendChild(titleIcon('info', 18))
    descTitle.appendChild(document.createTextNode(t('Sobre este track')))
    descCard.appendChild(descTitle)
    descCard.appendChild(descriptionBlock(track.description))
    container.appendChild(descCard)
  }

  function currentRatio(state: PlayerState): number {
    if (state.current?.id !== track.id) return 0
    const progress = player.progressMs()
    if (snip.snipped && snip.timelineMs > 0) return Math.min(1, progress / snip.timelineMs)
    if (state.duration <= 0) return 0
    return progress / state.duration
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
      toast(t('Esa parte solo está disponible con SoundCloud Go+'))
      return
    }
    await playAt(ms)
  }

  function togglePlay(): void {
    const state = player.store.get()
    if (state.current?.id === track.id) player.toggle()
    else void player.playTrack(track)
  }

  const renderPlay = (): void => {
    const state = player.store.get()
    const isCurrent = state.current?.id === track.id
    const playing = isCurrent && state.playing
    playIcon.innerHTML = svgIcon(playing ? 'pause' : 'play', 18)
    playLabel.textContent = playing ? 'Pausar' : t('Reproducir')
    artPlay.innerHTML = svgIcon(playing ? 'pause' : 'play', 34)
    art.title = playing ? 'Pausar' : `Reproducir «${track.title}»`
    timeNow.textContent = fmtTime(isCurrent ? player.progressMs() : 0)
  }
  const renderLike = (): void => {
    const liked = player.isLiked(track)
    likeBtn.dataset.liked = String(liked)
    likeBtn.title = liked ? 'Quitar de favoritos' : t('Guardar en favoritos')
    likeBtn.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 20)
  }
  renderPlay()
  renderLike()

  playBtn.addEventListener('click', () => togglePlay())
  likeBtn.addEventListener('click', () => {
    player.toggleLike(track)
    toast(player.isLiked(track) ? 'Guardado en favoritos' : t('Quitado de favoritos'), 'ok')
  })

  async function share(): Promise<void> {
    await shareLink(track.permalink_url, track.title)
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
      type: 'button',
      tabindex: '-1',
      'aria-hidden': 'true',
      title: `${comment.user?.username ?? t('Alguien')} en ${fmtTime(at)}: ${comment.body}`,
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
    const name = author?.username ?? t('Usuario desconocido')
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
        type: 'button',
        title: `Reproducir desde ${fmtTime(at)}`,
        'aria-label': `Reproducir desde ${fmtTime(at)}`,
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

  const appearsSection = h('section', { className: 'track-section' })
  const appearsTitle = h('h2', { className: 'h-section' })
  appearsTitle.appendChild(titleIcon('playlist', 18))
  appearsTitle.appendChild(document.createTextNode(t('Aparece en')))
  const appearsRow = h('div', { className: 'track-appears' })
  const appearsSkeleton = skAppearsRow(5)
  appearsSection.append(appearsTitle, appearsRow, appearsSkeleton)
  container.appendChild(appearsSection)

  function appearsCard(playlist: Playlist): HTMLElement {
    const card = h('a', { className: 'appears-card', href: link(`/playlist/${playlist.id}`), title: playlist.title })
    const art = artEl(playlist.artwork_url, playlist.title, { size: 't300x300' })
    art.classList.add('appears-art')
    const kind = playlist.is_album === true || playlist.set_type === 'album' ? 'Álbum' : t('Playlist')
    card.append(
      art,
      h('span', { className: 'appears-title truncate' }, playlist.title),
      h('span', { className: 'appears-sub truncate' }, `${kind} · ${playlist.track_count ?? 0} tracks`),
    )
    return card
  }

  void getAPI()
    .trackPlaylists(track.id, APPEARS_MAX)
    .then((playlists) => {
      if (!container.isConnected) return
      appearsSkeleton.remove()
      if (playlists.length === 0) {
        appearsSection.hidden = true
        return
      }
      for (const playlist of playlists) appearsRow.appendChild(appearsCard(playlist))
    })
    .catch(() => {
      appearsSkeleton.remove()
      appearsSection.hidden = true
    })

  const commentsSection = h('section', { className: 'track-section' })
  const commentsTitle = h('h2', { className: 'h-section' })
  commentsTitle.appendChild(titleIcon('comment', 18))
  commentsTitle.appendChild(document.createTextNode(t('Comentarios')))
  commentsSection.appendChild(commentsTitle)
  const commentList = h('div', { className: 'comment-list' })
  commentsSection.appendChild(commentList)
  const commentSkeleton = skComments(3)
  commentsSection.appendChild(commentSkeleton)
  const emptyComments = h('div', { className: 'empty-state' })
  emptyComments.appendChild(iconEl('comment', 44))
  emptyComments.appendChild(h('p', null, t('Sin comentarios')))
  emptyComments.style.display = 'none'
  commentsSection.appendChild(emptyComments)
  const commentsRetry = h('div', { className: 'load-error' })
  commentsRetry.appendChild(h('p', { className: 'text-dim' }, t('No se pudieron cargar más comentarios')))
  const commentsRetryBtn = h('button', { className: 'btn btn-ghost btn-sm' }, t('Reintentar'))
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
  relatedTitle.appendChild(titleIcon('music', 18))
  relatedTitle.appendChild(document.createTextNode(t('Tracks relacionados')))
  relatedSection.appendChild(relatedTitle)
  const relatedList = h('div', { className: 'track-list' })
  relatedSection.appendChild(relatedList)
  const relatedSkeleton = skTrackList(3)
  relatedSection.appendChild(relatedSkeleton)
  const relatedRetry = h('div', { className: 'load-error' })
  relatedRetry.appendChild(h('p', { className: 'text-dim' }, t('No se pudieron cargar más tracks')))
  const relatedRetryBtn = h('button', { className: 'btn btn-ghost btn-sm' }, t('Reintentar'))
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
          empty.appendChild(h('p', null, t('Sin tracks relacionados')))
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

  let tickAttached = false
  const unsubTick = player.tick.subscribe(() => {
    if (tickAttached && !container.isConnected) {
      unsubTick()
      return
    }
    tickAttached = true
    const state = player.store.get()
    if (state.current?.id !== track.id) return
    wave.setProgress(currentRatio(state))
    timeNow.textContent = fmtTime(player.progressMs())
  })
}
