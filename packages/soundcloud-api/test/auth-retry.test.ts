import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SoundCloudAPI } from '../src/client.ts'
import { ApiError, type Transport } from '../src/transport.ts'

const API_URL = 'https://api-v2.soundcloud.com'

class FakeTransport implements Transport {
  readonly clientIds: string[] = []
  readonly requests: Array<{ method: string; url: string }> = []
  readonly jsonRequests: string[] = []
  authStatus: number | null = 401
  alwaysUnauthorized = false
  authResponse: unknown = { id: 7, username: 'tester' }
  jsonResponse: unknown = { collection: [], next_href: null }

  getClientId(refresh = false): Promise<string> {
    const id = refresh ? 'new-client-id-123456' : 'old-client-id-123456'
    this.clientIds.push(id)
    return Promise.resolve(id)
  }

  async getJSON(url: string): Promise<unknown> {
    this.jsonRequests.push(url)
    if (this.jsonRequests.length === 1 && this.authStatus === 401) throw new ApiError(401, 'expired client id')
    return this.jsonResponse
  }

  rewriteHref(href: string): string {
    return href
  }

  async authedRequest(method: string, url: string): Promise<unknown> {
    this.requests.push({ method, url })
    if (this.authStatus !== null && (this.requests.length === 1 || this.alwaysUnauthorized)) {
      throw new ApiError(this.authStatus, 'unauthorized')
    }
    return this.authResponse
  }
}

test('page retries a 401 once with a fresh client id', async () => {
  const transport = new FakeTransport()
  transport.authStatus = 401
  transport.jsonResponse = { collection: [{ id: 1 }], next_href: null }
  const api = new SoundCloudAPI(transport)

  const response = await api.page<{ id: number }>(`${API_URL}/tracks?cursor=abc`)

  assert.deepEqual(response.collection, [{ id: 1 }])
  assert.deepEqual(transport.clientIds, ['old-client-id-123456', 'new-client-id-123456'])
  assert.deepEqual(
    transport.jsonRequests.map((url) => new URL(url).searchParams.get('client_id')),
    ['old-client-id-123456', 'new-client-id-123456'],
  )
  assert.equal(new URL(transport.jsonRequests[1]).searchParams.get('cursor'), 'abc')
})

test('authenticated reads retry once and preserve a cursor', async () => {
  const transport = new FakeTransport()
  transport.authResponse = { collection: [{ id: 4 }], next_href: `${API_URL}/users/7/likes?cursor=next` }
  const api = new SoundCloudAPI(transport)

  const response = await api.meLikes(7, 50, `${API_URL}/users/7/likes?cursor=previous`)

  assert.deepEqual(response.collection, [{ id: 4 }])
  assert.equal(transport.requests.length, 2)
  assert.deepEqual(
    transport.requests.map(({ url }) => new URL(url).searchParams.get('client_id')),
    ['old-client-id-123456', 'new-client-id-123456'],
  )
  assert.deepEqual(
    transport.requests.map(({ url }) => new URL(url).searchParams.get('cursor')),
    ['previous', 'previous'],
  )
})

test('me returns guest after the single refresh retry is also unauthorized', async () => {
  const transport = new FakeTransport()
  transport.alwaysUnauthorized = true
  const api = new SoundCloudAPI(transport)

  assert.equal(await api.me(), null)
  assert.equal(transport.requests.length, 2)
  assert.deepEqual(transport.clientIds, ['old-client-id-123456', 'new-client-id-123456'])
})

test('writes never use the authenticated read retry', async () => {
  const transport = new FakeTransport()
  transport.authStatus = 401
  const api = new SoundCloudAPI(transport)

  await assert.rejects(() => api.createPlaylist('one', []), (error: unknown) => error instanceof ApiError && error.status === 401)
  assert.equal(transport.requests.length, 1)
  assert.deepEqual(transport.clientIds, ['old-client-id-123456'])
})

test('absolute hostile API hrefs are rejected before client id lookup', async () => {
  const transport = new FakeTransport()
  const api = new SoundCloudAPI(transport)

  for (const href of [
    'http://api-v2.soundcloud.com/tracks',
    'https://api-v2.soundcloud.com:444/tracks',
    'https://user:pass@api-v2.soundcloud.com/tracks',
    'https://evil.example/tracks',
  ]) {
    await assert.rejects(() => api.page(href), /href de API/)
  }
  assert.deepEqual(transport.clientIds, [])
})
