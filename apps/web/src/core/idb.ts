export interface MutationQueue {
  tail: Promise<void>
}

export function enqueueMutation<T>(queue: MutationQueue, task: () => Promise<T>): Promise<T> {
  const result = queue.tail.then(task)
  queue.tail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function completeIdbTransaction<T>(
  transaction: IDBTransaction,
  run: () => IDBRequest<T> | readonly IDBRequest<T>[] | null,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false
    let result: T | undefined
    let requestError: unknown = null

    const fail = (reason: unknown, fallback: string): void => {
      if (settled) return
      settled = true
      reject(reason instanceof Error ? reason : new Error(fallback))
    }

    transaction.oncomplete = () => {
      if (requestError) {
        fail(requestError, 'IndexedDB request failed')
        return
      }
      if (settled) return
      settled = true
      resolve(result)
    }
    transaction.onerror = () => {
      fail(transaction.error ?? requestError, 'IndexedDB transaction failed')
    }
    transaction.onabort = () => {
      fail(transaction.error ?? requestError, 'IndexedDB transaction aborted')
    }

    try {
      const raw = run()
      const requests = raw === null ? [] : Array.isArray(raw) ? raw : [raw]
      const last = requests[requests.length - 1]
      for (const request of requests) {
        request.onsuccess = () => {
          if (request === last) result = request.result
        }
        request.onerror = () => {
          requestError = request.error ?? new Error('IndexedDB request failed')
          try {
            transaction.abort()
          } catch {}
          fail(requestError, 'IndexedDB request failed')
        }
      }
    } catch (error) {
      fail(error, 'IndexedDB transaction setup failed')
      try {
        transaction.abort()
      } catch {
        return
      }
    }
  })
}
