import { readFileSync } from 'node:fs'

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
const version = json('package.json').version
const paths = [
  'packages/soundcloud-api/package.json',
  'apps/web/package.json',
  'apps/desktop/package.json',
  'proxy/worker/package.json',
  'apps/desktop/src-tauri/tauri.conf.json',
]
const errors = paths.filter((path) => json(path).version !== version).map((path) => `${path}: versión distinta de ${version}`)
const cargo = readFileSync(new URL('../apps/desktop/src-tauri/Cargo.toml', import.meta.url), 'utf8')
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
if (cargoVersion !== version) errors.push(`Cargo.toml: versión distinta de ${version}`)
const lock = json('package-lock.json')
if (lock.version !== version || lock.packages[''].version !== version) errors.push('package-lock.json: versión raíz desactualizada')
for (const path of paths.filter((path) => path.endsWith('/package.json'))) {
  if (lock.packages[path.replace('/package.json', '')]?.version !== version) errors.push(`package-lock.json: ${path} desactualizado`)
}
const tag = process.argv[2]
if (tag && tag !== `v${version}`) errors.push(`La etiqueta ${tag} no coincide con v${version}`)
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Versiones alineadas: ${version}${tag ? ` (${tag})` : ''}`)
}
