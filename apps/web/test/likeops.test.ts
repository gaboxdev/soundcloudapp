import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmedLikeState, mergeLikeTracks, rememberLikeBaseline } from '../src/player/likeops.ts'

const track = (id: number, title = `t${id}`) => ({ id, title }) as never

test('favoritos: dos fallos serializados recuperan el baseline falso', () => {
  const confirmed = new Map<number, boolean>()
  rememberLikeBaseline(confirmed, 17, false)
  rememberLikeBaseline(confirmed, 17, true)

  assert.equal(confirmedLikeState(confirmed, 17, true), false)
})

test('favoritos: la sincronización conserva una mutación local posterior', () => {
  const remote = [track(1), track(2)]
  const local = [track(3, 'local'), track(1, 'local')]
  const merged = mergeLikeTracks(remote, local, [
    { id: 1, liked: true },
    { id: 2, liked: false },
    { id: 3, liked: true },
  ])

  assert.deepEqual(merged.map((item) => item.id), [1, 3])
  assert.equal(merged[0].title, 'local')
})

test('favoritos: una reversión local vuelve a incluir un track remoto quitado', () => {
  const merged = mergeLikeTracks([track(1), track(2)], [track(1), track(2)], [{ id: 1, liked: false }])

  assert.deepEqual(merged.map((item) => item.id), [2])
})

test('favoritos: el orden remoto se conserva y los nuevos van al final', () => {
  const merged = mergeLikeTracks([track(4), track(2)], [track(7), track(2)], [{ id: 7, liked: true }])

  assert.deepEqual(merged.map((item) => item.id), [4, 2, 7])
})
