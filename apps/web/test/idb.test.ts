import { test } from 'node:test'
import assert from 'node:assert/strict'
import { completeIdbTransaction, enqueueMutation, type MutationQueue } from '../src/core/idb.ts'

type Handler = (() => void) | null

class FakeRequest<T> {
  result!: T
  error: unknown = null
  onsuccess: Handler = null
  onerror: Handler = null
  private readonly commit: () => void
  private readonly rollback: () => void

  constructor(commit: () => void = () => {}, rollback: () => void = () => {}) {
    this.commit = commit
    this.rollback = rollback
  }

  succeed(value: T): void {
    this.result = value
    this.commit()
    this.onsuccess?.()
  }

  fail(error: Error): void {
    this.error = error
    this.onerror?.()
  }

  undo(): void {
    this.rollback()
  }
}

class FakeTransaction {
  error: unknown = null
  oncomplete: Handler = null
  onerror: Handler = null
  onabort: Handler = null
  private readonly requests: FakeRequest<unknown>[] = []

  request<T>(commit: () => void = () => {}, rollback: () => void = () => {}): FakeRequest<T> {
    const request = new FakeRequest<T>(commit, rollback)
    this.requests.push(request as FakeRequest<unknown>)
    return request
  }

  complete(): void {
    this.oncomplete?.()
  }

  abort(error?: Error): void {
    this.error = error
    for (const request of this.requests) request.undo()
    this.onabort?.()
  }
}

const asIdbTransaction = (transaction: FakeTransaction): IDBTransaction => transaction as unknown as IDBTransaction

test('la transacción no resuelve hasta que IndexedDB confirma', async () => {
  const transaction = new FakeTransaction()
  const request = transaction.request<string>()
  const pending = completeIdbTransaction(asIdbTransaction(transaction), () => request as unknown as IDBRequest<string>)
  request.succeed('guardado')

  let settled = false
  void pending.then(() => {
    settled = true
  })
  await Promise.resolve()
  assert.equal(settled, false)

  transaction.complete()
  assert.equal(await pending, 'guardado')
})

test('un fallo del índice aborta y revierte el audio ya preparado', async () => {
  const audio = new Map<number, string>()
  const index = new Map<number, string>()
  const transaction = new FakeTransaction()
  const audioRequest = transaction.request<number>(() => audio.set(7, 'bytes'), () => audio.delete(7))
  const indexRequest = transaction.request<number>(() => index.set(7, 'metadata'), () => index.delete(7))
  const pending = completeIdbTransaction(asIdbTransaction(transaction), () => [
    audioRequest as unknown as IDBRequest<number>,
    indexRequest as unknown as IDBRequest<number>,
  ])

  audioRequest.succeed(7)
  const failure = new Error('quota')
  indexRequest.fail(failure)

  await assert.rejects(pending, /quota/)
  assert.equal(audio.has(7), false)
  assert.equal(index.has(7), false)
})

test('las mutaciones serializadas vuelven a comprobar el presupuesto', async () => {
  const queue: MutationQueue = { tail: Promise.resolve() }
  let used = 0
  const save = (bytes: number): Promise<boolean> =>
    enqueueMutation(queue, async () => {
      const free = 10 - used
      await Promise.resolve()
      if (bytes > free) return false
      used += bytes
      return true
    })

  assert.deepEqual(await Promise.all([save(7), save(7)]), [true, false])
  assert.equal(used, 7)
})
