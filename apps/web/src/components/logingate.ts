import { desktopInvoke, isDesktop } from '../api/auth'
import { accountStore, refreshAccount, type AccountState } from '../core/account'
import { h, svgIcon } from '../ui/el'
import { toast, toastErr } from '../ui/toast'

const LOGO = `<svg width="54" height="54" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="lg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5500"/><stop offset="1" stop-color="#ff2d78"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="none"/><g fill="none" stroke="url(#lg2)" stroke-width="52" stroke-linecap="round"><path d="M96 296v64"/><path d="M156 232v128"/><path d="M216 176v184"/><path d="M276 264v96"/><path d="M336 208v152"/><path d="M396 256v104"/></g></svg>`

export function renderLoginGate(): HTMLElement {
  const gate = h('div', { className: 'login-gate', hidden: true })

  const card = h('div', { className: 'login-card card card-pad' })
  const logo = document.createElement('div')
  logo.className = 'login-logo'
  logo.innerHTML = LOGO
  card.appendChild(logo)
  card.appendChild(h('h1', { className: 'login-title' }, 'Soundlite'))
  card.appendChild(h('p', { className: 'text-dim' }, 'Tu música de SoundCloud, ligera y rápida.'))

  const statusText = h('p', { className: 'text-faint login-status' })
  card.appendChild(statusText)

  const actions = h('div', { className: 'login-actions' })
  card.appendChild(actions)

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

  function render(state: AccountState): void {
    if (state.status === 'ready' && previousStatus !== 'ready' && state.user) {
      toast(`¡Bienvenido, ${state.user.username}!`, 'ok')
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
    gate.hidden = state.status === 'ready'
    if (state.status === 'ready') {
      stopPoll()
    } else if (state.status === 'guest') {
      startPoll()
    }
    render(state)
  })

  gate.appendChild(card)
  return gate
}
