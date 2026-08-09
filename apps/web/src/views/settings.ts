import { register } from '../core/router'
import { getSettings, updateSettings, type Theme } from '../core/settings'
import { saveHistory, saveLikes } from '../core/library'
import { player } from '../player/player'
import { resetAPI } from '../api'
import { h, iconEl, svgIcon } from '../ui/el'
import { toast } from '../ui/toast'
import './views.css'

function settingsCard(title: string, children: HTMLElement[]): HTMLElement {
  const card = h('div', { className: 'card card-pad settings-card' })
  card.appendChild(h('h2', { className: 'h-section' }, title))
  children.forEach((child) => card.appendChild(child))
  return card
}

register('settings', (_route, container) => {
  document.title = 'Ajustes — Soundlite'

  const page = h('div', { className: 'view-page' })
  page.appendChild(h('h1', { className: 'h-display' }, 'Ajustes'))
  page.appendChild(h('p', { className: 'text-dim' }, 'Personaliza tu experiencia en Soundlite.'))
  container.appendChild(page)

  const themeRow = h('div', { className: 'chip-row' })
  const themeValues: { value: Theme; label: string }[] = [
    { value: 'dark', label: 'Oscuro' },
    { value: 'light', label: 'Claro' },
    { value: 'system', label: 'Sistema' },
  ]
  const themeChips = themeValues.map(({ value, label }) =>
    h('button', { className: 'chip', dataset: { theme: value } }, label),
  )
  themeChips.forEach((chip) => themeRow.appendChild(chip))
  const refreshTheme = (): void => {
    const current = getSettings().theme
    themeChips.forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.theme === current)
    })
  }
  refreshTheme()
  themeChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      updateSettings({ theme: chip.dataset.theme as Theme })
      refreshTheme()
    })
  })
  page.appendChild(settingsCard('Tema', [themeRow]))

  const volumeRow = h('div', { className: 'vol-row' })
  const volumeSlider = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
  }) as HTMLInputElement
  const volumeLabel = h('span', { className: 'text-faint vol-label' })
  volumeRow.appendChild(volumeSlider)
  volumeRow.appendChild(volumeLabel)
  const syncVolume = (value: number): void => {
    volumeSlider.value = String(value)
    volumeLabel.textContent = `${Math.round(value * 100)}%`
  }
  syncVolume(player.store.get().volume)
  volumeSlider.addEventListener('input', () => player.setVolume(parseFloat(volumeSlider.value)))
  page.appendChild(settingsCard('Volumen', [volumeRow]))

  const proxyField = h('div', { className: 'field' })
  proxyField.appendChild(h('label', { className: 'field-label' }, 'URL base del proxy'))
  const proxyInput = h('input', {
    className: 'input',
    type: 'url',
    placeholder: 'https://proxy.ejemplo.com',
    value: getSettings().apiBase,
  }) as HTMLInputElement
  const proxyHint = h('p', { className: 'text-faint' }, 'Si alojas tu propio proxy, indica aquí su URL base.')
  proxyField.appendChild(proxyInput)
  proxyField.appendChild(proxyHint)
  const proxyActions = h('div', { className: 'proxy-actions' })
  const saveProxyBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Guardar y recargar')
  saveProxyBtn.addEventListener('click', () => {
    updateSettings({ apiBase: proxyInput.value.trim() })
    resetAPI()
    location.reload()
  })
  proxyActions.appendChild(saveProxyBtn)
  page.appendChild(settingsCard('Proxy (avanzado)', [proxyField, proxyActions]))

  const dataActions = h('div', { className: 'data-actions' })
  const clearDataBtn = h('button', { className: 'btn btn-danger btn-sm' }, 'Borrar favoritos e historial')
  clearDataBtn.addEventListener('click', () => {
    player.store.set({ likes: [], history: [], isLiked: false })
    saveLikes([])
    saveHistory([])
    toast('Favoritos e historial borrados', 'ok')
  })
  const wipeBtn = h('button', { className: 'btn btn-danger btn-sm' }, 'Borrar toda la app')
  wipeBtn.addEventListener('click', () => {
    localStorage.clear()
    location.reload()
  })
  dataActions.appendChild(clearDataBtn)
  dataActions.appendChild(wipeBtn)
  page.appendChild(settingsCard('Datos', [dataActions]))

  const shortcuts: [string, string][] = [
    ['Espacio', 'Reproducir / pausar'],
    ['← / →', 'Saltar ±5 segundos'],
    ['N', 'Siguiente'],
    ['P', 'Anterior'],
    ['M', 'Silenciar'],
  ]
  const shortcutList = h('div', { className: 'shortcut-list' })
  shortcuts.forEach(([key, label]) => {
    const row = h('div', { className: 'shortcut-row' })
    row.appendChild(h('kbd', { className: 'kbd' }, key))
    row.appendChild(h('span', { className: 'text-dim' }, label))
    shortcutList.appendChild(row)
  })
  page.appendChild(settingsCard('Atajos de teclado', [shortcutList]))

  const aboutHead = h('div', { className: 'about-head' })
  const aboutLogo = h('span', { className: 'about-logo' })
  aboutLogo.innerHTML = svgIcon('waves', 24)
  aboutHead.appendChild(aboutLogo)
  aboutHead.appendChild(h('span', { className: 'about-title' }, 'Soundlite v0.1.0'))
  const aboutDesc = h(
    'p',
    { className: 'text-dim' },
    'Cliente de SoundCloud súper ligero y open source — no es un wrapper de la web.',
  )
  const ghLink = h(
    'a',
    { className: 'btn btn-ghost btn-sm', href: 'https://github.com/gaboxdev/soundcloudapp', target: '_blank', rel: 'noopener' },
    [iconEl('github', 16), 'Código fuente'],
  )
  const aboutActions = h('div', { className: 'about-actions' })
  aboutActions.appendChild(ghLink)
  const disclaimer = h(
    'p',
    { className: 'text-faint about-note' },
    'Soundlite no está afiliado a SoundCloud. SoundCloud y sus marcas pertenecen a sus respectivos dueños.',
  )
  const gift = h('p', { className: 'text-faint about-note' }, 'Regalo para la comunidad de SoundCloud')
  page.appendChild(settingsCard('Acerca de', [aboutHead, aboutDesc, aboutActions, disclaimer, gift]))

  const unsub = player.store.subscribe((state) => {
    if (!container.isConnected) {
      unsub()
      return
    }
    syncVolume(state.volume)
  })
})
