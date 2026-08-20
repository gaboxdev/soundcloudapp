import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = 'apps/web/src'
const SALTAR = ['/dev/', '/test/', 'i18n.en.ts', 'i18n.ts']

function ficheros(dir) {
  const salida = []
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada)
    if (statSync(ruta).isDirectory()) salida.push(...ficheros(ruta))
    else if (ruta.endsWith('.ts') && !SALTAR.some((s) => ruta.includes(s))) salida.push(ruta)
  }
  return salida
}

const esCandidato = (v) => {
  if (!/[a-záéíóúñ]/i.test(v)) return false
  if (/[<>{}]|^https?:|^sl:|^\.\.?\/|^data:|^audio\/|^image\//.test(v)) return false
  if (/^[a-z0-9-]+( [a-z0-9-]+)*$/.test(v)) return false
  if (!/[áéíóúñ¿¡]/i.test(v) && !/^[A-ZÁÉÍÓÚ¿¡]/.test(v)) return false
  return v.length >= 3
}

const traducidas = new Set()
const sinEnvolver = new Map()
for (const ruta of ficheros(RAIZ)) {
  const src = readFileSync(ruta, 'utf8')
  for (const m of src.matchAll(/(?<![A-Za-z])t\('((?:[^'\\]|\\.)+)'/g)) traducidas.add(m[1].replace(/\\'/g, "'"))
  for (const m of src.matchAll(/(?<![A-Za-z]|t\()'((?:[^'\\\n]|\\.)+)'/g)) {
    const valor = m[1]
    if (!esCandidato(valor)) continue
    const antes = src.slice(Math.max(0, m.index - 40), m.index)
    if (/(className|class|dataset|id|role|type|href|src|icon|name|command|slug|key|event|selector|tag)\s*[:=]\s*$/.test(antes)) continue
    if (/from\s*$/.test(antes)) continue
    const lista = sinEnvolver.get(ruta) ?? []
    lista.push(valor)
    sinEnvolver.set(ruta, lista)
  }
}

const { EN } = await import('../apps/web/src/core/i18n.en.ts')
const faltan = [...traducidas].filter((texto) => !(texto in EN)).sort()
const huerfanas = Object.keys(EN).filter((texto) => !traducidas.has(texto)).sort()
const sinCubrir = [...sinEnvolver.entries()].map(([ruta, lista]) => [ruta, [...new Set(lista)].filter((texto) => !(texto in EN))]).filter(([, lista]) => lista.length > 0)

console.log(`cadenas envueltas con t(): ${traducidas.size}`)
console.log(`traducidas al inglés: ${traducidas.size - faltan.length}`)
console.log(`sin traducir: ${faltan.length}`)
console.log(`en el diccionario sin literal directo (llegan por t(variable)): ${huerfanas.length}`)
const pendientes = sinCubrir
const totalPendientes = pendientes.reduce((n, [, lista]) => n + lista.length, 0)
console.log(`literales de UI sin envolver ni traducir: ${totalPendientes}`)
if (process.argv.includes('--detalle')) {
  if (faltan.length) console.log('\nsin traducir:\n' + faltan.map((t) => `  ${t}`).join('\n'))
  if (huerfanas.length) console.log('\nhuérfanas:\n' + huerfanas.map((t) => `  ${t}`).join('\n'))
  for (const [ruta, lista] of pendientes) console.log(`\n${ruta}\n` + lista.map((t) => `  ${t}`).join('\n'))
}
if (process.argv.includes('--json')) writeFileSync('scripts/i18n-strings.json', JSON.stringify([...traducidas].sort(), null, 1))
const estricto = process.argv.includes('--estricto')
if (estricto && faltan.length > 0) process.exit(1)
