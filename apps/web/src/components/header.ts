import { debounce } from '../core/utils'
import { navigate } from '../core/router'
import { getAPI } from '../api'
import { h, svgIcon } from '../ui/el'

const NAV_ITEMS = [
  { path: '/', label: 'Inicio', icon: 'home' },
  { path: '/charts', label: 'Charts', icon: 'chart' },
  { path: '/likes', label: 'Favoritos', icon: 'heart' },
  { path: '/queue', label: 'Cola', icon: 'queue' },
]

let headerEl: HTMLElement | null = null

function setActiveNav(): void {
  if (!headerEl) return
  const hash = window.location.hash.replace(/^#/, '') || '/'
  const active = hash === '/' ? '/' : `/${hash.split('/')[1]}`
  headerEl.querySelectorAll<HTMLElement>('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.path === active)
  })
}

export function renderHeader(): HTMLElement {
  headerEl = h('header', { className: 'app-header' })

  const logo = h(
    'a',
    {
      className: 'logo',
      href: '#/',
      title: 'Soundlite — inicio',
      style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
    },
  )
  logo.innerHTML = `<svg width="26" height="26" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5500"/><stop offset="1" stop-color="#ff2d78"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="none"/><g fill="none" stroke="url(#lg)" stroke-width="52" stroke-linecap="round"><path d="M96 296v64"/><path d="M156 232v128"/><path d="M216 176v184"/><path d="M276 264v96"/><path d="M336 208v152"/><path d="M396 256v104"/></g></svg><span style="font-weight:800;letter-spacing:-0.03em;font-size:18px">Soundlite</span>`
  headerEl.appendChild(logo)

  const nav = h('nav', { className: 'nav', style: { display: 'flex', gap: '2px' } })
  for (const item of NAV_ITEMS) {
    const btn = h(
      'a',
      {
        className: 'nav-item',
        dataset: { path: item.path },
        href: `#${item.path}`,
        style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '999px', fontSize: '14px', fontWeight: 600, color: 'var(--text2)', transition: 'background .15s,color .15s' },
      },
    )
    btn.innerHTML = svgIcon(item.icon, 16)
    btn.appendChild(document.createTextNode(item.label))
    nav.appendChild(btn)
  }
  headerEl.appendChild(nav)

  const searchBox = h('div', { className: 'search-input' })
  searchBox.innerHTML = svgIcon('search', 16)
  const input = h('input', {
    type: 'text',
    placeholder: 'Busca tracks, artistas, playlists…',
    autocomplete: 'off',
    spellcheck: false,
  }) as HTMLInputElement
  searchBox.appendChild(input)
  headerEl.appendChild(searchBox)

  const suggestions = h('div', {
    className: 'search-suggest',
    style: { position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden', display: 'none', zIndex: 60 },
  })
  searchBox.style.position = 'relative'
  searchBox.appendChild(suggestions)


  const closeSuggestions = () => {
    suggestions.style.display = 'none'
  }

  const showSuggestions = (items: string[]) => {
    suggestions.replaceChildren()
    if (items.length === 0) {
      suggestions.style.display = 'none'
      return
    }
    for (const item of items) {
      const opt = h(
        'button',
        {
          className: 'suggest-item',
          style: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '10px 14px', textAlign: 'left', fontSize: '14px', color: 'var(--text2)' },
        },
      )
      opt.innerHTML = svgIcon('search', 15)
      opt.appendChild(document.createTextNode(item))
      opt.addEventListener('click', () => {
        input.value = item
        closeSuggestions()
        goToSearch(item)
      })
      opt.addEventListener('mouseenter', () => opt.style.background = 'var(--surface2)')
      opt.addEventListener('mouseleave', () => opt.style.background = '')
      suggestions.appendChild(opt)
    }
    suggestions.style.display = 'block'
  }

  const debouncedSuggest = debounce(async (q: string) => {
    if (!q.trim()) {
      closeSuggestions()
      return
    }
    try {
      const items = await getAPI().searchSuggestions(q)
      if (input.value.trim() === q) showSuggestions(items)
    } catch {
      closeSuggestions()
    }
  }, 220)

  const goToSearch = (q: string) => {
    closeSuggestions()
    navigate(`/search?q=${encodeURIComponent(q)}`)
    input.blur()
  }

  input.addEventListener('input', () => {
    if (input.value.length >= 2) void debouncedSuggest(input.value.trim())
    else closeSuggestions()
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const q = input.value.trim()
      if (q) goToSearch(q)
    }
    if (event.key === 'Escape') closeSuggestions()
  })

  document.addEventListener('click', (event) => {
    if (!searchBox.contains(event.target as Node)) closeSuggestions()
  })

  const settingsBtn = h('a', { className: 'icon-btn', href: '#/settings', title: 'Ajustes' })
  settingsBtn.innerHTML = svgIcon('settings', 19)
  headerEl.appendChild(settingsBtn)

  setActiveNav()
  window.addEventListener('hashchange', setActiveNav)

  return headerEl
}
