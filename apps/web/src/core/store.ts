export interface Store<T> {
  get(): T
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void
  subscribe(fn: (state: T) => void): () => void
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state: T = { ...initial }
  const listeners = new Set<(state: T) => void>()
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
      for (const fn of [...listeners]) {
        if (!listeners.has(fn)) continue
        try {
          fn(state)
        } catch (error) {
          console.error('store listener', error)
        }
      }
    },
    subscribe(fn) {
      listeners.add(fn)
      try {
        fn(state)
      } catch (error) {
        console.error('store listener', error)
      }
      return () => listeners.delete(fn)
    },
  }
}
