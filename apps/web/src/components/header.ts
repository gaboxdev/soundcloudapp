import type { AccountState } from '../core/account'
import { accountStore } from '../core/account'
import { debounce } from '../core/utils'
import { currentRoute, navigate } from '../core/router'
import { getAPI } from '../api'
import { avatarEl } from '../ui/artwork'
import { h, svgIcon } from '../ui/el'
import { appLogo } from '../ui/logo'
import '../views/views.css'

const NAV_ITEMS = [
  { path: '/', label: 'Inicio', icon: 'home' },
  { path: '/charts', label: 'Charts', icon: 'chart' },
  { path: '/likes', label: 'Favoritos', icon: 'heart' },
  { path: '/queue', label: 'Cola', icon: 'queue' },
]

const SUGGEST_MIN = 2

let headerEl: HTMLElement | null = null

function setActiveNav(): void {
  if (!headerEl) return
  const hash = window.location.hash.replace(/^#/, '') || '/'
  const active = hash === '/' ? '/' : `/${hash.split('/')[1].split('?')[0]}`
  headerEl.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.path === active)
  })
}

export function renderHeader(): HTMLElement {
  const header = h('header', { className: 'app-header' })
  headerEl = header

  const logo = h('a', { className: 'logo', href: '#/', title: 'Soundlite — inicio' })
  logo.innerHTML = appLogo(28)
  logo.appendChild(h('span', { className: 'logo-name' }, 'Soundlite'))
  header.appendChild(logo)

  const historyNav = h('div', { className: 'history-nav' })
  const backBtn = h('button', { className: 'icon-btn', title: 'Atrás', 'aria-label': 'Atrás' })
  backBtn.innerHTML = svgIcon('back', 18)
  backBtn.addEventListener('click', () => window.history.back())
  const forwardBtn = h('button', { className: 'icon-btn', title: 'Adelante', 'aria-label': 'Adelante' })
  forwardBtn.innerHTML = svgIcon('forward', 18)
  forwardBtn.addEventListener('click', () => window.history.forward())
  historyNav.append(backBtn, forwardBtn)
  header.appendChild(historyNav)

  const nav = h('nav', { className: 'nav' })
  for (const item of NAV_ITEMS) {
    const btn = h('a', {
      className: 'nav-item',
      dataset: { path: item.path },
      href: `#${item.path}`,
      title: item.label,
    })
    btn.innerHTML = svgIcon(item.icon, 16)
    btn.appendChild(h('span', { className: 'nav-label' }, item.label))
    nav.appendChild(btn)
  }
  header.appendChild(nav)

  const searchWrap = h('div', { className: 'header-search' })
  const searchBox = h('div', { className: 'search-input' })
  searchBox.innerHTML = svgIcon('search', 16)
  const input = h('input', {
    type: 'text',
    placeholder: 'Busca tracks, artistas, playlists…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Buscar en SoundCloud',
  }) as HTMLInputElement
  searchBox.appendChild(input)
  const suggestions = h('div', { className: 'suggest-box' })
  searchWrap.append(searchBox, suggestions)
  header.appendChild(searchWrap)

  let items: string[] = []
  let activeIndex = -1

  const closeSuggestions = (): void => {
    items = []
    activeIndex = -1
    suggestions.replaceChildren()
  }

  const highlight = (): void => {
    suggestions.querySelectorAll<HTMLElement>('.suggest-item').forEach((option, i) => {
      option.classList.toggle('active', i === activeIndex)
    })
  }

  const goToSearch = (q: string): void => {
    closeSuggestions()
    navigate('/search', { q })
    input.blur()
  }

  const showSuggestions = (list: string[]): void => {
    items = list
    activeIndex = -1
    suggestions.replaceChildren()
    for (const item of list) {
      const option = h('button', { className: 'suggest-item', type: 'button' })
      option.innerHTML = svgIcon('search', 15)
      option.appendChild(document.createTextNode(item))
      option.addEventListener('mousedown', (event) => event.preventDefault())
      option.addEventListener('click', () => {
        input.value = item
        goToSearch(item)
      })
      suggestions.appendChild(option)
    }
  }

  const debouncedSuggest = debounce((q: string) => {
    getAPI()
      .searchSuggestions(q)
      .then((list) => {
        if (input.value.trim() === q) showSuggestions(list)
      })
      .catch(() => closeSuggestions())
  }, 220)

  input.addEventListener('input', () => {
    const q = input.value.trim()
    if (q.length >= SUGGEST_MIN) debouncedSuggest(q)
    else closeSuggestions()
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && items.length > 0) {
      event.preventDefault()
      activeIndex = (activeIndex + 1) % items.length
      highlight()
      return
    }
    if (event.key === 'ArrowUp' && items.length > 0) {
      event.preventDefault()
      activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1
      highlight()
      return
    }
    if (event.key === 'Enter') {
      const picked = activeIndex >= 0 ? items[activeIndex] : input.value.trim()
      if (!picked) return
      input.value = picked
      goToSearch(picked)
      return
    }
    if (event.key === 'Escape') closeSuggestions()
  })

  input.addEventListener('blur', () => {
    window.setTimeout(closeSuggestions, 150)
  })

  document.addEventListener('click', (event) => {
    if (!searchWrap.contains(event.target as Node)) closeSuggestions()
  })

  const accountLink = h('a', { className: 'header-account', href: '#/settings', title: 'Tu cuenta' })
  header.appendChild(accountLink)

  const renderAccount = (state: AccountState): void => {
    accountLink.replaceChildren()
    if (state.status !== 'ready' || !state.user) {
      accountLink.setAttribute('href', '#/settings')
      accountLink.title = state.status === 'unknown' ? 'Comprobando sesión…' : 'Inicia sesión'
      const placeholder = h('span', { className: 'account-placeholder' })
      placeholder.innerHTML = svgIcon('user', 16)
      accountLink.appendChild(placeholder)
      return
    }
    accountLink.setAttribute('href', '#/likes')
    accountLink.title = `${state.user.username} — tus favoritos`
    accountLink.appendChild(avatarEl(state.user.avatar_url, state.user.username, 30))
  }

  const settingsBtn = h('a', { className: 'icon-btn', href: '#/settings', title: 'Ajustes' })
  settingsBtn.innerHTML = svgIcon('settings', 19)
  header.appendChild(settingsBtn)

  const syncSearchInput = (): void => {
    const route = currentRoute()
    if (route.view !== 'search') return
    const q = route.params.q ?? ''
    if (document.activeElement !== input && input.value !== q) input.value = q
  }

  let attached = false
  let unsub: (() => void) | null = null
  unsub = accountStore.subscribe((state) => {
    if (attached && !header.isConnected) {
      unsub?.()
      return
    }
    attached = true
    renderAccount(state)
  })

  setActiveNav()
  syncSearchInput()
  window.addEventListener('hashchange', () => {
    setActiveNav()
    syncSearchInput()
  })

  return header
}
