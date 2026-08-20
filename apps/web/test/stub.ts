export interface StorageStub {
  store: Map<string, string>
  failAfter: number
}

export function installStorage(failAfter = Infinity): StorageStub {
  const store = new Map<string, string>()
  const stub: StorageStub = { store, failAfter }
  const storage = {
    get length() {
      return store.size
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      if (value.length > stub.failAfter) {
        const error = new Error('QuotaExceededError')
        error.name = 'QuotaExceededError'
        throw error
      }
      store.set(key, value)
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    clear(): void {
      store.clear()
    },
  }
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = storage
  return stub
}

export function installDom(): { dataset: Record<string, string> } {
  const dataset: Record<string, string> = {}
  const nodo = {
    dataset,
    style: {} as Record<string, string>,
    id: '',
    textContent: '',
    setAttribute(): void {},
    appendChild(): void {},
    remove(): void {},
    classList: { add(): void {}, remove(): void {}, toggle(): void {} },
  }
  const document = {
    documentElement: nodo,
    head: nodo,
    body: nodo,
    createElement: () => ({ ...nodo, style: {} as Record<string, string> }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(): void {},
  }
  ;(globalThis as unknown as { document: unknown }).document = document
  ;(globalThis as unknown as { window: unknown }).window = {
    addEventListener(): void {},
    setTimeout: globalThis.setTimeout,
  }
  return { dataset }
}
