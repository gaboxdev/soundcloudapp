import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installStorage } from './stub.ts'

const almacen = installStorage()
const { loadHistory, loadLikes, saveHistory, saveLikes } = await import('../src/core/library.ts')

const pista = (id: number) => ({ id, title: `t${id}` }) as never
const entrada = (id: number) => ({ track: pista(id), playedAt: 1000 + id }) as never

test('librería: guardar y leer favoritos', () => {
  almacen.store.clear()
  almacen.failAfter = Infinity
  saveLikes([pista(1), pista(2)])
  assert.deepEqual(loadLikes().map((t) => t.id), [1, 2])
})

test('librería: los favoritos se recortan a 500', () => {
  almacen.store.clear()
  almacen.failAfter = Infinity
  saveLikes(Array.from({ length: 700 }, (_, i) => pista(i)))
  assert.equal(loadLikes().length, 500)
})

test('librería: descarta lo que no es un track', () => {
  almacen.store.clear()
  almacen.failAfter = Infinity
  almacen.store.set('sl:likes', JSON.stringify([{ id: 5 }, { nope: true }, null, 7, { id: 'x' }]))
  assert.deepEqual(loadLikes().map((t) => t.id), [5])
})

test('librería: un JSON corrupto se lee como lista vacía', () => {
  almacen.store.clear()
  almacen.store.set('sl:likes', '{roto')
  assert.deepEqual(loadLikes(), [])
})

test('librería: si no cabe, guarda menos favoritos en vez de perderlos todos', () => {
  almacen.store.clear()
  almacen.failAfter = 3000
  saveLikes(Array.from({ length: 500 }, (_, i) => pista(i)))
  const guardados = loadLikes()
  assert.ok(guardados.length > 0, 'debería haber guardado algo')
  assert.ok(guardados.length <= 200, `esperaba el plan B, guardó ${guardados.length}`)
})

test('librería: si no cabe nada, deja la clave limpia en vez de dejar basura', () => {
  almacen.store.clear()
  almacen.failAfter = 5
  saveLikes(Array.from({ length: 100 }, (_, i) => pista(i)))
  assert.equal(almacen.store.has('sl:likes'), false)
})

test('librería: el historial se recorta a 200', () => {
  almacen.store.clear()
  almacen.failAfter = Infinity
  saveHistory(Array.from({ length: 320 }, (_, i) => entrada(i)))
  assert.equal(loadHistory().length, 200)
})

test('librería: el historial descarta entradas sin marca de tiempo', () => {
  almacen.store.clear()
  almacen.failAfter = Infinity
  almacen.store.set(
    'sl:history',
    JSON.stringify([{ track: { id: 1 }, playedAt: 5 }, { track: { id: 2 } }, { playedAt: 9 }, { track: { id: 3 }, playedAt: 'ayer' }]),
  )
  assert.deepEqual(loadHistory().map((e) => e.track.id), [1])
})

test('librería: el historial también tiene plan B de cuota', () => {
  almacen.store.clear()
  almacen.failAfter = 2000
  saveHistory(Array.from({ length: 200 }, (_, i) => entrada(i)))
  assert.ok(loadHistory().length <= 50)
})
