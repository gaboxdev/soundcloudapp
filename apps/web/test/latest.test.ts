import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestRequest } from '../src/core/latest.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('sesión: una comprobación forzada descarta la respuesta anterior', async () => {
  const before = deferred<string>()
  const after = deferred<string>()
  let calls = 0
  const committed: string[] = []
  const refresh = latestRequest(() => (++calls === 1 ? before.promise : after.promise), (value) => committed.push(value), () => assert.fail())
  const old = refresh()
  const recent = refresh(true)
  after.resolve('guest')
  await recent
  before.resolve('ready')
  await old
  assert.deepEqual(committed, ['guest'])
})

test('sesión: comparte solicitudes normales y puede volver a consultar al terminar', async () => {
  const pending = deferred<number>()
  let calls = 0
  const refresh = latestRequest(() => { calls++; return pending.promise }, () => {}, () => assert.fail())
  const first = refresh()
  assert.equal(refresh(), first)
  pending.resolve(1)
  await first
  await refresh()
  assert.equal(calls, 2)
})

test('sesión: un fallo antiguo no elimina una sesión nueva', async () => {
  const before = deferred<string>()
  const after = deferred<string>()
  let calls = 0
  const failures: unknown[] = []
  const committed: string[] = []
  const refresh = latestRequest(() => (++calls === 1 ? before.promise : after.promise), (value) => committed.push(value), (error) => failures.push(error))
  const old = refresh()
  const recent = refresh(true)
  after.resolve('ready')
  await recent
  before.reject(new Error('401'))
  await old
  assert.deepEqual(committed, ['ready'])
  assert.deepEqual(failures, [])
})
