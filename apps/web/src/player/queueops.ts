export interface QueueItem {
  id: number
}

export type RepeatMode = 'off' | 'all' | 'one'

export interface QueueChange<T> {
  queue: T[]
  index: number
  removed: number
}

export function removeAt<T>(queue: T[], index: number, current: number): QueueChange<T> {
  if (index < 0 || index >= queue.length) return { queue, index: current, removed: 0 }
  const next = queue.filter((_, i) => i !== index)
  let nextIndex = current
  if (index === current) nextIndex = next.length === 0 ? -1 : Math.min(index, next.length - 1)
  else if (index < current) nextIndex = current - 1
  return { queue: next, index: nextIndex, removed: 1 }
}

export function moveInList<T>(queue: T[], from: number, to: number, current: number): QueueChange<T> {
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) {
    return { queue, index: current, removed: 0 }
  }
  const next = [...queue]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  let nextIndex = current
  if (current === from) nextIndex = to
  else if (from < current && to >= current) nextIndex = current - 1
  else if (from > current && to <= current) nextIndex = current + 1
  return { queue: next, index: nextIndex, removed: 0 }
}

export function dropPlayed<T>(queue: T[], current: number): QueueChange<T> {
  if (current <= 0) return { queue, index: current, removed: 0 }
  return { queue: queue.slice(current), index: 0, removed: current }
}

export function dedupeById<T extends QueueItem>(queue: T[], current: number): QueueChange<T> {
  const seen = new Set<number>()
  const currentId = queue[current]?.id ?? null
  const next: T[] = []
  for (const item of queue) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    next.push(item)
  }
  const removed = queue.length - next.length
  if (removed === 0) return { queue, index: current, removed: 0 }
  const nextIndex = currentId === null ? -1 : next.findIndex((item) => item.id === currentId)
  return { queue: next, index: nextIndex, removed }
}

export function buildOrder(length: number, current: number, shuffled: boolean, roll: () => number = Math.random): number[] {
  const all = Array.from({ length }, (_, i) => i)
  if (!shuffled || length <= 1) return all
  if (current < 0 || current >= length) return shuffleWith(all, roll)
  const rest = all.filter((i) => i !== current)
  return [current, ...shuffleWith(rest, roll)]
}

export function shuffleWith(items: number[], roll: () => number = Math.random): number[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(roll() * (i + 1))
    const swap = copy[i]
    copy[i] = copy[j]
    copy[j] = swap
  }
  return copy
}

export function nextInOrder(order: number[], current: number, repeat: RepeatMode, allowWrap: boolean): number | null {
  if (order.length === 0) return null
  const position = order.indexOf(current)
  if (position === -1) return order[0] ?? null
  if (position + 1 < order.length) return order[position + 1]
  if (repeat === 'all' && allowWrap) return order[0] ?? null
  return null
}

export function aheadOf(order: number[], current: number): number {
  if (order.length === 0) return 0
  const position = order.indexOf(current)
  if (position === -1) return order.length
  return order.length - position - 1
}

export function uniqueAppend<T extends QueueItem>(queue: T[], items: T[]): T[] {
  const seen = new Set(queue.map((item) => item.id))
  const next = [...queue]
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    next.push(item)
  }
  return next
}
