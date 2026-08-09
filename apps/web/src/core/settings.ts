export type Theme = 'dark' | 'light' | 'system'

export type Glass = 'cristal' | 'equilibrado' | 'solido'

export type Topbar = 'fija' | 'auto' | 'oculta'

export interface Settings {
  version: number
  theme: Theme
  glass: Glass
  topbar: Topbar
  apiBase: string
  volume: number
}

const KEY = 'sl:settings'
const VERSION = 4
const THEMES: readonly string[] = ['dark', 'light', 'system']
const GLASSES: readonly string[] = ['cristal', 'equilibrado', 'solido']
const TOPBARS: readonly string[] = ['fija', 'auto', 'oculta']

const defaults: Settings = {
  version: VERSION,
  theme: 'dark',
  glass: 'equilibrado',
  topbar: 'fija',
  apiBase: '',
  volume: 0.9,
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

function sanitize(input: unknown): Settings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    version: VERSION,
    theme: isTheme(source.theme) ? source.theme : defaults.theme,
    glass: isGlass(source.glass) ? source.glass : defaults.glass,
    topbar: isTopbar(source.topbar) ? source.topbar : defaults.topbar,
    apiBase: normalizeApiBase(source.apiBase),
    volume: normalizeVolume(source.volume),
  }
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

export function initSettings(): Settings {
  initialized = true
  watchSystemTheme()
  settings = load()
  applyTheme(settings.theme)
  applyGlass(settings.glass)
  applyTopbar(settings.topbar)
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

export function resetSettings(): void {
  settings = { ...defaults }
  clearStored()
  applyTheme(settings.theme)
  applyGlass(settings.glass)
  applyTopbar(settings.topbar)
}
