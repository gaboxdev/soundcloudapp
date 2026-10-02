const CHANNEL = 'sl:player'
const TAB_ID = Math.random().toString(36).slice(2, 10)

type Message = { type: 'playing' | 'paused'; from: string }

let channel: BroadcastChannel | null = null
let onYield: (() => void) | null = null
let claimed = false

export function initCrossTab(yieldPlayback: () => void): boolean {
  if (typeof BroadcastChannel === 'undefined') return false
  if (channel) return true
  onYield = yieldPlayback
  channel = new BroadcastChannel(CHANNEL)
  channel.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as Message | null
    if (!data || data.from === TAB_ID) return
    if (data.type !== 'playing' || !claimed) return
    claimed = false
    onYield?.()
  })
  return true
}

export function claimPlayback(): void {
  if (claimed || !channel) return
  claimed = true
  channel.postMessage({ type: 'playing', from: TAB_ID } satisfies Message)
}

export function releasePlayback(): void {
  if (!claimed || !channel) return
  claimed = false
  channel.postMessage({ type: 'paused', from: TAB_ID } satisfies Message)
}

export function crossTabReady(): boolean {
  return channel !== null
}

export function closeCrossTab(): void {
  channel?.close()
  channel = null
  onYield = null
  claimed = false
}
