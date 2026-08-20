import { desktopInvoke, isDesktop } from '../api/auth'
import { accountStore, allowGuest, guestAllowed, refreshAccount, type AccountState } from '../core/account'
import { h, svgIcon } from '../ui/el'
import { appLogo, appLogoLive } from '../ui/logo'
import { toast, toastErr } from '../ui/toast'
import { t } from '../core/i18n.ts'

const SLOW_CHECK_MS = 3500

export function renderLoginGate(): HTMLElement {
  const gate = h('div', { className: 'login-gate', hidden: true })
  if (isDesktop()) gate.setAttribute('data-tauri-drag-region', '')

  const check = h('div', { className: 'login-check' })
  const checkLogo = h('button', {
    className: 'logo-fillable',
    type: 'button',
    title: t('Volver a comprobar la sesión'),
    'aria-label': t('Volver a comprobar la sesión'),
  })
  checkLogo.innerHTML = `<span class="logo-base">${appLogoLive(58)}</span><span class="logo-ink">${appLogoLive(58)}</span>`
  const checkWord = h('p', { className: 'check-word' }, t('Comprobando tu sesión'))
  const checkRail = h('div', { className: 'check-rail' }, [h('span')])
  const checkNote = h('p', { className: 'text-faint check-note' }, t('Un segundo: miramos si ya tienes sesión en este dispositivo.'))
  const checkEscape = h('button', { className: 'btn btn-ghost btn-sm check-escape' }, t('Explorar sin cuenta'))
  checkEscape.hidden = true
  check.append(checkLogo, checkWord, checkRail, checkNote, checkEscape)

  let slowTimer: ReturnType<typeof setTimeout> | null = null

  function stopSlowTimer(): void {
    if (slowTimer) {
      clearTimeout(slowTimer)
      slowTimer = null
    }
  }

  function startSlowTimer(): void {
    if (slowTimer) return
    slowTimer = setTimeout(() => {
      slowTimer = null
      checkNote.textContent = t('Está tardando más de lo normal. Puedes entrar como invitado y volver a intentarlo luego.')
      checkEscape.hidden = false
    }, SLOW_CHECK_MS)
  }

  checkLogo.addEventListener('click', () => {
    checkNote.textContent = t('Volviendo a comprobar…')
    void refreshAccount()
  })

  checkEscape.addEventListener('click', () => {
    allowGuest()
    toast(t('Modo invitado: tus favoritos se guardan solo en este dispositivo'))
  })

  const card = h('div', { className: 'login-card card card-pad' })
  const logo = document.createElement('div')
  logo.className = 'login-logo'
  logo.innerHTML = appLogo(54)
  card.appendChild(logo)
  card.appendChild(h('h1', { className: 'login-title' }, t('SoundClear')))
  card.appendChild(h('p', { className: 'text-dim' }, t('Cliente libre para SoundCloud. Ligero y rápido.')))

  const statusText = h('p', { className: 'text-faint login-status' })
  card.appendChild(statusText)

  const actions = h('div', { className: 'login-actions' })
  card.appendChild(actions)

  card.appendChild(
    h(
      'p',
      { className: 'text-faint login-disclaimer' },
      t('Proyecto independiente de código abierto, sin afiliación ni respaldo de SoundCloud. SoundCloud es una marca de SoundCloud Global Limited & Co. KG; sus marcas, logos y contenido pertenecen a sus dueños.'),
    ),
  )

  let poll: ReturnType<typeof setInterval> | null = null

  function stopPoll(): void {
    if (poll) {
      clearInterval(poll)
      poll = null
    }
  }

  function startPoll(): void {
    if (poll || !isDesktop()) return
    poll = setInterval(() => {
      void refreshAccount()
    }, 2500)
  }

  let previousStatus: AccountState['status'] = 'unknown'
  let lastKey = ''

  function render(state: AccountState): void {
    const key = `${state.status}|${state.user?.id ?? ''}`
    if (key === lastKey) return
    lastKey = key

    if (state.status === 'ready' && previousStatus !== 'ready') {
      if (state.user) toast(`¡Bienvenido, ${state.user.username}!`, 'ok')
      if (isDesktop()) {
        desktopInvoke('close_login_windows').catch(() => {})
      }
    }
    previousStatus = state.status

    if (state.status === 'unknown') {
      gate.dataset.phase = 'checking'
      check.hidden = false
      card.hidden = true
      startSlowTimer()
      return
    }
    stopSlowTimer()
    gate.dataset.phase = 'choose'
    check.hidden = true
    card.hidden = false
    actions.replaceChildren()
    statusText.textContent = ''

    const guestBtn = h('button', { className: 'btn btn-ghost login-guest' }, t('Explorar sin cuenta'))
    guestBtn.addEventListener('click', () => {
      allowGuest()
      toast(t('Modo invitado: tus favoritos se guardan solo en este dispositivo'))
    })

    if (isDesktop()) {
      const btn = h('button', { className: 'btn btn-primary login-btn' })
      btn.innerHTML = `${svgIcon('headphone', 18)} Iniciar sesión con SoundCloud`
      btn.addEventListener('click', () => {
        void desktopInvoke('login_window').catch(() => toastErr(t('No se pudo abrir la ventana de sesión')))
      })
      actions.appendChild(btn)
      actions.appendChild(
        h(
          'p',
          { className: 'text-faint' },
          t('Usa tu cuenta de SoundCloud · la sesión queda guardada en este dispositivo'),
        ),
      )
      actions.appendChild(
        h(
          'p',
          { className: 'text-faint' },
          t('Tras entrar en la ventana, si la app no te reconoce pulsa «He iniciado sesión · Continuar» dentro de ella.'),
        ),
      )
      const reset = h(
        'a',
        { className: 'text-faint link-hover', href: '#' },
        t('¿No entra? Cierra la sesión anterior de SoundCloud y reintenta'),
      )
      reset.addEventListener('click', (event) => {
        event.preventDefault()
        desktopInvoke('logout_window')
          .then(() => toast(t('Reinicia la sesión y vuelve a pulsar «Iniciar sesión con SoundCloud»'), 'ok'))
          .catch(() => toastErr(t('No se pudo abrir la ventana de sesión')))
      })
      actions.appendChild(reset)
      actions.appendChild(
        h(
          'a',
          { className: 'text-faint link-hover', href: 'https://soundcloud.com', target: '_blank', rel: 'noopener' },
          t('¿No tienes cuenta? Crea una en soundcloud.com'),
        ),
      )
      actions.appendChild(guestBtn)
    } else {
      actions.appendChild(
        h(
          'p',
          { className: 'text-dim' },
          t('La sesión con tu cuenta de SoundCloud solo está disponible en la app de escritorio de SoundClear.'),
        ),
      )
      const download = h(
        'a',
        { className: 'btn btn-primary', href: 'https://github.com/gaboxdev/soundcloudapp', target: '_blank', rel: 'noopener' },
      )
      download.innerHTML = `${svgIcon('github', 18)} Obtener la app de escritorio`
      actions.appendChild(download)
      actions.appendChild(guestBtn)
      actions.appendChild(
        h(
          'p',
          { className: 'text-faint' },
          t('Sin cuenta puedes buscar, escuchar y guardar favoritos en este navegador; para sincronizarlos con SoundCloud hace falta la app de escritorio.'),
        ),
      )
    }
  }

  accountStore.subscribe((state) => {
    const ready = state.status === 'ready'
    const open = !ready && !guestAllowed()
    if (gate.hidden === open) gate.hidden = !open
    document.documentElement.classList.toggle('gate-open', open)
    if (ready || !open) {
      stopPoll()
      stopSlowTimer()
    } else if (state.status === 'guest') {
      startPoll()
    }
    render(state)
  })

  gate.append(check, card)
  return gate
}
