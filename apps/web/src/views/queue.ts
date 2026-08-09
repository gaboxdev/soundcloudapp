import type { Track } from '@soundlite/api'
import { register } from '../core/router'
import { player, type PlayerState } from '../player/player'
import { trackRow } from '../components/trackrow'
import { fmtTime } from '../core/utils'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'
import './views.css'

register('queue', (_route, container) => {
  document.title = 'Cola — Soundlite'

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

  const list = h('div', { className: 'track-list' })
  page.appendChild(list)

  const empty = h('div', { className: 'empty-state' })
  empty.appendChild(iconEl('queue', 44))
  empty.appendChild(h('p', null, 'La cola está vacía'))
  empty.appendChild(h('a', { className: 'btn btn-ghost', href: '#/charts' }, 'Descubre música para añadir a tu cola'))

  container.appendChild(page)

  const renderList = (queue: Track[]): void => {
    list.replaceChildren()
    if (queue.length === 0) {
      list.appendChild(empty)
      return
    }
    queue.forEach((track, i) => {
      const row = trackRow(track, { rank: i + 1, onPlay: () => player.jumpTo(i) })
      const removeBtn = h('button', { className: 'icon-btn', title: 'Quitar de la cola' })
      removeBtn.innerHTML = svgIcon('close', 17)
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation()
        player.removeFromQueue(i)
      })
      row.querySelector('.row-actions')?.appendChild(removeBtn)
      list.appendChild(row)
    })
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
  let lastShuffle: boolean | null = null
  let lastRepeat: PlayerState['repeat'] | null = null
  const unsub = player.store.subscribe((state) => {
    if (!container.isConnected) {
      unsub()
      return
    }
    const key = state.queue.map((t) => t.id).join(',')
    if (key !== lastKey) {
      lastKey = key
      const total = state.queue.reduce((sum, t) => sum + (t.duration || 0), 0)
      count.textContent =
        state.queue.length === 0
          ? 'Cola vacía'
          : `${state.queue.length} ${state.queue.length === 1 ? 'track' : 'tracks'} · ${fmtTime(total)}`
      playAllBtn.disabled = state.queue.length === 0
      renderList(state.queue)
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
