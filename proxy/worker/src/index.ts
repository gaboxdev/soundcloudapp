const API_HOST = 'api-v2.soundcloud.com'
const CLIENT_ID_URL = 'https://soundcloud.com'
const CLIENT_ID_TTL = 15 * 60 * 1000

let cachedClientId: string | null = null
let cachedAt = 0

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

function extractClientId(html: string): string | null {
  const patterns = [
    /"hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]{16,64})"/,
    /"apiClient"[\s\S]{0,300}?"id":"([A-Za-z0-9]{16,64})"/,
    /client_id:"([A-Za-z0-9]{16,64})"/,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return match[1]
  }
  return null
}

async function resolveClientId(): Promise<string> {
  if (cachedClientId && Date.now() - cachedAt < CLIENT_ID_TTL) return cachedClientId
  const res = await fetch(CLIENT_ID_URL)
  const html = await res.text()
  const id = extractClientId(html)
  if (!id) throw new Error('no se pudo extraer client_id de soundcloud.com')
  cachedClientId = id
  cachedAt = Date.now()
  return id
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
  if (upstreamUrl.hostname !== API_HOST) {
    return json({ error: `host no permitido: ${upstreamUrl.hostname}` }, 403)
  }
  if (!upstreamUrl.searchParams.has('client_id')) {
    upstreamUrl.searchParams.set('client_id', await resolveClientId())
  }
  const headers: Record<string, string> = {}
  const userAgent = request.headers.get('user-agent')
  if (userAgent) headers['user-agent'] = userAgent
  const upstream = await fetch(upstreamUrl.toString(), { headers })
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
        const client_id = await resolveClientId()
        return json({ client_id })
      }
      return json({ error: 'not found' }, 404)
    } catch (error) {
      return json({ error: String(error) }, 502)
    }
  },
} satisfies ExportedHandler
