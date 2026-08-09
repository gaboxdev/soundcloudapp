import {
  REQUEST_TIMEOUT_MS,
  createClientIdCache,
  isAllowedTarget,
  wantsRefresh,
} from '../../shared/clientid'

const CLIENT_ID_TTL = 15 * 60 * 1000

const clientIds = createClientIdCache(CLIENT_ID_TTL)

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

async function proxy(request: Request, url: URL): Promise<Response> {
  const target = url.searchParams.get('url')
  if (!target) return json({ error: 'falta el parámetro url' }, 400)
  let upstreamUrl: URL
  try {
    upstreamUrl = new URL(target)
  } catch {
    return json({ error: 'url inválida' }, 400)
  }
  if (!isAllowedTarget(upstreamUrl)) {
    return json({ error: `host no permitido: ${upstreamUrl.hostname}` }, 403)
  }
  const injected = !upstreamUrl.searchParams.has('client_id')
  if (injected) upstreamUrl.searchParams.set('client_id', await clientIds.get())
  const headers: Record<string, string> = {}
  const userAgent = request.headers.get('user-agent')
  if (userAgent) headers['user-agent'] = userAgent
  const upstream = await fetch(upstreamUrl.toString(), {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (upstream.status === 401 && injected) clientIds.invalidate()
  const body = await upstream.text()
  const contentType = upstream.headers.get('content-type') ?? 'application/json; charset=utf-8'
  return new Response(body, {
    status: upstream.status,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }
    try {
      const url = new URL(request.url)
      if (url.pathname === '/sl-proxy') return proxy(request, url)
      if (url.pathname === '/sl-client-id') {
        const refresh = wantsRefresh(url.searchParams.get('refresh'))
        const client_id = await clientIds.get(refresh)
        return json({ client_id, refreshed: refresh })
      }
      return json({ error: 'not found' }, 404)
    } catch (error) {
      return json({ error: String(error) }, 502)
    }
  },
} satisfies ExportedHandler
