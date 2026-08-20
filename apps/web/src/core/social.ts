import type { Playlist, PlaylistSummary, Track, User } from '@soundclear/api'
import { isPlaylistSummary } from '@soundclear/api'
import { getAPI } from '../api'
import { isDesktop } from '../api/auth'
import { accountStore } from './account'
import { createStore, type Store } from './store'
import { toast, toastErr } from '../ui/toast'
import { t } from './i18n.ts'

export interface SocialState {
  followingIds: Set<number>
  repostIds: Set<number>
  knownFollowing: boolean
  knownReposts: boolean
  busy: Set<number>
  rev: number
}

export type AddToPlaylistResult = 'added' | 'duplicate'

const IDS_TTL = 5 * 60 * 1000

export const socialStore: Store<SocialState> = createStore<SocialState>({
  followingIds: new Set(),
  repostIds: new Set(),
  knownFollowing: false,
  knownReposts: false,
  busy: new Set(),
  rev: 0,
})

let loadedFor: number | null = null
let loadedAt = 0
let loading: Promise<void> | null = null
let playlists: PlaylistSummary[] | null = null
let playlistsFor: number | null = null
let initialized = false

function bump(patch: Partial<SocialState>): void {
  socialStore.set((state) => ({ ...patch, rev: state.rev + 1 }))
}

export function canWrite(): boolean {
  return isDesktop() && accountStore.get().status === 'ready' && accountStore.get().user !== null
}

function currentUserId(): number | null {
  return accountStore.get().user?.id ?? null
}

export function isFollowing(userId: number): boolean {
  return socialStore.get().followingIds.has(userId)
}

export function isReposted(trackId: number): boolean {
  return socialStore.get().repostIds.has(trackId)
}

export function isBusy(id: number): boolean {
  return socialStore.get().busy.has(id)
}

function setBusy(id: number, busy: boolean): void {
  const next = new Set(socialStore.get().busy)
  if (busy) next.add(id)
  else next.delete(id)
  bump({ busy: next })
}

export function loadSocial(force = false): Promise<void> {
  if (!canWrite()) return Promise.resolve()
  const userId = currentUserId()
  if (userId === null) return Promise.resolve()
  if (loading) return loading
  const fresh = loadedFor === userId && Date.now() - loadedAt < IDS_TTL
  if (fresh && !force) return Promise.resolve()
  const api = getAPI()
  const run = (async () => {
    const [following, reposts] = await Promise.allSettled([api.followingIds(userId), api.repostIds()])
    const patch: Partial<SocialState> = {}
    if (following.status === 'fulfilled') {
      patch.followingIds = new Set(following.value)
      patch.knownFollowing = true
    }
    if (reposts.status === 'fulfilled') {
      patch.repostIds = new Set(reposts.value)
      patch.knownReposts = true
    }
    if (Object.keys(patch).length > 0) bump(patch)
    loadedFor = userId
    loadedAt = Date.now()
  })()
  loading = run
  void run.finally(() => {
    if (loading === run) loading = null
  })
  return run
}

export function initSocial(): void {
  if (initialized) return
  initialized = true
  accountStore.subscribe((state) => {
    if (state.status !== 'ready') return
    if (state.user && state.user.id !== loadedFor) {
      playlists = null
      playlistsFor = null
    }
    void loadSocial()
  })
}

export async function toggleFollow(user: User): Promise<void> {
  if (!canWrite() || isBusy(user.id)) return
  const wasFollowing = isFollowing(user.id)
  const next = new Set(socialStore.get().followingIds)
  if (wasFollowing) next.delete(user.id)
  else next.add(user.id)
  bump({ followingIds: next, knownFollowing: true })
  setBusy(user.id, true)
  try {
    await getAPI().setFollowing(user.id, !wasFollowing)
    toast(wasFollowing ? `Has dejado de seguir a ${user.username}` : `Ahora sigues a ${user.username}`, 'ok')
  } catch {
    const rollback = new Set(socialStore.get().followingIds)
    if (wasFollowing) rollback.add(user.id)
    else rollback.delete(user.id)
    bump({ followingIds: rollback })
    toastErr(wasFollowing ? 'No se pudo dejar de seguir' : t('No se pudo seguir a este artista'))
  } finally {
    setBusy(user.id, false)
  }
}

export async function toggleRepost(track: Track): Promise<void> {
  if (!canWrite() || isBusy(track.id)) return
  const wasReposted = isReposted(track.id)
  const next = new Set(socialStore.get().repostIds)
  if (wasReposted) next.delete(track.id)
  else next.add(track.id)
  bump({ repostIds: next, knownReposts: true })
  setBusy(track.id, true)
  try {
    await getAPI().setRepost(track.id, !wasReposted)
    toast(wasReposted ? 'Repost quitado' : t('Reposteado en tu perfil'), 'ok')
  } catch {
    const rollback = new Set(socialStore.get().repostIds)
    if (wasReposted) rollback.add(track.id)
    else rollback.delete(track.id)
    bump({ repostIds: rollback })
    toastErr(wasReposted ? 'No se pudo quitar el repost' : t('No se pudo repostear'))
  } finally {
    setBusy(track.id, false)
  }
}

export async function myPlaylists(force = false): Promise<PlaylistSummary[]> {
  const userId = currentUserId()
  if (!canWrite() || userId === null) return []
  if (!force && playlists && playlistsFor === userId) return playlists
  const api = getAPI()
  const response = await api.mePlaylists(userId, 50).catch(() => api.userContent(userId, 'playlists', 0, 50))
  const owned = response.collection.filter((item): item is Playlist => isPlaylistSummary(item))
  playlists = owned.filter((item) => item.user?.id === userId || item.user_id === userId)
  playlistsFor = userId
  return playlists
}

export function invalidatePlaylists(): void {
  playlists = null
  playlistsFor = null
}

export async function addTrackToPlaylist(playlist: PlaylistSummary, track: Track): Promise<AddToPlaylistResult> {
  const api = getAPI()
  const ids = await api.playlistTrackIds(playlist.id)
  if (ids.includes(track.id)) return 'duplicate'
  await api.setPlaylistTracks(playlist.id, [...ids, track.id])
  invalidatePlaylists()
  return 'added'
}

export async function createPlaylistWith(title: string, trackIds: number[], isPublic: boolean): Promise<PlaylistSummary> {
  const api = getAPI()
  const unique: number[] = []
  const seen = new Set<number>()
  for (const id of trackIds) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  try {
    const created = await api.createPlaylist(title, unique, isPublic)
    invalidatePlaylists()
    return created
  } catch (error) {
    const existing = await findRecentByTitle(title)
    if (existing) {
      invalidatePlaylists()
      return existing
    }
    throw error
  }
}

async function findRecentByTitle(title: string): Promise<PlaylistSummary | null> {
  try {
    const list = await myPlaylists(true)
    const needle = title.trim().toLowerCase()
    const matches = list.filter((item) => (item.title ?? '').trim().toLowerCase() === needle)
    if (matches.length === 0) return null
    return matches.reduce((newest, item) => {
      const a = Date.parse(item.created_at ?? '') || 0
      const b = Date.parse(newest.created_at ?? '') || 0
      return a > b ? item : newest
    }, matches[0])
  } catch {
    return null
  }
}
