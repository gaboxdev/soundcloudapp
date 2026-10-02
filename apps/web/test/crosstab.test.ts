import './runtime.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installDom } from './stub.ts'

installDom()

const { initCrossTab, claimPlayback, releasePlayback, crossTabReady, closeCrossTab } = await import(
  '../src/core/crosstab.ts'
)

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
const cede = async () => {
  const cedes: number[] = []
  initCrossTab(() => cedes.push(1))
  return cedes
}

test('crosstab: solo una pestana suena a la vez', async (t) => {
  const cedes = await cede()
  assert.equal(crossTabReady(), true, 'sin BroadcastChannel no habria coordinacion')

  await t.test('reclamar no cede nada por si mismo', () => {
    claimPlayback()
    assert.deepEqual(cedes, [])
  })

  await t.test('otra pestana que empieza hace ceder a esta', async () => {
    const otra = new BroadcastChannel('sl:player')
    otra.postMessage({ type: 'playing', from: 'otra-pestana' })
    await tick()
    assert.equal(cedes.length, 1)
    otra.close()
  })

  await t.test('tras ceder no vuelve a ceder: no hay bucle entre pestanas', async () => {
    const otra = new BroadcastChannel('sl:player')
    otra.postMessage({ type: 'playing', from: 'otra-pestana' })
    otra.postMessage({ type: 'playing', from: 'otra-pestana' })
    otra.postMessage({ type: 'playing', from: 'otra' })
    await tick()
    assert.equal(cedes.length, 1, 'esta pestana ya esta pausada: seguir cediendo seria un bucle')
    otra.close()
  })

  await t.test('volver a reclamar recupera el control', async () => {
    claimPlayback()
    const otra = new BroadcastChannel('sl:player')
    otra.postMessage({ type: 'playing', from: 'otra-pestana' })
    await tick()
    assert.equal(cedes.length, 2, 'si vuelve a sonar, vuelve a poder ceder')
    otra.close()
  })

  await t.test('un aviso de pausa ajena no provoca cesion', async () => {
    releasePlayback()
    const antes = cedes.length
    const otra = new BroadcastChannel('sl:player')
    otra.postMessage({ type: 'paused', from: 'otra-pestana' })
    await tick()
    assert.equal(cedes.length, antes)
    otra.close()
  })

  closeCrossTab()
})

test('crosstab: init repetido no pisa el manejador original', async () => {
  const cedes = await cede()
  const otros: number[] = []
  assert.equal(initCrossTab(() => otros.push(1)), true)
  assert.equal(crossTabReady(), true)

  claimPlayback()
  const otra = new BroadcastChannel('sl:player')
  otra.postMessage({ type: 'playing', from: 'otra-pestana' })
  await tick()
  assert.equal(cedes.length, 1)
  assert.equal(otros.length, 0, 'el segundo init no debe reemplazar al primero')
  otra.close()

  closeCrossTab()
})
