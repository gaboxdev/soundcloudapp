import './runtime.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAudioGraph } from '../src/player/audiograph.ts'

class FakeParam {
  value = 0
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value
  }
}

class FakeNode {
  disconnects = 0
  connect(): void {}
  disconnect(): void {
    this.disconnects++
  }
}

class FakeContext {
  static instances: FakeContext[] = []
  readonly destination = new FakeNode()
  state: AudioContextState = 'suspended'
  currentTime = 0
  closed = false

  constructor() {
    FakeContext.instances.push(this)
  }

  createBiquadFilter(): FakeNode & { frequency: FakeParam; Q: FakeParam; gain: FakeParam; type: BiquadFilterType } {
    return Object.assign(new FakeNode(), { frequency: new FakeParam(), Q: new FakeParam(), gain: new FakeParam(), type: 'peaking' as BiquadFilterType })
  }

  createGain(): FakeNode & { gain: FakeParam } {
    return Object.assign(new FakeNode(), { gain: new FakeParam() })
  }

  createWaveShaper(): FakeNode & { curve: Float32Array<ArrayBuffer> | null; oversample: OverSampleType } {
    return Object.assign(new FakeNode(), { curve: null, oversample: 'none' as OverSampleType })
  }

  createAnalyser(): FakeNode & { fftSize: number; getFloatTimeDomainData(values: Float32Array): void } {
    return Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData: (values: Float32Array) => values.fill(0) })
  }

  createMediaElementSource(): FakeNode {
    return new FakeNode()
  }

  resume(): Promise<void> {
    this.state = 'running'
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed = true
    this.state = 'closed'
    return Promise.resolve()
  }
}

test('audio graph: dispose libera listeners, nodos y contexto', () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const listeners = new Map<string, Set<EventListener>>()
  const documentStub = {
    addEventListener(type: string, listener: EventListener): void {
      const set = listeners.get(type) ?? new Set<EventListener>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type: string, listener: EventListener): void {
      listeners.get(type)?.delete(listener)
    },
  }
  Object.assign(globalThis, { window: { AudioContext: FakeContext }, document: documentStub })

  try {
    const graph = createAudioGraph([0, 0, 0, 0, 0], false, 1)
    assert.ok(graph)
    graph.route({} as HTMLMediaElement)
    assert.equal(listeners.get('pointerdown')?.size, 1)
    const context = FakeContext.instances.at(-1)
    assert.ok(context)

    graph.dispose()
    graph.dispose()

    assert.equal(context.closed, true)
    assert.equal(listeners.get('pointerdown')?.size, 0)
    assert.equal(listeners.get('keydown')?.size, 0)
    assert.equal(graph.suspended(), true)
    assert.equal(graph.level(), 0)
  } finally {
    Object.assign(globalThis, { window: previousWindow, document: previousDocument })
  }
})
