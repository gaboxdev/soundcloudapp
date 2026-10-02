import type { Track } from '@soundclear/api'

export interface LikeOverride {
  id: number
  liked: boolean
}

export function rememberLikeBaseline(confirmed: Map<number, boolean>, id: number, liked: boolean): void {
  if (!confirmed.has(id)) confirmed.set(id, liked)
}

export function confirmedLikeState(confirmed: ReadonlyMap<number, boolean>, id: number, fallback: boolean): boolean {
  return confirmed.has(id) ? confirmed.get(id) === true : fallback
}

export function mergeLikeTracks(
  remote: readonly Track[],
  local: readonly Track[],
  overrides: readonly LikeOverride[],
): Track[] {
  const localById = new Map(local.map((track) => [track.id, track]))
  const overrideById = new Map(overrides.map((override) => [override.id, override.liked]))
  const seen = new Set<number>()
  const merged: Track[] = []

  for (const remoteTrack of remote) {
    const override = overrideById.get(remoteTrack.id)
    if (override === false || seen.has(remoteTrack.id)) continue
    seen.add(remoteTrack.id)
    merged.push(override === true ? localById.get(remoteTrack.id) ?? remoteTrack : remoteTrack)
  }

  for (const override of overrides) {
    if (!override.liked || seen.has(override.id)) continue
    const track = localById.get(override.id)
    if (!track) continue
    seen.add(override.id)
    merged.push(track)
  }

  return merged
}
