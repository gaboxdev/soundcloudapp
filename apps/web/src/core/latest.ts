export function latestRequest<T>(
  load: () => Promise<T>,
  commit: (value: T) => void,
  fail: (error: unknown) => void,
): (force?: boolean) => Promise<void> {
  let generation = 0
  let pending: Promise<void> | null = null
  return (force = false) => {
    if (pending && !force) return pending
    const current = ++generation
    const run = Promise.resolve()
      .then(load)
      .then((value) => {
        if (current === generation) commit(value)
      }, (error: unknown) => {
        if (current === generation) fail(error)
      })
      .finally(() => {
        if (pending === run) pending = null
      })
    pending = run
    return run
  }
}
