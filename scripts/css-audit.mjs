import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'apps/web/src'
const SALTAR_DIR = ['/dev/', 'i18n.en.ts']

// Ganchos que el codigo ya aplica pero que aun no tienen regla: son trabajo a medio
// hacer, no errores. Estan aqui para que la puerta siga sirve para lo nuevo.
const GANCHOS = new Set([
  'btn-label',
  'charts-filter-genre',
  'charts-filter-global',
  'expand-btn',
  'feed-view',
  'now-view',
  'palette-btn',
  'profile-place',
  'shortcuts-modal',
  'tour-window-history',
  'track-time',
  'user-row',
  'view-host',
])

function ficheros(dir, ext, saltando = []) {
  const salida = []
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada).replace(/\\/g, '/')
    if (ruta.includes('/node_modules/')) continue
    if (statSync(ruta).isDirectory()) {
      if (SALTAR_DIR.some((s) => ruta.endsWith(s))) continue
      salida.push(...ficheros(ruta, ext, saltando))
    } else if (ruta.endsWith(ext) && !saltando.some((s) => ruta.includes(s))) {
      salida.push(ruta)
    }
  }
  return salida
}

const css = ficheros(RAIZ, '.css')
const codigo = [...ficheros(RAIZ, '.ts'), 'apps/web/index.html']

const definidas = new Map()
const selectoresDeClase = new Set()
for (const ruta of css) {
  const src = readFileSync(ruta, 'utf8')
  const sinComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of sinComentarios.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) selectoresDeClase.add(m[1])
  for (const m of sinComentarios.matchAll(/^\s*\.(-?[_a-zA-Z][\w-]*)\s*[,{]/gm)) {
    const clase = m[1]
    if (!definidas.has(clase)) definidas.set(clase, [])
    definidas.get(clase).push(ruta)
  }
}

const VALID = /^[a-zA-Z][\w-]*$/
const SIN_CLASE = new Set([
  'true', 'false', 'null', 'undefined', 'class', 'className', 'none', 'inherit',
  'initial', 'unset', 'auto', 'default', 'hidden', 'active', 'visible',
  'index', 'i', 'el', 'item', 'key', 'value', 'type', 'label', 'name',
])

const usadas = new Map()
const anotar = (crudo, ruta) => {
  for (const clase of crudo.split(/\s+/)) {
    if (!VALID.test(clase) || SIN_CLASE.has(clase)) continue
    if (!usadas.has(clase)) usadas.set(clase, [])
    usadas.get(clase).push(ruta)
  }
}

for (const ruta of codigo) {
  const src = readFileSync(ruta, 'utf8')
  for (const m of src.matchAll(/class(?:Name)?\s*[:=]\s*(['"`])([\s\S]*?)\1/g)) anotar(m[2], ruta)
  for (const m of src.matchAll(/\.className\s*=\s*(['"`])([\s\S]*?)\1/g)) anotar(m[2], ruta)
  for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\(\s*(['"`])([^'"`$]+)\1/g)) {
    if (VALID.test(m[2])) anotar(m[2], ruta)
  }
  for (const m of src.matchAll(/class="([^"$<]*)"/g)) anotar(m[1], ruta)
}

const html = readFileSync('apps/web/index.html', 'utf8')
for (const m of html.matchAll(/class="([^"$]*)"/g)) anotar(m[1], 'apps/web/index.html')

const sinDefinir = [...usadas.entries()]
  .filter(([clase]) => !selectoresDeClase.has(clase) && !GANCHOS.has(clase))
  .sort((a, b) => a[0].localeCompare(b[0]))

const ganchosVivos = [...GANCHOS].filter((clase) => usadas.has(clase) && !selectoresDeClase.has(clase))

const sinUsar = [...definidas.keys()]
  .filter((clase) => !usadas.has(clase))
  .sort((a, b) => a.localeCompare(b[0]))

console.log(`clases de CSS con selector: ${selectoresDeClase.size}`)
console.log(`clases usadas en codigo: ${usadas.size}`)
console.log(`\nSIN DEFINIR (se usan pero no hay selector): ${sinDefinir.length}`)
for (const [clase, donde] of sinDefinir) {
  console.log(`  .${clase}  <- ${[...new Set(donde)].slice(0, 3).join(', ')}`)
}
console.log(`\nganchos conocidos sin regla todavia: ${ganchosVivos.length} (${ganchosVivos.join(', ')})`)
console.log(`\nSIN USAR (hay selector pero nadie las usa): ${sinUsar.length}`)
for (const clase of sinUsar) {
  console.log(`  .${clase}  (${definidas.get(clase)[0]})`)
}

if (process.argv.includes('--estricto') && sinDefinir.length > 0) process.exit(1)