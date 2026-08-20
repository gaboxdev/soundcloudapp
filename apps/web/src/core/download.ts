import type { Track } from '@soundclear/api'
import { getAPI } from '../api'
import { desktopInvoke, isDesktop } from '../api/auth'
import { toast, toastErr } from '../ui/toast'
import { t } from './i18n.ts'

export function canDownloadFile(track: Track): boolean {
  return track.downloadable === true && track.has_downloads_left !== false
}

function fileName(track: Track): string {
  const artist = track.user?.username ?? t('SoundCloud')
  return `${artist} - ${track.title}`.replace(/\s+/g, ' ').trim()
}

export async function downloadTrackFile(track: Track): Promise<void> {
  if (!canDownloadFile(track)) {
    toastErr(t('El artista no permite descargar este track'))
    return
  }
  try {
    const url = await getAPI().downloadUrl(track)
    if (!url) {
      toastErr(t('La descarga no está disponible'))
      return
    }
    if (!isDesktop()) {
      window.open(url, '_blank', 'noopener')
      return
    }
    toast(t('Descargando el archivo…'))
    const path = await desktopInvoke<string>('download_to_music', { url, name: fileName(track) })
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const folder = cut > 0 ? path.slice(0, cut) : path
    toast(`Guardado en ${folder}`, 'ok')
  } catch {
    toastErr(t('No se pudo descargar el archivo'))
  }
}
