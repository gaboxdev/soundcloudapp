import type { Playlist, StreamPost, Track } from '@soundclear/api'
import { getAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { accountStore, hasAccount } from '../core/account'
import { link, register } from '../core/router'
import { timeAgo } from '../core/utils'
import { player } from '../player/player'
import { trackRow } from '../components/trackrow'
import { artEl, avatarEl } from '../ui/artwork'
import { h, iconEl, labelBtn, svgIcon, titleIcon } from '../ui/el'
import { skFeedItems, skMore } from '../ui/skeleton'
import { toastErr } from '../ui/toast'
import './feed.css'
import { t } from '../core/i18n.ts'

const PAGE_SIZE = 20
const SCROLL_MARGIN = 280

export function postReason(post: StreamPost): string {
  const who = post.user?.username ?? t('Alguien')
  const when = timeAgo(post.created_at)
  const verb = post.type.includes('repost') ? 'reposteó' : t('publicó')
  return when ? `${who} ${verb} · ${when}` : `${who} ${verb}`
}

function reasonEl(post: StreamPost): HTMLElement {
  const wrap = h('div', { className: 'feed-reason' })
  const who = post.user?.username ?? t('Alguien')
  const avatar = avatarEl(post.user?.avatar_url ?? null, who, 20)
  avatar.classList.add('feed-reason-avatar')
  const icon = h('span', { className: 'feed-reason-icon' })
  icon.innerHTML = svgIcon(post.type.includes('repost') ? 'repost' : 'music', 13)
  wrap.append(avatar, icon, h('span', { className: 'truncate' }, postReason(post)))
  const caption = post.caption?.trim()
  if (caption) wrap.appendChild(h('span', { className: 'feed-caption truncate' }, `«${caption}»`))
  return wrap
}

function playlistPostEl(post: StreamPost, playlist: Playlist): HTMLElement {
  const item = h('div', { className: 'feed-item' })
  item.appendChild(reasonEl(post))
  const row = h('a', { className: 'result-row playlist-row', href: link(`/playlist/${playlist.id}`) })
  row.appendChild(artEl(playlist.artwork_url, playlist.title, { size: 't300x300' }))
  const meta = h('div', { className: 'meta' })
  const titleLine = h('div', { className: 'title-line' })
  titleLine.appendChild(h('span', { className: 'title truncate' }, playlist.title))
  const isAlbum = playlist.is_album === true || playlist.set_type === 'album'
  titleLine.appendChild(h('span', { className: 'kind-badge' }, isAlbum ? 'Álbum' : t('Playlist')))
  meta.appendChild(titleLine)
  meta.appendChild(
    h('div', { className: 'sub text-dim truncate' }, `${playlist.track_count ?? 0} tracks · ${playlist.user?.username ?? ''}`),
  )
  row.appendChild(meta)
  item.appendChild(row)
  return item
}

register('feed', (_route, container) => {
  document.title = t('De quien sigues — SoundClear')

  const page = h('div', { className: 'view-page feed-view' })
  const head = h('div', { className: 'page-head' })
  head.appendChild(h('h1', { className: 'h-display h-icon' }, [titleIcon('user', 26), h('span', null, t('De quien sigues'))]))
  const count = h('div', { className: 'text-faint' })
  head.appendChild(count)
  page.appendChild(head)

  const toolbar = h('div', { className: 'page-toolbar' })
  const refreshBtn = h('button', { className: 'btn btn-ghost btn-sm' })
  refreshBtn.innerHTML = `${svgIcon('refresh', 16)}<span>Actualizar</span>`
  const playAllBtn = labelBtn('btn btn-ghost btn-sm', 'play', t('Reproducir lo nuevo')).btn
  toolbar.append(refreshBtn, playAllBtn)
  page.appendChild(toolbar)

  const list = h('div', { className: 'track-list feed-list' })
  const sentinel = h('div', { className: 'load-more' })
  page.append(list, sentinel)
  container.appendChild(page)

  const tracks: Track[] = []
  const seen = new Set<string>()
  let next: string | null = null
  let started = false
  let loading = false
  let done = false
  let rendered = 0

  const observer = new IntersectionObserver(
    (entries) => {
      if (!container.isConnected) {
        observer.disconnect()
        return
      }
      for (const entry of entries) {
        if (entry.isIntersecting) void load()
      }
    },
    { rootMargin: `${SCROLL_MARGIN}px` },
  )
  observer.observe(sentinel)

  function setToolbar(enabled: boolean): void {
    toolbar.hidden = !enabled
    playAllBtn.disabled = tracks.length === 0
  }

  function gateEl(): HTMLElement {
    const empty = h('div', { className: 'empty-state' })
    empty.appendChild(iconEl('user', 44))
    if (!isDesktop()) {
      empty.appendChild(h('p', null, t('Tu feed vive en tu cuenta de SoundCloud, y la sesión solo está disponible en la app de escritorio.')))
      empty.appendChild(
        h(
          'a',
          { className: 'btn btn-ghost', href: 'https://github.com/gaboxdev/soundcloudapp', target: '_blank', rel: 'noopener' },
          t('Obtener la app de escritorio'),
        ),
      )
      return empty
    }
    empty.appendChild(h('p', null, t('Conecta tu cuenta para ver lo que publican los artistas que sigues')))
    const login = h('button', { className: 'btn btn-primary' }, t('Iniciar sesión con SoundCloud'))
    login.addEventListener('click', () => {
      void desktopInvoke('login_window').catch(() => toastErr(t('No se pudo abrir la ventana de sesión')))
    })
    empty.appendChild(login)
    return empty
  }

  function renderEmpty(): void {
    list.replaceChildren(
      h('div', { className: 'empty-state' }, [
        iconEl('music', 44),
        h('p', null, t('Todavía no hay nada nuevo de quien sigues')),
        h('a', { className: 'btn btn-ghost', href: link('/charts') }, t('Descubrir artistas')),
      ]),
    )
  }

  function renderError(): void {
    list.replaceChildren(
      h('div', { className: 'page-error' }, [
        h('h2', {}, t('No se pudo cargar tu feed')),
        h('p', { className: 'text-dim' }, t('Comprueba tu conexión e inténtalo de nuevo.')),
        h('div', {}, [h('button', { className: 'btn btn-primary', onclick: () => reset() }, t('Reintentar'))]),
      ]),
    )
  }

  function appendPosts(posts: StreamPost[]): number {
    let added = 0
    for (const post of posts) {
      const payload = post.track ?? post.playlist
      if (!payload) continue
      const key = `${post.type}:${payload.id}`
      if (seen.has(key)) continue
      seen.add(key)
      added += 1
      if (post.track) {
        const track = post.track
        const index = tracks.length
        tracks.push(track)
        const item = h('div', { className: 'feed-item' })
        item.appendChild(reasonEl(post))
        item.appendChild(trackRow(track, { showPlays: true, onPlay: () => player.playQueue(tracks, index) }))
        list.appendChild(item)
      } else if (post.playlist) {
        list.appendChild(playlistPostEl(post, post.playlist))
      }
      rendered += 1
    }
    return added
  }

  async function load(): Promise<void> {
    if (loading || done || !container.isConnected) return
    if (!hasAccount()) return
    loading = true
    const first = !started
    if (first) {
      list.replaceChildren(...skFeedItems(5))
    } else {
      sentinel.replaceChildren(skMore(2))
    }
    try {
      const response = await getAPI().stream(PAGE_SIZE, next)
      if (!container.isConnected) return
      if (first) list.replaceChildren()
      started = true
      next = response.next_href
      const added = appendPosts(response.collection)
      done = !next || (response.collection.length === 0 && added === 0)
      count.textContent = rendered === 0 ? '' : `${rendered} publicaciones`
      if (done && rendered === 0) renderEmpty()
      setToolbar(true)
    } catch {
      if (!container.isConnected) return
      done = true
      if (rendered === 0) renderError()
      else toastErr(t('No se pudieron cargar más publicaciones'))
    } finally {
      loading = false
      sentinel.replaceChildren()
      if (!done) pump()
    }
  }

  function pump(): void {
    window.requestAnimationFrame(() => {
      if (loading || done || !container.isConnected || !sentinel.isConnected) return
      if (sentinel.getBoundingClientRect().top <= window.innerHeight + SCROLL_MARGIN) void load()
    })
  }

  function reset(): void {
    tracks.length = 0
    seen.clear()
    next = null
    started = false
    done = false
    loading = false
    rendered = 0
    count.textContent = ''
    list.replaceChildren()
    void load()
  }

  refreshBtn.addEventListener('click', () => reset())
  playAllBtn.addEventListener('click', () => {
    if (tracks.length > 0) player.playQueue([...tracks], 0)
  })

  function paint(): void {
    if (hasAccount()) {
      setToolbar(true)
      if (!started) void load()
      return
    }
    setToolbar(false)
    list.replaceChildren(gateEl())
  }

  let attached = false
  let unsub: (() => void) | null = null
  unsub = accountStore.subscribe(() => {
    if (attached && !container.isConnected) {
      unsub?.()
      observer.disconnect()
      return
    }
    attached = true
    paint()
  })
})
