import type { Track, User } from '@soundclear/api'
import { getAPI } from '../api'
import { link, navigate } from '../core/router'
import { getSettings, updateSettings } from '../core/settings'
import { fmtTime } from '../core/utils'
import { artEl, artOverlay } from '../ui/artwork'
import { h, svgIcon } from '../ui/el'
import { appLogoLive } from '../ui/logo'
import { toast, toastErr } from '../ui/toast'
import { waveformEl } from '../ui/waveform'
import { player, type PlayerState } from '../player/player'
import { openMenu, type MenuEntry } from './menu'
import { t } from '../core/i18n.ts'

const SAMPLES_CACHE_MAX = 60
const samplesCache = new Map<number, number[]>()

async function loadSamples(trackId: number): Promise<number[] | null> {
  const cached = samplesCache.get(trackId)
  if (cached) {
    samplesCache.delete(trackId)
    samplesCache.set(trackId, cached)
    return cached
  }
  const current = player.store.get().current
  if (!current || current.id !== trackId) return null
  const samples = await getAPI().waveformSamples(current)
  if (samples) {
    samplesCache.set(trackId, samples)
    if (samplesCache.size > SAMPLES_CACHE_MAX) {
      const oldest = samplesCache.keys().next().value
      if (oldest !== undefined) samplesCache.delete(oldest)
    }
  }
  return samples
}

let startingTrending = false

async function startTrending(): Promise<void> {
  if (startingTrending) return
  startingTrending = true
  try {
    const response = await getAPI().charts(undefined, undefined, 0, 20)
    const tracks = response.collection.map((item) => item.track).filter((track): track is Track => Boolean(track))
    if (tracks.length === 0) {
      toastErr(t('No se pudieron cargar las tendencias'))
      return
    }
    player.playQueue(tracks, 0)
    toast(t('Sonando las tendencias de SoundCloud'), 'ok')
  } catch {
    toastErr(t('No se pudieron cargar las tendencias'))
  } finally {
    startingTrending = false
  }
}

async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    toast(t('Enlace copiado al portapapeles'), 'ok')
  } catch {
    toastErr(t('No se pudo copiar el enlace'))
  }
}

export function renderPlayerBar(): HTMLElement {
  const bar = h('div', { className: 'app-player idle' })
  const grid = h('div', { className: 'player-grid' })

  const nowWrap = h('div', { className: 'now' })
  const nowArt = h('a', { className: 'art art-idle', href: link('/charts'), title: t('Descubre algo que suene') })
  nowArt.innerHTML = appLogoLive(26)
  const nowMeta = h('div', { className: 'meta' })
  const nowTitle = h('a', { className: 'title truncate' }, t('Aún no suena nada'))
  const nowArtist = h('a', { className: 'artist truncate link-hover' }, t('Elige por dónde empezar'))
  const nowBadges = h('div', { className: 'now-badges' })
  nowMeta.append(nowTitle, nowArtist, nowBadges)
  nowWrap.append(nowArt, nowMeta)
  grid.appendChild(nowWrap)

  const center = h('div', { className: 'center' })

  const controls = h('div', { className: 'controls' })
  const shuffleBtn = h('button', { className: 'icon-btn', title: t('Aleatorio'), 'aria-label': t('Aleatorio') })
  shuffleBtn.innerHTML = svgIcon('shuffle', 17)
  const prevBtn = h('button', { className: 'icon-btn', title: t('Anterior'), 'aria-label': t('Anterior') })
  prevBtn.innerHTML = svgIcon('prev', 18)
  const playBtn = h('button', { className: 'play-big', title: t('Reproducir las tendencias'), 'aria-label': t('Reproducir') })
  playBtn.innerHTML = svgIcon('play', 20)
  const nextBtn = h('button', { className: 'icon-btn', title: t('Siguiente'), 'aria-label': t('Siguiente') })
  nextBtn.innerHTML = svgIcon('next', 18)
  const repeatBtn = h('button', { className: 'icon-btn', title: t('Repetir'), 'aria-label': t('Repetir') })
  repeatBtn.innerHTML = svgIcon('repeat', 17)
  controls.append(shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn)
  center.appendChild(controls)

  const progressRow = h('div', { className: 'progress-row' })
  const timeNow = h('span', { className: 'time', textContent: '0:00' })
  const timeTotal = h('span', { className: 'time total', textContent: '0:00' })

  const wave = waveformEl({
    interactive: true,
    showHover: true,
    getDuration: () => player.store.get().duration,
    onSeek: (ratio) => player.seekRatio(ratio),
  })

  progressRow.append(timeNow, wave.el, timeTotal)

  const idleCta = h('div', { className: 'player-idle-cta' })
  const idleLinks: { label: string; icon: string; href: string }[] = [
    { label: t('Tendencias'), icon: 'trend', href: link('/charts') },
    { label: t('Tus favoritos'), icon: 'heart', href: link('/likes') },
    { label: t('Buscar algo'), icon: 'search', href: link('/search') },
  ]
  for (const item of idleLinks) {
    const chip = h('a', { className: 'chip', href: item.href, title: item.label })
    chip.innerHTML = `${svgIcon(item.icon, 14)}<span>${item.label}</span>`
    idleCta.appendChild(chip)
  }

  center.append(progressRow, idleCta)
  grid.appendChild(center)

  const side = h('div', { className: 'side' })
  const likeBtn = h('button', { className: 'icon-btn', title: t('Favorito'), 'aria-label': t('Favorito') })
  likeBtn.innerHTML = svgIcon('heart', 18)
  const volumeBtn = h('button', { className: 'icon-btn', title: t('Silenciar'), 'aria-label': t('Silenciar') })
  volumeBtn.innerHTML = svgIcon('volume', 18)
  const volumeSlider = h('input', {
    type: 'range',
    className: 'vol',
    min: '0',
    max: '1',
    step: '0.01',
    'aria-label': t('Volumen'),
  }) as HTMLInputElement
  const volumeWrap = h('div', { className: 'volume-wrap' })
  volumeWrap.append(volumeBtn, volumeSlider)
  const queueBtn = h('button', { className: 'icon-btn queue-btn', title: t('Cola'), 'aria-label': t('Cola') })
  queueBtn.innerHTML = svgIcon('queue', 18)
  const moreBtn = h('button', { className: 'icon-btn', title: t('Más opciones'), 'aria-label': t('Más opciones') })
  moreBtn.innerHTML = svgIcon('more', 18)
  const expandBtn = h('button', { className: 'icon-btn expand-btn', title: t('Ahora suena (A)'), 'aria-label': t('Ahora suena') })
  expandBtn.innerHTML = svgIcon('expand', 17)
  side.append(likeBtn, volumeWrap, queueBtn, moreBtn, expandBtn)
  grid.appendChild(side)

  bar.appendChild(grid)

  const announcer = h('p', { className: 'sr-only', 'aria-live': 'polite' })
  bar.appendChild(announcer)

  const errorBar = h('div', { className: 'player-error', role: 'status' })
  errorBar.hidden = true
  const errorText = h('span', { className: 'truncate' })
  const errorRetry = h('button', { className: 'btn btn-ghost btn-sm' }, t('Reintentar'))
  const errorClose = h('button', { className: 'icon-btn', title: t('Descartar'), 'aria-label': t('Descartar') })
  errorClose.innerHTML = svgIcon('close', 16)
  errorBar.append(errorText, errorRetry, errorClose)
  bar.appendChild(errorBar)

  let lastTrackId: number | null = null
  let lastLiked: boolean | null = null
  let lastError: string | null = null
  let lastBadges = ''

  const paintBadges = (state: PlayerState): void => {
    const parts: string[] = []
    if (state.rate !== 1) parts.push(`${state.rate}×`)
    if (state.sleepAt !== null) parts.push('sleep')
    if (state.radioLoading) parts.push('radio-load')
    else if (state.current && player.isRadioTrack(state.current.id)) parts.push('radio')
    const key = parts.join('|')
    if (key === lastBadges) return
    lastBadges = key
    nowBadges.replaceChildren()
    for (const part of parts) {
      const label =
        part === 'sleep' ? 'Temporizador' : part === 'radio' ? 'Radio' : part === 'radio-load' ? 'Buscando radio…' : part
      nowBadges.appendChild(h('span', { className: 'now-badge' }, label))
    }
  }

  const paintTrack = (state: PlayerState): void => {
    const { current } = state
    if (!current) {
      if (lastTrackId === null) return
      lastTrackId = null
      bar.classList.add('idle')
      nowArt.innerHTML = appLogoLive(26)
      nowArt.classList.remove('art-open')
      nowArt.classList.add('art-idle')
      nowArt.href = link('/charts')
      nowArt.title = t('Descubre algo que suene')
      nowTitle.removeAttribute('href')
      nowTitle.textContent = t('Aún no suena nada')
      nowArtist.removeAttribute('href')
      nowArtist.textContent = t('Elige por dónde empezar')
      likeBtn.dataset.liked = 'false'
      likeBtn.innerHTML = svgIcon('heart', 18)
      timeNow.textContent = '0:00'
      timeTotal.textContent = '0:00'
      wave.setSamples(null)
      wave.setProgress(0)
      return
    }
    if (current.id === lastTrackId) return
    lastTrackId = current.id
    bar.classList.remove('idle')
    nowArt.classList.remove('art-idle')
    const user = current.user as User | undefined
    nowArt.replaceChildren(...artEl(current.artwork_url, current.title, { size: 't120x120' }).children)
    nowArt.appendChild(artOverlay('expand', 16))
    nowArt.classList.add('art-open')
    nowArt.href = link(`/track/${current.id}`)
    nowArt.title = `Abrir «${current.title}»`
    nowTitle.href = link(`/track/${current.id}`)
    nowTitle.textContent = current.title
    if (user) nowArtist.href = link(`/user/${user.id}`)
    else nowArtist.removeAttribute('href')
    nowArtist.textContent = user?.username ?? t('Artista desconocido')
    announcer.textContent = `Suena ${current.title}${user?.username ? ` de ${user.username}` : ''}`
    timeNow.textContent = '0:00'
    timeTotal.textContent = fmtTime(current.duration)
    wave.setProgress(0)
    wave.setLoading(true)
    void loadSamples(current.id).then((samples) => {
      if (player.store.get().current?.id === current.id) wave.setSamples(samples)
    })
  }

  const paintState = (state: PlayerState): void => {
    playBtn.innerHTML = svgIcon(state.playing ? 'pause' : 'play', 20)
    playBtn.title =
      !state.current && state.queue.length === 0
        ? t('Reproducir las tendencias')
        : state.playing
          ? t('Pausar')
          : t('Reproducir')
    paintTrack(state)
    paintBadges(state)

    if (state.isLiked !== lastLiked) {
      lastLiked = state.isLiked
      likeBtn.dataset.liked = String(state.isLiked)
      likeBtn.title = state.isLiked ? 'Quitar de favoritos' : t('Guardar en favoritos')
      likeBtn.innerHTML = svgIcon(state.isLiked ? 'heartFill' : 'heart', 18)
    }

    if (state.duration > 0) timeTotal.textContent = fmtTime(state.duration)
    wave.setLoading(state.loading)

    shuffleBtn.classList.toggle('active', state.shuffle)
    shuffleBtn.title = state.shuffle ? 'Aleatorio: activo' : t('Aleatorio')
    repeatBtn.classList.toggle('active', state.repeat !== 'off')
    repeatBtn.title = state.repeat === 'one' ? 'Repetir: una vez' : state.repeat === 'all' ? 'Repetir: todo' : t('Repetir')
    const repeatIcon = state.repeat === 'one' ? 'repeatOne' : 'repeat'
    if (repeatBtn.dataset.icon !== repeatIcon) {
      repeatBtn.dataset.icon = repeatIcon
      repeatBtn.innerHTML = svgIcon(repeatIcon, 17)
    }

    if (document.activeElement !== volumeSlider) volumeSlider.value = String(state.volume)
    const silent = state.muted || state.volume === 0
    const volumeIcon = silent ? 'mute' : 'volume'
    volumeBtn.title = silent ? 'Activar sonido' : t('Silenciar')
    volumeBtn.classList.toggle('active', silent)
    if (volumeBtn.dataset.icon !== volumeIcon) {
      volumeBtn.dataset.icon = volumeIcon
      volumeBtn.innerHTML = svgIcon(volumeIcon, 18)
    }

    if (state.error !== lastError) {
      lastError = state.error
      errorBar.hidden = state.error === null
      errorText.textContent = state.error ?? ''
    }
  }

  const paintTime = (): void => {
    const { progress } = player.tick.get()
    const { duration } = player.store.get()
    timeNow.textContent = fmtTime(progress)
    wave.setProgress(duration > 0 ? progress / duration : 0)
  }

  player.store.subscribe(paintState)
  player.tick.subscribe(paintTime)

  shuffleBtn.addEventListener('click', () => {
    player.toggleShuffle()
    toast(player.store.get().shuffle ? 'Aleatorio activado' : t('Aleatorio desactivado'))
  })

  prevBtn.addEventListener('click', () => player.prev())
  nextBtn.addEventListener('click', () => player.next())
  playBtn.addEventListener('click', () => {
    const state = player.store.get()
    if (!state.current && state.queue.length === 0) {
      void startTrending()
      return
    }
    player.toggle()
  })
  repeatBtn.addEventListener('click', () => {
    player.cycleRepeat()
    const mode = player.store.get().repeat
    toast(mode === 'one' ? 'Repetir una vez' : mode === 'all' ? 'Repetir toda la cola' : t('Repetir desactivado'))
  })

  likeBtn.addEventListener('click', () => {
    const { current } = player.store.get()
    if (!current) return
    player.toggleLike(current)
    toast(player.isLiked(current) ? 'Guardado en favoritos' : t('Quitado de favoritos'), 'ok')
  })

  volumeSlider.addEventListener('input', () => player.setVolume(parseFloat(volumeSlider.value)))
  volumeBtn.addEventListener('click', () => player.toggleMute())
  queueBtn.addEventListener('click', () => navigate('/queue'))
  expandBtn.addEventListener('click', () => navigate('/now'))

  errorRetry.addEventListener('click', () => player.retry())
  errorClose.addEventListener('click', () => player.clearError())

  moreBtn.addEventListener('click', () => {
    const state = player.store.get()
    const current = state.current
    const entries: MenuEntry[] = []
    if (current) {
      entries.push(
        {
          label: t('Radio a partir de este track'),
          icon: 'radio',
          hint: 'X',
          onSelect: () => void player.startRadio(current),
        },
        {
          label: t('Ir al artista'),
          icon: 'user',
          disabled: !current.user,
          onSelect: () => {
            if (current.user) navigate(`/user/${current.user.id}`)
          },
        },
        { label: t('Copiar enlace'), icon: 'link', onSelect: () => void copyLink(current.permalink_url) },
        'separator',
      )
    }
    for (const rate of player.rates()) {
      entries.push({
        label: `Velocidad ${rate}×`,
        icon: 'speed',
        hint: state.rate === rate ? '•' : undefined,
        onSelect: () => {
          player.setRate(rate)
          toast(`Velocidad ${rate}×`)
        },
      })
    }
    entries.push('separator')
    for (const minutes of [15, 30, 60]) {
      entries.push({
        label: `Pausar en ${minutes} min`,
        icon: 'moon',
        onSelect: () => {
          player.setSleepTimer(minutes)
          toast(`Se pausará en ${minutes} minutos`, 'ok')
        },
      })
    }
    if (state.sleepAt !== null) {
      entries.push({
        label: t('Quitar el temporizador'),
        icon: 'close',
        onSelect: () => {
          player.setSleepTimer(null)
          toast(t('Temporizador cancelado'))
        },
      })
    }
    entries.push('separator', {
      label: getSettings().autoplay ? 'Desactivar radio infinita' : t('Activar radio infinita'),
      icon: 'radio',
      onSelect: () => {
        const next = !getSettings().autoplay
        updateSettings({ autoplay: next })
        toast(next ? 'Radio infinita activada' : t('Radio infinita desactivada'))
      },
    })
    openMenu(entries, moreBtn)
  })

  return bar
}
