# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Lee AGENTS.md primero

[AGENTS.md](./AGENTS.md) es la referencia profunda del proyecto: gotchas de la API v2 de SoundCloud verificados contra la API real (endpoints muertos, paginación por cursor, hidratación de playlists, detección de SNIP), el motor acrílico y la escalera de contraste, el puente de sesión de escritorio y los patrones de vista. **Consúltalo antes de tocar llamadas a la API, CSS o la sesión** — muchas de esas notas documentan bugs ya pagados una vez. Este archivo cubre lo operativo y el mapa general.

## Comandos

```bash
npm install                              # workspaces npm (packages/*, apps/*, proxy/*)
npm run dev                              # web en http://localhost:5173 (proxy de dev incluido)
npm run dev:desktop                      # Tauri (levanta Vite solo; requiere Rust)
npm run build                            # tsc --noEmit + vite build (apps/web)
npm run typecheck                        # todos los workspaces
npm run typecheck -w apps/web            # solo web (incluye packages/soundcloud-api vía tsconfig)
npm run build -w apps/desktop            # binario Tauri
npm run icons -w apps/desktop            # regenera PNGs + iconos del SO desde public/icon.svg
npm test                                 # 63 casos con node:test (TS directo, sin dependencias)
npm run probe                            # 16 sondas contra la API real de SoundCloud
npm run i18n                             # cadenas envueltas vs diccionario (--detalle, --estricto)
npm run dev -w @soundclear/proxy-worker  # wrangler dev
npm run deploy -w @soundclear/proxy-worker
SOUNDCLEAR_SELFTEST=1 cargo run          # en apps/desktop/src-tauri: client_id → /me → login → exit(0)
```

**La puerta de calidad es `npm run typecheck` + `npm test` + `npm run build`** (sin linter), que es exactamente lo que corre CI (`.github/workflows/ci.yml`; el Worker además tiene su propio job). Termina cualquier tarea con esos dos comandos en verde.

Debug de escritorio: `$TMPDIR/soundclear-debug.log` — en Windows `%TEMP%\soundclear-debug.log` (comando `log_debug` desde TS).

En `npm run dev` la app expone `window.soundclear = { player, settings }` (solo con `import.meta.env.DEV`; el bundle de producción no lo contiene). Es la vía para medir el audio desde la consola: `soundclear.player.diagnostics()` devuelve grafo, platos, ganancias, nivel RMS y ajustes, y `await soundclear.auditRoutes()` pasa la auditoría de accesibilidad por las rutas principales.

## Arquitectura

```
packages/soundcloud-api  # @soundclear/api: tipos + SoundCloudAPI + Transport (sin build, main apunta al .ts)
apps/web                 # SPA Vite + TS vanilla — es TODO el UI, también el de escritorio
apps/desktop/src-tauri   # Rust: proxy sin CORS, ventanas de login, puente autenticado
proxy/shared/clientid.ts # lógica compartida por Vite y el Worker (import por ruta relativa, NO workspace)
proxy/worker             # Cloudflare Worker: mismos endpoints que el proxy de dev
```

**Una sola app web, dos entornos.** `apps/web` no sabe si corre en navegador o en Tauri más allá de `isTauri()`. La diferencia se encapsula en el `Transport` (`packages/soundcloud-api/src/transport.ts`):

| | web | escritorio |
|---|---|---|
| datos | `ProxyTransport` → `/sl-proxy?url=` | `TauriTransport` → `invoke('proxy_fetch')` |
| client_id | `/sl-client-id` | `invoke('get_client_id')` |
| autenticado | lanza error | `invoke('authed_request')` → webview `sl-bridge` |

Consecuencia práctica: **nunca hagas `fetch` a api-v2 desde una vista**. Todo pasa por `getAPI()` (`apps/web/src/api/index.ts`, instancia única) y toda función que ofrezca login/likes de cuenta debe comprobar `isDesktop()` (`apps/web/src/api/auth.ts`) antes.

Media (mp3 de `cf-media.sndcdn.com`, waveforms de `wave.sndcdn.com`) sí manda `ACAO: *` y va directa desde el navegador, sin proxy. El service worker cachea artwork y waveforms con LRU, **nunca audio** (las peticiones con `Range` devuelven 206 y `cache.put` las rechaza).

### Flujo de arranque

`main.ts` es la entrada mínima: importa los CSS base, llama a `initSettings()` y decide qué ventana es. La ventana `mini` carga `mini/mini.ts` (un mando de ~14 KB que **no** instancia el player); cualquier otra etiqueta que no sea `main` **sale sin arrancar nada**; `main` importa `boot.ts` de forma dinámica, que es quien **registra las vistas por side-effect** (`import './views/x'`) (las ventanas de login y el puente cargan el mismo bundle; si arrancaran romperían la sesión) → `bootstrapApp()` monta ambiente, cabecera, outlet, reproductor, la puerta de login y, si `onboarded` es falso, el tour de personalización (`components/welcome.ts`, z-index por encima de la puerta).

### Estado

Tres singletons, todos con el mismo micro-store pub/sub de `core/store.ts` (~20 líneas):

- `player` (`player/player.ts`) — cola, reproducción, likes, historial, radio, velocidad y temporizador. Persiste en `sl:player:queue`. **Tiene dos stores**: `player.store` (metadatos) y `player.tick` (`progress`/`buffered`, 60 veces por segundo). Para pintar tiempo u onda suscríbete a `player.tick`; para todo lo demás, a `player.store`. También gestiona **dos platos de audio** y el grafo de `player/audiograph.ts` (EQ de 5 bandas, limitador, volumen maestro y crossfade de potencia constante). Detalles y trampas medidas, en AGENTS.md.
- `accountStore` (`core/account.ts`) — `unknown | guest | ready`; la puerta (`components/logingate.ts`) tapa la app hasta que haya sesión **o hasta que el usuario elija «Explorar sin cuenta»** (`allowGuest()`, flag `sl:guest`). En web esa es la única vía: la sesión de SoundCloud solo existe en escritorio.
- `socialStore` (`core/social.ts`) — seguir, repostear y playlists de la cuenta. Todo detrás de `canWrite()` (escritorio con sesión); en web esas acciones no se pintan. Optimista con reversión; los detalles de la API (cadenas de reserva, `PUT` de playlists que reemplaza, reconciliación del `POST`) están en AGENTS.md.
- `offlineStore` (`core/offline.ts`) — copias locales del audio en IndexedDB para escuchar sin red, con presupuesto en ajustes. El player pregunta por la copia local **antes** de pedir el stream. Detalles en AGENTS.md.
- settings (`core/settings.ts`) — `sl:settings`, saneado campo a campo y migrado por `version`. Ejes: `theme`, `glass`, `topbar`, `accent` (+ `accentHue` para el tono libre), `density`, `backdrop`, `navLabels`, `iconStyle`, `historyNav`, `autoplay`, `rate`, `volume`, `apiBase`, la marca `onboarded` del tour y los ejes de audio y datos (`dsp`, `eq`, `leveling`, `crossfade`, `offlineBudget`), que no tienen `data-*` porque no son visuales. Cada eje visual se refleja en un `data-*` de `<html>` (`data-theme`, `data-glass`, `data-topbar`, `data-accent`, `data-density`, `data-backdrop`, `data-navlabels`, `data-icons`, `data-historynav`) y el script inline de `index.html` lo aplica antes del primer pintado: **si añades un eje, añádelo también ahí** o habrá salto en el primer frame.

Suscríbete siempre con auto-descarte, o filtras eventos de vistas ya desmontadas:

```ts
const unsub = player.store.subscribe((state) => {
  if (!container.isConnected) { unsub(); return }
})
```

(`subscribe()` invoca el callback **síncronamente**; declara `let unsub` — con `const` el patrón revienta por TDZ.)

### Vistas

Router hash-based propio (`core/router.ts`) con restauración de scroll. Añadir una vista son dos pasos: `register('nombre', (route, container) => …)` en `views/nombre.ts` y un `import './views/nombre'` en `boot.ts`. El `container` llega limpio; los errores (sync o promesa rechazada) se pintan solos como `.page-error`.

Rutas: `home`, `search?q=&tab=&dur=&when=&genre=&cc=`, `charts?genre=`, `track/:id`, `playlist/:id`, `user/:id`, `queue`, `now`, `feed`, `likes`, `settings`.

## Convenciones no negociables

- **Cero dependencias de UI.** La única dependencia de runtime es `hls.js`, cargada lazy y en su propio chunk. Nada de React/Vue/Svelte/Tailwind ni librerías de componentes: el argumento del proyecto es el tamaño del bundle (hoy ~76 KB gzip de JS + ~16 KB de CSS en la ventana principal, y solo ~14 KB en la mini para la app entera; el chunk de `hls.js` solo se descarga si un track necesita HLS).
- **Sin comentarios en el código.** Texto de UI en español. IDs y clases en kebab-case.
- TS estricto con `verbatimModuleSyntax`, `noUnusedLocals`/`noUnusedParameters`: importa tipos con `import type`.
- Construye DOM con `h()`/`svgIcon()` de `ui/el.ts`. `esc()` es **solo** para `innerHTML` — pasárselo a `h()` produce entidades visibles.
- Filas de tracks siempre con `trackRow()` (`components/trackrow.ts`); errores con `.page-error` o `toast()`.
- **Todo estado de carga es un esqueleto de `ui/skeleton.ts`** (`skTrackList`, `skHome`, `skTrackPage`, `skProfileHead`, `skComments`, `skMore`…), nunca un spinner de página ni un «Cargando…». Cada pieza copia la geometría del componente real para que no haya salto al llegar los datos; si añades una vista, añade también su esqueleto. Estilos en `styles/skeleton.css` (tokens `--sk-*`, escalonado por `--sk-i`).
- Menús, modales y paleta de comandos: `components/menu.ts`, `ui/modal.ts`, `components/palette.ts`. No montes overlays a mano: esas tres piezas ya resuelven foco, `Escape` y cierre al pulsar fuera.
- Colores solo desde los tokens de `styles/design.css` (el tema claro los redefine enteros). `--accent` es color de fondo; para primer plano, `--accent-text`.

## Al tocar el proxy o el escritorio

- `proxy/shared/clientid.ts` lo importan **Vite y el Worker** por ruta relativa. Un cambio ahí afecta a los dos: valida `npm run typecheck -w apps/web` y `-w @soundclear/proxy-worker`.
- `/sl-proxy` solo acepta `https://api-v2.soundcloud.com` (lista blanca en `isAllowedTarget`). No la amplíes sin motivo: sin ella el servidor de dev es un proxy abierto contra la LAN.
- Comandos Rust expuestos (`apps/desktop/src-tauri/src/lib.rs`): `get_client_id`, `refresh_client_id`, `proxy_fetch`, `authed_request`, `login_window`, `logout_window`, `close_login_windows`, `log_debug`, `download_to_music`, `mini_window`, `toggle_mini`, `notify_track`, `set_now_playing`, `shortcut_status`. Añadir uno exige registrarlo en `invoke_handler![]`.
- Cualquier host nuevo al que la app hable en escritorio hay que añadirlo al `connect-src` del CSP en `apps/desktop/src-tauri/tauri.conf.json`, y los permisos de ventana a `src-tauri/capabilities/default.json`.
