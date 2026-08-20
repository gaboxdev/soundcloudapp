import { applyTone, normalizeHue } from './accent.ts'
import { applyLang, isLangSetting, type LangSetting } from './i18n.ts'
import { CROSSFADE_MAX_S, flatGains, normalizeGains } from '../player/audiograph.ts'

export type Theme = 'dark' | 'light' | 'system'

export type Glass = 'cristal' | 'equilibrado' | 'solido'

export type Topbar = 'fija' | 'auto' | 'oculta'

export type Accent = 'violeta' | 'cian' | 'ambar' | 'verde' | 'rosa' | 'soundcloud' | 'tono'

export type Density = 'comoda' | 'compacta'

export type Backdrop = 'auto' | 'caratula' | 'sistema'

export type NavLabels = 'texto' | 'iconos'

export type IconStyle = 'plano' | 'insignia'

export interface Settings {
  version: number
  theme: Theme
  glass: Glass
  topbar: Topbar
  accent: Accent
  accentHue: number
  density: Density
  backdrop: Backdrop
  navLabels: NavLabels
  iconStyle: IconStyle
  historyNav: boolean
  onboarded: boolean
  autoplay: boolean
  rate: number
  apiBase: string
  volume: number
  dsp: boolean
  eq: number[]
  leveling: boolean
  crossfade: number
  offlineBudget: number
  notifyTrack: boolean
  lang: LangSetting
}

const KEY = 'sl:settings'
const VERSION = 8
const THEMES: readonly string[] = ['dark', 'light', 'system']
const GLASSES: readonly string[] = ['cristal', 'equilibrado', 'solido']
const TOPBARS: readonly string[] = ['fija', 'auto', 'oculta']
const ACCENTS: readonly string[] = ['violeta', 'cian', 'ambar', 'verde', 'rosa', 'soundcloud', 'tono']
const DENSITIES: readonly string[] = ['comoda', 'compacta']
const BACKDROPS: readonly string[] = ['auto', 'caratula', 'sistema']
const NAV_LABELS: readonly string[] = ['texto', 'iconos']
const ICON_STYLES: readonly string[] = ['plano', 'insignia']
const RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2]
export const OFFLINE_BUDGETS: readonly number[] = [0, 250, 500, 1000, 2000, 5000]

const defaults: Settings = {
  version: VERSION,
  theme: 'dark',
  glass: 'equilibrado',
  topbar: 'fija',
  accent: 'violeta',
  accentHue: 210,
  density: 'comoda',
  backdrop: 'auto',
  navLabels: 'iconos',
  iconStyle: 'plano',
  historyNav: true,
  onboarded: false,
  autoplay: true,
  rate: 1,
  apiBase: '',
  volume: 0.9,
  dsp: true,
  eq: flatGains(),
  leveling: false,
  crossfade: 0,
  offlineBudget: 500,
  notifyTrack: false,
  lang: 'auto',
}

let settings: Settings = { ...defaults }
let themeQuery: MediaQueryList | null = null
let initialized = false

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEMES.includes(value)
}

function isGlass(value: unknown): value is Glass {
  return typeof value === 'string' && GLASSES.includes(value)
}

function isTopbar(value: unknown): value is Topbar {
  return typeof value === 'string' && TOPBARS.includes(value)
}

function isAccent(value: unknown): value is Accent {
  return typeof value === 'string' && ACCENTS.includes(value)
}

function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && DENSITIES.includes(value)
}

function isBackdrop(value: unknown): value is Backdrop {
  return typeof value === 'string' && BACKDROPS.includes(value)
}

function isNavLabels(value: unknown): value is NavLabels {
  return typeof value === 'string' && NAV_LABELS.includes(value)
}

function isIconStyle(value: unknown): value is IconStyle {
  return typeof value === 'string' && ICON_STYLES.includes(value)
}

function normalizeRate(value: unknown): number {
  const rate = typeof value === 'number' ? value : Number(value)
  return RATES.includes(rate) ? rate : defaults.rate
}

function normalizeVolume(value: unknown): number {
  const volume = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(volume)) return defaults.volume
  return Math.min(1, Math.max(0, volume))
}

function normalizeApiBase(value: unknown): string {
  if (typeof value !== 'string') return defaults.apiBase
  const base = value.trim().replace(/\/+$/, '')
  if (!base) return ''
  try {
    new URL(base)
    return base
  } catch {
    return defaults.apiBase
  }
}

function normalizeCrossfade(value: unknown): number {
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(seconds)) return defaults.crossfade
  return Math.round(Math.min(CROSSFADE_MAX_S, Math.max(0, seconds)) * 10) / 10
}

function normalizeBudget(value: unknown): number {
  const mb = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(mb)) return defaults.offlineBudget
  return OFFLINE_BUDGETS.includes(Math.round(mb)) ? Math.round(mb) : defaults.offlineBudget
}

function sanitize(input: unknown): Settings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    version: VERSION,
    theme: isTheme(source.theme) ? source.theme : defaults.theme,
    glass: isGlass(source.glass) ? source.glass : defaults.glass,
    topbar: isTopbar(source.topbar) ? source.topbar : defaults.topbar,
    accent: isAccent(source.accent) ? source.accent : defaults.accent,
    accentHue: normalizeHue(source.accentHue, defaults.accentHue),
    density: isDensity(source.density) ? source.density : defaults.density,
    backdrop: isBackdrop(source.backdrop) ? source.backdrop : defaults.backdrop,
    navLabels: isNavLabels(source.navLabels) ? source.navLabels : defaults.navLabels,
    iconStyle: isIconStyle(source.iconStyle) ? source.iconStyle : defaults.iconStyle,
    historyNav: typeof source.historyNav === 'boolean' ? source.historyNav : defaults.historyNav,
    onboarded: typeof source.onboarded === 'boolean' ? source.onboarded : defaults.onboarded,
    autoplay: typeof source.autoplay === 'boolean' ? source.autoplay : defaults.autoplay,
    rate: normalizeRate(source.rate),
    apiBase: normalizeApiBase(source.apiBase),
    volume: normalizeVolume(source.volume),
    dsp: typeof source.dsp === 'boolean' ? source.dsp : defaults.dsp,
    eq: normalizeGains(source.eq),
    leveling: typeof source.leveling === 'boolean' ? source.leveling : defaults.leveling,
    crossfade: normalizeCrossfade(source.crossfade),
    offlineBudget: normalizeBudget(source.offlineBudget),
    notifyTrack: typeof source.notifyTrack === 'boolean' ? source.notifyTrack : defaults.notifyTrack,
    lang: isLangSetting(source.lang) ? source.lang : defaults.lang,
  }
}

export function sanitizeSettings(input: unknown): Settings {
  return sanitize(input)
}

export function settingsDefaults(): Settings {
  return { ...defaults, eq: [...defaults.eq] }
}

function persist(value: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function clearStored(): boolean {
  try {
    localStorage.removeItem(KEY)
    return true
  } catch {
    return false
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const parsed: unknown = JSON.parse(raw)
    const migrated = sanitize(parsed)
    const version = (parsed as { version?: unknown } | null)?.version
    if (version !== VERSION) persist(migrated)
    return migrated
  } catch {
    return { ...defaults }
  }
}

function watchSystemTheme(): void {
  if (themeQuery || typeof window.matchMedia !== 'function') return
  themeQuery = window.matchMedia('(prefers-color-scheme: dark)')
  themeQuery.addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme('system')
  })
}

function applyAll(value: Settings): void {
  applyLang(value.lang)
  applyTheme(value.theme)
  applyGlass(value.glass)
  applyTopbar(value.topbar)
  applyAccent(value.accent, value.accentHue)
  applyDensity(value.density)
  applyBackdrop(value.backdrop)
  applyNavLabels(value.navLabels)
  applyIconStyle(value.iconStyle)
  applyHistoryNav(value.historyNav)
}

export function initSettings(): Settings {
  initialized = true
  watchSystemTheme()
  settings = load()
  applyAll(settings)
  return settings
}

export function getSettings(): Settings {
  if (!initialized) initSettings()
  return settings
}

export function updateSettings(patch: Partial<Settings>): Settings {
  if (!initialized) initSettings()
  settings = sanitize({ ...settings, ...patch })
  persist(settings)
  if (patch.theme !== undefined) applyTheme(settings.theme)
  if (patch.glass !== undefined) applyGlass(settings.glass)
  if (patch.topbar !== undefined) applyTopbar(settings.topbar)
  if (patch.accent !== undefined || patch.accentHue !== undefined) applyAccent(settings.accent, settings.accentHue)
  if (patch.density !== undefined) applyDensity(settings.density)
  if (patch.backdrop !== undefined) applyBackdrop(settings.backdrop)
  if (patch.lang !== undefined) applyLang(settings.lang)
  if (patch.navLabels !== undefined) applyNavLabels(settings.navLabels)
  if (patch.iconStyle !== undefined) applyIconStyle(settings.iconStyle)
  if (patch.historyNav !== undefined) applyHistoryNav(settings.historyNav)
  return settings
}

function systemDark(): boolean {
  return themeQuery?.matches ?? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'system' ? systemDark() : theme === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#08080b' : '#ececed')
}

export function applyGlass(glass: Glass): void {
  document.documentElement.dataset.glass = glass
}

export function applyTopbar(topbar: Topbar): void {
  document.documentElement.dataset.topbar = topbar
}

export function applyAccent(accent: Accent, hue: number): void {
  document.documentElement.dataset.accent = accent
  applyTone(hue)
}

export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density
}

export function applyNavLabels(navLabels: NavLabels): void {
  document.documentElement.dataset.navlabels = navLabels
}

export function applyIconStyle(iconStyle: IconStyle): void {
  document.documentElement.dataset.icons = iconStyle
}

export function applyHistoryNav(historyNav: boolean): void {
  document.documentElement.dataset.historynav = historyNav ? 'si' : 'no'
}

export function nativeGlassAvailable(): boolean {
  if (!('__TAURI_INTERNALS__' in window)) return false
  return /Mac OS X|Macintosh|Windows/.test(navigator.userAgent)
}

export function applyBackdrop(backdrop: Backdrop): void {
  const root = document.documentElement
  const system = backdrop === 'sistema' || (backdrop === 'auto' && nativeGlassAvailable())
  if (system) root.dataset.backdrop = 'system'
  else delete root.dataset.backdrop
}

export function resetSettings(): Settings {
  const onboarded = settings.onboarded
  clearStored()
  settings = { ...defaults, eq: flatGains(), onboarded }
  persist(settings)
  applyAll(settings)
  return settings
}
