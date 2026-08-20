const BASE = 'https://api-v2.soundcloud.com'
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const TIMEOUT = 12000

async function texto(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT) })
  return res.text()
}

async function clientId() {
  const html = await texto('https://soundcloud.com/discover')
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1])
  for (const src of scripts.reverse()) {
    const code = await texto(src)
    const match = /client_id\s*[:=]\s*"([a-zA-Z0-9]{20,})"/.exec(code)
    if (match) return match[1]
  }
  throw new Error('no se pudo extraer el client_id de soundcloud.com')
}

function sondas(id) {
  const q = (path, params = {}) => {
    const url = new URL(path.startsWith('http') ? path : BASE + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    url.searchParams.set('client_id', id)
    return url.toString()
  }
  return [
    { nombre: 'search/tracks', url: q('/search/tracks', { q: 'house', limit: 3 }), critico: true, comprueba: (d) => Array.isArray(d.collection) && d.collection.length > 0 },
    { nombre: 'filtro de duración', url: q('/search/tracks', { q: 'house', limit: 3, 'filter.duration': 'short' }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'tracks?ids=', url: q('/tracks', { ids: '2325522620' }), critico: true, comprueba: (d) => Array.isArray(d) && d.length === 1 && d[0].media?.transcodings?.length > 0 },
    { nombre: 'charts trending', url: q('/charts', { kind: 'trending', genre: 'soundcloud:genres:all-music', limit: 3 }), critico: true, comprueba: (d) => Array.isArray(d.collection) && d.collection.length > 0 },
    { nombre: 'recent-tracks por género', url: q('/recent-tracks/house', { limit: 3 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'mixed-selections', url: q('/mixed-selections', { limit: 3 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'estación de track', url: q('/stations/soundcloud:track-stations:2325522620/tracks', { limit: 5 }), critico: false, comprueba: (d) => Array.isArray(d.collection) && d.collection.length > 0 },
    { nombre: 'perfil de usuario', url: q('/users/12025'), critico: true, comprueba: (d) => typeof d.username === 'string' },
    { nombre: 'toptracks de usuario', url: q('/users/203410014/toptracks', { limit: 3 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'artistas relacionados', url: q('/users/203410014/relatedartists', { limit: 3 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'likes de usuario (cursor)', url: q('/users/12025/likes', { limit: 3, linked_partitioning: 1 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'stream público de usuario', url: q('/stream/users/203410014', { limit: 3, linked_partitioning: 1 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'comentarios con threaded', url: q('/tracks/2325522620/comments', { threaded: 1, limit: 3 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'aparece en playlists', url: q('/tracks/2325522620/playlists_without_albums', { limit: 3 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
    { nombre: 'resolve de enlace', url: q('/resolve', { url: 'https://soundcloud.com/deadmau5' }), critico: true, comprueba: (d) => d.kind === 'user' },
    { nombre: 'sugerencias de búsqueda', url: q('/search/queries', { q: 'jaz', limit: 3 }), critico: false, comprueba: (d) => Array.isArray(d.collection) },
  ]
}

async function correr(sonda) {
  try {
    const res = await fetch(sonda.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT) })
    if (!res.ok) return { ok: false, detalle: `HTTP ${res.status}` }
    const data = await res.json()
    return sonda.comprueba(data) ? { ok: true, detalle: 'ok' } : { ok: false, detalle: 'respondió con otra forma' }
  } catch (error) {
    return { ok: false, detalle: String(error).slice(0, 60) }
  }
}

async function main() {
  const soloStream = process.argv.includes('--transcoding')
  const id = await clientId()
  console.log(`client_id: ${id.slice(0, 6)}… (${id.length} caracteres)\n`)
  const lista = sondas(id)
  let fallosCriticos = 0
  let fallos = 0
  for (const sonda of lista) {
    const r = await correr(sonda)
    if (!r.ok) {
      fallos++
      if (sonda.critico) fallosCriticos++
    }
    const marca = r.ok ? 'OK   ' : sonda.critico ? 'FALLA' : 'ojo  '
    console.log(`${marca} ${sonda.nombre.padEnd(28)} ${r.ok ? '' : r.detalle}`)
  }
  if (soloStream) {
    const tracks = await fetch(`${BASE}/tracks?ids=2325522620&client_id=${id}`, { headers: { 'user-agent': UA } }).then((r) => r.json())
    const plano = (tracks[0].media?.transcodings ?? []).find((t) => t.format.protocol === 'progressive')
    if (plano) {
      const sobre = await fetch(`${plano.url}?client_id=${id}`, { headers: { 'user-agent': UA } })
      const cuerpo = await sobre.json().catch(() => ({}))
      console.log(`\nenvelope progresivo: HTTP ${sobre.status} ${cuerpo.url ? 'con url' : 'sin url'}`)
    }
  }
  console.log(`\n${lista.length - fallos}/${lista.length} sondas en verde`)
  if (fallosCriticos > 0) {
    console.error(`\n${fallosCriticos} endpoint(s) CRÍTICO(s) cambiaron: la app se rompe hasta arreglarlo.`)
    process.exit(1)
  }
  if (fallos > 0) console.log('Los avisos "ojo" degradan funciones, no rompen la app.')
}

main().catch((error) => {
  console.error(`la sonda no pudo arrancar: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(2)
})
