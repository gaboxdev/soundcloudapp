import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aheadOf,
  buildOrder,
  dedupeById,
  dropPlayed,
  moveInList,
  nextInOrder,
  removeAt,
  shuffleWith,
  uniqueAppend,
} from '../src/player/queueops.ts'

const cola = (...ids: number[]) => ids.map((id) => ({ id }))
const ids = (items: { id: number }[]) => items.map((item) => item.id)

test('removeAt: quitar antes del actual baja el índice', () => {
  const r = removeAt(cola(1, 2, 3, 4), 0, 2)
  assert.deepEqual(ids(r.queue), [2, 3, 4])
  assert.equal(r.index, 1)
})

test('removeAt: quitar después del actual no lo mueve', () => {
  const r = removeAt(cola(1, 2, 3), 2, 0)
  assert.deepEqual(ids(r.queue), [1, 2])
  assert.equal(r.index, 0)
})

test('removeAt: quitar el actual se queda en la misma posición', () => {
  const r = removeAt(cola(1, 2, 3), 1, 1)
  assert.deepEqual(ids(r.queue), [1, 3])
  assert.equal(r.index, 1)
})

test('removeAt: quitar el último actual retrocede', () => {
  const r = removeAt(cola(1, 2, 3), 2, 2)
  assert.deepEqual(ids(r.queue), [1, 2])
  assert.equal(r.index, 1)
})

test('removeAt: vaciar la cola deja índice -1', () => {
  const r = removeAt(cola(7), 0, 0)
  assert.deepEqual(r.queue, [])
  assert.equal(r.index, -1)
})

test('removeAt: índice fuera de rango no toca nada', () => {
  const original = cola(1, 2)
  const r = removeAt(original, 5, 0)
  assert.equal(r.queue, original)
  assert.equal(r.removed, 0)
})

test('moveInList: mover el actual lo sigue', () => {
  const r = moveInList(cola(1, 2, 3, 4), 0, 2, 0)
  assert.deepEqual(ids(r.queue), [2, 3, 1, 4])
  assert.equal(r.index, 2)
})

test('moveInList: mover de antes a después del actual lo sube', () => {
  const r = moveInList(cola(1, 2, 3, 4), 0, 3, 1)
  assert.deepEqual(ids(r.queue), [2, 3, 4, 1])
  assert.equal(r.index, 0)
})

test('moveInList: mover de después a antes del actual lo baja', () => {
  const r = moveInList(cola(1, 2, 3, 4), 3, 0, 1)
  assert.deepEqual(ids(r.queue), [4, 1, 2, 3])
  assert.equal(r.index, 2)
})

test('moveInList: mismo origen y destino no hace nada', () => {
  const original = cola(1, 2)
  assert.equal(moveInList(original, 1, 1, 0).queue, original)
})

test('moveInList: fuera de rango no hace nada', () => {
  const original = cola(1, 2)
  assert.equal(moveInList(original, 0, 9, 0).queue, original)
  assert.equal(moveInList(original, -1, 0, 0).queue, original)
})

test('dropPlayed: recorta lo ya escuchado', () => {
  const r = dropPlayed(cola(1, 2, 3, 4), 2)
  assert.deepEqual(ids(r.queue), [3, 4])
  assert.equal(r.index, 0)
  assert.equal(r.removed, 2)
})

test('dropPlayed: en la primera pista no hace nada', () => {
  const original = cola(1, 2)
  const r = dropPlayed(original, 0)
  assert.equal(r.queue, original)
  assert.equal(r.removed, 0)
})

test('dedupeById: mantiene el primero de cada id', () => {
  const r = dedupeById(cola(1, 2, 1, 3, 2), 0)
  assert.deepEqual(ids(r.queue), [1, 2, 3])
  assert.equal(r.removed, 2)
})

test('dedupeById: el actual sigue siendo el mismo track', () => {
  const r = dedupeById(cola(9, 4, 9, 7), 3)
  assert.deepEqual(ids(r.queue), [9, 4, 7])
  assert.equal(r.index, 2)
})

test('dedupeById: sin duplicados devuelve la misma cola', () => {
  const original = cola(1, 2, 3)
  const r = dedupeById(original, 1)
  assert.equal(r.queue, original)
  assert.equal(r.removed, 0)
})

test('dedupeById: cola vacía no rompe', () => {
  const r = dedupeById([] as { id: number }[], -1)
  assert.deepEqual(r.queue, [])
  assert.equal(r.removed, 0)
})

test('buildOrder: sin aleatorio es el orden natural', () => {
  assert.deepEqual(buildOrder(4, 1, false), [0, 1, 2, 3])
})

test('buildOrder: con aleatorio el actual va primero', () => {
  const orden = buildOrder(5, 3, true, () => 0.5)
  assert.equal(orden[0], 3)
  assert.equal(orden.length, 5)
  assert.deepEqual([...orden].sort((a, b) => a - b), [0, 1, 2, 3, 4])
})

test('buildOrder: un solo track no se mezcla', () => {
  assert.deepEqual(buildOrder(1, 0, true), [0])
})

test('buildOrder: sin actual válido mezcla todo', () => {
  const orden = buildOrder(3, -1, true, () => 0)
  assert.deepEqual([...orden].sort((a, b) => a - b), [0, 1, 2])
})

test('shuffleWith es determinista con un generador fijo', () => {
  const a = shuffleWith([0, 1, 2, 3, 4], () => 0.42)
  const b = shuffleWith([0, 1, 2, 3, 4], () => 0.42)
  assert.deepEqual(a, b)
  assert.deepEqual([...a].sort((x, y) => x - y), [0, 1, 2, 3, 4])
})

test('nextInOrder: en medio devuelve el siguiente', () => {
  assert.equal(nextInOrder([0, 1, 2], 1, 'off', true), 2)
})

test('nextInOrder: al final sin repetir devuelve null', () => {
  assert.equal(nextInOrder([0, 1, 2], 2, 'off', true), null)
})

test('nextInOrder: al final con repetir todo vuelve al principio', () => {
  assert.equal(nextInOrder([0, 1, 2], 2, 'all', true), 0)
})

test('nextInOrder: repetir todo sin permitir vuelta devuelve null', () => {
  assert.equal(nextInOrder([0, 1, 2], 2, 'all', false), null)
})

test('nextInOrder: índice desconocido empieza por el primero', () => {
  assert.equal(nextInOrder([3, 4, 5], 99, 'off', true), 3)
})

test('nextInOrder: orden vacío devuelve null', () => {
  assert.equal(nextInOrder([], 0, 'all', true), null)
})

test('nextInOrder: respeta el orden aleatorio, no el natural', () => {
  assert.equal(nextInOrder([2, 0, 1], 2, 'off', true), 0)
})

test('aheadOf cuenta lo que queda por delante', () => {
  assert.equal(aheadOf([0, 1, 2, 3], 1), 2)
  assert.equal(aheadOf([0, 1], 1), 0)
  assert.equal(aheadOf([], 0), 0)
  assert.equal(aheadOf([5, 6], 99), 2)
})

test('uniqueAppend no repite lo que ya estaba', () => {
  const r = uniqueAppend(cola(1, 2), cola(2, 3, 3, 4))
  assert.deepEqual(ids(r), [1, 2, 3, 4])
})
