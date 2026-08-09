import type { Searchable, Track } from '@soundlite/api'
import { register } from '../core/router'
import { player } from '../player/player'
import { getAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { trackRow } from '../components/trackrow'
import { timeAgo } from '../core/utils'
import { avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { toastErr, toastOK } from '../ui/toast'
import './views.css'

type Tab = 'likes' | 'history' | 'account'

function emptyState(icon: string, text: string, cta?: HTMLElement): HTMLElement {
  const el = h('div', { className: 'empty-state' })
  el.appendChild(iconEl(icon, 44))
  el.appendChild(h('p', null, text))
  if (cta) el.appendChild(cta)
  return el
}

register('likes', (_route, container) => {
  document.title = 'Favoritos — Soundlite'

  let tab: Tab = 'likes'
  const desktop = isDesktop()

  const page = h('div', { className: 'view-page' })

  const head = h('div', { className: 'page-head' })
  head.appendChild(h('h1', { className: 'h-display' }, 'Favoritos'))
  page.appendChild(head)

  const tabs = h('div', { className: 'chip-row' })
  const likesTab = h('button', { className: 'chip active' }, 'Favoritos')
  const historyTab = h('button', { className: 'chip' }, 'Historial')
  tabs.appendChild(likesTab)
  tabs.appendChild(historyTab)
  const accountTab = desktop ? h('button', { className: 'chip' }, 'Tu cuenta') : null
  if (accountTab) tabs.appendChild(accountTab)
  page.appendChild(tabs)

  const toolbar = h('div', { className: 'page-toolbar' })
  const playAllBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Reproducir todo')
  toolbar.appendChild(playAllBtn)
  page.appendChild(toolbar)

  const list = h('div', { className: 'track-list' })
  page.appendChild(list)

  const likesEmpty = emptyState(
    'heart',
    'Todavía no tienes favoritos',
    h('a', { className: 'btn btn-ghost', href: '#/search' }, 'Buscar música'),
  )

  const historyEmpty = emptyState('clock', 'Aún no has escuchado nada')

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

  accountTab?.addEventListener('click', () => {
    tab = 'account'
    accountBuilt = false
    render()
  })

  let lastKey = ''
  function render(): void {
    likesTab.classList.toggle('active', tab === 'likes')
    historyTab.classList.toggle('active', tab === 'history')
    accountTab?.classList.toggle('active', tab === 'account')
    if (tab === 'account') {
      toolbar.hidden = true
      if (!accountBuilt) {
        accountBuilt = true
        buildAccountTab()
      }
      return
    }
    const state = player.store.get()
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

  let accountBuilt = false

  let accountTracks: Track[] = []
  let accountOffset = 0
  let accountLoading = false
  let accountDone = false
  let accountObserver: IntersectionObserver | null = null
  let accountSeq = 0

  function buildAccountTab(): void {
    list.replaceChildren()
    const checking = emptyState('headphone', 'Comprobando tu cuenta…')
    list.appendChild(checking)
    const mySeq = ++accountSeq

    accountTracks = []
    accountOffset = 0
    accountLoading = false
    accountDone = false

    getAPI()
      .me()
      .then(async (user) => {
        if (!container.isConnected || mySeq !== accountSeq) return

        if (!user) {
          list.replaceChildren()
          const loginBtn = h('button', { className: 'btn btn-primary' }, 'Iniciar sesión con SoundCloud')
          loginBtn.addEventListener('click', () => {
            void desktopInvoke('login_window').catch(() => toastErr('No se pudo abrir la ventana de sesión'))
          })
          list.appendChild(
            emptyState('user', 'Conecta tu cuenta para ver tus likes de SoundCloud', loginBtn),
          )
          return
        }
        list.replaceChildren()
        const card = h('div', { className: 'card card-pad account-card' })
        const row = h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } })
        row.appendChild(avatarEl(user.avatar_url, user.username, 56))
        const info = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } })
        info.appendChild(h('strong', { className: 'truncate' }, `${user.username}${user.verified ? ' ✓' : ''}`))
        info.appendChild(
          h('span', { className: 'text-faint' }, `${user.followers_count ?? 0} seguidores · tus likes de SoundCloud`),
        )
        row.appendChild(info)
        card.appendChild(row)
        list.appendChild(card)

        const sentinel = h('div', { className: 'load-more' })
        list.appendChild(sentinel)
        accountObserver = new IntersectionObserver((entries) => {
          if (!container.isConnected) {
            accountObserver?.disconnect()
            return
          }
          if (entries[0]?.isIntersecting) void loadAccountPage()
        })
        accountObserver.observe(sentinel)
        await loadAccountPage()
      })
      .catch(() => {
        if (!container.isConnected || mySeq !== accountSeq) return

        list.replaceChildren()
        list.appendChild(emptyState('user', 'No se pudo conectar con tu cuenta'))
      })
  }

  async function loadAccountPage(): Promise<void> {
    if (accountLoading || accountDone || !container.isConnected) return
    accountLoading = true
    const mySeq = accountSeq
    try {
      const response = await getAPI().meLikes(accountOffset, 50)
      if (!container.isConnected || mySeq !== accountSeq) return
      accountDone = !response.next_href || response.collection.length === 0
      const items = response.collection as Searchable[]
      accountOffset += items.length
      items.forEach((item) => {
        if (item.kind !== 'track') return
        const track = item as Track
        accountTracks.push(track)
        const row = trackRow(track, {
          showPlays: true,
          onPlay: () => {
            const index = accountTracks.findIndex((t) => t.id === track.id)
            player.playQueue(accountTracks, Math.max(0, index))
          },
        })
        const unlikeBtn = h('button', { className: 'icon-btn', title: 'Quitar de tus likes' })
        unlikeBtn.innerHTML = svgIcon('heart', 17)
        unlikeBtn.addEventListener('click', (event) => {
          event.stopPropagation()
          void getAPI()
            .toggleAccountLike(track.id, false)
            .then(() => {
              accountTracks = accountTracks.filter((t) => t.id !== track.id)
              row.remove()
              toastOK('Quitado de tus likes de SoundCloud')
            })
            .catch(() => toastErr('No se pudo quitar el like'))
        })
        row.querySelector('.row-actions')?.appendChild(unlikeBtn)
        list.appendChild(row)
      })
      if (accountDone && accountTracks.length === 0 && accountOffset > 0) {
        list.appendChild(emptyState('heart', 'No tienes likes en tu cuenta'))
      }
    } catch {
      if (!container.isConnected || mySeq !== accountSeq) return
      accountDone = true
      toastErr('No se pudieron cargar tus likes')
    } finally {
      if (mySeq === accountSeq) accountLoading = false
    }
  }

  const unsub = player.store.subscribe(() => {
    if (!container.isConnected) {
      unsub()
      return
    }
    render()
  })
})
