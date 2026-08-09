import { register } from '../core/router'
import { getSettings, updateSettings, type Glass, type Theme, type Topbar } from '../core/settings'
import { saveHistory, saveLikes } from '../core/library'
import { player } from '../player/player'
import { resetAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { accountStore, refreshAccount, type AccountState } from '../core/account'
import { avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon } from '../ui/el'
import { appLogo } from '../ui/logo'
import { toast, toastErr } from '../ui/toast'
import './views.css'

const APP_VERSION = __APP_VERSION__
const WIPE_TIMEOUT = 6000

function settingsCard(title: string, children: HTMLElement[]): HTMLElement {
  const card = h('div', { className: 'card card-pad settings-card' })
  card.appendChild(h('h2', { className: 'h-section' }, title))
  children.forEach((child) => card.appendChild(child))
  return card
}

register('settings', (_route, container) => {
  document.title = 'Ajustes — SoundClear'

  const desktop = isDesktop()
  const page = h('div', { className: 'view-page' })
  page.appendChild(h('h1', { className: 'h-display' }, 'Ajustes'))
  page.appendChild(h('p', { className: 'text-dim' }, 'Personaliza tu experiencia en SoundClear.'))
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
  const themeHint = h('p', { className: 'text-faint' })
  const systemQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const refreshTheme = (): void => {
    const current = getSettings().theme
    themeChips.forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.theme === current)
    })
    const resolved = document.documentElement.dataset.theme === 'light' ? 'claro' : 'oscuro'
    themeHint.textContent =
      current === 'system'
        ? `Siguiendo el tema del sistema · ahora ${resolved}`
        : `Tema fijado en ${current === 'light' ? 'claro' : 'oscuro'}`
  }
  refreshTheme()
  themeChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      updateSettings({ theme: chip.dataset.theme as Theme })
      refreshTheme()
    })
  })
  const onSystemTheme = (): void => {
    if (!container.isConnected) {
      systemQuery?.removeEventListener('change', onSystemTheme)
      return
    }
    refreshTheme()
  }
  systemQuery?.addEventListener('change', onSystemTheme)
  page.appendChild(settingsCard('Tema', [themeRow, themeHint]))

  const glassRow = h('div', { className: 'chip-row' })
  const glassValues: { value: Glass; label: string; hint: string }[] = [
    { value: 'cristal', label: 'Cristal', hint: 'Máxima transparencia: la carátula se cuela por toda la interfaz.' },
    { value: 'equilibrado', label: 'Equilibrado', hint: 'El color de la carátula tiñe el cristal sin comerse el texto.' },
    { value: 'solido', label: 'Sólido', hint: 'Cristal apenas insinuado, contraste máximo.' },
  ]
  const glassChips = glassValues.map(({ value, label }) =>
    h('button', { className: 'chip', dataset: { glass: value } }, label),
  )
  glassChips.forEach((chip) => glassRow.appendChild(chip))
  const glassHint = h('p', { className: 'text-faint' })
  const refreshGlass = (): void => {
    const current = getSettings().glass
    glassChips.forEach((chip) => chip.classList.toggle('active', chip.dataset.glass === current))
    glassHint.textContent = glassValues.find((option) => option.value === current)?.hint ?? ''
  }
  refreshGlass()
  glassChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      updateSettings({ glass: chip.dataset.glass as Glass })
      refreshGlass()
    })
  })
  const reducedTransparency =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-transparency: reduce)').matches
  const glassCard = settingsCard('Cristal', [glassRow, glassHint])
  if (reducedTransparency) {
    glassCard.appendChild(
      h(
        'p',
        { className: 'text-faint' },
        'Tu sistema pide reducir transparencias, así que SoundClear está usando superficies opacas y este ajuste no se aplica.',
      ),
    )
  }
  page.appendChild(glassCard)

  const topbarRow = h('div', { className: 'chip-row' })
  const topbarValues: { value: Topbar; label: string; hint: string }[] = [
    { value: 'fija', label: 'Fija', hint: 'La barra superior siempre visible.' },
    {
      value: 'auto',
      label: 'Al desplazar',
      hint: 'La barra se esconde al bajar y vuelve al subir o al acercar el cursor al borde.',
    },
    {
      value: 'oculta',
      label: 'Oculta',
      hint: 'Sin barra: la parte de arriba queda libre y aparece al acercar el cursor al borde superior.',
    },
  ]
  const topbarChips = topbarValues.map(({ value, label }) =>
    h('button', { className: 'chip', dataset: { topbar: value } }, label),
  )
  topbarChips.forEach((chip) => topbarRow.appendChild(chip))
  const topbarHint = h('p', { className: 'text-faint' })
  const refreshTopbar = (): void => {
    const current = getSettings().topbar
    topbarChips.forEach((chip) => chip.classList.toggle('active', chip.dataset.topbar === current))
    topbarHint.textContent = topbarValues.find((option) => option.value === current)?.hint ?? ''
  }
  refreshTopbar()
  topbarChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      updateSettings({ topbar: chip.dataset.topbar as Topbar })
      refreshTopbar()
    })
  })
  const topbarCard = settingsCard('Barra superior', [topbarRow, topbarHint])
  if (desktop) {
    topbarCard.appendChild(
      h(
        'p',
        { className: 'text-faint' },
        'Con la barra escondida puedes seguir moviendo la ventana arrastrando el borde de arriba.',
      ),
    )
  }
  page.appendChild(topbarCard)

  const volumeRow = h('div', { className: 'vol-row' })
  const muteBtn = h('button', { className: 'icon-btn', title: 'Silenciar', 'aria-label': 'Silenciar' })
  const volumeSlider = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    'aria-label': 'Volumen',
  }) as HTMLInputElement
  const volumeLabel = h('span', { className: 'text-faint vol-label' })
  volumeRow.appendChild(muteBtn)
  volumeRow.appendChild(volumeSlider)
  volumeRow.appendChild(volumeLabel)
  muteBtn.addEventListener('click', () => player.toggleMute())

  let lastMuted: boolean | null = null
  const syncVolume = (volume: number, muted: boolean): void => {
    if (parseFloat(volumeSlider.value) !== volume) volumeSlider.value = String(volume)
    const label = muted ? 'Silenciado' : `${Math.round(volume * 100)}%`
    if (volumeLabel.textContent !== label) volumeLabel.textContent = label
    if (muted !== lastMuted) {
      lastMuted = muted
      muteBtn.innerHTML = svgIcon(muted ? 'mute' : 'volume', 18)
      muteBtn.classList.toggle('active', muted)
      muteBtn.title = muted ? 'Quitar silencio' : 'Silenciar'
    }
  }
  const initial = player.store.get()
  syncVolume(initial.volume, initial.muted)
  volumeSlider.addEventListener('input', () => player.setVolume(parseFloat(volumeSlider.value)))
  page.appendChild(settingsCard('Volumen', [volumeRow]))

  const accountCard = settingsCard('Cuenta', [])
  page.appendChild(accountCard)

  if (!desktop) {
    accountCard.appendChild(
      h(
        'p',
        { className: 'text-faint' },
        'Inicia sesión desde la app de escritorio para conectar tu cuenta de SoundCloud.',
      ),
    )
  } else {
    const statusRow = h('div', { className: 'account-status' })
    const actions = h('div', { className: 'data-actions' })
    accountCard.appendChild(statusRow)
    accountCard.appendChild(actions)

    const renderAccount = (state: AccountState): void => {
      statusRow.replaceChildren()
      actions.replaceChildren()
      if (state.status === 'unknown') {
        statusRow.appendChild(h('span', { className: 'text-dim' }, 'Comprobando sesión…'))
        return
      }
      if (state.status !== 'ready' || !state.user) {
        statusRow.appendChild(h('span', { className: 'text-dim' }, 'No has iniciado sesión.'))
        const loginBtn = h('button', { className: 'btn btn-primary btn-sm' }, 'Iniciar sesión con SoundCloud')
        loginBtn.addEventListener('click', () => {
          void desktopInvoke('login_window').catch(() => toastErr('No se pudo abrir la ventana de sesión'))
        })
        actions.appendChild(loginBtn)
        return
      }
      const user = state.user
      const row = h('div', { className: 'account-row' })
      row.appendChild(avatarEl(user.avatar_url, user.username, 40))
      const info = h('div', { className: 'account-info' })
      info.appendChild(h('strong', { className: 'truncate' }, `${user.username}${user.verified ? ' ✓' : ''}`))
      info.appendChild(h('span', { className: 'text-faint' }, `${user.followers_count ?? 0} seguidores`))
      row.appendChild(info)
      statusRow.appendChild(row)
      const logoutBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Cerrar sesión')
      logoutBtn.addEventListener('click', () => {
        void desktopInvoke('logout_window').catch(() => toastErr('No se pudo cerrar sesión'))
        toast('Ventana abierta para cerrar tu cuenta en SoundCloud')
        setTimeout(() => void refreshAccount(), 2500)
      })
      actions.appendChild(logoutBtn)
      actions.appendChild(h('a', { className: 'btn btn-ghost btn-sm', href: '#/likes' }, 'Ver tus likes'))
    }

    let accountAttached = false
    let unsubAccount: (() => void) | null = null
    unsubAccount = accountStore.subscribe((state) => {
      if (accountAttached && !container.isConnected) {
        unsubAccount?.()
        return
      }
      accountAttached = true
      renderAccount(state)
    })
    void refreshAccount()
  }

  if (!desktop) {
    const proxyField = h('div', { className: 'field' })
    proxyField.appendChild(h('label', { className: 'field-label' }, 'URL base del proxy'))
    const proxyInput = h('input', {
      className: 'input',
      type: 'url',
      placeholder: 'https://proxy.ejemplo.com',
      value: getSettings().apiBase,
    }) as HTMLInputElement
    const proxyHint = h('p', { className: 'text-faint' }, 'Si alojas tu propio proxy, indica aquí su URL base. Déjalo vacío para usar el proxy por defecto.')
    const proxyStatus = h('p', { className: 'proxy-status text-faint' })
    proxyField.appendChild(proxyInput)
    proxyField.appendChild(proxyHint)
    proxyField.appendChild(proxyStatus)

    const setProxyStatus = (message: string, error: boolean): void => {
      proxyStatus.textContent = message
      proxyStatus.classList.toggle('error', error)
    }

    const proxyActions = h('div', { className: 'proxy-actions' })
    const saveProxyBtn = h('button', { className: 'btn btn-ghost btn-sm' }, 'Probar y guardar')
    proxyActions.appendChild(saveProxyBtn)

    const saveProxy = async (): Promise<void> => {
      const raw = proxyInput.value.trim()
      if (!raw) {
        updateSettings({ apiBase: '' })
        resetAPI()
        location.reload()
        return
      }
      let base: string
      try {
        base = new URL(raw).toString().replace(/\/+$/, '')
      } catch {
        setProxyStatus('Esa URL no es válida. Usa un formato como https://proxy.ejemplo.com', true)
        return
      }
      saveProxyBtn.disabled = true
      setProxyStatus(`Comprobando ${base}/sl-client-id…`, false)
      try {
        const response = await fetch(`${base}/sl-client-id`)
        if (!response.ok) throw new Error(String(response.status))
        if (updateSettings({ apiBase: base }).apiBase !== base) throw new Error('rechazada')
        resetAPI()
        location.reload()
      } catch {
        saveProxyBtn.disabled = false
        setProxyStatus(`No se pudo contactar con ${base}/sl-client-id. Revisa la URL y que el proxy esté activo.`, true)
      }
    }

    saveProxyBtn.addEventListener('click', () => void saveProxy())
    page.appendChild(settingsCard('Proxy (avanzado)', [proxyField, proxyActions]))
  }

  const dataActions = h('div', { className: 'data-actions' })
  const clearDataBtn = h('button', { className: 'btn btn-danger btn-sm' }, 'Borrar historial y caché local')
  clearDataBtn.addEventListener('click', () => {
    player.store.set({ history: [] })
    saveHistory([])
    saveLikes([])
    if (desktop) {
      void player.syncAccountLikes(true)
      toast('Historial y caché local borrados', 'ok')
      return
    }
    player.store.set({ likes: [], isLiked: false })
    toast('Historial y favoritos locales borrados', 'ok')
  })

  let wipeArmed = false
  let wipeTimer: ReturnType<typeof setTimeout> | null = null
  const wipeBtn = h('button', { className: 'btn btn-danger btn-sm' }, 'Borrar toda la app')
  const disarmWipe = (): void => {
    wipeArmed = false
    wipeBtn.textContent = 'Borrar toda la app'
    wipeBtn.classList.remove('armed')
    if (wipeTimer) {
      clearTimeout(wipeTimer)
      wipeTimer = null
    }
  }
  wipeBtn.addEventListener('click', () => {
    if (!wipeArmed) {
      wipeArmed = true
      wipeBtn.textContent = '¿Seguro? Pulsa otra vez para borrarlo todo'
      wipeBtn.classList.add('armed')
      wipeTimer = setTimeout(disarmWipe, WIPE_TIMEOUT)
      return
    }
    disarmWipe()
    localStorage.clear()
    location.reload()
  })

  dataActions.appendChild(clearDataBtn)
  dataActions.appendChild(wipeBtn)
  const dataHint = h(
    'p',
    { className: 'text-faint' },
    desktop
      ? 'Tus favoritos viven en tu cuenta de SoundCloud: al borrar la caché se vuelven a sincronizar. Para quitarlos de verdad, usa el corazón de cada track.'
      : 'Se borra el historial y los favoritos guardados en este navegador.',
  )
  const wipeHint = h(
    'p',
    { className: 'text-faint' },
    '«Borrar toda la app» elimina ajustes, cola, historial y caché de este dispositivo, y recarga SoundClear.',
  )
  page.appendChild(settingsCard('Datos', [dataActions, dataHint, wipeHint]))

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
  aboutLogo.innerHTML = appLogo(42)
  aboutHead.appendChild(aboutLogo)
  aboutHead.appendChild(h('span', { className: 'about-title' }, `SoundClear v${APP_VERSION}`))
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
    'Proyecto independiente de código abierto, sin afiliación ni respaldo de SoundCloud. «SoundCloud» es una marca registrada de SoundCloud Global Limited & Co. KG; sus marcas, logos y contenido pertenecen a sus dueños.',
  )
  const gift = h('p', { className: 'text-faint about-note' }, 'Regalo para la comunidad de SoundCloud')
  page.appendChild(settingsCard('Acerca de', [aboutHead, aboutDesc, aboutActions, disclaimer, gift]))

  let attached = false
  let unsub: (() => void) | null = null
  unsub = player.store.subscribe((state) => {
    if (attached && !container.isConnected) {
      systemQuery?.removeEventListener('change', onSystemTheme)
      if (wipeTimer) clearTimeout(wipeTimer)
      unsub?.()
      return
    }
    attached = true
    syncVolume(state.volume, state.muted)
  })
})
