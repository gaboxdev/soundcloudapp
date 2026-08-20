import type { Track, TrackStub, User } from '@soundclear/api'
import { isDrmOnly, isTrackStub } from '@soundclear/api'
import { offlineHas, offlineReason, offlineSaving, removeOffline, saveOffline, type OfflineSignal } from '../core/offline'
import { canDownloadFile, downloadTrackFile } from '../core/download'
import { shareLink } from '../core/links'
import type { PlayerState } from '../player/player'
import { player } from '../player/player'
import { artEl, artOverlay } from '../ui/artwork'
import { link, navigate } from '../core/router'
import { canWrite, isBusy, isReposted, toggleRepost } from '../core/social'
import { fmtCount, fmtTime } from '../core/utils'
import { h, svgIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import { openMenu, type MenuEntry } from './menu'
import { openPlaylistPicker } from './playlistpicker'
import { t } from '../core/i18n.ts'

export interface TrackRowOptions {
  rank?: number
  showPlays?: boolean
  showAlbum?: boolean
  onPlay?: (track: Track) => void
  actionButtons?: boolean
  extraMenu?: MenuEntry[]
}

function watchPlayer(el: HTMLElement, render: (state: PlayerState) => void): void {
  let unsub: (() => void) | null = null
  let attached = false
  unsub = player.store.subscribe((state) => {
    if (attached && !el.isConnected) {
      unsub?.()
      return
    }
    attached = true
    render(state)
  })
}


function iconButton(icon: string, label: string, size = 18): HTMLButtonElement {
  const btn = h('button', { className: 'icon-btn', type: 'button', title: label, 'aria-label': label }) as HTMLButtonElement
  btn.innerHTML = svgIcon(icon, size)
  return btn
}

function heartButton(track: Track): HTMLElement {
  const btn = iconButton('heart', t('Guardar en favoritos'))
  const render = (liked: boolean): void => {
    btn.dataset.liked = String(liked)
    btn.title = liked ? 'Quitar de favoritos' : t('Guardar en favoritos')
    btn.setAttribute('aria-label', `${btn.title}: ${track.title}`)
    btn.innerHTML = svgIcon(liked ? 'heartFill' : 'heart', 18)
  }
  render(player.isLiked(track))
  let lastRev = -1
  watchPlayer(btn, (state) => {
    if (state.likesRev === lastRev) return
    lastRev = state.likesRev
    const liked = player.isLiked(track)
    if (String(liked) !== btn.dataset.liked) render(liked)
  })
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    player.toggleLike(track)
    const liked = player.isLiked(track)
    render(liked)
    toast(liked ? 'Guardado en favoritos' : t('Quitado de favoritos'), 'ok')
  })
  return btn
}

function queueButton(track: Track): HTMLElement {
  const btn = iconButton('plus', `Añadir «${track.title}» a la cola`)
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    const added = player.addToQueue(track)
    if (added) toast(`«${track.title}» añadido a la cola`, 'ok')
    else toast(t('Ya estaba en la cola'))
  })
  return btn
}

function unavailableRow(id: number): HTMLElement {
  const row = h('div', {
    className: 'track-row row-disabled',
    dataset: { id: String(id) },
    'aria-disabled': 'true',
  })
  const art = h('div', { className: 'art art-frame' })
  art.appendChild(h('div', { className: 'art-fallback' }, '—'))
  row.appendChild(art)
  const meta = h('div', { className: 'meta' })
  meta.appendChild(h('div', { className: 'title text-dim' }, t('Track no disponible')))
  meta.appendChild(h('div', { className: 'artist text-faint' }, t('Este track ya no está en SoundCloud')))
  row.appendChild(meta)
  return row
}

const ROW_FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function rowsOf(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('.track-row')].filter((row) => row.offsetParent !== null)
}

function focusTwin(from: HTMLElement, row: HTMLElement): boolean {
  const classes = [...from.classList].filter((name) => name !== 'icon-btn')
  for (const name of classes) {
    const twin = row.querySelector<HTMLElement>(`.${name}`)
    if (twin) {
      twin.focus()
      return true
    }
  }
  const first = row.querySelector<HTMLElement>(ROW_FOCUSABLE)
  if (!first) return false
  first.focus()
  return true
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
  if (event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement | null
  const row = target?.closest<HTMLElement>('.track-row')
  if (!row) return
  const list = row.closest<HTMLElement>('.track-list, .tab-panel, .vlist')
  if (!list) return
  const rows = rowsOf(list)
  const index = rows.indexOf(row)
  if (index === -1) return
  const next =
    event.key === 'ArrowDown'
      ? rows[index + 1]
      : event.key === 'ArrowUp'
        ? rows[index - 1]
        : event.key === 'Home'
          ? rows[0]
          : rows[rows.length - 1]
  if (!next || next === row) return
  if (!target) return
  if (focusTwin(target, next)) event.preventDefault()
})

function offlineBadge(state: 'saved' | 'saving'): HTMLElement {
  const badge = h('span', {
    className: state === 'saving' ? 'offline-badge saving' : 'offline-badge',
    title: state === 'saving' ? 'Guardando para sin conexión…' : t('Guardado en este dispositivo'),
    'aria-label': state === 'saving' ? 'Guardando sin conexión' : t('Disponible sin conexión'),
  })
  badge.innerHTML = svgIcon('download', 12)
  return badge
}

function paintOfflineBadges(trackId: number, state: OfflineSignal): void {
  for (const row of document.querySelectorAll<HTMLElement>(`.track-row[data-id="${trackId}"]`)) {
    const line = row.querySelector('.title-line')
    if (!line) continue
    line.querySelector('.offline-badge')?.remove()
    if (state !== 'gone') line.appendChild(offlineBadge(state === 'saving' ? 'saving' : 'saved'))
  }
}

window.addEventListener('sl:offline', (event) => {
  const detail = (event as CustomEvent<{ trackId?: number; state?: OfflineSignal }>).detail
  if (!detail || typeof detail.trackId !== 'number' || !detail.state) return
  paintOfflineBadges(detail.trackId, detail.state)
})

export async function toggleOffline(track: Track): Promise<void> {
  if (offlineHas(track.id)) {
    await removeOffline(track.id)
    toast(t('Quitado de sin conexión'))
    return
  }
  const blocked = offlineReason(track)
  if (blocked) {
    toastErr(blocked)
    return
  }
  toast(t('Guardando para escuchar sin conexión…'))
  const result = await saveOffline(track)
  if (result.ok) toast(result.message, 'ok')
  else toastErr(result.message)
}

export function trackMenu(track: Track, play: (track: Track) => void, extra: MenuEntry[] = []): MenuEntry[] {
  const user = track.user as User | undefined
  const entries: MenuEntry[] = [
    { label: t('Reproducir'), icon: 'play', onSelect: () => play(track) },
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
    {
      label: t('Empezar radio'),
      icon: 'radio',
      onSelect: () => void player.startRadio(track),
    },
    'separator',
    {
      label: player.isLiked(track) ? 'Quitar de favoritos' : t('Guardar en favoritos'),
      icon: player.isLiked(track) ? 'heartFill' : 'heart',
      onSelect: () => {
        player.toggleLike(track)
        toast(player.isLiked(track) ? 'Guardado en favoritos' : t('Quitado de favoritos'), 'ok')
      },
    },
  ]
  if (canWrite()) {
    entries.push(
      {
        label: isReposted(track.id) ? 'Quitar el repost' : t('Repostear'),
        icon: 'repost',
        disabled: isBusy(track.id),
        onSelect: () => void toggleRepost(track),
      },
      { label: t('Añadir a una playlist…'), icon: 'playlist', onSelect: () => openPlaylistPicker(track) },
    )
  }
  entries.push({
    label: offlineHas(track.id) ? 'Quitar de sin conexión' : t('Guardar sin conexión'),
    icon: 'download',
    disabled: offlineSaving(track.id) !== null,
    onSelect: () => void toggleOffline(track),
  })
  if (canDownloadFile(track)) {
    entries.push({
      label: t('Descargar el archivo'),
      icon: 'download',
      onSelect: () => void downloadTrackFile(track),
    })
  }
  entries.push({ label: t('Abrir la ficha'), icon: 'music', onSelect: () => navigate(`/track/${track.id}`) })
  if (user) {
    entries.push({ label: `Ir a ${user.username}`, icon: 'user', onSelect: () => navigate(`/user/${user.id}`) })
  }
  if (extra.length > 0) entries.push('separator', ...extra)
  if (track.permalink_url) {
    entries.push('separator', {
      label: t('Compartir enlace'),
      icon: 'link',
      onSelect: () => void shareLink(track.permalink_url, track.title),
    })
    entries.push({
      label: t('Abrir en SoundCloud'),
      icon: 'external',
      onSelect: () => window.open(track.permalink_url, '_blank', 'noopener'),
    })
  }
  return entries
}

export function trackRow(track: Track | TrackStub, opts: TrackRowOptions = {}): HTMLElement {
  if (isTrackStub(track)) return unavailableRow(track.id)

  const row = h('div', { className: 'track-row', dataset: { id: String(track.id) } })
  const user = track.user as User | undefined

  if (opts.rank !== undefined) {
    row.appendChild(h('div', { className: `rank${opts.rank <= 3 ? ' top' : ''}` }, String(opts.rank)))
  }

  const art = artEl(track.artwork_url, track.title, {
    size: 't120x120',
    href: link(`/track/${track.id}`),
    title: `Abrir «${track.title}»`,
  })
  art.classList.add('art')
  art.appendChild(artOverlay('expand', 18))
  row.appendChild(art)

  const meta = h('div', { className: 'meta' })
  const titleLine = h('div', { className: 'title-line' })
  titleLine.appendChild(h('a', { className: 'title link-hover', href: link(`/track/${track.id}`) }, track.title))
  if (track.policy === 'SNIP') {
    titleLine.appendChild(h('span', { className: 'snip-badge', title: t('Preview de 30s (exclusivo Go+)') }, '30s'))
  }
  if (offlineHas(track.id)) titleLine.appendChild(offlineBadge('saved'))
  else if (offlineSaving(track.id) !== null) titleLine.appendChild(offlineBadge('saving'))
  if (isDrmOnly(track)) {
    titleLine.appendChild(
      h('span', { className: 'drm-badge', title: t('SoundCloud entrega este track cifrado (DRM): solo suena en su propia app') }, t('DRM')),
    )
  }
  meta.appendChild(titleLine)
  meta.appendChild(
    user
      ? h('a', { className: 'artist link-hover', href: link(`/user/${user.id}`) }, user.username)
      : h('span', { className: 'artist text-faint' }, t('Artista desconocido')),
  )
  if (opts.showAlbum) {
    const album = track.publisher_metadata?.album_title
    if (album) meta.appendChild(h('div', { className: 'album truncate' }, album))
  }
  row.appendChild(meta)

  const playAction = opts.onPlay ?? ((t: Track) => void player.playTrack(t))

  if (opts.actionButtons !== false) {
    const actions = h('div', { className: 'row-actions' })
    const playBtn = iconButton('play', `Reproducir «${track.title}»`, 16)
    playBtn.classList.add('row-play')
    playBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      playAction(track)
    })
    actions.append(playBtn, heartButton(track), queueButton(track))
    const moreBtn = iconButton('more', `Más opciones de «${track.title}»`)
    moreBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      openMenu(trackMenu(track, playAction, opts.extraMenu ?? []), moreBtn)
    })
    actions.appendChild(moreBtn)
    row.appendChild(actions)
  }

  const stat = h('div', { className: 'stat' })
  stat.textContent = opts.showPlays ? `${fmtCount(track.playback_count)} plays` : fmtTime(track.duration)
  row.appendChild(stat)

  row.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) return
    if ((event.target as HTMLElement).closest('.row-actions')) return
    playAction(track)
  })

  row.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    openMenu(trackMenu(track, playAction, opts.extraMenu ?? []), { x: event.clientX, y: event.clientY })
  })

  let lastPlaying: boolean | null = null
  watchPlayer(row, (state) => {
    const isCurrent = state.current?.id === track.id && state.playing
    if (isCurrent === lastPlaying) return
    lastPlaying = isCurrent
    row.classList.toggle('playing', isCurrent)
  })

  return row
}
