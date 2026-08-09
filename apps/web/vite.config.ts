import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

const CLIENT_ID_TTL = 20 * 60 * 1000
const CLIENT_ID_URL = 'https://soundcloud.com'

let cachedClientId: string | null = null
let cachedAt = 0

function extractClientId(html: string): string | null {
  const patterns = [
    /"hydratable":"apiClient","data":{"id":"([A-Za-z0-9]{16,64})"/,
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(JSON.stringify(body))
}

function slProxy(): Plugin {
  return {
    name: 'soundlite-proxy',
    configureServer(server) {
      server.middlewares.use('/sl-proxy', async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')
          if (!url) return sendJson(res, 400, { error: 'falta el parámetro url' })
          const upstream = await fetch(url)
          res.statusCode = upstream.status
          const contentType = upstream.headers.get('content-type')
          if (contentType) res.setHeader('Content-Type', contentType)
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Cache-Control', 'no-store')
          res.end(await upstream.text())
        } catch (error) {
          sendJson(res, 502, { error: String(error) })
        }
      })
      server.middlewares.use('/sl-client-id', async (_req: IncomingMessage, res: ServerResponse) => {
        try {
          const clientId = await resolveClientId()
          sendJson(res, 200, { client_id: clientId })
        } catch (error) {
          sendJson(res, 502, { error: String(error) })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [slProxy()],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          hls: ['hls.js'],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
