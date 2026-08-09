import type { Track } from '@soundclear/api'
import { register } from '../core/router'
import { player, type PlayerState } from '../player/player'
import { trackRow } from '../components/trackrow'
import { fmtTime } from '../core/utils'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'
import './views.css'

function moveInQueue(from: number, to: number): void {
  player.moveInQueue(from, to)
}

register('queue', (_route, container) => {
  document.title = 'Cola — SoundClear'

  const page = h('div', { className: 'view-page' })

  const head = h('div', { className: 'page-head' })
  head.appendChild(h('h1', { className: 'h-display' }, 'Cola'))
  const count = h('div', { className: 'text-faint' })
  head.appendChild(count)
  page.appendChild(head)

  const toolbar = h('div', { className: 'page-toolbar' })
  const playAllBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Reproducir todo')
  const shuffleBtn = h('button', { className: 'icon-btn', title: 'Aleatorio' })
  shuffleBtn.innerHTML = svgIcon('shuffle', 18)
  const repeatBtn = h('button', { className: 'icon-btn', title: 'Repetir' })
  repeatBtn.innerHTML = svgIcon('repeat', 18)
  const clearBtn = h('button', { className: 'icon-btn', title: 'Vaciar cola' })
  clearBtn.innerHTML = svgIcon('trash', 18)
  toolbar.appendChild(playAllBtn)
  toolbar.appendChild(shuffleBtn)
  toolbar.appendChild(repeatBtn)
  toolbar.appendChild(clearBtn)
  page.appendChild(toolbar)

  const hint = h('p', { className: 'text-faint queue-hint' }, 'Arrastra las filas o usa las flechas para reordenar la cola.')
  page.appendChild(hint)

  const list = h('div', { className: 'track-list queue-list' })
  page.appendChild(list)

  const empty = h('div', { className: 'empty-state' })
  empty.appendChild(iconEl('queue', 44))
  empty.appendChild(h('p', null, 'La cola está vacía'))
  empty.appendChild(h('a', { className: 'btn btn-ghost', href: '#/charts' }, 'Descubre música para añadir a tu cola'))

  container.appendChild(page)

  let rows: HTMLElement[] = []
  let dragFrom: number | null = null

  const clearDropMarks = (): void => {
    for (const row of rows) row.classList.remove('drop-before', 'drop-after')
  }

  const markCurrent = (index: number): void => {
    rows.forEach((row, i) => row.classList.toggle('queue-current', i === index))
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

  const renderList = (queue: Track[], index: number): void => {
    rows = []
    list.replaceChildren()
    if (queue.length === 0) {
      hint.hidden = true
      list.appendChild(empty)
      return
    }
    hint.hidden = queue.length < 2
    const fragment = document.createDocumentFragment()
    queue.forEach((track, i) => {
      const row = trackRow(track, { rank: i + 1, onPlay: () => player.jumpTo(i) })
      const actions = row.querySelector('.row-actions')
      if (actions) {
        actions.appendChild(moveButton('Subir en la cola', 'up', i, i - 1, i > 0))
        actions.appendChild(moveButton('Bajar en la cola', 'down', i, i + 1, i < queue.length - 1))
        const removeBtn = h('button', { className: 'icon-btn', title: 'Quitar de la cola', 'aria-label': 'Quitar de la cola' })
        removeBtn.innerHTML = svgIcon('close', 17)
        removeBtn.addEventListener('click', (event) => {
          event.stopPropagation()
          player.removeFromQueue(i)
        })
        actions.appendChild(removeBtn)
      }
      bindDrag(row, i)
      rows.push(row)
      fragment.appendChild(row)
    })
    list.appendChild(fragment)
    markCurrent(index)
  }

  playAllBtn.addEventListener('click', () => {
    const queue = player.store.get().queue
    if (queue.length > 0) player.playQueue([...queue], 0)
  })

  shuffleBtn.addEventListener('click', () => {
    player.toggleShuffle()
    toast(player.store.get().shuffle ? 'Aleatorio activado' : 'Aleatorio desactivado')
  })

  repeatBtn.addEventListener('click', () => {
    player.cycleRepeat()
    const mode = player.store.get().repeat
    toast(mode === 'one' ? 'Repetir una vez' : mode === 'all' ? 'Repetir toda la cola' : 'Repetir desactivado')
  })

  clearBtn.addEventListener('click', () => {
    if (player.store.get().queue.length === 0) return
    player.clearQueue()
    toast('Cola vaciada')
  })

  let lastKey = ''
  let lastIndex = -2
  let lastShuffle: boolean | null = null
  let lastRepeat: PlayerState['repeat'] | null = null
  let attached = false
  let unsub: (() => void) | null = null
  unsub = player.store.subscribe((state) => {
    if (attached && !container.isConnected) {
      unsub?.()
      return
    }
    attached = true
    const key = state.queue.map((t) => t.id).join(',')
    if (key !== lastKey) {
      lastKey = key
      lastIndex = state.index
      const total = state.queue.reduce((sum, t) => sum + (t.duration || 0), 0)
      count.textContent =
        state.queue.length === 0
          ? 'Cola vacía'
          : `${state.queue.length} ${state.queue.length === 1 ? 'track' : 'tracks'} · ${fmtTime(total)}`
      playAllBtn.disabled = state.queue.length === 0
      renderList(state.queue, state.index)
    } else if (state.index !== lastIndex) {
      lastIndex = state.index
      markCurrent(state.index)
    }
    if (state.shuffle !== lastShuffle) {
      lastShuffle = state.shuffle
      shuffleBtn.classList.toggle('active', state.shuffle)
      shuffleBtn.title = state.shuffle ? 'Aleatorio: activo' : 'Aleatorio'
    }
    if (state.repeat !== lastRepeat) {
      lastRepeat = state.repeat
      repeatBtn.classList.toggle('active', state.repeat !== 'off')
      repeatBtn.title = state.repeat === 'one' ? 'Repetir: una vez' : state.repeat === 'all' ? 'Repetir todo' : 'Repetir'
      repeatBtn.innerHTML = svgIcon(state.repeat === 'one' ? 'repeatOne' : 'repeat', 18)
    }
  })
})
