import type { Track } from '@soundclear/api'
import { register } from '../core/router'
import { canWrite } from '../core/social'
import { openSaveQueue } from '../components/playlistpicker'
import { player, type PlayerState } from '../player/player'
import { trackRow } from '../components/trackrow'
import { fmtTime } from '../core/utils'
import { h, iconEl, labelBtn, svgIcon, titleIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'
import { virtualList, type VirtualList } from '../ui/virtuallist'
import './views.css'
import { t } from '../core/i18n.ts'

const VIRTUAL_MIN = 60

function moveInQueue(from: number, to: number): void {
  player.moveInQueue(from, to)
}

register('queue', (_route, container) => {
  document.title = t('Cola — SoundClear')

  const page = h('div', { className: 'view-page' })

  const head = h('div', { className: 'page-head' })
  head.appendChild(h('h1', { className: 'h-display h-icon' }, [titleIcon('queue', 26), h('span', null, t('Cola'))]))
  const count = h('div', { className: 'text-faint' })
  head.appendChild(count)
  page.appendChild(head)

  const toolbar = h('div', { className: 'page-toolbar' })
  const playAllBtn = labelBtn('btn btn-ghost btn-sm', 'play', t('Reproducir todo')).btn
  const shuffleBtn = h('button', { className: 'icon-btn', title: t('Aleatorio') })
  shuffleBtn.innerHTML = svgIcon('shuffle', 18)
  const repeatBtn = h('button', { className: 'icon-btn', title: t('Repetir') })
  repeatBtn.innerHTML = svgIcon('repeat', 18)
  const clearBtn = h('button', { className: 'icon-btn', title: t('Vaciar cola') })
  clearBtn.innerHTML = svgIcon('trash', 18)
  const playedBtn = labelBtn('btn btn-ghost btn-sm', 'check', t('Quitar reproducidos')).btn
  const dedupeBtn = labelBtn('btn btn-ghost btn-sm', 'filter', t('Quitar duplicados')).btn
  const copyBtn = labelBtn('btn btn-ghost btn-sm', 'link', t('Copiar la cola')).btn
  const saveBtn = canWrite() ? labelBtn('btn btn-ghost btn-sm', 'playlist', t('Guardar como playlist')).btn : null
  toolbar.appendChild(playAllBtn)
  toolbar.appendChild(shuffleBtn)
  toolbar.appendChild(repeatBtn)
  toolbar.appendChild(playedBtn)
  toolbar.appendChild(dedupeBtn)
  toolbar.appendChild(copyBtn)
  if (saveBtn) toolbar.appendChild(saveBtn)
  toolbar.appendChild(clearBtn)
  page.appendChild(toolbar)

  const hint = h('p', { className: 'text-faint queue-hint' }, t('Arrastra las filas o usa las flechas para reordenar la cola.'))
  page.appendChild(hint)

  const list = h('div', { className: 'track-list queue-list' })
  page.appendChild(list)

  const empty = h('div', { className: 'empty-state' })
  empty.appendChild(iconEl('queue', 44))
  empty.appendChild(h('p', null, t('La cola está vacía')))
  empty.appendChild(h('a', { className: 'btn btn-ghost', href: '#/charts' }, t('Descubre música para añadir a tu cola')))

  container.appendChild(page)

  let queueRef: Track[] = []
  let currentIndex = -1
  let virtual: VirtualList | null = null
  let dragFrom: number | null = null

  const mountedRows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>('.track-row[data-qindex]')]

  const clearDropMarks = (): void => {
    for (const row of list.querySelectorAll('.drop-before, .drop-after')) {
      row.classList.remove('drop-before', 'drop-after')
    }
  }

  const markCurrent = (index: number): void => {
    currentIndex = index
    for (const row of mountedRows()) {
      row.classList.toggle('queue-current', Number(row.dataset.qindex) === index)
    }
  }

  const moveButton = (title: string, direction: 'up' | 'down', from: number, to: number, enabled: boolean): HTMLElement => {
    const btn = h('button', {
      className: `icon-btn queue-move queue-move-${direction}`,
      title,
      'aria-label': title,
      disabled: !enabled,
    })
    btn.innerHTML = svgIcon(direction === 'up' ? 'back' : 'forward', 17)
    btn.addEventListener('click', (event) => {
      event.stopPropagation()
      if (enabled) moveInQueue(from, to)
    })
    return btn
  }

  const bindDrag = (row: HTMLElement, index: number): void => {
    row.draggable = true
    row.querySelectorAll<HTMLElement>('a, img').forEach((child) => {
      child.draggable = false
    })
    row.addEventListener('dragstart', (event) => {
      dragFrom = index
      row.classList.add('dragging')
      event.dataTransfer?.setData('text/plain', String(index))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    })
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging')
      clearDropMarks()
      dragFrom = null
    })
    row.addEventListener('dragover', (event) => {
      if (dragFrom === null || dragFrom === index) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      clearDropMarks()
      row.classList.add(index < dragFrom ? 'drop-before' : 'drop-after')
    })
    row.addEventListener('dragleave', () => {
      row.classList.remove('drop-before', 'drop-after')
    })
    row.addEventListener('drop', (event) => {
      event.preventDefault()
      const from = dragFrom
      dragFrom = null
      clearDropMarks()
      if (from !== null) moveInQueue(from, index)
    })
  }

  const queueRow = (i: number): HTMLElement => {
    const track = queueRef[i]
    if (!track) return h('div')
    const row = trackRow(track, { rank: i + 1, onPlay: () => player.jumpTo(i) })
    row.dataset.qindex = String(i)
    if (i === currentIndex) row.classList.add('queue-current')
    const actions = row.querySelector('.row-actions')
    if (actions) {
      actions.appendChild(moveButton(t('Subir en la cola'), 'up', i, i - 1, i > 0))
      actions.appendChild(moveButton(t('Bajar en la cola'), 'down', i, i + 1, i < queueRef.length - 1))
      const removeBtn = h('button', { className: 'icon-btn', title: t('Quitar de la cola'), 'aria-label': t('Quitar de la cola') })
      removeBtn.innerHTML = svgIcon('close', 17)
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        player.removeFromQueue(i)
      })
      actions.appendChild(removeBtn)
    }
    if (player.isRadioTrack(track.id)) {
      const meta = row.querySelector('.title-line')
      if (meta) meta.appendChild(h('span', { className: 'now-badge' }, t('Radio')))
    }
    bindDrag(row, i)
    return row
  }

  const dropVirtual = (): void => {
    if (!virtual) return
    virtual.destroy()
    virtual = null
  }

  const renderList = (queue: Track[], index: number): void => {
    queueRef = queue
    currentIndex = index
    if (queue.length === 0) {
      dropVirtual()
      list.replaceChildren(empty)
      hint.hidden = true
      return
    }
    hint.hidden = queue.length < 2
    if (queue.length > VIRTUAL_MIN) {
      if (!virtual) {
        virtual = virtualList({ row: queueRow })
        list.replaceChildren(virtual.el)
      }
      virtual.setCount(queue.length)
      return
    }
    dropVirtual()
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < queue.length; i++) fragment.appendChild(queueRow(i))
    list.replaceChildren(fragment)
  }

  list.addEventListener('dragend', () => {
    dragFrom = null
    clearDropMarks()
  })

  playAllBtn.addEventListener('click', () => {
    const queue = player.store.get().queue
    if (queue.length > 0) player.playQueue([...queue], 0)
  })

  shuffleBtn.addEventListener('click', () => {
    player.toggleShuffle()
    toast(player.store.get().shuffle ? 'Aleatorio activado' : t('Aleatorio desactivado'))
  })

  repeatBtn.addEventListener('click', () => {
    player.cycleRepeat()
    const mode = player.store.get().repeat
    toast(mode === 'one' ? 'Repetir una vez' : mode === 'all' ? 'Repetir toda la cola' : t('Repetir desactivado'))
  })

  playedBtn.addEventListener('click', () => {
    const removed = player.removePlayed()
    toast(removed > 0 ? `${removed} ${removed === 1 ? 'track quitado' : 'tracks quitados'} de la cola` : t('No hay nada por delante que quitar'))
  })

  dedupeBtn.addEventListener('click', () => {
    const removed = player.dedupeQueue()
    toast(removed > 0 ? `${removed} ${removed === 1 ? 'duplicado' : 'duplicados'} fuera` : t('No había duplicados'))
  })

  copyBtn.addEventListener('click', () => {
    const queue = player.store.get().queue
    if (queue.length === 0) return
    const text = queue
      .map((track, index) => `${index + 1}. ${track.user?.username ?? t('Artista desconocido')} — ${track.title} (${track.permalink_url})`)
      .join('\n')
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(t('Cola copiada al portapapeles'), 'ok'))
      .catch(() => toastErr(t('No se pudo copiar la cola')))
  })

  saveBtn?.addEventListener('click', () => openSaveQueue([...player.store.get().queue]))

  clearBtn.addEventListener('click', () => {
    if (player.store.get().queue.length === 0) return
    player.clearQueue()
    toast(t('Cola vaciada'))
  })

  let lastKey = ''
  let lastIndex = -2
  let lastShuffle: boolean | null = null
  let lastRepeat: PlayerState['repeat'] | null = null
  let attached = false
  let unsub: (() => void) | null = null
  unsub = player.store.subscribe((state) => {
    if (attached && !container.isConnected) {
      dropVirtual()
      unsub?.()
      return
    }
    attached = true
    const key = `${state.radioIds.length}:${state.queue.map((t) => t.id).join(',')}`
    if (key !== lastKey) {
      lastKey = key
      lastIndex = state.index
      const total = state.queue.reduce((sum, t) => sum + (t.duration || 0), 0)
      count.textContent =
        state.queue.length === 0
          ? t('Cola vacía')
          : `${state.queue.length} ${state.queue.length === 1 ? 'track' : 'tracks'} · ${fmtTime(total)}`
      playAllBtn.disabled = state.queue.length === 0
      playedBtn.disabled = state.index <= 0
      dedupeBtn.disabled = state.queue.length < 2
      copyBtn.disabled = state.queue.length === 0
      if (saveBtn) saveBtn.disabled = state.queue.length === 0
      clearBtn.disabled = state.queue.length === 0
      renderList(state.queue, state.index)
    } else if (state.index !== lastIndex) {
      lastIndex = state.index
      markCurrent(state.index)
    }
    if (state.shuffle !== lastShuffle) {
      lastShuffle = state.shuffle
      shuffleBtn.classList.toggle('active', state.shuffle)
      shuffleBtn.title = state.shuffle ? 'Aleatorio: activo' : t('Aleatorio')
    }
    if (state.repeat !== lastRepeat) {
      lastRepeat = state.repeat
      repeatBtn.classList.toggle('active', state.repeat !== 'off')
      repeatBtn.title = state.repeat === 'one' ? 'Repetir: una vez' : state.repeat === 'all' ? 'Repetir todo' : t('Repetir')
      repeatBtn.innerHTML = svgIcon(state.repeat === 'one' ? 'repeatOne' : 'repeat', 18)
    }
  })
})
