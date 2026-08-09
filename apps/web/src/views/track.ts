import type { Comment, Track } from '@soundlite/api'
import { getAPI } from '../api'
import { skeletonRows, trackRow } from '../components/trackrow'
import { link, register } from '../core/router'
import { esc, fmtCount, formatDate, timeAgo } from '../core/utils'
import { player } from '../player/player'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import { waveformEl } from '../ui/waveform'
import './track.css'

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
  info.appendChild(h('div', { className: 'skeleton sk-line', style: { width: '56%' } }))
  header.appendChild(info)
  wrap.appendChild(header)
  wrap.appendChild(h('div', { className: 'skeleton sk-wave' }))
  const list = h('div', { className: 'track-list' })
  for (const row of skeletonRows(6)) list.appendChild(row)
  wrap.appendChild(list)
  return wrap
}

function commentRow(comment: Comment): HTMLElement {
  const row = h('div', { className: 'comment' })
  row.appendChild(avatarEl(comment.user.avatar_url, comment.user.username, 36))
  const body = h('div', { className: 'body' })
  const head = h('div', { className: 'comment-head' })
  head.appendChild(h('a', { className: 'link-hover', href: link(`/user/${comment.user.id}`) }, esc(comment.user.username)))
  head.appendChild(h('span', { className: 'text-faint' }, timeAgo(comment.created_at)))
  body.appendChild(head)
  body.appendChild(h('p', { className: 'comment-text' }, esc(comment.body)))
  row.appendChild(body)
  return row
}

register('track', (route, container) => {
  const id = Number(route.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    document.title = 'Soundlite'
    container.appendChild(errorView('Track no encontrado'))
    return
  }
  document.title = 'Cargando… — Soundlite'
  container.appendChild(skeletonView())
  void load()

  async function load(): Promise<void> {
    let track: Track
    try {
      track = await getAPI().track(id)
    } catch {
      document.title = 'Soundlite'
      container.innerHTML = ''
      container.appendChild(errorView('No se pudo cargar el track', () => void load()))
      return
    }
    if (!container.isConnected) return
    document.title = track.title
    container.innerHTML = ''
    renderTrack(track, container)
  }
})

function renderTrack(track: Track, container: HTMLElement): void {
  const header = h('div', { className: 'track-header' })
  const art = artEl(track.artwork_url, track.title, { size: 't500x500', blur: true })
  art.classList.add('track-art')
  header.appendChild(art)

  const info = h('div', { className: 'track-info' })
  info.appendChild(h('h1', { className: 'h-display' }, esc(track.title)))
  info.appendChild(
    h('a', { className: 'artist-link link-hover', href: link(`/user/${track.user.id}`) }, esc(track.user.username)),
  )

  const chips = h('div', { className: 'chip-row' })
  if (track.genre) chips.appendChild(h('span', { className: 'chip' }, esc(track.genre)))
  if (track.display_date) chips.appendChild(h('span', { className: 'chip' }, formatDate(track.display_date)))
  chips.appendChild(h('span', { className: 'chip' }, `${fmtCount(track.playback_count)} plays`))
  chips.appendChild(h('span', { className: 'chip' }, `${fmtCount(track.likes_count)} likes`))
  chips.appendChild(h('span', { className: 'chip' }, `${fmtCount(track.comment_count)} comentarios`))
  chips.appendChild(h('span', { className: 'chip' }, `${fmtCount(track.reposts_count)} reposts`))
  info.appendChild(chips)

  if (track.description) {
    info.appendChild(h('p', { className: 'track-desc text-dim' }, esc(track.description)))
  }

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
    player.addToQueue(track)
    toast('Añadido a la cola')
  })
  actions.appendChild(queueBtn)

  const likeBtn = h('button', { className: 'icon-btn', title: 'Guardar en favoritos' })
  actions.appendChild(likeBtn)

  if (track.downloadable) {
    const dlBtn = h('button', { className: 'btn btn-ghost' })
    dlBtn.innerHTML = `${svgIcon('download', 18)}<span>Descargar</span>`
    dlBtn.addEventListener('click', () => void download())
    actions.appendChild(dlBtn)
  }
  info.appendChild(actions)
  header.appendChild(info)
  container.appendChild(header)

  const waveBlock = h('div', { className: 'track-wave' })
  const wave = waveformEl({
    interactive: true,
    showHover: true,
    getDuration: () => track.duration,
    onSeek: (ratio) => player.seekRatio(ratio),
  })
  waveBlock.appendChild(wave.el)
  if (track.policy === 'SNIP') {
    waveBlock.appendChild(h('div', { className: 'text-accent track-snip' }, 'Preview de 30s (exclusivo Go+)'))
  }
  container.appendChild(waveBlock)

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

  async function download(): Promise<void> {
    try {
      const url = await getAPI().downloadUrl(track)
      if (url) window.open(url, '_blank')
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

  const commentsSection = h('section', { className: 'track-section' })
  const commentsTitle = h('h2', { className: 'h-section' })
  commentsTitle.appendChild(iconEl('comment', 18))
  commentsTitle.appendChild(document.createTextNode('Comentarios'))
  commentsSection.appendChild(commentsTitle)
  const commentList = h('div', { className: 'comment-list' })
  commentsSection.appendChild(commentList)
  const emptyComments = h('div', { className: 'empty-state' })
  emptyComments.appendChild(iconEl('comment', 44))
  emptyComments.appendChild(h('p', null, 'Sin comentarios'))
  commentsSection.appendChild(emptyComments)
  emptyComments.style.display = 'none'
  const sentinel = h('div', { className: 'load-more' })
  sentinel.appendChild(h('div', { className: 'spinner' }))
  commentsSection.appendChild(sentinel)
  container.appendChild(commentsSection)

  let commentOffset = 0
  let commentsLoading = false
  let commentsDone = false
  let commentsEmpty = true

  async function loadComments(): Promise<void> {
    if (commentsLoading || commentsDone) return
    commentsLoading = true
    try {
      const res = await getAPI().trackComments(track.id, commentOffset, 30)
      if (!container.isConnected) return
      commentsDone = !res.next_href || res.collection.length === 0
      commentOffset += res.collection.length
      if (res.collection.length > 0) commentsEmpty = false
      for (const comment of res.collection) commentList.appendChild(commentRow(comment))
      if (commentsDone) {
        if (commentsEmpty) emptyComments.style.display = ''
        sentinel.remove()
        observer.disconnect()
      }
    } catch {
      commentsDone = true
      sentinel.remove()
      observer.disconnect()
    } finally {
      commentsLoading = false
    }
  }
  const observer = new IntersectionObserver((entries) => {
    if (!container.isConnected) {
      observer.disconnect()
      return
    }
    if (entries[0]?.isIntersecting) void loadComments()
  })
  observer.observe(sentinel)
  void loadComments()

  const relatedSection = h('section', { className: 'track-section' })
  const relatedTitle = h('h2', { className: 'h-section' })
  relatedTitle.appendChild(iconEl('music', 18))
  relatedTitle.appendChild(document.createTextNode('Tracks relacionados'))
  relatedSection.appendChild(relatedTitle)
  const relatedList = h('div', { className: 'track-list' })
  relatedSection.appendChild(relatedList)
  const relatedMore = h('div', { className: 'load-more' })
  relatedMore.appendChild(h('button', { className: 'btn btn-ghost', onclick: () => void loadRelated() }, 'Ver más'))
  relatedSection.appendChild(relatedMore)
  container.appendChild(relatedSection)

  let relatedTracks: Track[] = []
  let relatedOffset = 0
  let relatedLoading = false
  let relatedDone = false

  async function loadRelated(): Promise<void> {
    if (relatedLoading || relatedDone) return
    relatedLoading = true
    const start = relatedTracks.length
    try {
      const res = await getAPI().trackRelated(track.id, relatedOffset, 12)
      if (!container.isConnected) return
      relatedDone = !res.next_href || res.collection.length === 0
      relatedOffset += res.collection.length
      relatedTracks.push(...res.collection)
      res.collection.forEach((t, i) => {
        relatedList.appendChild(trackRow(t, { onPlay: () => player.playQueue(relatedTracks, start + i) }))
      })
      if (relatedDone) {
        if (relatedTracks.length === 0) {
          const empty = h('div', { className: 'empty-state' })
          empty.appendChild(iconEl('music', 44))
          empty.appendChild(h('p', null, 'Sin tracks relacionados'))
          relatedList.appendChild(empty)
        }
        relatedMore.remove()
      }
    } catch {
      relatedDone = true
      relatedMore.remove()
    } finally {
      relatedLoading = false
    }
  }
  void loadRelated()

  const unsub = player.store.subscribe((state) => {
    if (!container.isConnected) {
      unsub()
      return
    }
    const isCurrent = state.current?.id === track.id
    wave.setProgress(isCurrent && state.duration > 0 ? state.progress / state.duration : 0)
    renderPlay()
    renderLike()
  })
}
