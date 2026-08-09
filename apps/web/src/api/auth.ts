import { isTauri } from '@soundclear/api'

export function isDesktop(): boolean {
  return isTauri()
}

export async function desktopInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Solo disponible en la app de escritorio')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}
