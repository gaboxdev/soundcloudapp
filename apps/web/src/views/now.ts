import type { Track, User } from '@soundclear/api'
import { getAPI } from '../api'
import { link, navigate, register } from '../core/router'
import { getSettings, updateSettings } from '../core/settings'
import { fmtCount, fmtTime, timeAgo } from '../core/utils'
import { player, type PlayerState } from '../player/player'
import { artEl } from '../ui/artwork'
import { h, svgIcon, titleIcon } from '../ui/el'
import { appLogoLive } from '../ui/logo'
import { toast } from '../ui/toast'
import { waveformEl } from '../ui/waveform'
import { openMenu, type MenuEntry } from '../components/menu'
import { openPlaylistPicker } from '../components/playlistpicker'
import { canWrite, isReposted, toggleRepost } from '../core/social'
import './now.css'
import { t } from '../core/i18n.ts'

const UP_NEXT_MAX = 25
const samples = new Map<number, number[]>()

register('now', (_route, container) => {
  document.title = t('Ahora suena — SoundClear')
  container.classList.add('now-view')

  const emptyMark = h('div', { className: 'now-idle-mark logo-fillable' })
  emptyMark.innerHTML = `<span class="logo-base">${appLogoLive(84)}</span><span class="logo-ink">${appLogoLive(84)}</span>`
  const emptyActions = h('div', { className: 'now-idle-actions' })
  const emptyPrimary = h('a', { className: 'btn btn-primary', href: link('/charts') })
  emptyPrimary.innerHTML = `${svgIcon('trend', 16)}<span>Ver tendencias</span>`
  const emptyLikes = h('a', { className: 'btn btn-ghost', href: link('/likes') })
  emptyLikes.innerHTML = `${svgIcon('heart', 16)}<span>Tus favoritos</span>`
  const emptySearch = h('a', { className: 'btn btn-ghost', href: link('/search') })
  emptySearch.innerHTML = `${svgIcon('search', 16)}<span>Buscar</span>`
  emptyActions.append(emptyPrimary, emptyLikes, emptySearch)
  const empty = h('div', { className: 'now-idle' }, [
    emptyMark,
    h('h1', { className: 'now-idle-title' }, t('Silencio absoluto')),
    h(
      'p',
      { className: 'text-dim now-idle-note' },
      t('Pon algo a sonar y aquí verás la carátula a lo grande, la onda completa y lo que viene después.'),
    ),
    emptyActions,
    h('div', { className: 'now-idle-keys' }, [
      h('span', null, [h('kbd', { className: 'kbd' }, '⌘K'), ' paleta de comandos']),
      h('span', null, [h('kbd', { className: 'kbd' }, t('Espacio')), ' reproducir o pausar']),
    ]),
  ])

  const stage = h('div', { className: 'now-stage' })

  const artWrap = h('div', { className: 'now-art-wrap' })
  const glow = h('div', { className: 'now-glow' })
  const artHost = h('a', { className: 'now-art art-frame art-open' })
  artWrap.append(glow, artHost)

  const info = h('div', { className: 'now-info' })
  const kicker = h('div', { className: 'now-kicker' })
  const title = h('a', { className: 'now-title link-hover' })
  const artist = h('a', { className: 'now-artist link-hover' })
  const stats = h('div', { className: 'now-stats' })
  info.append(kicker, title, artist, stats)

  const wave = waveformEl({
    interactive: true,
    showHover: true,
    getDuration: () => player.store.get().duration,
    onSeek: (ratio) => player.seekRatio(ratio),
  })
  const times = h('div', { className: 'now-times' })
  const timeNow = h('span', { className: 'time' }, '0:00')
  const timeTotal = h('span', { className: 'time' }, '0:00')
  times.append(timeNow, timeTotal)
  const waveBox = h('div', { className: 'now-wave' }, [wave.el, times])

  const controls = h('div', { className: 'now-controls' })
  const shuffleBtn = h('button', { className: 'icon-btn', title: t('Aleatorio'), 'aria-label': t('Aleatorio') })
  shuffleBtn.innerHTML = svgIcon('shuffle', 20)
  const prevBtn = h('button', { className: 'icon-btn', title: t('Anterior'), 'aria-label': t('Anterior') })
  prevBtn.innerHTML = svgIcon('prev', 24)
  const playBtn = h('button', { className: 'now-play', title: t('Reproducir o pausar'), 'aria-label': t('Reproducir o pausar') })
  playBtn.innerHTML = svgIcon('play', 26)
  const nextBtn = h('button', { className: 'icon-btn', title: t('Siguiente'), 'aria-label': t('Siguiente') })
  nextBtn.innerHTML = svgIcon('next', 24)
  const repeatBtn = h('button', { className: 'icon-btn', title: t('Repetir'), 'aria-label': t('Repetir') })
  repeatBtn.innerHTML = svgIcon('repeat', 20)
  controls.append(shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn)

  const extras = h('div', { className: 'now-extras' })
  const likeBtn = h('button', { className: 'icon-btn', title: t('Favorito'), 'aria-label': t('Favorito') })
  likeBtn.innerHTML = svgIcon('heart', 20)
  const radioBtn = h('button', { className: 'btn btn-ghost btn-sm' })
  radioBtn.innerHTML = `${svgIcon('radio', 16)}<span>Radio</span>`
  const rateBtn = h('button', { className: 'btn btn-ghost btn-sm' }, '1×')
  const sleepBtn = h('button', { className: 'btn btn-ghost btn-sm' })
  sleepBtn.innerHTML = `${svgIcon('moon', 16)}<span>Temporizador</span>`
  const moreBtn = h('button', { className: 'icon-btn', title: t('Más opciones'), 'aria-label': t('Más opciones') })
  moreBtn.innerHTML = svgIcon('more', 20)
  extras.append(likeBtn, radioBtn, rateBtn, sleepBtn, moreBtn)

  stage.append(artWrap, h('div', { className: 'now-main' }, [info, waveBox, controls, extras]))

  const upNext = h('section', { className: 'now-next' })
  const upNextHead = h('div', { className: 'h-section' }, [titleIcon('queue', 18), h('span', null, t('A continuación'))])
  const upNextLink = h('a', { className: 'see-more link-hover', href: link('/queue') }, t('Ver la cola'))
  upNextHead.appendChild(upNextLink)
  const upNextList = h('div', { className: 'now-next-list' })
  upNext.append(upNextHead, upNextList)

  const page = h('div', { className: 'now-page' }, [stage, upNext])
  container.appendChild(page)

  let lastTrackId: number | null = null
  let lastQueueKey = ''

  const loadWave = (track: Track): void => {
    const cached = samples.get(track.id)
    if (cached) {
      wave.setSamples(cached)
      return
    }
    wave.setLoading(true)
    void getAPI()
      .waveformSamples(track)
      .then((data) => {
        if (!container.isConnected) return
        if (data) samples.set(track.id, data)
        if (player.store.get().current?.id === track.id) wave.setSamples(data)
      })
  }

  const paintTrack = (track: Track): void => {
    if (track.id === lastTrackId) return
    lastTrackId = track.id
    const user = track.user as User | undefined
    const art = artEl(track.artwork_url, track.title, { size: 't500x500' })
    artHost.replaceChildren(...art.children)
    artHost.href = link(`/track/${track.id}`)
    artHost.title = `Abrir «${track.title}»`
    const artSrc = track.artwork_url?.replace(/-t\d{3,4}x\d{3,4}/, '-t500x500') ?? ''
    glow.style.backgroundImage = artSrc ? `url("${artSrc}")` : 'none'
    title.textContent = track.title
    title.href = link(`/track/${track.id}`)
    if (user) {
      artist.textContent = user.username
      artist.href = link(`/user/${user.id}`)
    } else {
      artist.textContent = t('Artista desconocido')
      artist.removeAttribute('href')
    }
    stats.replaceChildren()
    const parts: string[] = []
    if (track.genre) parts.push(track.genre)
    parts.push(`${fmtCount(track.playback_count)} plays`)
    parts.push(`${fmtCount(track.likes_count)} favoritos`)
    if (track.display_date) parts.push(timeAgo(track.display_date))
    stats.appendChild(h('span', { className: 'text-dim' }, parts.join(' · ')))
    timeTotal.textContent = fmtTime(track.duration)
    loadWave(track)
  }

  const paintQueue = (state: PlayerState): void => {
    const upcoming = state.queue.slice(state.index + 1, state.index + 1 + UP_NEXT_MAX)
    const key = `${state.index}:${upcoming.map((t) => t.id).join(',')}`
    if (key === lastQueueKey) return
    lastQueueKey = key
    upNextList.replaceChildren()
    if (upcoming.length === 0) {
      upNextList.appendChild(
        h('p', { className: 'text-faint' }, getSettings().autoplay ? 'Al terminar seguirá la radio automática.' : t('La cola se acaba aquí.')),
      )
      return
    }
    upcoming.forEach((track, offset) => {
      const index = state.index + 1 + offset
      const row = h('button', { className: 'now-next-row', type: 'button' })
      const art = artEl(track.artwork_url, track.title, { size: 't120x120' })
      art.classList.add('now-next-art')
      const meta = h('span', { className: 'now-next-meta' }, [
        h('span', { className: 'now-next-title truncate' }, track.title),
        h('span', { className: 'now-next-artist truncate' }, track.user?.username ?? t('Artista desconocido')),
      ])
      row.append(art, meta, h('span', { className: 'now-next-time' }, fmtTime(track.duration)))
      if (player.isRadioTrack(track.id)) row.appendChild(h('span', { className: 'now-badge' }, t('Radio')))
      row.addEventListener('click', () => player.jumpTo(index))
      upNextList.appendChild(row)
    })
  }

  const paint = (state: PlayerState): void => {
    const current = state.current
    if (!current) {
      lastTrackId = null
      if (!empty.isConnected) container.replaceChildren(empty)
      return
    }
    if (!page.isConnected) container.replaceChildren(page)
    paintTrack(current)
    playBtn.innerHTML = svgIcon(state.playing ? 'pause' : 'play', 26)
    shuffleBtn.classList.toggle('active', state.shuffle)
    repeatBtn.classList.toggle('active', state.repeat !== 'off')
    repeatBtn.innerHTML = svgIcon(state.repeat === 'one' ? 'repeatOne' : 'repeat', 20)
    likeBtn.dataset.liked = String(state.isLiked)
    likeBtn.innerHTML = svgIcon(state.isLiked ? 'heartFill' : 'heart', 20)
    likeBtn.title = state.isLiked ? 'Quitar de favoritos' : t('Guardar en favoritos')
    rateBtn.textContent = `${state.rate}×`
    rateBtn.title = `Velocidad de reproducción: ${state.rate}×`
    sleepBtn.classList.toggle('active', state.sleepAt !== null)
    kicker.textContent = state.radioLoading
      ? t('Buscando radio…')
      : player.isRadioTrack(current.id)
        ? t('Radio automática')
        : state.playing
          ? t('Suena ahora')
          : t('En pausa')
    if (state.duration > 0) timeTotal.textContent = fmtTime(state.duration)
    paintQueue(state)
  }

  const paintTick = (): void => {
    const state = player.store.get()
    if (!state.current) return
    const progress = player.progressMs()
    timeNow.textContent = fmtTime(progress)
    wave.setProgress(state.duration > 0 ? progress / state.duration : 0)
  }

  playBtn.addEventListener('click', () => player.toggle())
  prevBtn.addEventListener('click', () => player.prev())
  nextBtn.addEventListener('click', () => player.next())
  shuffleBtn.addEventListener('click', () => player.toggleShuffle())
  repeatBtn.addEventListener('click', () => player.cycleRepeat())
  likeBtn.addEventListener('click', () => {
    const current = player.store.get().current
    if (!current) return
    player.toggleLike(current)
  })
  radioBtn.addEventListener('click', () => {
    const current = player.store.get().current
    if (current) void player.startRadio(current)
  })
  rateBtn.addEventListener('click', () => {
    const entries: MenuEntry[] = player.rates().map((rate) => ({
      label: `${rate}×`,
      icon: 'speed',
      hint: player.store.get().rate === rate ? '•' : undefined,
      onSelect: () => player.setRate(rate),
    }))
    openMenu(entries, rateBtn)
  })
  sleepBtn.addEventListener('click', () => {
    const entries: MenuEntry[] = [15, 30, 60, 120].map((minutes) => ({
      label: `Pausar en ${minutes} min`,
      icon: 'moon',
      onSelect: () => {
        player.setSleepTimer(minutes)
        toast(`Se pausará en ${minutes} minutos`, 'ok')
      },
    }))
    if (player.store.get().sleepAt !== null) {
      entries.push('separator', {
        label: t('Quitar el temporizador'),
        icon: 'close',
        onSelect: () => {
          player.setSleepTimer(null)
          toast(t('Temporizador cancelado'))
        },
      })
    }
    openMenu(entries, sleepBtn)
  })
  moreBtn.addEventListener('click', () => {
    const current = player.store.get().current
    const entries: MenuEntry[] = [
      {
        label: getSettings().autoplay ? 'Desactivar radio infinita' : t('Activar radio infinita'),
        icon: 'radio',
        onSelect: () => {
          const next = !getSettings().autoplay
          updateSettings({ autoplay: next })
          toast(next ? 'Radio infinita activada' : t('Radio infinita desactivada'))
        },
      },
      { label: t('Ver la cola'), icon: 'queue', onSelect: () => navigate('/queue') },
    ]
    if (current) {
      if (canWrite()) {
        entries.push(
          'separator',
          {
            label: isReposted(current.id) ? 'Quitar el repost' : t('Repostear'),
            icon: 'repost',
            onSelect: () => void toggleRepost(current),
          },
          { label: t('Añadir a una playlist…'), icon: 'playlist', onSelect: () => openPlaylistPicker(current) },
        )
      }
      entries.push('separator', {
        label: t('Abrir en SoundCloud'),
        icon: 'external',
        onSelect: () => window.open(current.permalink_url, '_blank', 'noopener'),
      })
    }
    openMenu(entries, moreBtn)
  })

  let attached = false
  let unsub: (() => void) | null = null
  unsub = player.store.subscribe((state) => {
    if (attached && !container.isConnected) {
      unsub?.()
      return
    }
    attached = true
    paint(state)
  })

  let tickAttached = false
  let unsubTick: (() => void) | null = null
  unsubTick = player.tick.subscribe(() => {
    if (tickAttached && !container.isConnected) {
      unsubTick?.()
      return
    }
    tickAttached = true
    paintTick()
  })
})
