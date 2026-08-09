import type { User } from '@soundlite/api'
import { getAPI } from '../api'
import { link } from '../core/router'
import { fmtTime } from '../core/utils'
import { artEl } from '../ui/artwork'
import { h, svgIcon } from '../ui/el'
import { appLogo } from '../ui/logo'
import { toast } from '../ui/toast'
import { waveformEl } from '../ui/waveform'
import { player } from '../player/player'

let samplesCache = new Map<number, number[]>()

async function loadSamples(trackId: number): Promise<number[] | null> {
  if (samplesCache.has(trackId)) return samplesCache.get(trackId) ?? null
  const current = player.store.get().current
  if (!current || current.id !== trackId) return null
  const samples = await getAPI().waveformSamples(current)
  if (samples) samplesCache.set(trackId, samples)
  return samples
}

export function renderPlayerBar(): HTMLElement {
  const bar = h('div', { className: 'app-player' })
  const grid = h('div', { className: 'player-grid' })

  const nowWrap = h('div', { className: 'now' })
  const nowArt = h('div', { className: 'art' })
  nowArt.innerHTML = appLogo(48)
  const nowMeta = h('div', { className: 'meta' })
  const nowTitle = h('a', { className: 'title truncate', style: { fontSize: '13px', fontWeight: 700 } })
  const nowArtist = h('a', { className: 'artist truncate link-hover', style: { fontSize: '12px', color: 'var(--text2)' } })
  nowMeta.appendChild(nowTitle)
  nowMeta.appendChild(nowArtist)
  nowWrap.appendChild(nowArt)
  nowWrap.appendChild(nowMeta)
  grid.appendChild(nowWrap)

  const center = h('div', { className: 'center' })

  const controls = h('div', { className: 'controls' })
  const shuffleBtn = h('button', { className: 'icon-btn', title: 'Aleatorio' })
  shuffleBtn.innerHTML = svgIcon('shuffle', 17)
  const prevBtn = h('button', { className: 'icon-btn', title: 'Anterior' })
  prevBtn.innerHTML = svgIcon('prev', 18)
  const playBtn = h('button', { className: 'play-big', title: 'Reproducir / pausar' })
  playBtn.innerHTML = svgIcon('play', 20)
  const nextBtn = h('button', { className: 'icon-btn', title: 'Siguiente' })
  nextBtn.innerHTML = svgIcon('next', 18)
  const repeatBtn = h('button', { className: 'icon-btn', title: 'Repetir' })
  repeatBtn.innerHTML = svgIcon('repeat', 17)
  controls.appendChild(shuffleBtn)
  controls.appendChild(prevBtn)
  controls.appendChild(playBtn)
  controls.appendChild(nextBtn)
  controls.appendChild(repeatBtn)
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

  progressRow.appendChild(timeNow)
  progressRow.appendChild(wave.el)
  progressRow.appendChild(timeTotal)
  center.appendChild(progressRow)
  grid.appendChild(center)

  const side = h('div', { className: 'side' })
  const likeBtn = h('button', { className: 'icon-btn', title: 'Favorito' })
  likeBtn.innerHTML = svgIcon('heart', 18)
  const volumeBtn = h('button', { className: 'icon-btn', title: 'Silenciar' })
  volumeBtn.innerHTML = svgIcon('volume', 18)
  const volumeSlider = h('input', { type: 'range', className: 'vol', min: '0', max: '1', step: '0.01' }) as HTMLInputElement
  const volumeWrap = h('div', { className: 'volume-wrap' })
  volumeWrap.appendChild(volumeBtn)
  volumeWrap.appendChild(volumeSlider)
  const queueBtn = h('button', { className: 'icon-btn queue-btn', title: 'Cola' })
  queueBtn.innerHTML = svgIcon('queue', 18)
  side.appendChild(likeBtn)
  side.appendChild(volumeWrap)
  side.appendChild(queueBtn)
  grid.appendChild(side)

  bar.appendChild(grid)

  const updateNow = (state: ReturnType<typeof player.store.get>) => {
    const { current, playing } = state
    playBtn.innerHTML = svgIcon(playing ? 'pause' : 'play', 20)
    if (!current) {
      nowArt.innerHTML = appLogo(48)
      nowTitle.removeAttribute('href')
      nowTitle.textContent = 'Sin reproducción'
      nowArtist.removeAttribute('href')
      nowArtist.textContent = 'Soundlite'
      likeBtn.dataset.liked = 'false'
      likeBtn.innerHTML = svgIcon('heart', 18)
      return
    }
    if (nowTitle.textContent !== current.title) {
      const user = current.user as User | undefined
      nowArt.replaceChildren(...artEl(current.artwork_url, current.title, { size: 't120x120' }).children)
      nowTitle.href = link(`/track/${current.id}`)
      nowTitle.textContent = current.title
      if (user) nowArtist.href = link(`/user/${user.id}`)
      else nowArtist.removeAttribute('href')
      nowArtist.textContent = user?.username ?? 'Artista desconocido'
      likeBtn.dataset.liked = String(state.isLiked)
      likeBtn.innerHTML = svgIcon(state.isLiked ? 'heartFill' : 'heart', 18)
      timeNow.textContent = '0:00'
      timeTotal.textContent = fmtTime(current.duration)
      wave.setProgress(0)
      wave.setLoading(true)
      loadSamples(current.id).then((samples) => {
        if (player.store.get().current?.id === current.id) wave.setSamples(samples)
      })
    }
    if (state.isLiked !== (likeBtn.dataset.liked === 'true')) {
      likeBtn.dataset.liked = String(state.isLiked)
      likeBtn.innerHTML = svgIcon(state.isLiked ? 'heartFill' : 'heart', 18)
    }
    timeNow.textContent = fmtTime(state.progress)
    if (state.duration > 0) timeTotal.textContent = fmtTime(state.duration)
    const ratio = state.duration > 0 ? state.progress / state.duration : 0
    wave.setProgress(ratio)
    wave.setLoading(state.loading)
  }

  const updateControls = (state: ReturnType<typeof player.store.get>) => {
    shuffleBtn.classList.toggle('active', state.shuffle)
    shuffleBtn.title = state.shuffle ? 'Aleatorio: activo' : 'Aleatorio'
    repeatBtn.classList.toggle('active', state.repeat !== 'off')
    repeatBtn.title = state.repeat === 'one' ? 'Repetir: una vez' : state.repeat === 'all' ? 'Repetir: todo' : 'Repetir'
    const repeatIcon = state.repeat === 'one' ? 'repeatOne' : 'repeat'
    if (repeatBtn.dataset.icon !== repeatIcon) {
      repeatBtn.dataset.icon = repeatIcon
      repeatBtn.innerHTML = svgIcon(repeatIcon, 17)
    }
    if (document.activeElement !== volumeSlider) volumeSlider.value = String(state.volume)
    const silent = state.muted || state.volume === 0
    const volumeIcon = silent ? 'mute' : 'volume'
    volumeBtn.title = silent ? 'Activar sonido' : 'Silenciar'
    volumeBtn.classList.toggle('active', silent)
    if (volumeBtn.dataset.icon !== volumeIcon) {
      volumeBtn.dataset.icon = volumeIcon
      volumeBtn.innerHTML = svgIcon(volumeIcon, 18)
    }
  }

  player.store.subscribe(updateNow)
  player.store.subscribe(updateControls)

  shuffleBtn.addEventListener('click', () => {
    player.toggleShuffle()
    toast(player.store.get().shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado')
  })

  prevBtn.addEventListener('click', () => player.prev())
  nextBtn.addEventListener('click', () => player.next())
  playBtn.addEventListener('click', () => player.toggle())
  repeatBtn.addEventListener('click', () => {
    player.cycleRepeat()
    const mode = player.store.get().repeat
    toast(mode === 'one' ? 'Repetir una vez' : mode === 'all' ? 'Repetir toda la cola' : 'Repetir desactivado')
  })

  likeBtn.addEventListener('click', () => {
    const { current } = player.store.get()
    if (!current) return
    player.toggleLike(current)
    toast(player.isLiked(current) ? 'Guardado en favoritos' : 'Quitado de favoritos', 'ok')
  })

  volumeSlider.addEventListener('input', () => player.setVolume(parseFloat(volumeSlider.value)))
  volumeBtn.addEventListener('click', () => player.toggleMute())

  queueBtn.addEventListener('click', () => {
    window.location.hash = '#/queue'
  })

  return bar
}
