export type Theme = 'dark' | 'light' | 'system'

export interface Settings {
  theme: Theme
  apiBase: string
  volume: number
  firstRun: boolean
}

const KEY = 'sl:settings'

const defaults: Settings = {
  theme: 'dark',
  apiBase: '',
  volume: 0.9,
  firstRun: true,
}

let settings: Settings = { ...defaults }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    // ignora almacenamiento corrupto
  }
  return { ...defaults }
}

export function initSettings(): Settings {
  settings = load()
  applyTheme(settings.theme)
  return settings
}

export function getSettings(): Settings {
  return settings
}

export function updateSettings(patch: Partial<Settings>): Settings {
  settings = { ...settings, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    // sin almacenamiento disponible
  }
  if (patch.theme) applyTheme(patch.theme)
  return settings
}

function systemDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

export function applyTheme(theme: Theme): void {
  const dark = theme === 'system' ? systemDark() : theme === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#0f0f10' : '#f6f6f7')
}

export function resetSettings(): void {
  settings = { ...defaults }
  try {
    localStorage.removeItem(KEY)
  } catch {
    // sin almacenamiento
  }
  applyTheme(settings.theme)
}
