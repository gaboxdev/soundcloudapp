import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'apps/web/src'
const EXCLUIR = ['/dev/', '/test/', 'i18n', 'sw.js']
const FICHEROS_UI = [
  'components/welcome.ts',
  'app.ts',
  'player/audiograph.ts',
  'ui/toast.ts',
  'ui/modal.ts',
  'ui/artwork.ts',
  'ui/skeleton.ts',
  'core/account.ts',
  'views/playlist.ts',
  'components/header.ts',
  'components/playerbar.ts',
  'components/trackrow.ts',
  'components/logingate.ts',
  'components/palette.ts',
  'components/menu.ts',
  'components/shortcuts.ts',
  'components/playlistpicker.ts',
  'core/shortcuts.ts',
  'core/links.ts',
  'core/download.ts',
  'core/offline.ts',
  'core/social.ts',
  'views/home.ts',
  'views/charts.ts',
  'views/search.ts',
  'views/track.ts',
  'views/playlist.ts',
  'views/user.ts',
  'views/queue.ts',
  'views/now.ts',
  'views/feed.ts',
  'views/likes.ts',
  'views/explore.ts',
  'views/settings.ts',
  'player/player.ts',
  'mini/mini.ts',
]

const esCandidato = (v) => {
  if (!/[a-záéíóúñ]/i.test(v)) return false
  if (/[<>{}]|^https?:|^sl:|^\.\.?\/|^data:|^audio\/|^image\//.test(v)) return false
  if (/^[a-z0-9-]+( [a-z0-9-]+)*$/.test(v)) return false
  if (!/[áéíóúñ¿¡]/i.test(v) && !/^[A-ZÁÉÍÓÚ¿¡]/.test(v)) return false
  if (v.length < 3) return false
  return true
}

const PROHIBIDO_ANTES = /(className|class|dataset|id|role|type|href|src|icon|name|command|slug|label:\s*$|key|event|selector|tag)\s*[:=]\s*$/

function envolver(ruta) {
  const abs = join(RAIZ, ruta)
  let src = readFileSync(abs, 'utf8')
  const encontrados = []
  let salida = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === "'" ) {
      let j = i + 1
      let valor = ''
      let escapado = false
      while (j < src.length) {
        const d = src[j]
        if (escapado) { valor += d; escapado = false; j++; continue }
        if (d === '\\') { valor += d; escapado = true; j++; continue }
        if (d === "'") break
        if (d === '\n') { valor = null; break }
        valor += d
        j++
      }
      if (valor !== null && j < src.length) {
        const antes = salida.slice(-40)
        const despues = src.slice(j + 1, j + 3)
        const dentroDeImport = /from\s*$|import\s*\(\s*$/.test(antes)
        const esClave = /^\s*:/.test(despues)
        if (esCandidato(valor) && !PROHIBIDO_ANTES.test(antes) && !dentroDeImport && !esClave && !/(?<![A-Za-z])t\($/.test(antes)) {
          salida += `t('${valor}')`
          encontrados.push(valor)
          i = j + 1
          continue
        }
        salida += src.slice(i, j + 1)
        i = j + 1
        continue
      }
    }
    salida += c
    i++
  }
  if (encontrados.length > 0 && !/from '\.\.?\/core\/i18n\.ts'/.test(salida)) {
    const lineas = salida.split('\n')
    const ultimoImport = lineas.reduce((acc, linea, idx) => (linea.startsWith('import ') ? idx : acc), -1)
    const prefijo = ruta.includes('/') ? '../' : './'
    const especificador = ruta.startsWith('core/') ? './i18n.ts' : `${prefijo}core/i18n.ts`
    lineas.splice(ultimoImport + 1, 0, `import { t } from '${especificador}'`)
    salida = lineas.join('\n')
  }
  writeFileSync(abs, salida)
  return encontrados
}

const todos = new Map()
for (const ruta of FICHEROS_UI) {
  try {
    statSync(join(RAIZ, ruta))
  } catch {
    console.log(`(no existe) ${ruta}`)
    continue
  }
  const encontrados = envolver(ruta)
  console.log(`${String(encontrados.length).padStart(3)} ${ruta}`)
  for (const texto of encontrados) todos.set(texto, (todos.get(texto) ?? 0) + 1)
}
writeFileSync('scripts/i18n-strings.json', JSON.stringify([...todos.keys()].sort(), null, 1))
console.log(`\n${todos.size} cadenas distintas -> scripts/i18n-strings.json`)
void readdirSync
void EXCLUIR
