import { getAPI } from '../api'
import { navigate } from './router'
import { toast, toastErr } from '../ui/toast'
import { t } from './i18n.ts'

const HOSTS = ['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com', 'on.soundcloud.com', 'soundcloud.app.goo.gl']

export function soundcloudUrl(texto: string): string | null {
  const bruto = texto.trim()
  if (!bruto) return null
  const candidato = /^https?:\/\//i.test(bruto) ? bruto : /^(www\.)?(m\.)?soundcloud\.com\//i.test(bruto) ? `https://${bruto}` : null
  if (!candidato) return null
  try {
    const url = new URL(candidato)
    if (!HOSTS.includes(url.hostname.toLowerCase())) return null
    if (url.pathname === '/' || url.pathname === '') return null
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

export function routeFor(item: { kind?: string; id?: number }): string | null {
  if (typeof item.id !== 'number') return null
  if (item.kind === 'track') return `/track/${item.id}`
  if (item.kind === 'user') return `/user/${item.id}`
  if (item.kind === 'playlist' || item.kind === 'album') return `/playlist/${item.id}`
  return null
}

export async function openSoundcloudLink(url: string): Promise<boolean> {
  const limpia = soundcloudUrl(url)
  if (!limpia) {
    toastErr(t('Ese enlace no es de SoundCloud'))
    return false
  }
  try {
    const item = await getAPI().resolve(limpia)
    const ruta = routeFor(item as { kind?: string; id?: number })
    if (!ruta) {
      toastErr(t('SoundCloud resolvió el enlace, pero no es un track, perfil ni playlist'))
      return false
    }
    navigate(ruta)
    return true
  } catch {
    toastErr(t('SoundCloud no reconoció ese enlace'))
    return false
  }
}

export async function shareLink(url: string, title: string): Promise<void> {
  const nav = navigator as Navigator & { share?: (data: { title?: string; url?: string }) => Promise<void> }
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, url })
      return
    } catch {
      return
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast(t('Enlace copiado al portapapeles'), 'ok')
  } catch {
    toastErr(t('No se pudo compartir el enlace'))
  }
}

export function consumeSharedLink(): string | null {
  const params = new URLSearchParams(location.search)
  const bruto = params.get('share') ?? params.get('url') ?? params.get('text') ?? ''
  if (!bruto) return null
  const limpio = soundcloudUrl(bruto) ?? soundcloudUrl((/https?:\/\/\S+/.exec(bruto) ?? [''])[0])
  if (location.search) history.replaceState(null, '', `${location.pathname}${location.hash}`)
  return limpio
}
