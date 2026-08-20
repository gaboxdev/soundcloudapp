const BARS: readonly (readonly [number, number, number])[] = [
  [0, 114, 104],
  [72, 62, 208],
  [144, 10, 312],
  [216, 62, 208],
  [288, 114, 104],
]

function rects(extra: (index: number) => string): string {
  return BARS.map(([x, y, height], index) => {
    return `<rect x="${x}" y="${y}" width="44" height="${height}" rx="22"${extra(index)}/>`
  }).join('')
}

export function appLogo(size = 28): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 332 332" fill="currentColor" aria-hidden="true">${rects(() => '')}</svg>`
}

export function appLogoLive(size = 56): string {
  const body = rects((index) => ` class="logo-bar" style="--bar:${index}"`)
  return `<svg class="logo-live" width="${size}" height="${size}" viewBox="0 0 332 332" fill="currentColor" aria-hidden="true">${body}</svg>`
}
