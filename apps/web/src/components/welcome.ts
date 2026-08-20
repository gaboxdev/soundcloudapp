import {
  getSettings,
  updateSettings,
  type Accent,
  type Density,
  type Glass,
  type IconStyle,
  type NavLabels,
  type Theme,
} from '../core/settings'
import { toneTokens } from '../core/accent'
import { h, svgIcon } from '../ui/el'
import { appLogo } from '../ui/logo'
import '../styles/welcome.css'
import { t } from '../core/i18n.ts'

interface Choice {
  label: string
  hint: string
  sample: HTMLElement
  isActive: () => boolean
  apply: () => void
}

interface Group {
  label: string
  choices: Choice[]
}

interface Step {
  key: string
  title: string
  lead: string
  groups: Group[]
  extra?: HTMLElement
  sync?: () => void
}

const ACCENT_HEX: Record<string, string> = {
  violeta: '#7857ff',
  cian: '#0f8097',
  ambar: '#a66407',
  verde: '#16864e',
  rosa: '#de1b6d',
  soundcloud: '#ff5500',
}

let openTour: HTMLElement | null = null

export function welcomePending(): boolean {
  return !getSettings().onboarded
}

function swatch(background: string, className = ''): HTMLElement {
  const dot = h('span', { className: `tour-swatch${className ? ` ${className}` : ''}` })
  dot.style.background = background
  return dot
}

function glassSample(level: Glass): HTMLElement {
  const box = h('span', { className: `tour-sample tour-sample-glass tour-glass-${level}` })
  box.append(h('i'), h('i'))
  return box
}

function densitySample(density: Density): HTMLElement {
  const box = h('span', { className: `tour-sample tour-sample-rows tour-rows-${density}` })
  for (let index = 0; index < (density === 'compacta' ? 4 : 3); index += 1) box.appendChild(h('i'))
  return box
}

function navSample(mode: NavLabels): HTMLElement {
  const box = h('span', { className: 'tour-sample tour-sample-nav' })
  for (const icon of ['home', 'chart', 'heart']) {
    const item = h('span', { className: 'tour-navchip' })
    item.innerHTML = svgIcon(icon, 13)
    if (mode === 'texto') item.appendChild(h('i'))
    box.appendChild(item)
  }
  return box
}

function iconSample(style: IconStyle): HTMLElement {
  const box = h('span', { className: `tour-sample tour-sample-icon tour-icon-${style}` })
  const mark = h('span', { className: 'tour-iconmark' })
  mark.innerHTML = svgIcon('heart', 17)
  box.append(mark, h('i'))
  return box
}

function toggleSample(on: boolean): HTMLElement {
  const box = h('span', { className: 'tour-sample tour-sample-history' })
  if (on) {
    for (const icon of ['back', 'forward']) {
      const item = h('span', { className: 'tour-navchip' })
      item.innerHTML = svgIcon(icon, 13)
      box.appendChild(item)
    }
    return box
  }
  const item = h('span', { className: 'tour-navchip' })
  item.innerHTML = svgIcon('close', 13)
  box.appendChild(item)
  return box
}

function themeSample(theme: Theme): HTMLElement {
  return h('span', { className: `tour-sample tour-sample-theme tour-theme-${theme}` }, [h('i'), h('i')])
}

function buildPreview(): HTMLElement {
  const preview = h('div', { className: 'tour-preview', 'aria-hidden': 'true' })
  const frame = h('div', { className: 'tour-window card' })

  const head = h('div', { className: 'tour-window-head' })
  const logo = h('span', { className: 'logo' })
  const mark = h('span', { className: 'logo-mark' })
  mark.innerHTML = appLogo(19)
  logo.append(mark, h('span', { className: 'logo-name' }, t('SoundClear')))
  const nav = h('span', { className: 'nav tour-window-nav' })
  const items: [string, string, boolean][] = [
    ['home', t('Inicio'), false],
    ['chart', t('Charts'), false],
    ['heart', t('Favoritos'), true],
    ['queue', t('Cola'), false],
  ]
  for (const [icon, label, active] of items) {
    const item = h('span', { className: `nav-item${active ? ' active' : ''}` })
    item.innerHTML = svgIcon(icon, 15)
    item.appendChild(h('span', { className: 'nav-label' }, label))
    nav.appendChild(item)
  }
  const history = h('span', { className: 'history-nav tour-window-history' })
  for (const icon of ['back', 'forward']) {
    const btn = h('span', { className: 'icon-btn' })
    btn.innerHTML = svgIcon(icon, 15)
    history.appendChild(btn)
  }
  head.append(logo, history, nav)

  const body = h('div', { className: 'tour-window-body' })
  const heading = h('span', { className: 'h-display h-icon tour-window-title' })
  const headingIcon = h('span', { className: 'title-icon' })
  headingIcon.innerHTML = svgIcon('heart', 20)
  heading.append(headingIcon, h('span', null, t('Favoritos')))
  body.appendChild(heading)
  const titles = [t('Midnight Drive'), t('Sunset Tape'), t('Neon Rain')]
  const artists = [t('Kova'), t('Lumen'), t('Rueda')]
  for (let index = 0; index < 3; index += 1) {
    const row = h('span', { className: `tour-window-row${index === 0 ? ' playing' : ''}` })
    const art = h('span', { className: 'tour-window-art' })
    if (index === 0) art.innerHTML = svgIcon('play', 14)
    const meta = h('span', { className: 'tour-window-meta' }, [
      h('span', { className: 'tour-window-name' }, titles[index]),
      h('span', { className: 'tour-window-artist' }, artists[index]),
    ])
    const heart = h('span', { className: `tour-window-heart${index === 0 ? ' on' : ''}` })
    heart.innerHTML = svgIcon(index === 0 ? 'heartFill' : 'heart', 14)
    row.append(art, meta, heart)
    body.appendChild(row)
  }

  const foot = h('span', { className: 'tour-window-player' })
  const footArt = h('span', { className: 'tour-window-art small' })
  const footMeta = h('span', { className: 'tour-window-meta' }, [
    h('span', { className: 'tour-window-name' }, t('Midnight Drive')),
    h('span', { className: 'tour-window-artist' }, t('Kova')),
  ])
  const play = h('span', { className: 'tour-window-play' })
  play.innerHTML = svgIcon('play', 13)
  const wave = h('span', { className: 'tour-window-wave' })
  const heights = [38, 62, 84, 54, 92, 70, 46, 78, 58, 88, 42, 66, 80, 50, 72, 36]
  heights.forEach((height, index) => {
    const bar = h('i')
    bar.style.height = `${height}%`
    if (index < 6) bar.classList.add('on')
    wave.appendChild(bar)
  })
  foot.append(footArt, footMeta, play, wave)

  frame.append(head, body, foot)
  preview.append(frame, h('p', { className: 'text-faint tour-preview-note' }, t('Vista previa en vivo · todo se aplica al instante')))
  return preview
}

export function openWelcome(): void {
  if (openTour) return

  const root = h('div', {
    className: 'tour',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('Personaliza SoundClear'),
  })
  openTour = root

  const panel = h('div', { className: 'tour-panel' })
  const kicker = h('p', { className: 'tour-kicker' })
  const title = h('h2', { className: 'tour-title' })
  const lead = h('p', { className: 'tour-lead text-dim' })
  const bodyWrap = h('div', { className: 'tour-body' })
  const dots = h('div', { className: 'tour-dots' })
  const backBtn = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, t('Atrás'))
  const nextBtn = h('button', { className: 'btn btn-primary', type: 'button' })
  const hint = h('p', { className: 'text-faint tour-hint' })
  const foot = h('div', { className: 'tour-foot' }, [dots, h('div', { className: 'tour-foot-btns' }, [backBtn, nextBtn])])
  panel.append(kicker, title, lead, bodyWrap, hint, foot)

  const shell = h('div', { className: 'tour-shell' }, [buildPreview(), panel])
  root.appendChild(shell)

  const touched = new Set<string>()
  let index = 0
  let cards: { card: HTMLElement; choice: Choice }[] = []

  const themeChoice = (value: Theme, label: string, hintText: string): Choice => ({
    label,
    hint: hintText,
    sample: themeSample(value),
    isActive: () => getSettings().theme === value,
    apply: () => updateSettings({ theme: value }),
  })

  const accentChoice = (value: Accent, label: string, hintText: string): Choice => ({
    label,
    hint: hintText,
    sample: swatch(value === 'tono' ? toneTokens(getSettings().accentHue).accent : ACCENT_HEX[value], value === 'tono' ? 'tour-swatch-tono' : ''),
    isActive: () => getSettings().accent === value,
    apply: () => updateSettings({ accent: value }),
  })

  const glassChoice = (value: Glass, label: string, hintText: string): Choice => ({
    label,
    hint: hintText,
    sample: glassSample(value),
    isActive: () => getSettings().glass === value,
    apply: () => updateSettings({ glass: value }),
  })

  const densityChoice = (value: Density, label: string, hintText: string): Choice => ({
    label,
    hint: hintText,
    sample: densitySample(value),
    isActive: () => getSettings().density === value,
    apply: () => updateSettings({ density: value }),
  })

  const navChoice = (value: NavLabels, label: string, hintText: string): Choice => ({
    label,
    hint: hintText,
    sample: navSample(value),
    isActive: () => getSettings().navLabels === value,
    apply: () => updateSettings({ navLabels: value }),
  })

  const iconChoice = (value: IconStyle, label: string, hintText: string): Choice => ({
    label,
    hint: hintText,
    sample: iconSample(value),
    isActive: () => getSettings().iconStyle === value,
    apply: () => updateSettings({ iconStyle: value }),
  })

  const historyChoice = (value: boolean, label: string, hintText: string): Choice => ({
    label,
    hint: hintText,
    sample: toggleSample(value),
    isActive: () => getSettings().historyNav === value,
    apply: () => updateSettings({ historyNav: value }),
  })

  const toneSwatch = h('span', { className: 'tone-swatch' })
  const toneInput = h('input', {
    className: 'tone-range',
    type: 'range',
    min: '0',
    max: '359',
    step: '1',
    'aria-label': t('Tono del acento'),
  }) as HTMLInputElement
  const toneValue = h('span', { className: 'tone-value text-faint' })
  toneInput.style.background = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => toneTokens((i * 30) % 360).accent).join(', ')})`
  const toneExtra = h('div', { className: 'tour-extra' }, [
    h('span', { className: 'field-label' }, t('Tono libre')),
    h('div', { className: 'tone-row' }, [toneSwatch, toneInput, toneValue]),
    h(
      'p',
      { className: 'text-faint tour-extra-note' },
      t('Mueve la rueda y la app calcula el acento más vivo que sigue cumpliendo el contraste mínimo sobre cristal.'),
    ),
  ])
  const syncTone = (): void => {
    const { accent, accentHue } = getSettings()
    if (toneInput.value !== String(accentHue)) toneInput.value = String(accentHue)
    toneSwatch.style.background = toneTokens(accentHue).accent
    toneValue.textContent = `${accentHue}°`
    toneExtra.classList.toggle('tone-idle', accent !== 'tono')
    const tonoDot = bodyWrap.querySelector<HTMLElement>('.tour-swatch-tono')
    if (tonoDot) tonoDot.style.background = toneTokens(accentHue).accent
  }
  toneInput.addEventListener('input', () => {
    updateSettings({ accent: 'tono', accentHue: Number(toneInput.value) })
    touched.add('accent')
    syncStep()
  })

  const summary = h('div', { className: 'tour-summary' })

  const steps: Step[] = [
    {
      key: 'theme',
      title: t('¿Claro u oscuro?'),
      lead: t('Todo el cristal y los contrastes se recalculan al instante.'),
      groups: [
        {
          label: t('Tema'),
          choices: [
            themeChoice('dark', t('Oscuro'), t('Fondos profundos, perfecto de noche')),
            themeChoice('light', t('Claro'), t('Superficies luminosas y limpias')),
            themeChoice('system', t('Sistema'), t('Sigue al tema de tu equipo')),
          ],
        },
      ],
    },
    {
      key: 'accent',
      title: t('Tu color'),
      lead: t('El acento pinta el logo, los iconos, la onda y los botones principales.'),
      groups: [
        {
          label: t('Acento'),
          choices: [
            accentChoice('violeta', t('Violeta'), t('El de siempre en SoundClear')),
            accentChoice('soundcloud', t('Naranja SoundCloud'), t('El naranja original del servicio')),
            accentChoice('cian', t('Cian'), t('Frío y sobrio')),
            accentChoice('ambar', t('Ámbar'), t('Cálido, tipo vinilo')),
            accentChoice('verde', t('Verde'), t('Tranquilo y natural')),
            accentChoice('rosa', t('Rosa'), t('Vivo y descarado')),
            accentChoice('tono', t('Tono libre'), t('Cualquier color de la rueda')),
          ],
        },
      ],
      extra: toneExtra,
      sync: syncTone,
    },
    {
      key: 'glass',
      title: t('Cuánto cristal'),
      lead: t('La carátula de lo que suena tiñe la interfaz. Tú decides cuánto.'),
      groups: [
        {
          label: t('Cristal'),
          choices: [
            glassChoice('cristal', t('Cristal'), t('Máxima transparencia')),
            glassChoice('equilibrado', t('Equilibrado'), t('Color sin comerse el texto')),
            glassChoice('solido', t('Sólido'), t('Contraste máximo')),
          ],
        },
        {
          label: t('Densidad de las listas'),
          choices: [
            densityChoice('comoda', t('Cómoda'), t('Filas espaciadas, carátulas grandes')),
            densityChoice('compacta', t('Compacta'), t('Más tracks a la vista')),
          ],
        },
      ],
    },
    {
      key: 'nav',
      title: t('La barra de arriba'),
      lead: t('Ajusta la navegación a tu gusto: con o sin texto, con o sin flechas.'),
      groups: [
        {
          label: t('Secciones'),
          choices: [
            navChoice('iconos', t('Solo iconos'), t('Barra mínima, se entiende por el icono')),
            navChoice('texto', t('Icono y texto'), t('Con el nombre de cada sección')),
          ],
        },
        {
          label: t('Iconos de las secciones'),
          choices: [
            iconChoice('plano', t('Sin fondo'), t('Iconos limpios sobre el cristal')),
            iconChoice('insignia', t('Con insignia'), t('Icono dentro de una pastilla de cristal')),
          ],
        },
        {
          label: t('Flechas de atrás y adelante'),
          choices: [
            historyChoice(true, t('Mostrarlas'), t('Atrás y adelante siempre a mano')),
            historyChoice(false, t('Ocultarlas'), t('Gana sitio en la barra')),
          ],
        },
      ],
    },
    {
      key: 'done',
      title: t('Listo, es tuya'),
      lead: t('Guardamos esta combinación en este dispositivo. Puedes cambiarla cuando quieras en Ajustes.'),
      groups: [],
      extra: summary,
      sync: () => paintSummary(),
    },
  ]

  function paintSummary(): void {
    const settings = getSettings()
    const accentLabel =
      settings.accent === 'tono'
        ? `Tono ${settings.accentHue}°`
        : settings.accent === 'soundcloud'
          ? t('Naranja SoundCloud')
          : settings.accent.charAt(0).toUpperCase() + settings.accent.slice(1)
    const entries: [string, string][] = [
      [t('Tema'), settings.theme === 'dark' ? 'Oscuro' : settings.theme === 'light' ? 'Claro' : t('Sistema')],
      [t('Acento'), accentLabel],
      [t('Cristal'), settings.glass.charAt(0).toUpperCase() + settings.glass.slice(1)],
      [t('Densidad'), settings.density === 'comoda' ? 'Cómoda' : t('Compacta')],
      [t('Barra'), settings.navLabels === 'texto' ? 'Icono y texto' : t('Solo iconos')],
      [t('Iconos'), settings.iconStyle === 'plano' ? 'Sin fondo' : t('Con insignia')],
      [t('Flechas'), settings.historyNav ? 'Visibles' : t('Ocultas')],
    ]
    summary.replaceChildren()
    for (const [label, value] of entries) {
      summary.appendChild(h('span', { className: 'chip chip-static' }, [h('b', null, `${label}: `), value]))
    }
  }

  function syncStep(): void {
    for (const entry of cards) entry.card.classList.toggle('active', entry.choice.isActive())
    steps[index].sync?.()
    const step = steps[index]
    const needsChoice = step.groups.length > 0 && !touched.has(step.key)
    nextBtn.disabled = needsChoice
    hint.textContent = needsChoice ? 'Toca una opción para confirmarla y seguir.' : ''
  }

  function paintStep(): void {
    const step = steps[index]
    kicker.textContent = `Paso ${index + 1} de ${steps.length}`
    title.textContent = step.title
    lead.textContent = step.lead
    nextBtn.textContent = index === steps.length - 1 ? 'Empezar a escuchar' : t('Continuar')
    backBtn.hidden = index === 0
    cards = []
    bodyWrap.replaceChildren()
    for (const group of step.groups) {
      if (step.groups.length > 1) bodyWrap.appendChild(h('span', { className: 'field-label' }, group.label))
      const grid = h('div', { className: `tour-grid${group.choices.length > 3 ? ' tour-grid-wide' : ''}` })
      for (const choice of group.choices) {
        const card = h('button', { className: 'tour-card', type: 'button' })
        card.append(
          choice.sample,
          h('span', { className: 'tour-card-label' }, choice.label),
          h('span', { className: 'tour-card-hint' }, choice.hint),
        )
        card.addEventListener('click', () => {
          choice.apply()
          touched.add(step.key)
          syncStep()
        })
        cards.push({ card, choice })
        grid.appendChild(card)
      }
      bodyWrap.appendChild(grid)
    }
    if (step.extra) bodyWrap.appendChild(step.extra)
    dots.replaceChildren()
    steps.forEach((_, position) => {
      const dot = h('span', { className: `tour-dot${position === index ? ' active' : ''}${position < index ? ' done' : ''}` })
      dots.appendChild(dot)
    })
    syncStep()
    const first = bodyWrap.querySelector<HTMLElement>('.tour-card.active') ?? bodyWrap.querySelector<HTMLElement>('.tour-card')
    first?.focus()
  }

  function close(): void {
    document.removeEventListener('keydown', onKeyDown, true)
    document.documentElement.classList.remove('tour-open')
    root.remove()
    openTour = null
  }

  function finish(): void {
    updateSettings({ onboarded: true })
    close()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && getSettings().onboarded) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  backBtn.addEventListener('click', () => {
    if (index === 0) return
    index -= 1
    paintStep()
  })

  nextBtn.addEventListener('click', () => {
    if (index === steps.length - 1) {
      finish()
      return
    }
    index += 1
    paintStep()
  })

  document.addEventListener('keydown', onKeyDown, true)
  document.documentElement.classList.add('tour-open')
  document.body.appendChild(root)
  paintStep()
}
