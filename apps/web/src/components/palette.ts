import type { Playlist, Track, User } from '@soundclear/api'
import { getAPI } from '../api'
import { openSoundcloudLink, soundcloudUrl } from '../core/links'
import { navigate } from '../core/router'
import { getSettings, updateSettings, type Accent, type Density, type Glass, type Theme, type Topbar } from '../core/settings'
import { canWrite, isReposted, toggleRepost } from '../core/social'
import { debounce, fmtTime } from '../core/utils'
import { player } from '../player/player'
import { h, svgIcon } from '../ui/el'
import { openModal } from '../ui/modal'
import { skPaletteRows } from '../ui/skeleton'
import { toast, toastErr } from '../ui/toast'
import { openPlaylistPicker } from './playlistpicker'
import { openShortcuts } from './shortcuts'
import { t } from '../core/i18n.ts'

interface Command {
  id: string
  label: string
  icon: string
  hint?: string
  keywords?: string
  run: () => void
}

const RESULT_LIMIT = 5

let open = false

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast(t('Enlace copiado al portapapeles'), 'ok')
  } catch {
    toastErr(t('No se pudo copiar el enlace'))
  }
}

function buildCommands(close: () => void): Command[] {
  const state = player.store.get()
  const settings = getSettings()
  const current = state.current
  const go = (path: string): (() => void) => () => {
    close()
    navigate(path)
  }
  const commands: Command[] = [
    { id: 'nav-home', label: t('Ir a Inicio'), icon: 'home', keywords: 'inicio home', run: go('/') },
    { id: 'nav-charts', label: t('Ir a Charts'), icon: 'chart', keywords: 'charts tendencias generos', run: go('/charts') },
    { id: 'nav-feed', label: t('Ir a tu feed'), icon: 'user', keywords: 'feed quien sigues novedades', run: go('/feed') },
    { id: 'nav-likes', label: t('Ir a Favoritos'), icon: 'heart', keywords: 'favoritos likes', run: go('/likes') },
    { id: 'nav-queue', label: t('Ir a la Cola'), icon: 'queue', keywords: 'cola queue', run: go('/queue') },
    { id: 'nav-now', label: t('Abrir «Ahora suena»'), icon: 'disc', keywords: 'ahora suena reproduciendo', run: go('/now') },
    { id: 'nav-settings', label: t('Abrir Ajustes'), icon: 'settings', keywords: 'ajustes settings', run: go('/settings') },
    {
      id: 'play-toggle',
      label: state.playing ? 'Pausar' : t('Reproducir'),
      icon: state.playing ? 'pause' : 'play',
      hint: t('Espacio'),
      keywords: 'play pausa reproducir',
      run: () => {
        close()
        player.toggle()
      },
    },
    {
      id: 'play-next',
      label: t('Siguiente track'),
      icon: 'next',
      hint: 'N',
      run: () => {
        close()
        player.next()
      },
    },
    {
      id: 'play-prev',
      label: t('Track anterior'),
      icon: 'prev',
      hint: 'P',
      run: () => {
        close()
        player.prev()
      },
    },
    {
      id: 'play-shuffle',
      label: state.shuffle ? 'Desactivar aleatorio' : t('Activar aleatorio'),
      icon: 'shuffle',
      hint: 'S',
      run: () => {
        close()
        player.toggleShuffle()
        toast(player.store.get().shuffle ? 'Aleatorio activado' : t('Aleatorio desactivado'))
      },
    },
    {
      id: 'play-repeat',
      label: t('Cambiar modo de repetición'),
      icon: 'repeat',
      hint: 'R',
      run: () => {
        close()
        player.cycleRepeat()
      },
    },
    {
      id: 'play-rate',
      label: `Velocidad: ${state.rate}× · cambiar`,
      icon: 'clock',
      keywords: 'velocidad rate tempo',
      run: () => {
        close()
        player.cycleRate()
        toast(`Velocidad ${player.store.get().rate}×`)
      },
    },
    {
      id: 'autoplay',
      label: settings.autoplay ? 'Desactivar radio infinita' : t('Activar radio infinita'),
      icon: 'radio',
      keywords: 'autoplay radio infinita continuar',
      run: () => {
        close()
        const next = !getSettings().autoplay
        updateSettings({ autoplay: next })
        toast(next ? 'Radio infinita activada' : t('Radio infinita desactivada'))
      },
    },
  ]

  if (current) {
    commands.push(
      {
        id: 'current-like',
        label: player.isLiked(current) ? `Quitar «${current.title}» de favoritos` : `Guardar «${current.title}» en favoritos`,
        icon: player.isLiked(current) ? 'heartFill' : 'heart',
        hint: 'F',
        run: () => {
          close()
          player.toggleLike(current)
        },
      },
      {
        id: 'current-radio',
        label: t('Radio a partir de lo que suena'),
        icon: 'radio',
        hint: 'X',
        run: () => {
          close()
          void player.startRadio(current)
        },
      },
      {
        id: 'current-track',
        label: t('Abrir la ficha del track'),
        icon: 'music',
        run: () => {
          close()
          navigate(`/track/${current.id}`)
        },
      },
      {
        id: 'current-artist',
        label: `Ir al perfil de ${current.user?.username ?? 'el artista'}`,
        icon: 'user',
        run: () => {
          close()
          if (current.user) navigate(`/user/${current.user.id}`)
        },
      },
      {
        id: 'current-copy',
        label: t('Copiar el enlace del track'),
        icon: 'link',
        run: () => {
          close()
          void copy(current.permalink_url)
        },
      },
    )
    if (canWrite()) {
      commands.push(
        {
          id: 'current-repost',
          label: isReposted(current.id) ? 'Quitar el repost de este track' : t('Repostear este track'),
          icon: 'repost',
          keywords: 'repost repostear',
          run: () => {
            close()
            void toggleRepost(current)
          },
        },
        {
          id: 'current-playlist',
          label: t('Añadir este track a una playlist'),
          icon: 'playlist',
          keywords: t('playlist añadir guardar'),
          run: () => {
            close()
            openPlaylistPicker(current)
          },
        },
      )
    }
  }

  for (const minutes of [15, 30, 60]) {
    commands.push({
      id: `sleep-${minutes}`,
      label: `Temporizador: pausar en ${minutes} min`,
      icon: 'clock',
      keywords: 'temporizador dormir sleep',
      run: () => {
        close()
        player.setSleepTimer(minutes)
        toast(`Se pausará en ${minutes} minutos`, 'ok')
      },
    })
  }
  if (state.sleepAt !== null) {
    commands.push({
      id: 'sleep-off',
      label: t('Quitar el temporizador'),
      icon: 'close',
      keywords: 'temporizador dormir sleep',
      run: () => {
        close()
        player.setSleepTimer(null)
        toast(t('Temporizador cancelado'))
      },
    })
  }

  const themes: { value: Theme; label: string }[] = [
    { value: 'dark', label: 'oscuro' },
    { value: 'light', label: 'claro' },
    { value: 'system', label: 'del sistema' },
  ]
  for (const theme of themes) {
    commands.push({
      id: `theme-${theme.value}`,
      label: `Tema ${theme.label}`,
      icon: theme.value === 'light' ? 'sun' : theme.value === 'dark' ? 'moon' : 'settings',
      keywords: 'tema theme apariencia',
      run: () => {
        close()
        updateSettings({ theme: theme.value })
      },
    })
  }

  const glasses: Glass[] = ['cristal', 'equilibrado', 'solido']
  for (const glass of glasses) {
    commands.push({
      id: `glass-${glass}`,
      label: `Cristal: ${glass}`,
      icon: 'waves',
      keywords: 'cristal glass transparencia',
      run: () => {
        close()
        updateSettings({ glass })
      },
    })
  }

  const accents: Accent[] = ['violeta', 'cian', 'ambar', 'verde', 'rosa', 'tono']
  for (const accent of accents) {
    commands.push({
      id: `accent-${accent}`,
      label: `Acento: ${accent}`,
      icon: 'disc',
      keywords: 'acento color accent',
      run: () => {
        close()
        updateSettings({ accent })
      },
    })
  }

  const densities: { value: Density; label: string }[] = [
    { value: 'comoda', label: t('cómoda') },
    { value: 'compacta', label: 'compacta' },
  ]
  for (const density of densities) {
    commands.push({
      id: `density-${density.value}`,
      label: `Densidad ${density.label}`,
      icon: 'list',
      keywords: 'densidad compacta espaciado',
      run: () => {
        close()
        updateSettings({ density: density.value })
      },
    })
  }

  const topbars: { value: Topbar; label: string }[] = [
    { value: 'fija', label: 'fija' },
    { value: 'auto', label: 'al desplazar' },
    { value: 'oculta', label: 'oculta' },
  ]
  for (const topbar of topbars) {
    commands.push({
      id: `topbar-${topbar.value}`,
      label: `Barra superior ${topbar.label}`,
      icon: 'layout',
      keywords: 'barra superior topbar cabecera',
      run: () => {
        close()
        updateSettings({ topbar: topbar.value })
      },
    })
  }

  commands.push(
    {
      id: 'queue-clear',
      label: t('Vaciar la cola'),
      icon: 'trash',
      run: () => {
        close()
        player.clearQueue()
        toast(t('Cola vaciada'))
      },
    },
    {
      id: 'help-shortcuts',
      label: t('Ver los atajos de teclado'),
      icon: 'info',
      hint: '?',
      run: () => {
        close()
        openShortcuts()
      },
    },
  )

  return commands
}

export function openPalette(initial = ''): void {
  if (open) return
  open = true
  const api = getAPI()
  const modal = openModal({
    title: t('Paleta de comandos'),
    className: 'palette-modal',
    onClose: () => {
      open = false
    },
  })

  const input = h('input', {
    className: 'input palette-input',
    type: 'text',
    placeholder: t('Escribe un comando o busca música…'),
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'palette-list',
    'aria-label': t('Comando o búsqueda'),
    value: initial,
  }) as HTMLInputElement

  const list = h('div', { className: 'palette-list', id: 'palette-list', role: 'listbox' })
  const empty = h('div', { className: 'palette-empty text-faint' }, t('Sin coincidencias'))
  empty.hidden = true

  modal.body.append(input, list, empty)

  const commands = buildCommands(() => modal.close())
  let rows: { el: HTMLElement; run: () => void }[] = []
  let active = 0
  let queryToken = 0

  const paintActive = (): void => {
    rows.forEach((row, index) => {
      const on = index === active
      row.el.classList.toggle('active', on)
      row.el.setAttribute('aria-selected', on ? 'true' : 'false')
      if (on) row.el.scrollIntoView({ block: 'nearest' })
    })
  }

  const rowEl = (icon: string, label: string, sub: string | null, hint: string | null, run: () => void): HTMLElement => {
    const el = h('div', { className: 'palette-row', role: 'option', 'aria-selected': 'false', tabindex: '-1' })
    const iconWrap = h('span', { className: 'palette-icon' })
    iconWrap.innerHTML = svgIcon(icon, 17)
    const text = h('span', { className: 'palette-text' })
    text.appendChild(h('span', { className: 'palette-label truncate' }, label))
    if (sub) text.appendChild(h('span', { className: 'palette-sub truncate' }, sub))
    el.append(iconWrap, text)
    if (hint) el.appendChild(h('kbd', { className: 'kbd palette-kbd' }, hint))
    el.addEventListener('click', () => run())
    el.addEventListener('mousemove', () => {
      const index = rows.findIndex((row) => row.el === el)
      if (index >= 0 && index !== active) {
        active = index
        paintActive()
      }
    })
    return el
  }

  const sectionEl = (label: string): HTMLElement => h('div', { className: 'palette-section' }, label)

  const render = (query: string, results: (Track | User | Playlist)[], searching = false): void => {
    const needle = normalize(query.trim())
    const matched = needle
      ? commands.filter((command) => normalize(`${command.label} ${command.keywords ?? ''}`).includes(needle))
      : commands.slice(0, 8)
    list.replaceChildren()
    rows = []
    active = 0

    const enlace = soundcloudUrl(query)
    if (enlace) {
      list.appendChild(sectionEl(t('Enlace de SoundCloud')))
      const run = (): void => {
        modal.close()
        void openSoundcloudLink(enlace)
      }
      const el = rowEl('link', t('Abrir este enlace'), enlace.replace('https://', ''), '↵', run)
      rows.push({ el, run })
      list.appendChild(el)
    }

    if (matched.length > 0) {
      list.appendChild(sectionEl(needle ? 'Comandos' : t('Acciones rápidas')))
      for (const command of matched.slice(0, 8)) {
        const el = rowEl(command.icon, command.label, null, command.hint ?? null, command.run)
        rows.push({ el, run: command.run })
        list.appendChild(el)
      }
    }

    if (results.length > 0) {
      list.appendChild(sectionEl(t('En SoundCloud')))
      for (const item of results) {
        if (item.kind === 'track') {
          const track = item as Track
          const run = (): void => {
            modal.close()
            void player.playTrack(track)
          }
          const el = rowEl('play', track.title, `${track.user?.username ?? t('Artista desconocido')} · ${fmtTime(track.duration)}`, null, run)
          rows.push({ el, run })
          list.appendChild(el)
        } else if (item.kind === 'user') {
          const user = item as User
          const run = (): void => {
            modal.close()
            navigate(`/user/${user.id}`)
          }
          const el = rowEl('user', user.username, t('Perfil'), null, run)
          rows.push({ el, run })
          list.appendChild(el)
        } else {
          const playlist = item as Playlist
          const run = (): void => {
            modal.close()
            navigate(`/playlist/${playlist.id}`)
          }
          const el = rowEl('playlist', playlist.title, `${playlist.track_count ?? 0} tracks`, null, run)
          rows.push({ el, run })
          list.appendChild(el)
        }
      }
    }

    if (needle && rows.length === 0) {
      const run = (): void => {
        modal.close()
        navigate('/search', { q: query.trim() })
      }
      const el = rowEl('search', `Buscar «${query.trim()}» en SoundCloud`, null, '↵', run)
      rows.push({ el, run })
      list.appendChild(el)
    }

    if (searching) {
      list.appendChild(sectionEl(t('Buscando en SoundCloud')))
      for (const skeleton of skPaletteRows(3)) list.appendChild(skeleton)
    }

    empty.hidden = rows.length > 0 || searching
    paintActive()
  }

  const search = debounce((query: string) => {
    const token = ++queryToken
    void Promise.allSettled([api.searchTracks(query, 0, RESULT_LIMIT), api.searchUsers(query, 0, 2)]).then(
      ([tracks, users]) => {
        if (token !== queryToken || !modal.root.isConnected) return
        const items: (Track | User)[] = []
        if (tracks.status === 'fulfilled') items.push(...tracks.value.collection)
        if (users.status === 'fulfilled') items.push(...users.value.collection)
        render(query, items)
      },
    )
  }, 240)

  input.addEventListener('input', () => {
    const value = input.value.trim()
    render(input.value, [], value.length >= 2)
    if (value.length >= 2) search(value)
    else queryToken++
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (rows.length === 0) return
      active = (active + 1) % rows.length
      paintActive()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length === 0) return
      active = (active - 1 + rows.length) % rows.length
      paintActive()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      rows[active]?.run()
    }
  })

  render(initial, [])
  if (initial.trim().length >= 2) search(initial.trim())
  input.focus()
  input.select()
}
