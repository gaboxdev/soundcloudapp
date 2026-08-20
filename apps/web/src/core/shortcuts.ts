export interface Shortcut {
  keys: string
  label: string
  group: string
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: 'Espacio', label: 'Reproducir o pausar', group: 'Reproducción' },
  { keys: '← / →', label: 'Saltar ±5 segundos', group: 'Reproducción' },
  { keys: '⇧ ← / →', label: 'Saltar ±15 segundos', group: 'Reproducción' },
  { keys: '↑ / ↓', label: 'Subir o bajar el volumen', group: 'Reproducción' },
  { keys: 'N / P', label: 'Siguiente o anterior', group: 'Reproducción' },
  { keys: 'M', label: 'Silenciar', group: 'Reproducción' },
  { keys: 'F', label: 'Añadir a favoritos', group: 'Reproducción' },
  { keys: 'S', label: 'Aleatorio', group: 'Reproducción' },
  { keys: 'R', label: 'Repetir', group: 'Reproducción' },
  { keys: 'X', label: 'Radio a partir de lo que suena', group: 'Reproducción' },
  { keys: 'A', label: 'Abrir «Ahora suena»', group: 'Navegación' },
  { keys: 'Q', label: 'Abrir la cola', group: 'Navegación' },
  { keys: '/', label: 'Buscar', group: 'Navegación' },
  { keys: ',', label: 'Abrir los ajustes', group: 'Navegación' },
  { keys: '⌘K / Ctrl+K', label: 'Paleta de comandos', group: 'Interfaz' },
  { keys: '?', label: 'Ver estos atajos', group: 'Interfaz' },
  { keys: 'Esc', label: 'Cerrar lo que esté abierto', group: 'Interfaz' },
]
