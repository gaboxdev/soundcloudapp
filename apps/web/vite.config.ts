import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import {
  REQUEST_TIMEOUT_MS,
  createClientIdCache,
  isAllowedTarget,
  wantsRefresh,
} from '../../proxy/shared/clientid'

const CLIENT_ID_TTL = 20 * 60 * 1000

const clientIds = createClientIdCache(CLIENT_ID_TTL)

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function applyCors(res: ServerResponse): void {
  for (const [key, value] of Object.entries(corsHeaders)) res.setHeader(key, value)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end()
    return
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  applyCors(res)
  res.end(JSON.stringify(body))
}

function preflight(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'OPTIONS') return false
  res.statusCode = 204
  applyCors(res)
  res.end()
  return true
}

function slProxy(): Plugin {
  return {
    name: 'soundclear-proxy',
    configureServer(server) {
      server.middlewares.use('/sl-proxy', async (req: IncomingMessage, res: ServerResponse) => {
        if (preflight(req, res)) return
        try {
          const params = new URL(req.url ?? '', 'http://localhost').searchParams
          const target = params.get('url')
          if (!target) return sendJson(res, 400, { error: 'falta el parámetro url' })
          let upstreamUrl: URL
          try {
            upstreamUrl = new URL(target)
          } catch {
            return sendJson(res, 400, { error: 'url inválida' })
          }
          if (!isAllowedTarget(upstreamUrl)) {
            return sendJson(res, 403, { error: `host no permitido: ${upstreamUrl.hostname}` })
          }
          const injected = !upstreamUrl.searchParams.has('client_id')
          if (injected) upstreamUrl.searchParams.set('client_id', await clientIds.get())
          const headers: Record<string, string> = {}
          const userAgent = req.headers['user-agent']
          if (typeof userAgent === 'string') headers['user-agent'] = userAgent
          const upstream = await fetch(upstreamUrl.toString(), {
            headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          })
          if (upstream.status === 401 && injected) clientIds.invalidate()
          res.statusCode = upstream.status
          const contentType = upstream.headers.get('content-type')
          if (contentType) res.setHeader('Content-Type', contentType)
          applyCors(res)
          res.setHeader('Cache-Control', 'no-store')
          res.end(await upstream.text())
        } catch (error) {
          sendJson(res, 502, { error: String(error) })
        }
      })
      server.middlewares.use('/sl-client-id', async (req: IncomingMessage, res: ServerResponse) => {
        if (preflight(req, res)) return
        try {
          const params = new URL(req.url ?? '', 'http://localhost').searchParams
          const refresh = wantsRefresh(params.get('refresh'))
          const clientId = await clientIds.get(refresh)
          sendJson(res, 200, { client_id: clientId, refreshed: refresh })
        } catch (error) {
          sendJson(res, 502, { error: String(error) })
        }
      })
    },
  }
}

const SW_FILE = 'sw.js'

async function listFiles(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await listFiles(full, base)))
    else files.push(relative(base, full))
  }
  return files
}

async function buildIdFrom(outDir: string): Promise<string> {
  const files = (await listFiles(outDir, outDir)).filter((file) => file !== SW_FILE).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update(await readFile(resolve(outDir, file)))
  }
  return hash.digest('hex').slice(0, 12)
}

function slServiceWorker(): Plugin {
  let outDir = ''
  return {
    name: 'soundclear-sw-version',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    async closeBundle() {
      const file = resolve(outDir, SW_FILE)
      let source: string
      try {
        source = await readFile(file, 'utf8')
      } catch {
        return
      }
      const id = await buildIdFrom(outDir)
      await writeFile(file, source.replace(/__SL_BUILD__/g, id), 'utf8')
    },
  }
}

const appVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0.0.0'

export default defineConfig({
  plugins: [slProxy(), slServiceWorker()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
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
