import { register } from '../core/router'
import { player } from '../player/player'
import { trackRow } from '../components/trackrow'
import { timeAgo } from '../core/utils'
import { h, iconEl } from '../ui/el'
import './views.css'

register('likes', (_route, container) => {
  document.title = 'Favoritos — Soundlite'

  let tab: 'likes' | 'history' = 'likes'

  const page = h('div', { className: 'view-page' })

  const head = h('div', { className: 'page-head' })
  head.appendChild(h('h1', { className: 'h-display' }, 'Favoritos'))
  page.appendChild(head)

  const tabs = h('div', { className: 'chip-row' })
  const likesTab = h('button', { className: 'chip active' }, 'Favoritos')
  const historyTab = h('button', { className: 'chip' }, 'Historial')
  tabs.appendChild(likesTab)
  tabs.appendChild(historyTab)
  page.appendChild(tabs)

  const toolbar = h('div', { className: 'page-toolbar' })
  const playAllBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Reproducir todo')
  toolbar.appendChild(playAllBtn)
  page.appendChild(toolbar)

  const list = h('div', { className: 'track-list' })
  page.appendChild(list)

  const likesEmpty = h('div', { className: 'empty-state' })
  likesEmpty.appendChild(iconEl('heart', 44))
  likesEmpty.appendChild(h('p', null, 'Todavía no tienes favoritos'))
  likesEmpty.appendChild(h('a', { className: 'btn btn-ghost', href: '#/search' }, 'Buscar música'))

  const historyEmpty = h('div', { className: 'empty-state' })
  historyEmpty.appendChild(iconEl('clock', 44))
  historyEmpty.appendChild(h('p', null, 'Aún no has escuchado nada'))

  container.appendChild(page)

  playAllBtn.addEventListener('click', () => {
    const likes = player.store.get().likes
    if (likes.length > 0) player.playQueue([...likes], 0)
  })

  likesTab.addEventListener('click', () => {
    tab = 'likes'
    render()
  })

  historyTab.addEventListener('click', () => {
    tab = 'history'
    render()
  })

  let lastKey = ''
  function render(): void {
    const state = player.store.get()
    likesTab.classList.toggle('active', tab === 'likes')
    historyTab.classList.toggle('active', tab === 'history')
    const key = `${tab}|${state.likes.length}|${state.history.length}|${state.likes.map((t) => t.id).join(',')}|${state.history.map((e) => e.track.id).join(',')}`
    if (key === lastKey) return
    lastKey = key
    list.replaceChildren()
    if (tab === 'likes') {
      toolbar.hidden = false
      playAllBtn.disabled = state.likes.length === 0
      if (state.likes.length === 0) {
        list.appendChild(likesEmpty)
        return
      }
      state.likes.forEach((track, i) => {
        list.appendChild(trackRow(track, { showPlays: true, onPlay: () => player.playQueue(state.likes, i) }))
      })
      return
    }
    toolbar.hidden = true
    if (state.history.length === 0) {
      list.appendChild(historyEmpty)
      return
    }
    state.history.forEach((entry) => {
      const row = trackRow(entry.track)
      const stat = row.querySelector('.stat')
      if (stat) stat.textContent = timeAgo(new Date(entry.playedAt).toISOString())
      list.appendChild(row)
    })
  }

  const unsub = player.store.subscribe(() => {
    if (!container.isConnected) {
      unsub()
      return
    }
    render()
  })
})
