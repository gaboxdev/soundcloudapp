import { register } from '../core/router'
import {
  getSettings,
  nativeGlassAvailable,
  resetSettings,
  updateSettings,
  type Accent,
  type Backdrop,
  type Density,
  type Glass,
  type IconStyle,
  type NavLabels,
  type Theme,
  type Topbar,
} from '../core/settings'
import { toneTokens } from '../core/accent'
import { clearOffline, offlineStore, removeOffline } from '../core/offline'
import { shortcutStatus, toggleMiniPlayer } from '../api/native'
import { remountApp } from '../app'
import { loadLang, type LangSetting } from '../core/i18n.ts'
import { isMac, OFFLINE_BUDGETS } from '../core/settings'
import { fmtBytes } from '../core/utils'
import { cacheBytes, calls, latency, localStorageBytes } from '../core/diag'
import { CROSSFADE_MAX_S, EQ_BANDS, EQ_MAX_DB, EQ_PRESETS, flatGains, isEqFlat, presetIdFor } from '../player/audiograph'
import { saveHistory } from '../core/library'
import { SHORTCUTS } from '../core/shortcuts'
import { player } from '../player/player'
import { resetAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { accountStore, guestAllowed, refreshAccount, revokeGuest, type AccountState } from '../core/account'
import { openShortcuts } from '../components/shortcuts'
import { openWelcome } from '../components/welcome'
import { avatarEl } from '../ui/artwork'
import { h, iconEl, svgIcon, titleIcon } from '../ui/el'
import { appLogo } from '../ui/logo'
import { skAccountPreview, skStatus } from '../ui/skeleton'
import { toast, toastErr } from '../ui/toast'
import './views.css'
import { t } from '../core/i18n.ts'

const APP_VERSION = __APP_VERSION__
const WIPE_TIMEOUT = 6000

function settingsCard(icon: string, title: string, children: HTMLElement[]): HTMLElement {
  const card = h('div', { className: 'card card-pad settings-card' })
  card.appendChild(h('h2', { className: 'h-section' }, [titleIcon(icon, 18), h('span', null, title)]))
  children.forEach((child) => card.appendChild(child))
  return card
}

function optionRow<T extends string>(
  label: string,
  options: { value: T; label: string; hint?: string }[],
  read: () => T,
  write: (value: T) => void,
): HTMLElement {
  const field = h('div', { className: 'settings-field' })
  field.appendChild(h('span', { className: 'field-label' }, label))
  const row = h('div', { className: 'chip-row' })
  const hint = h('p', { className: 'text-faint settings-hint' })
  const chips = options.map((option) =>
    h('button', { className: 'chip', type: 'button', dataset: { value: option.value } }, option.label),
  )
  const refresh = (): void => {
    const current = read()
    chips.forEach((chip) => chip.classList.toggle('active', chip.dataset.value === current))
    hint.textContent = options.find((option) => option.value === current)?.hint ?? ''
    hint.hidden = hint.textContent === ''
  }
  chips.forEach((chip, index) => {
    row.appendChild(chip)
    chip.addEventListener('click', () => {
      write(options[index].value)
      refresh()
    })
  })
  refresh()
  field.addEventListener('sl:sync', refresh)
  field.append(row, hint)
  return field
}

register('settings', (_route, container) => {
  document.title = t('Ajustes — SoundClear')

  const desktop = isDesktop()
  const page = h('div', { className: 'view-page' })
  page.appendChild(h('h1', { className: 'h-display h-icon' }, [titleIcon('settings', 26), h('span', null, t('Ajustes'))]))
  page.appendChild(h('p', { className: 'text-dim' }, t('Personaliza tu experiencia en SoundClear.')))
  container.appendChild(page)

  const themeField = optionRow<Theme>(
    t('Tema'),
    [
      { value: 'dark', label: t('Oscuro') },
      { value: 'light', label: t('Claro') },
      { value: 'system', label: t('Sistema') },
    ],
    () => getSettings().theme,
    (theme) => updateSettings({ theme }),
  )
  const themeHint = h('p', { className: 'text-faint' })
  const systemQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null
  const refreshThemeHint = (): void => {
    const current = getSettings().theme
    const resolved = document.documentElement.dataset.theme === 'light' ? 'claro' : 'oscuro'
    themeHint.textContent =
      current === 'system'
        ? `Siguiendo el tema del sistema · ahora ${resolved}`
        : `Tema fijado en ${current === 'light' ? 'claro' : 'oscuro'}`
  }
  refreshThemeHint()
  themeField.addEventListener('click', () => window.setTimeout(refreshThemeHint, 0))
  const onSystemTheme = (): void => {
    if (!container.isConnected) {
      systemQuery?.removeEventListener('change', onSystemTheme)
      return
    }
    refreshThemeHint()
  }
  systemQuery?.addEventListener('change', onSystemTheme)

  const accentField = optionRow<Accent>(
    t('Acento'),
    [
      { value: 'violeta', label: t('Violeta') },
      { value: 'cian', label: t('Cian') },
      { value: 'ambar', label: t('Ámbar') },
      { value: 'verde', label: t('Verde') },
      { value: 'rosa', label: t('Rosa') },
      { value: 'soundcloud', label: t('Naranja SoundCloud') },
      { value: 'tono', label: t('Tono libre') },
    ],
    () => getSettings().accent,
    (accent) => updateSettings({ accent }),
  )

  const toneField = h('div', { className: 'settings-field tone-field' })
  toneField.appendChild(h('span', { className: 'field-label' }, t('Tono libre')))
  const toneSwatch = h('span', { className: 'tone-swatch' })
  const toneInput = h('input', {
    className: 'tone-range',
    type: 'range',
    min: '0',
    max: '359',
    step: '1',
    'aria-label': t('Tono del acento'),
  })
  const toneValue = h('span', { className: 'tone-value text-faint' })
  toneField.appendChild(h('div', { className: 'tone-row' }, [toneSwatch, toneInput, toneValue]))
  toneField.appendChild(
    h(
      'p',
      { className: 'text-faint settings-hint' },
      t('Cualquier color de la rueda. El tono elige el matiz y la app calcula el acento más vivo que sigue cumpliendo el contraste mínimo sobre cristal.'),
    ),
  )
  toneInput.style.background = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, index) => toneTokens((index * 30) % 360).accent).join(', ')})`
  const refreshTone = (): void => {
    const { accent, accentHue } = getSettings()
    toneInput.value = String(accentHue)
    toneSwatch.style.background = toneTokens(accentHue).accent
    toneValue.textContent = `${accentHue}°`
    toneField.classList.toggle('tone-idle', accent !== 'tono')
  }
  toneInput.addEventListener('input', () => {
    updateSettings({ accent: 'tono', accentHue: Number(toneInput.value) })
    refreshTone()
    accentField.dispatchEvent(new Event('sl:sync'))
  })
  accentField.addEventListener('click', () => refreshTone())
  refreshTone()

  const glassField = optionRow<Glass>(
    t('Cristal'),
    [
      { value: 'cristal', label: t('Cristal'), hint: t('Máxima transparencia: la carátula se cuela por toda la interfaz.') },
      { value: 'equilibrado', label: t('Equilibrado'), hint: t('El color de la carátula tiñe el cristal sin comerse el texto.') },
      { value: 'solido', label: t('Sólido'), hint: t('Cristal apenas insinuado, contraste máximo.') },
    ],
    () => getSettings().glass,
    (glass) => updateSettings({ glass }),
  )

  const densityField = optionRow<Density>(
    t('Densidad'),
    [
      { value: 'comoda', label: t('Cómoda'), hint: t('Filas espaciadas, carátulas grandes.') },
      { value: 'compacta', label: t('Compacta'), hint: t('Más tracks a la vista, ideal en ventanas pequeñas.') },
    ],
    () => getSettings().density,
    (density) => updateSettings({ density }),
  )

  const topbarField = optionRow<Topbar>(
    t('Barra superior'),
    [
      { value: 'fija', label: t('Fija'), hint: t('La barra superior siempre visible.') },
      { value: 'auto', label: t('Al desplazar'), hint: t('Se esconde al bajar y vuelve al subir o al acercar el cursor al borde.') },
      { value: 'oculta', label: t('Oculta'), hint: t('Sin barra: aparece al acercar el cursor al borde superior.') },
    ],
    () => getSettings().topbar,
    (topbar) => updateSettings({ topbar }),
  )

  const navField = optionRow<NavLabels>(
    t('Secciones de la barra'),
    [
      { value: 'iconos', label: t('Solo iconos'), hint: t('Barra mínima: cada sección se reconoce por su icono.') },
      { value: 'texto', label: t('Icono y texto'), hint: t('Muestra el nombre de cada sección junto al icono.') },
    ],
    () => getSettings().navLabels,
    (navLabels) => updateSettings({ navLabels }),
  )

  const iconField = optionRow<IconStyle>(
    t('Iconos de los títulos'),
    [
      { value: 'plano', label: t('Sin fondo'), hint: t('Iconos limpios sobre el cristal, como los de la barra.') },
      { value: 'insignia', label: t('Con insignia'), hint: t('Cada icono dentro de una pastilla de cristal.') },
    ],
    () => getSettings().iconStyle,
    (iconStyle) => updateSettings({ iconStyle }),
  )

  const historyField = optionRow<'si' | 'no'>(
    t('Flechas de atrás y adelante'),
    [
      { value: 'si', label: t('Mostrarlas'), hint: t('Atrás y adelante siempre a mano en la barra.') },
      { value: 'no', label: t('Ocultarlas'), hint: t('Se ganan unos píxeles; los atajos del navegador siguen funcionando.') },
    ],
    () => (getSettings().historyNav ? 'si' : 'no'),
    (value) => updateSettings({ historyNav: value === 'si' }),
  )

  const tourField = h('div', { className: 'settings-field' })
  const tourBtn = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' })
  tourBtn.innerHTML = `${svgIcon('sun', 16)}<span>Abrir la personalización guiada</span>`
  tourBtn.addEventListener('click', () => openWelcome())
  tourField.append(
    h('span', { className: 'field-label' }, t('Personalización guiada')),
    tourBtn,
    h(
      'p',
      { className: 'text-faint settings-hint' },
      t('Repite el recorrido de bienvenida con vista previa en vivo de tema, acento, cristal y barra.'),
    ),
  )

  const appearance: HTMLElement[] = [
    tourField,
    themeField,
    themeHint,
    accentField,
    toneField,
    glassField,
    densityField,
    topbarField,
    navField,
    iconField,
    historyField,
  ]

  if (desktop) {
    appearance.push(
      optionRow<Backdrop>(
        t('Fondo de la ventana'),
        [
          {
            value: 'auto',
            label: t('Automático'),
            hint: nativeGlassAvailable()
              ? t('Usa el cristal del sistema en este equipo.')
              : t('Este sistema no ofrece cristal nativo: se usa la carátula.'),
          },
          { value: 'caratula', label: t('Carátula'), hint: t('El fondo lo pinta la portada de lo que suena, difuminada.') },
          { value: 'sistema', label: t('Cristal del sistema'), hint: t('Deja ver el escritorio a través de la ventana.') },
        ],
        () => getSettings().backdrop,
        (backdrop) => updateSettings({ backdrop }),
      ),
    )
  }

  const reducedTransparency =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-transparency: reduce)').matches
  if (reducedTransparency) {
    appearance.push(
      h(
        'p',
        { className: 'text-faint' },
        t('Tu sistema pide reducir transparencias, así que SoundClear usa superficies opacas y los ajustes de cristal no se aplican.'),
      ),
    )
  }

  const langField = optionRow<LangSetting>(
    t('Idioma'),
    [
      { value: 'auto', label: t('Automático'), hint: t('Sigue el idioma de tu navegador o sistema.') },
      { value: 'es', label: 'Español' },
      { value: 'en', label: 'English' },
    ],
    () => getSettings().lang,
    (lang) => {
      updateSettings({ lang })
      void loadLang(lang).then(() => remountApp())
    },
  )
  page.appendChild(settingsCard('sun', t('Apariencia'), [...appearance, langField]))

  const volumeRow = h('div', { className: 'vol-row' })
  const muteBtn = h('button', { className: 'icon-btn', title: t('Silenciar'), 'aria-label': t('Silenciar') })
  const volumeSlider = h('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    'aria-label': t('Volumen'),
  }) as HTMLInputElement
  const volumeLabel = h('span', { className: 'text-faint vol-label' })
  volumeRow.append(muteBtn, volumeSlider, volumeLabel)
  muteBtn.addEventListener('click', () => player.toggleMute())
  volumeSlider.addEventListener('input', () => player.setVolume(parseFloat(volumeSlider.value)))

  let lastMuted: boolean | null = null
  const syncVolume = (volume: number, muted: boolean): void => {
    if (parseFloat(volumeSlider.value) !== volume) volumeSlider.value = String(volume)
    const label = muted ? 'Silenciado' : `${Math.round(volume * 100)}%`
    if (volumeLabel.textContent !== label) volumeLabel.textContent = label
    if (muted !== lastMuted) {
      lastMuted = muted
      muteBtn.innerHTML = svgIcon(muted ? 'mute' : 'volume', 18)
      muteBtn.classList.toggle('active', muted)
      muteBtn.title = muted ? 'Quitar silencio' : t('Silenciar')
    }
  }

  const rateField = h('div', { className: 'settings-field' })
  rateField.appendChild(h('span', { className: 'field-label' }, t('Velocidad de reproducción')))
  const rateRow = h('div', { className: 'chip-row' })
  const rateChips = player.rates().map((rate) => {
    const chip = h('button', { className: 'chip', type: 'button', dataset: { rate: String(rate) } }, `${rate}×`)
    chip.addEventListener('click', () => player.setRate(rate))
    rateRow.appendChild(chip)
    return chip
  })
  rateField.appendChild(rateRow)

  const autoplayField = h('div', { className: 'settings-field' })
  const autoplayToggle = h('button', { className: 'chip', type: 'button' })
  const autoplayHint = h(
    'p',
    { className: 'text-faint settings-hint' },
    t('Cuando la cola se acaba, SoundClear sigue con la radio de SoundCloud a partir del último track.'),
  )
  const refreshAutoplay = (): void => {
    const on = getSettings().autoplay
    autoplayToggle.classList.toggle('active', on)
    autoplayToggle.textContent = on ? 'Radio infinita activada' : t('Radio infinita desactivada')
    autoplayToggle.setAttribute('aria-pressed', on ? 'true' : 'false')
  }
  autoplayToggle.addEventListener('click', () => {
    updateSettings({ autoplay: !getSettings().autoplay })
    refreshAutoplay()
  })
  refreshAutoplay()
  autoplayField.append(h('span', { className: 'field-label' }, t('Al terminar la cola')), autoplayToggle, autoplayHint)

  const sleepField = h('div', { className: 'settings-field' })
  sleepField.appendChild(h('span', { className: 'field-label' }, t('Temporizador')))
  const sleepRow = h('div', { className: 'chip-row' })
  const sleepStatus = h('p', { className: 'text-faint settings-hint' })
  for (const minutes of [15, 30, 60, 120]) {
    const chip = h('button', { className: 'chip', type: 'button' }, `${minutes} min`)
    chip.addEventListener('click', () => {
      player.setSleepTimer(minutes)
      toast(`Se pausará en ${minutes} minutos`, 'ok')
    })
    sleepRow.appendChild(chip)
  }
  const sleepOff = h('button', { className: 'chip', type: 'button' }, t('Quitar'))
  sleepOff.addEventListener('click', () => {
    player.setSleepTimer(null)
    toast(t('Temporizador cancelado'))
  })
  sleepRow.appendChild(sleepOff)
  sleepField.append(sleepRow, sleepStatus)

  page.appendChild(settingsCard('play', t('Reproducción'), [volumeRow, rateField, autoplayField, sleepField]))

  const dspField = h('div', { className: 'settings-field' })
  const dspToggle = h('button', { className: 'chip', type: 'button' })
  const dspHint = h('p', { className: 'text-faint settings-hint' })
  const eqField = h('div', { className: 'settings-field' })
  eqField.appendChild(h('span', { className: 'field-label' }, t('Ecualizador')))
  const presetRow = h('div', { className: 'chip-row' })
  const eqGrid = h('div', { className: 'eq-grid' })
  const eqInputs: HTMLInputElement[] = []
  const eqValues: HTMLElement[] = []

  const readEq = (): number[] => [...getSettings().eq]
  const currentGains = (): number[] => eqInputs.map((input) => parseFloat(input.value))

  const paintEqValues = (gains: number[]): void => {
    gains.forEach((gain, index) => {
      const rounded = Math.round(gain * 10) / 10
      eqValues[index].textContent = `${rounded > 0 ? '+' : ''}${rounded} dB`
      eqValues[index].classList.toggle('text-accent', Math.abs(rounded) >= 0.1)
    })
  }

  const presetChips = EQ_PRESETS.map((preset) => {
    const chip = h('button', { className: 'chip', type: 'button', dataset: { preset: preset.id } }, preset.label)
    presetRow.appendChild(chip)
    return chip
  })

  const refreshPresets = (gains: number[]): void => {
    const active = presetIdFor(gains)
    presetChips.forEach((chip) => chip.classList.toggle('active', chip.dataset.preset === active))
  }

  EQ_BANDS.forEach((band) => {
    const row = h('div', { className: 'eq-row' })
    const label = h('span', { className: 'eq-band text-faint' }, `${band.label} Hz`)
    const input = h('input', {
      className: 'eq-range',
      type: 'range',
      min: String(-EQ_MAX_DB),
      max: String(EQ_MAX_DB),
      step: '0.5',
      'aria-label': `Banda de ${band.label} hercios`,
    }) as HTMLInputElement
    const value = h('span', { className: 'eq-value text-faint' })
    input.addEventListener('input', () => {
      const gains = currentGains()
      paintEqValues(gains)
      refreshPresets(gains)
      player.previewEq(gains)
    })
    input.addEventListener('change', () => player.setEqGains(currentGains()))
    eqInputs.push(input)
    eqValues.push(value)
    row.append(label, input, value)
    eqGrid.appendChild(row)
  })

  presetChips.forEach((chip, index) => {
    chip.addEventListener('click', () => {
      const gains = [...EQ_PRESETS[index].gains]
      player.setEqGains(gains)
      syncAudio()
    })
  })

  const eqReset = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, t('Dejar plano'))
  eqReset.addEventListener('click', () => {
    player.setEqGains(flatGains())
    syncAudio()
  })
  eqField.append(presetRow, eqGrid, eqReset)

  const levelField = h('div', { className: 'settings-field' })
  const levelToggle = h('button', { className: 'chip', type: 'button' })
  const levelHint = h(
    'p',
    { className: 'text-faint settings-hint' },
    t('Compresor suave: recorta los picos para que un mixtape casero y un máster comercial no se lleven tanto. No mide el loudness real de cada track, así que no es normalización de verdad.'),
  )
  levelToggle.addEventListener('click', () => {
    player.setLeveling(!getSettings().leveling)
    syncAudio()
  })
  levelField.append(h('span', { className: 'field-label' }, t('Nivelado suave')), levelToggle, levelHint)

  const fadeField = h('div', { className: 'settings-field' })
  fadeField.appendChild(h('span', { className: 'field-label' }, t('Transición entre tracks')))
  const fadeInput = h('input', {
    className: 'eq-range',
    type: 'range',
    min: '0',
    max: String(CROSSFADE_MAX_S),
    step: '0.5',
    'aria-label': t('Segundos de crossfade'),
  }) as HTMLInputElement
  const fadeValue = h('span', { className: 'eq-value text-faint' })
  const fadeHint = h(
    'p',
    { className: 'text-faint settings-hint' },
    t('El siguiente track se resuelve y se precarga 20 s antes del final. Con 0 s el salto es encadenado (sin silencio); a partir de 1 s se solapan con curva de potencia constante, sin el bajón del centro que deja un fundido lineal.'),
  )
  const paintFade = (seconds: number): void => {
    fadeValue.textContent = seconds === 0 ? 'Encadenado' : `${seconds} s`
  }
  fadeInput.addEventListener('input', () => paintFade(parseFloat(fadeInput.value)))
  fadeInput.addEventListener('change', () => {
    player.setCrossfade(parseFloat(fadeInput.value))
    syncAudio()
  })
  fadeField.append(h('div', { className: 'eq-row' }, [fadeInput, fadeValue]), fadeHint)

  function syncAudio(): void {
    const settings = getSettings()
    const on = settings.dsp
    dspToggle.classList.toggle('active', on)
    dspToggle.textContent = on ? 'Motor avanzado activado' : t('Motor avanzado desactivado')
    dspToggle.setAttribute('aria-pressed', on ? 'true' : 'false')
    dspHint.textContent = on
      ? player.graphActive()
        ? t('Ecualizador, nivelado y transiciones activos sobre WebAudio.')
        : t('Se enciende con la primera reproducción: el navegador no deja crear el grafo de audio antes de que toques play.')
      : t('Ruta simple: un solo elemento de audio, como antes. Sin ecualizador, sin nivelado y sin transiciones.')
    const gains = readEq()
    eqInputs.forEach((input, index) => {
      if (parseFloat(input.value) !== gains[index]) input.value = String(gains[index])
      input.disabled = !on
    })
    paintEqValues(gains)
    refreshPresets(gains)
    eqReset.disabled = !on || isEqFlat(gains)
    presetChips.forEach((chip) => {
      const button = chip as HTMLButtonElement
      button.disabled = !on
    })
    levelToggle.classList.toggle('active', settings.leveling)
    levelToggle.textContent = settings.leveling ? 'Nivelado activado' : t('Nivelado desactivado')
    levelToggle.setAttribute('aria-pressed', settings.leveling ? 'true' : 'false')
    ;(levelToggle as HTMLButtonElement).disabled = !on
    if (parseFloat(fadeInput.value) !== settings.crossfade) fadeInput.value = String(settings.crossfade)
    fadeInput.disabled = !on
    paintFade(settings.crossfade)
  }

  dspToggle.addEventListener('click', () => {
    player.setDsp(!getSettings().dsp)
    syncAudio()
  })
  dspField.append(h('span', { className: 'field-label' }, t('Motor de audio')), dspToggle, dspHint)
  syncAudio()

  page.appendChild(settingsCard('waves', t('Audio'), [dspField, eqField, levelField, fadeField]))

  if (desktop) {
    const miniField = h('div', { className: 'settings-field' })
    const miniBtn = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, t('Abrir el mini reproductor'))
    miniBtn.addEventListener('click', () => {
      void toggleMiniPlayer().then((open) => {
        miniBtn.textContent = open ? 'Cerrar el mini reproductor' : t('Abrir el mini reproductor')
        toast(open ? 'Mini reproductor abierto' : t('Mini reproductor cerrado'))
      })
    })
    miniField.append(
      h('span', { className: 'field-label' }, t('Mini reproductor')),
      miniBtn,
      h(
        'p',
        { className: 'text-faint settings-hint' },
        t('Ventana pequeña siempre encima, con lo que suena y sus controles. Se abre y cierra con ⌘⌥M o desde la bandeja, y queda fuera de las capturas de pantalla para que no se cuele si compartes pantalla.'),
      ),
    )

    const notifyField = h('div', { className: 'settings-field' })
    const notifyToggle = h('button', { className: 'chip', type: 'button' })
    const paintNotify = (): void => {
      const on = getSettings().notifyTrack
      notifyToggle.classList.toggle('active', on)
      notifyToggle.textContent = on ? 'Avisos activados' : t('Avisos desactivados')
      notifyToggle.setAttribute('aria-pressed', on ? 'true' : 'false')
    }
    notifyToggle.addEventListener('click', () => {
      updateSettings({ notifyTrack: !getSettings().notifyTrack })
      paintNotify()
    })
    paintNotify()
    notifyField.append(
      h('span', { className: 'field-label' }, t('Aviso al cambiar de track')),
      notifyToggle,
      h(
        'p',
        { className: 'text-faint settings-hint' },
        t('Notificación del sistema con el título y el artista cuando empieza otro track. Apagado por defecto; el sistema puede pedirte permiso la primera vez.'),
      ),
    )

    const keysField = h('div', { className: 'settings-field' })
    const keysList = h('div', { className: 'shortcut-list' })
    const keysHint = h('p', { className: 'text-faint settings-hint' })
    keysField.append(h('span', { className: 'field-label' }, t('Atajos globales')), keysList, keysHint)
    void shortcutStatus().then((entries) => {
      if (!container.isConnected) return
      keysList.replaceChildren()
      for (const [label, command, ok] of entries) {
        const row = h('div', { className: 'shortcut-row' })
        const action =
          command === 'toggle'
            ? t('Reproducir o pausar')
            : command === 'next'
              ? t('Siguiente')
              : command === 'prev'
                ? t('Anterior')
                : command === 'like'
                  ? t('Favorito')
                  : t('Mini reproductor')
        row.append(
          h('kbd', { className: 'kbd' }, label),
          h('span', { className: ok ? 'text-dim' : 'text-faint' }, ok ? action : `${action} · no disponible`),
        )
        keysList.appendChild(row)
      }
      const failed = entries.filter(([, , ok]) => !ok).length
      keysHint.textContent =
        failed === 0
          ? t('Funcionan con SoundClear en segundo plano.')
          : isMac()
            ? `${failed} de ${entries.length} no se pudieron registrar: macOS no siempre cede las teclas de medios a apps que no son nativas, y otra app pudo quedarse el atajo. Las combinaciones con ⌘⌥ son la vía fiable.`
            : `${failed} de ${entries.length} no se pudieron registrar: otra app se quedó el atajo antes, o Windows lo reserva para sí. Las combinaciones con Ctrl+Alt son la vía fiable.`
    })

    page.appendChild(settingsCard('layout', t('Escritorio'), [miniField, notifyField, keysField]))
  }

  const accountCard = settingsCard('user', t('Cuenta'), [])
  page.appendChild(accountCard)

  if (!desktop) {
    accountCard.appendChild(
      h(
        'p',
        { className: 'text-faint' },
        t('Inicia sesión desde la app de escritorio para conectar tu cuenta de SoundCloud.'),
      ),
    )
  } else {
    const statusRow = h('div', { className: 'account-status' })
    const actions = h('div', { className: 'data-actions' })
    accountCard.append(statusRow, actions)

    const renderAccount = (state: AccountState): void => {
      statusRow.replaceChildren()
      actions.replaceChildren()
      if (state.status === 'unknown') {
        statusRow.appendChild(skAccountPreview(40))
        return
      }
      if (state.status !== 'ready' || !state.user) {
        statusRow.appendChild(h('span', { className: 'text-dim' }, t('No has iniciado sesión.')))
        const loginBtn = h('button', { className: 'btn btn-primary btn-sm' }, t('Iniciar sesión con SoundCloud'))
        loginBtn.addEventListener('click', () => {
          void desktopInvoke('login_window').catch(() => toastErr(t('No se pudo abrir la ventana de sesión')))
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
      const logoutBtn = h('button', { className: 'btn btn-ghost btn-sm' }, t('Cerrar sesión'))
      logoutBtn.addEventListener('click', () => {
        void desktopInvoke('logout_window').catch(() => toastErr(t('No se pudo cerrar sesión')))
        toast(t('Ventana abierta para cerrar tu cuenta en SoundCloud'))
        setTimeout(() => void refreshAccount(), 2500)
      })
      actions.append(
        logoutBtn,
        h('a', { className: 'btn btn-ghost btn-sm', href: '#/likes' }, t('Ver tus likes')),
        h('a', { className: 'btn btn-ghost btn-sm', href: `#/user/${user.id}` }, t('Tu perfil')),
      )
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

  if (guestAllowed()) {
    accountCard.appendChild(
      h('p', { className: 'text-faint' }, t('Estás usando SoundClear en modo invitado: no se pide sesión al abrir.')),
    )
    const askAgain = h('button', { className: 'btn btn-ghost btn-sm' }, t('Volver a pedir sesión al abrir'))
    askAgain.addEventListener('click', () => {
      revokeGuest()
      toast(t('Se pedirá sesión la próxima vez que abras SoundClear'), 'ok')
      window.setTimeout(() => location.reload(), 500)
    })
    accountCard.appendChild(askAgain)
  }

  if (!desktop) {
    const proxyField = h('div', { className: 'field' })
    proxyField.appendChild(h('label', { className: 'field-label' }, t('URL base del proxy')))
    const proxyInput = h('input', {
      className: 'input',
      type: 'url',
      placeholder: 'https://proxy.ejemplo.com',
      value: getSettings().apiBase,
    }) as HTMLInputElement
    const proxyHint = h(
      'p',
      { className: 'text-faint' },
      t('Si alojas tu propio proxy, indica aquí su URL base. Déjalo vacío para usar el proxy por defecto.'),
    )
    const proxyStatus = h('p', { className: 'proxy-status text-faint' })
    proxyField.append(proxyInput, proxyHint, proxyStatus)

    const setProxyStatus = (message: string, error: boolean, busy = false): void => {
      proxyStatus.replaceChildren(message)
      proxyStatus.classList.toggle('error', error)
      if (busy) proxyStatus.appendChild(skStatus('90px'))
    }

    const proxyActions = h('div', { className: 'proxy-actions' })
    const saveProxyBtn = h('button', { className: 'btn btn-ghost btn-sm' }, t('Probar y guardar'))
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
        setProxyStatus(t('Esa URL no es válida. Usa un formato como https://proxy.ejemplo.com'), true)
        return
      }
      saveProxyBtn.disabled = true
      setProxyStatus(`Comprobando ${base}/sl-client-id… `, false, true)
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
    page.appendChild(settingsCard('link', t('Proxy (avanzado)'), [proxyField, proxyActions]))
  }

  const dataActions = h('div', { className: 'data-actions' })
  const clearDataBtn = h('button', { className: 'btn btn-danger btn-sm' }, t('Borrar historial y caché local'))
  clearDataBtn.addEventListener('click', () => {
    player.store.set({ history: [] })
    saveHistory([])
    player.clearLocalLikes()
    if (desktop) {
      void player.syncAccountLikes(true)
      toast(t('Historial y caché local borrados'), 'ok')
      return
    }
    toast(t('Historial y favoritos locales borrados'), 'ok')
  })

  const resetBtn = h('button', { className: 'btn btn-ghost btn-sm' }, t('Restaurar ajustes'))
  resetBtn.addEventListener('click', () => {
    resetSettings()
    toast(t('Ajustes restaurados'), 'ok')
    window.setTimeout(() => location.reload(), 400)
  })

  let wipeArmed = false
  let wipeTimer: ReturnType<typeof setTimeout> | null = null
  const wipeBtn = h('button', { className: 'btn btn-danger btn-sm' }, t('Borrar toda la app'))
  const disarmWipe = (): void => {
    wipeArmed = false
    wipeBtn.textContent = t('Borrar toda la app')
    wipeBtn.classList.remove('armed')
    if (wipeTimer) {
      clearTimeout(wipeTimer)
      wipeTimer = null
    }
  }
  wipeBtn.addEventListener('click', () => {
    if (!wipeArmed) {
      wipeArmed = true
      wipeBtn.textContent = t('¿Seguro? Pulsa otra vez para borrarlo todo')
      wipeBtn.classList.add('armed')
      wipeTimer = setTimeout(disarmWipe, WIPE_TIMEOUT)
      return
    }
    disarmWipe()
    localStorage.clear()
    location.reload()
  })

  dataActions.append(clearDataBtn, resetBtn, wipeBtn)
  const dataHint = h(
    'p',
    { className: 'text-faint' },
    desktop
      ? t('Tus favoritos viven en tu cuenta de SoundCloud: al borrar la caché se vuelven a sincronizar. Para quitarlos de verdad, usa el corazón de cada track.')
      : t('Se borra el historial y los favoritos guardados en este navegador.'),
  )
  const wipeHint = h(
    'p',
    { className: 'text-faint' },
    t('«Borrar toda la app» elimina ajustes, cola, historial y caché de este dispositivo, y recarga SoundClear.'),
  )
  const offlineField = h('div', { className: 'settings-field' })
  offlineField.appendChild(h('span', { className: 'field-label' }, t('Sin conexión')))
  const offlineBar = h('div', { className: 'usage-bar' })
  const offlineFill = h('span', { className: 'usage-fill' })
  offlineBar.appendChild(offlineFill)
  const offlineUsage = h('p', { className: 'text-faint settings-hint' })
  const budgetRow = h('div', { className: 'chip-row' })
  const budgetChips = OFFLINE_BUDGETS.map((mb) => {
    const chip = h(
      'button',
      { className: 'chip', type: 'button', dataset: { budget: String(mb) } },
      mb === 0 ? 'Desactivado' : mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`,
    )
    chip.addEventListener('click', () => {
      updateSettings({ offlineBudget: mb })
      paintOffline()
    })
    budgetRow.appendChild(chip)
    return chip
  })
  const offlineList = h('div', { className: 'offline-list' })
  const offlineClear = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, t('Vaciar sin conexión'))
  offlineClear.addEventListener('click', () => {
    void clearOffline().then((removed) => {
      toast(removed > 0 ? `${removed} ${removed === 1 ? 'track quitado' : 'tracks quitados'} del almacenamiento` : t('No había nada guardado'))
      paintOffline()
    })
  })
  const offlineHint = h(
    'p',
    { className: 'text-faint settings-hint' },
    t('Guardas una copia del audio en este dispositivo para escucharlo sin red. Es solo para ti: el contenido sigue siendo de sus autores y se borra cuando quitas el track o vacías el espacio. Los previews de 30 s de Go+ y los tracks con DRM no se pueden guardar.'),
  )

  function paintOffline(): void {
    const state = offlineStore.get()
    const budget = getSettings().offlineBudget
    const budgetBytes = budget * 1024 * 1024
    const ratio = budgetBytes > 0 ? Math.min(1, state.bytes / budgetBytes) : 0
    offlineFill.style.width = `${Math.round(ratio * 100)}%`
    offlineBar.classList.toggle('full', ratio >= 0.98)
    offlineUsage.textContent =
      budget === 0
        ? state.entries.length > 0
          ? `${state.entries.length} guardados (${fmtBytes(state.bytes)}) · el espacio está desactivado, no se guardarán más`
          : t('Guardar sin conexión está desactivado')
        : `${state.entries.length} ${state.entries.length === 1 ? 'track' : 'tracks'} · ${fmtBytes(state.bytes)} de ${budget >= 1000 ? `${budget / 1000} GB` : `${budget} MB`}`
    budgetChips.forEach((chip) => chip.classList.toggle('active', chip.dataset.budget === String(budget)))
    offlineList.replaceChildren()
    for (const entry of state.entries.slice(0, 40)) {
      const row = h('div', { className: 'offline-row' })
      const meta = h('div', { className: 'offline-meta' })
      meta.append(
        h('a', { className: 'offline-title truncate link-hover', href: `#/track/${entry.id}` }, entry.title),
        h('span', { className: 'offline-sub text-faint truncate' }, `${entry.artist} · ${fmtBytes(entry.bytes)}`),
      )
      const remove = h('button', { className: 'icon-btn', type: 'button', title: t('Quitar de sin conexión') })
      remove.innerHTML = svgIcon('close', 16)
      remove.addEventListener('click', () => {
        void removeOffline(entry.id).then(paintOffline)
      })
      row.append(meta, remove)
      offlineList.appendChild(row)
    }
    if (state.entries.length > 40) {
      offlineList.appendChild(h('p', { className: 'text-faint settings-hint' }, `y ${state.entries.length - 40} más`))
    }
    offlineClear.disabled = state.entries.length === 0
  }

  offlineField.append(budgetRow, offlineBar, offlineUsage, offlineList, offlineClear, offlineHint)
  paintOffline()
  let offlineAttached = false
  let unsubOffline: (() => void) | null = null
  unsubOffline = offlineStore.subscribe(() => {
    if (offlineAttached && !container.isConnected) {
      unsubOffline?.()
      return
    }
    offlineAttached = true
    paintOffline()
  })

  page.appendChild(settingsCard('trash', t('Datos'), [offlineField, dataActions, dataHint, wipeHint]))

  const shortcutList = h('div', { className: 'shortcut-list' })
  for (const shortcut of SHORTCUTS) {
    const row = h('div', { className: 'shortcut-row' })
    row.append(h('kbd', { className: 'kbd' }, shortcut.keys), h('span', { className: 'text-dim' }, t(shortcut.label)))
    shortcutList.appendChild(row)
  }
  const shortcutsBtn = h('button', { className: 'btn btn-ghost btn-sm' })
  shortcutsBtn.innerHTML = `${svgIcon('keyboard', 16)}<span>Ver en pantalla completa</span>`
  shortcutsBtn.addEventListener('click', () => openShortcuts())
  page.appendChild(settingsCard('keyboard', t('Atajos de teclado'), [shortcutList, shortcutsBtn]))

  const diagField = h('div', { className: 'settings-field' })
  const diagList = h('div', { className: 'shortcut-list' })
  const diagActions = h('div', { className: 'data-actions' })
  const diagRefresh = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, t('Actualizar'))
  const diagCopy = h('button', { className: 'btn btn-ghost btn-sm', type: 'button' }, t('Copiar informe'))
  diagActions.append(diagRefresh, diagCopy)
  const diagHint = h(
    'p',
    { className: 'text-faint settings-hint' },
    t('Todo se calcula en este dispositivo y nada sale de aquí. El informe no lleva tu nombre, tu correo ni los títulos de lo que escuchas: solo rutas de API con los identificadores tapados.'),
  )

  const diagRow = (clave: string, valor: string): HTMLElement => {
    const row = h('div', { className: 'shortcut-row' })
    row.append(h('span', { className: 'text-dim' }, clave), h('span', { className: 'text-faint' }, valor))
    return row
  }

  async function informe(): Promise<string[]> {
    const lat = latency()
    const cachés = await cacheBytes()
    const settings = getSettings()
    const off = offlineStore.get()
    let clientId = 'sin resolver'
    try {
      if (desktop) {
        const id = await desktopInvoke<string>('get_client_id', { refresh: false })
        clientId = `resuelto (${id.length} caracteres)`
      } else {
        const res = await fetch('/sl-client-id')
        const data = (await res.json()) as { client_id?: string; refreshed?: boolean }
        clientId = data.client_id ? `resuelto (${data.client_id.length} caracteres${data.refreshed ? ', recién renovado' : ''})` : `sin resolver (HTTP ${res.status})`
      }
    } catch {
      clientId = 'sin resolver (error de red)'
    }
    return [
      `versión: ${APP_VERSION}`,
      `entorno: ${desktop ? 'escritorio (Tauri)' : 'navegador'}`,
      `client_id: ${clientId}`,
      `proxy: ${settings.apiBase || (desktop ? 'nativo' : 'el del servidor')}`,
      `llamadas medidas: ${lat.n}${lat.n ? ` · mediana ${lat.mediana} ms · peor ${lat.peor} ms · fallos ${lat.fallos}` : ''}`,
      `datos en localStorage: ${fmtBytes(localStorageBytes())}`,
      `sin conexión: ${off.entries.length} tracks · ${fmtBytes(off.bytes)} de ${settings.offlineBudget} MB`,
      `cachés del navegador: ${cachés.nombres.length}${cachés.estimado ? ` · ${fmtBytes(cachés.estimado)} usados de ${fmtBytes(cachés.cuota)}` : ''}`,
      `motor de audio: ${settings.dsp ? (player.graphActive() ? 'activo' : 'a la espera del primer play') : 'apagado'}`,
      `últimas rutas: ${calls().slice(0, 6).map((c) => `${c.ruta} ${c.ms}ms${c.ok ? '' : t(' (falló)')}`).join(' · ') || 'ninguna'}`,
    ]
  }

  async function pintarDiag(): Promise<void> {
    diagList.replaceChildren(h('p', { className: 'text-faint settings-hint' }, t('Midiendo…')))
    const lineas = await informe()
    if (!container.isConnected) return
    diagList.replaceChildren()
    for (const linea of lineas) {
      const corte = linea.indexOf(':')
      diagList.appendChild(diagRow(linea.slice(0, corte), linea.slice(corte + 1).trim()))
    }
  }

  diagRefresh.addEventListener('click', () => void pintarDiag())
  diagCopy.addEventListener('click', () => {
    void informe().then((lineas) => {
      const texto = [t('SoundClear · informe local'), ...lineas.map((l) => `- ${l}`)].join('\n')
      void navigator.clipboard
        .writeText(texto)
        .then(() => toast(t('Informe copiado: pégalo en el issue'), 'ok'))
        .catch(() => toastErr(t('No se pudo copiar el informe')))
    })
  })
  diagField.append(h('span', { className: 'field-label' }, t('Estado local')), diagList, diagActions, diagHint)
  void pintarDiag()
  page.appendChild(settingsCard('info', t('Diagnóstico'), [diagField]))

  const aboutHead = h('div', { className: 'about-head' })
  const aboutLogo = h('span', { className: 'about-logo' })
  aboutLogo.innerHTML = appLogo(42)
  aboutHead.append(aboutLogo, h('span', { className: 'about-title' }, `SoundClear v${APP_VERSION}`))
  const aboutDesc = h(
    'p',
    { className: 'text-dim' },
    t('Cliente de SoundCloud súper ligero y open source — no es un wrapper de la web.'),
  )
  const ghLink = h(
    'a',
    { className: 'btn btn-ghost btn-sm', href: 'https://github.com/gaboxdev/soundcloudapp', target: '_blank', rel: 'noopener' },
    [iconEl('github', 16), t('Código fuente')],
  )
  const aboutActions = h('div', { className: 'about-actions' })
  aboutActions.appendChild(ghLink)
  const disclaimer = h(
    'p',
    { className: 'text-faint about-note' },
    t('Proyecto independiente de código abierto, sin afiliación ni respaldo de SoundCloud. «SoundCloud» es una marca registrada de SoundCloud Global Limited & Co. KG; sus marcas, logos y contenido pertenecen a sus dueños.'),
  )
  const gift = h('p', { className: 'text-faint about-note' }, t('Regalo para la comunidad de SoundCloud'))
  page.appendChild(settingsCard('info', t('Acerca de'), [aboutHead, aboutDesc, aboutActions, disclaimer, gift]))

  const syncPlayback = (): void => {
    const state = player.store.get()
    syncVolume(state.volume, state.muted)
    rateChips.forEach((chip) => chip.classList.toggle('active', chip.dataset.rate === String(state.rate)))
    sleepOff.hidden = state.sleepAt === null
    if (state.sleepAt === null) {
      sleepStatus.textContent = t('Sin temporizador activo.')
      return
    }
    const minutes = Math.max(1, Math.round((state.sleepAt - Date.now()) / 60_000))
    sleepStatus.textContent = `La reproducción se pausará en unos ${minutes} min.`
  }

  let attached = false
  let unsub: (() => void) | null = null
  unsub = player.store.subscribe(() => {
    if (attached && !container.isConnected) {
      systemQuery?.removeEventListener('change', onSystemTheme)
      if (wipeTimer) clearTimeout(wipeTimer)
      unsub?.()
      return
    }
    attached = true
    syncPlayback()
  })
})
