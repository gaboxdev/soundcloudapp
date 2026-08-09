import { desktopInvoke, isDesktop } from '../api/auth'
import { accountStore, refreshAccount, type AccountState } from '../core/account'
import { h, svgIcon } from '../ui/el'
import { appLogo } from '../ui/logo'
import { toast, toastErr } from '../ui/toast'

export function renderLoginGate(): HTMLElement {
  const gate = h('div', { className: 'login-gate', hidden: true })

  const card = h('div', { className: 'login-card card card-pad' })
  const logo = document.createElement('div')
  logo.className = 'login-logo'
  logo.innerHTML = appLogo(54)
  card.appendChild(logo)
  card.appendChild(h('h1', { className: 'login-title' }, 'Soundlite'))
  card.appendChild(h('p', { className: 'text-dim' }, 'Cliente libre para SoundCloud. Ligero y rápido.'))

  const statusText = h('p', { className: 'text-faint login-status' })
  card.appendChild(statusText)

  const actions = h('div', { className: 'login-actions' })
  card.appendChild(actions)

  card.appendChild(
    h(
      'p',
      { className: 'text-faint login-disclaimer' },
      'Proyecto independiente de código abierto, sin afiliación ni respaldo de SoundCloud. SoundCloud es una marca de SoundCloud Global Limited & Co. KG; sus marcas, logos y contenido pertenecen a sus dueños.',
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

    actions.replaceChildren()
    if (state.status === 'unknown') {
      statusText.textContent = 'Comprobando sesión…'
      return
    }
    statusText.textContent = ''

    if (isDesktop()) {
      const btn = h('button', { className: 'btn btn-primary login-btn' })
      btn.innerHTML = `${svgIcon('headphone', 18)} Iniciar sesión con SoundCloud`
      btn.addEventListener('click', () => {
        void desktopInvoke('login_window').catch(() => toastErr('No se pudo abrir la ventana de sesión'))
      })
      actions.appendChild(btn)
      actions.appendChild(
        h(
          'p',
          { className: 'text-faint' },
          'Usa tu cuenta de SoundCloud · la sesión queda guardada en este dispositivo',
        ),
      )
      actions.appendChild(
        h(
          'p',
          { className: 'text-faint' },
          'Tras entrar en la ventana, si la app no te reconoce pulsa «He iniciado sesión · Continuar» dentro de ella.',
        ),
      )
      const reset = h(
        'a',
        { className: 'text-faint link-hover', href: '#' },
        '¿No entra? Cierra la sesión anterior de SoundCloud y reintenta',
      )
      reset.addEventListener('click', (event) => {
        event.preventDefault()
        desktopInvoke('logout_window')
          .then(() => toast('Reinicia la sesión y vuelve a pulsar «Iniciar sesión con SoundCloud»', 'ok'))
          .catch(() => toastErr('No se pudo abrir la ventana de sesión'))
      })
      actions.appendChild(reset)
      actions.appendChild(
        h(
          'a',
          { className: 'text-faint link-hover', href: 'https://soundcloud.com', target: '_blank', rel: 'noopener' },
          '¿No tienes cuenta? Crea una en soundcloud.com',
        ),
      )
    } else {
      actions.appendChild(
        h(
          'p',
          { className: 'text-dim' },
          'La sesión con tu cuenta de SoundCloud solo está disponible en la app de escritorio de Soundlite.',
        ),
      )
      const download = h(
        'a',
        { className: 'btn btn-primary', href: 'https://github.com/gaboxdev/soundcloudapp', target: '_blank', rel: 'noopener' },
      )
      download.innerHTML = `${svgIcon('github', 18)} Obtener la app de escritorio`
      actions.appendChild(download)
    }
  }

  accountStore.subscribe((state) => {
    const ready = state.status === 'ready'
    if (gate.hidden !== ready) gate.hidden = ready
    if (ready) {
      stopPoll()
    } else if (state.status === 'guest') {
      startPoll()
    }
    render(state)
  })

  gate.appendChild(card)
  return gate
}
