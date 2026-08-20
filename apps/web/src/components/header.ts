import type { AccountState } from '../core/account'
import { isDesktop } from '../api/auth'
import { accountStore } from '../core/account'
import { debounce } from '../core/utils'
import { currentRoute, navigate } from '../core/router'
import { getAPI } from '../api'
import { avatarEl } from '../ui/artwork'
import { h, svgIcon } from '../ui/el'
import { appLogo } from '../ui/logo'
import { skCircle } from '../ui/skeleton'
import { openPalette } from './palette'
import '../views/views.css'
import { t } from '../core/i18n.ts'

interface NavItem {
  path: string
  label: string
  icon: string
  desktopOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Inicio', icon: 'home' },
  { path: '/feed', label: 'Feed', icon: 'user', desktopOnly: true },
  { path: '/charts', label: 'Charts', icon: 'chart' },
  { path: '/explore', label: 'Explorar', icon: 'radio' },
  { path: '/likes', label: 'Favoritos', icon: 'heart' },
  { path: '/now', label: 'Ahora', icon: 'disc' },
  { path: '/queue', label: 'Cola', icon: 'queue' },
]

const SUGGEST_MIN = 2

let headerEl: HTMLElement | null = null

function setActiveNav(): void {
  if (!headerEl) return
  const hash = window.location.hash.replace(/^#/, '') || '/'
  const active = hash === '/' ? '/' : `/${hash.split('/')[1].split('?')[0]}`
  headerEl.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => {
    const on = item.dataset.path === active
    item.classList.toggle('active', on)
    if (on) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  })
}

export function renderHeader(): HTMLElement {
  const desktop = isDesktop()
  const header = h('header', { className: 'app-header' })
  if (desktop) header.setAttribute('data-tauri-drag-region', 'deep')
  headerEl = header

  const brand = h('div', { className: 'titlebar-brand' })
  if (desktop) brand.title = t('Arrastra para mover la ventana · doble clic para maximizar')
  const logo = h('a', { className: 'logo', href: '#/', title: t('SoundClear — ir al inicio'), 'aria-label': t('SoundClear — ir al inicio') })
  if (desktop) logo.setAttribute('data-tauri-drag-region', 'false')
  const logoMark = h('span', { className: 'logo-mark' })
  logoMark.innerHTML = appLogo(28)
  logo.append(logoMark, h('span', { className: 'logo-name' }, t('SoundClear')))
  brand.appendChild(logo)
  header.appendChild(brand)

  const historyNav = h('div', { className: 'history-nav' })
  const backBtn = h('button', { className: 'icon-btn', title: t('Atrás'), 'aria-label': t('Atrás') })
  backBtn.innerHTML = svgIcon('back', 18)
  backBtn.addEventListener('click', () => window.history.back())
  const forwardBtn = h('button', { className: 'icon-btn', title: t('Adelante'), 'aria-label': t('Adelante') })
  forwardBtn.innerHTML = svgIcon('forward', 18)
  forwardBtn.addEventListener('click', () => window.history.forward())
  historyNav.append(backBtn, forwardBtn)
  header.appendChild(historyNav)

  const nav = h('nav', { className: 'nav' })
  for (const item of NAV_ITEMS) {
    if (item.desktopOnly && !desktop) continue
    const btn = h('a', {
      className: 'nav-item',
      dataset: { path: item.path },
      href: `#${item.path}`,
      title: t(item.label),
    })
    btn.innerHTML = svgIcon(item.icon, 16)
    btn.appendChild(h('span', { className: 'nav-label' }, t(item.label)))
    nav.appendChild(btn)
  }
  header.appendChild(nav)

  const searchWrap = h('div', { className: 'header-search' })
  if (desktop) searchWrap.setAttribute('data-tauri-drag-region', 'false')
  const searchBox = h('div', { className: 'search-input' })
  searchBox.innerHTML = svgIcon('search', 16)
  const input = h('input', {
    type: 'text',
    placeholder: t('Busca tracks, artistas, playlists…'),
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': t('Buscar en SoundCloud'),
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

  const paletteBtn = h('button', {
    className: 'icon-btn palette-btn',
    type: 'button',
    title: t('Paleta de comandos (⌘K)'),
    'aria-label': t('Abrir la paleta de comandos'),
  })
  paletteBtn.innerHTML = svgIcon('command', 17)
  paletteBtn.addEventListener('click', () => openPalette(input.value.trim()))
  header.appendChild(paletteBtn)

  const settingsBtn = h('a', { className: 'icon-btn', href: '#/settings', title: t('Ajustes'), 'aria-label': t('Ajustes') })
  settingsBtn.innerHTML = svgIcon('settings', 19)
  header.appendChild(settingsBtn)

  const accountLink = h('a', {
    className: 'header-account',
    href: '#/settings',
    title: t('Tu cuenta'),
    'aria-label': t('Tu cuenta'),
  })
  header.appendChild(accountLink)

  const renderAccount = (state: AccountState): void => {
    accountLink.replaceChildren()
    if (state.status !== 'ready' || !state.user) {
      accountLink.classList.remove('has-photo')
      accountLink.setAttribute('href', '#/settings')
      accountLink.title = state.status === 'unknown' ? 'Comprobando sesión…' : t('Inicia sesión')
      accountLink.setAttribute('aria-label', accountLink.title)
      if (state.status === 'unknown') {
        accountLink.appendChild(skCircle(30))
        return
      }
      const placeholder = h('span', { className: 'account-placeholder' })
      placeholder.innerHTML = svgIcon('user', 16)
      accountLink.appendChild(placeholder)
      return
    }
    accountLink.classList.add('has-photo')
    accountLink.setAttribute('href', `#/user/${state.user.id}`)
    accountLink.title = `${state.user.username} — tu perfil`
    accountLink.setAttribute('aria-label', accountLink.title)
    accountLink.appendChild(avatarEl(state.user.avatar_url, state.user.username, 32))
  }

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
