import './runtime.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { User, Playlist, Track } from '@soundclear/api'
import { installDom, installStorage } from './stub.ts'
import { deferred } from './runtime.ts'

installStorage()
installDom()
Object.assign(globalThis, { HTMLElement: class {} })
Object.assign(window, { __TAURI_INTERNALS__: {} })

const { getAPI } = await import('../src/api/index.ts')
const { accountStore } = await import('../src/core/account.ts')
const { initSocial, loadSocial, socialStore, toggleFollow, myPlaylists, addTrackToPlaylist } = await import('../src/core/social.ts')
const api = getAPI()
api.followingIds = async () => []
api.repostIds = async () => []
initSocial()
const account = (id: number) => accountStore.set({ status: 'ready', user: { id } as User })
const logout = () => accountStore.set({ status: 'guest', user: null })

test('social: las respuestas de la cuenta anterior no pisan la cuenta nueva', async () => {
  logout()
  const oldFollowing = deferred<number[]>()
  const newFollowing = deferred<number[]>()
  const oldReposts = deferred<number[]>()
  const newReposts = deferred<number[]>()
  api.followingIds = (id) => id === 1 ? oldFollowing.promise : newFollowing.promise
  api.repostIds = () => accountStore.get().user?.id === 1 ? oldReposts.promise : newReposts.promise
  account(1)
  const old = loadSocial()
  account(2)
  const recent = loadSocial()
  newFollowing.resolve([22])
  newReposts.resolve([23])
  await recent
  oldFollowing.resolve([11])
  oldReposts.resolve([12])
  await old
  assert.deepEqual([...socialStore.get().followingIds], [22])
  assert.deepEqual([...socialStore.get().repostIds], [23])
  logout()
  assert.equal(socialStore.get().followingIds.size, 0)
  assert.equal(socialStore.get().repostIds.size, 0)
  assert.equal(socialStore.get().knownFollowing, false)
})

test('social: cerrar sesión invalida una carga en curso', async () => {
  const following = deferred<number[]>()
  api.followingIds = () => following.promise
  api.repostIds = async () => [32]
  account(3)
  const pending = loadSocial()
  logout()
  following.resolve([31])
  await pending
  assert.equal(socialStore.get().followingIds.size, 0)
  assert.equal(socialStore.get().repostIds.size, 0)
  assert.equal(socialStore.get().knownReposts, false)
})

test('social: el fallo de una escritura antigua no modifica la nueva cuenta', async () => {
  api.followingIds = async () => []
  api.repostIds = async () => []
  account(4)
  await loadSocial()
  const write = deferred<void>()
  api.setFollowing = () => write.promise
  const pending = toggleFollow({ id: 77, username: 'artista' } as User)
  assert.equal(socialStore.get().followingIds.has(77), true)
  account(5)
  await loadSocial()
  write.reject(new Error('offline'))
  await pending
  assert.equal(socialStore.get().followingIds.size, 0)
  assert.equal(socialStore.get().busy.size, 0)
  logout()
})

test('social: una lista privada pendiente no se publica después de cerrar sesión', async () => {
  account(6)
  await loadSocial()
  const response = deferred<{ collection: Playlist[]; next_href: null }>()
  api.mePlaylists = () => response.promise
  const pending = myPlaylists(true)
  logout()
  response.resolve({ collection: [{ id: 88, kind: 'playlist', user_id: 6 } as Playlist], next_href: null })
  assert.deepEqual(await pending, [])
})

test('social: espera el estado inicial antes de alternar y recarga una lectura interrumpida', async () => {
  logout()
  const initial = deferred<number[]>()
  const refresh = deferred<number[]>()
  const write = deferred<void>()
  let reads = 0
  let writes = 0
  let requested: boolean | undefined
  api.followingIds = () => ++reads === 1 ? initial.promise : reads === 2 ? refresh.promise : Promise.resolve([70])
  api.repostIds = async () => [71]
  api.setFollowing = async (_id, enabled) => {
    writes++
    requested = enabled
    await write.promise
  }
  account(7)
  const toggle = toggleFollow({ id: 77, username: 'artista' } as User)
  assert.equal(writes, 0)
  initial.resolve([70, 77])
  await loadSocial()
  await Promise.resolve()
  assert.equal(requested, false)
  const interrupted = loadSocial(true)
  write.resolve()
  await toggle
  refresh.resolve([70, 77])
  await interrupted
  await loadSocial()
  assert.deepEqual([...socialStore.get().followingIds], [70])
  assert.deepEqual([...socialStore.get().repostIds], [71])
  assert.equal(socialStore.get().knownFollowing, true)
  logout()
})

test('playlists: dos añadidos simultáneos conservan ambos tracks', async () => {
  api.followingIds = async () => []
  api.repostIds = async () => []
  account(8)
  await loadSocial()
  let ids = [10]
  let reads = 0
  const firstWrite = deferred<void>()
  const writing = deferred<void>()
  api.playlistTrackIds = async () => { reads++; return [...ids] }
  api.setPlaylistTracks = async (_id, next) => {
    if (next.includes(11) && !next.includes(12)) {
      writing.resolve()
      await firstWrite.promise
    }
    ids = next
  }
  const playlist = { id: 90 } as Playlist
  const first = addTrackToPlaylist(playlist, { id: 11 } as Track)
  const second = addTrackToPlaylist(playlist, { id: 12 } as Track)
  await writing.promise
  assert.equal(reads, 1)
  firstWrite.resolve()
  assert.deepEqual(await Promise.all([first, second]), ['added', 'added'])
  assert.deepEqual(ids, [10, 11, 12])
  logout()
})

test('playlists: sigue el cursor autenticado y conserva las playlists privadas', async () => {
  account(9)
  await loadSocial()
  const calls: Array<string | null> = []
  api.mePlaylists = async (_user, _limit, next = null) => {
    calls.push(next)
    return { collection: [{ id: next ? 92 : 91, kind: 'playlist', title: 'privada', user_id: 9 } as Playlist], next_href: next ? null : 'https://api-v2.soundcloud.com/cursor' }
  }
  assert.deepEqual((await myPlaylists(true)).map((item) => item.id), [91, 92])
  assert.deepEqual(calls, [null, 'https://api-v2.soundcloud.com/cursor'])
  logout()
})
