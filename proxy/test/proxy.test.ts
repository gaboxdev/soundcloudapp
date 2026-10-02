import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../worker/src/index.ts'
import { createClientIdCache, isAllowedTarget } from '../shared/clientid.ts'

const originalFetch = globalThis.fetch

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://proxy.example${path}`, init)
}

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test('proxy whitelist rejects userinfo, non-443 ports, and non-HTTPS origins', () => {
  assert.equal(isAllowedTarget(new URL('https://api-v2.soundcloud.com/tracks')), true)
  assert.equal(isAllowedTarget(new URL('https://api-v2.soundcloud.com:443/tracks')), true)
  assert.equal(isAllowedTarget(new URL('https://user:pass@api-v2.soundcloud.com/tracks')), false)
  assert.equal(isAllowedTarget(new URL('https://api-v2.soundcloud.com:444/tracks')), false)
  assert.equal(isAllowedTarget(new URL('http://api-v2.soundcloud.com/tracks')), false)
})

test('proxy rejects non-GET requests without an upstream call', async () => {
  let upstreamCalls = 0
  globalThis.fetch = async () => {
    upstreamCalls += 1
    return new Response('{}')
  }

  const response = await worker.fetch(request('/sl-proxy?url=https%3A%2F%2Fapi-v2.soundcloud.com%2Ftracks', { method: 'POST' }))

  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET, OPTIONS')
  assert.equal(upstreamCalls, 0)
})

test('proxy does not follow or forward upstream redirects', async () => {
  let options: RequestInit | undefined
  globalThis.fetch = async (input, init) => {
    options = init
    if (new URL(input.toString()).hostname === 'soundcloud.com') {
      return new Response('client_id: "ABCDEFGHIJKLMNOP"', { status: 200 })
    }
    return new Response('', { status: 302, headers: { location: 'https://evil.example' } })
  }

  const response = await worker.fetch(request('/sl-proxy?url=https%3A%2F%2Fapi-v2.soundcloud.com%2Ftracks'))

  assert.equal(response.status, 502)
  assert.equal(response.headers.has('location'), false)
  assert.equal(options?.redirect, 'manual')
})

test('client id responses are not cacheable', async () => {
  globalThis.fetch = async () => new Response('client_id: "ABCDEFGHIJKLMNOP"', { status: 200 })

  const response = await worker.fetch(request('/sl-client-id'))

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('client id cache shares one in-flight load', async () => {
  let calls = 0
  let release: ((response: Response) => void) | undefined
  globalThis.fetch = () => {
    calls += 1
    return new Promise<Response>((resolve) => {
      release = resolve
    })
  }
  const cache = createClientIdCache(60_000)
  const first = cache.get()
  const second = cache.get()

  assert.equal(calls, 1)
  release?.(new Response('client_id: "ABCDEFGHIJKLMNOP"', { status: 200 }))
  assert.equal(await first, 'ABCDEFGHIJKLMNOP')
  assert.equal(await second, 'ABCDEFGHIJKLMNOP')
  assert.equal(calls, 1)
})
