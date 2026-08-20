export type Lang = 'es' | 'en'
export type LangSetting = 'auto' | Lang

const LANGS: readonly LangSetting[] = ['auto', 'es', 'en']

let actual: Lang = 'es'
let dict: Record<string, string> = {}
const oyentes = new Set<() => void>()

export async function loadLang(setting: LangSetting): Promise<Lang> {
  const objetivo = resolveLang(setting)
  if (objetivo === 'en' && Object.keys(dict).length === 0) {
    try {
      const mod = await import('./i18n.en.ts')
      dict = mod.EN
    } catch {
      dict = {}
    }
  }
  return applyLang(setting)
}

export function isLangSetting(value: unknown): value is LangSetting {
  return typeof value === 'string' && LANGS.includes(value as LangSetting)
}

export function detectLang(): Lang {
  const idiomas = typeof navigator === 'undefined' ? [] : [navigator.language, ...(navigator.languages ?? [])]
  for (const código of idiomas) {
    if (typeof código !== 'string') continue
    if (código.toLowerCase().startsWith('es')) return 'es'
    if (código.toLowerCase().startsWith('en')) return 'en'
  }
  return 'es'
}

export function resolveLang(setting: LangSetting): Lang {
  return setting === 'auto' ? detectLang() : setting
}

export function applyLang(setting: LangSetting): Lang {
  actual = resolveLang(setting)
  if (typeof document !== 'undefined') document.documentElement.lang = actual
  for (const oyente of [...oyentes]) oyente()
  return actual
}

export function lang(): Lang {
  return actual
}

export function onLangChange(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

export function t(texto: string, vars?: Record<string, string | number>): string {
  const base = actual === 'es' ? texto : (dict[texto] ?? texto)
  if (!vars) return base
  return base.replace(/\{(\w+)\}/g, (todo, clave: string) => (clave in vars ? String(vars[clave]) : todo))
}

export function loadedTranslations(): number {
  return Object.keys(dict).length
}
