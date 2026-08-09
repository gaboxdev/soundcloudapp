# Soundlite

Cliente de SoundCloud súper ligero, rápido y open source. No es un wrapper de la web: cliente nativo con API propia, reproductor con waveform, cola y PWA + escritorio (Tauri).

## Comandos

```bash
npm install
npm run dev          # web app (Vite, puerto 5173)
npm run build        # build producción de la web
npm run typecheck    # typecheck de todos los workspaces
npm run dev:desktop  # app de escritorio (Tauri) — requiere Rust
```

## Arquitectura

```
packages/soundcloud-api   # Core: tipos TS + cliente de la API v2 de SoundCloud
apps/web                  # SPA Vite + TypeScript vanilla (sin frameworks)
apps/desktop              # Wrapper de escritorio Tauri 2 (Rust)
proxy/worker              # Proxy Cloudflare Worker para el build web en producción
```

### El proxy

api-v2.soundcloud.com bloquea CORS para todo origen que no sea soundcloud.com. El `client_id` se extrae del HTML de soundcloud.com (bloque hydratable) y se cachea con TTL.

- **Dev**: middleware en `apps/web/vite.config.ts` — endpoints `/sl-proxy?url=` y `/sl-client-id`.
- **Prod web**: `proxy/worker` (Cloudflare Worker, los mismos endpoints).
- **Desktop**: comandos Rust `proxy_fetch` y `get_client_id` (sin CORS).

Los medios (CDN mp3 `cf-media.sndcdn.com`, waveforms `wave.sndcdn.com`) sí envían `Access-Control-Allow-Origin: *` — se fetch directo desde el navegador.

### Sesión de cuenta (solo desktop)

SoundCloud no permite registrar apps OAuth nuevas → la sesión se hace con el login nativo de soundcloud.com dentro de la webview de Tauri (cookies compartidas entre ventanas del mismo data store). Comandos Rust en `apps/desktop/src-tauri/src/lib.rs`:

- `login_window` / `logout_window`: abren una ventana con soundcloud.com / soundcloud.com/logout. La ventana de login lleva un script inyectado que (1) consulta `/me` cada 2s y al detectar sesión navega a `tauri://localhost/auth-login-complete` (Rust la cierra junto a los popups) y (2) muestra avisos flotantes (en /login: usar email+contraseña, passkeys no soportados; fuera de /login: cerrar ventana). Los popups de OAuth se crean como ventanas Tauri `sl-popup-N` (comparten cookies y se pueden cerrar). `close_login_windows` cierra login + popups y emite `sl-session-check`.
- `authed_request(method, url, body)`: webview oculta `sl-bridge` cargada en `soundcloud.com/robots.txt` (mismo origen → envía cookies y el CORS de la API la permite). Serializado con mutex, espera lista del puente, reintento 1x. Ejecuta `fetch` con `credentials: 'include'` y devuelve el resultado navegando a `tauri://localhost/auth-bridge?status=..&body=..` (se captura con `on_page_load` y se resuelve con oneshot). El cliente TS parsea `"status\nbody"`.
- La SPA NO arranca en ventanas que no sean `main` (`apps/web/src/main.ts` comprueba el label) — evita que el puente se auto-polle y rompa la sesión.
- Debug: `debug_log` escribe en `$TMPDIR/soundlite-debug.log` (cap 512KB). Comando `log_debug`. Modo auto-test: `SOUNDLITE_SELFTEST=1 cargo run` — hace client_id → `/me` → abre/cierra login → loguea todo → exit(0).

En web (`ProxyTransport`) `authedRequest` lanza error → las vistas deben comprobar `isDesktop()` (`apps/web/src/api/auth.ts`) antes de ofrecer login.

### Puerta de entrada (login obligatorio)

Al abrir la app se muestra la pantalla de acceso (`src/components/logingate.ts`) cubriendo toda la UI hasta que haya sesión: sin sesión no se puede usar la app.

- `accountStore` (`src/core/account.ts`): estado `{ status: 'unknown'|'guest'|'ready', user }`. `refreshAccount()` lo actualiza (GET /me). `watchSessionWindow()` re-comprueba al cerrar la ventana `sl-login`.
- La gate hace polling de `refreshAccount()` cada 2.5s mientras no haya sesión (solo desktop). En web muestra un aviso + enlace a la app de escritorio.
- `settings.ts` y la gate se suscriben a `accountStore` (patrón auto-descarte).

### Core (`@soundlite/api`)

- `Transport` (interfaz): `getClientId()`, `getJSON(url)`, `rewriteHref(href)`, `authedRequest(method, url, body?)` (solo Tauri; en web lanza error). Implementaciones: `ProxyTransport(base)`, `TauriTransport`.
- `SoundCloudAPI` (instancia única vía `getAPI()` en `apps/web/src/api/index.ts`):
  - `search(q, offset, limit, filters)` → `SearchResponse<Searchable>` (colección heterogénea: tracks/playlists/users, filtrar por `.kind`)
  - `searchSuggestions(q)`, `track(id)`, `trackComments(id)`, `trackRelated(id)`, `playlist(id)`, `user(id)`, `userContent(id, kind)`, `charts(genreUrn, kind, offset)`, `featured(genre)`, `mixedSelections()`, `resolve(url)`, `page<T>(href)` (next_href ya reescrito por el transport)
  - `streamUrl(track)` → `{ url, protocol, mimeType, snipped } | null` (progressive MP3; fallback HLS)
  - `waveformSamples(track)` → `number[] | null` (fetch directo)
  - `downloadUrl(track)` → string | null (solo si `track.downloadable`)
  - `me()` → `User | null` (autenticado, desktop), `meLikes(offset, limit)` → `SearchResponse<Searchable>`, `toggleAccountLike(trackId, liked)` (PUT/DELETE `/me/likes/{id}`)
- Tipos: `Track`, `Playlist`, `User`, `Comment`, `ChartItem`, `SearchResponse<T>`, `Selection` (mixed-selections), `TrackStub` (tracks borrados dentro de playlists: `typeof t.title !== 'string'`).
- Gotchas verificados:
  - `artwork_url` es `null` ~34% de las veces → SIEMPRE fallback con iniciales.
  - `next_href` NO trae client_id → el transport lo inyecta.
  - Comentarios necesitan `threaded=1`.
  - `system-playlists/*` está muerto (404) → usar `featured`/`charts`.
  - `policy: 'SNIP'` = preview de 30s (Go+ exclusivo), `duration` está clamped.
  - Playlists embed tracks completos excepto stubs.

## Estado global (stores)

- `player` (`apps/web/src/player/player.ts`): singleton, `player.store.subscribe(fn)` — estado: `{ queue: Track[], index, playing, repeat: 'off'|'all'|'one', shuffle, volume, current, duration, progress, buffered, loading, error, likes: Track[], isLiked, history }`.
  - API: `playTrack(track, queue?, index?)`, `playQueue(tracks, start)`, `toggle()`, `next()`, `prev()`, `jumpTo(i)`, `seekTo(ms)`, `seekRatio(r)`, `setVolume(v)`, `toggleMute()`, `cycleRepeat()`, `toggleShuffle()`, `addToQueue(track)`, `removeFromQueue(i)`, `clearQueue()`, `isLiked(track)`, `toggleLike(track)`.
  - La cola, repeat, shuffle y volumen persisten en localStorage.
- `createStore` (`src/core/store.ts`): micro-store pub/sub.
- Settings (`src/core/settings.ts`): `{ theme, apiBase, volume, firstRun }` con `getSettings()/updateSettings()`.

## Router

Hash-based, en `src/core/router.ts`. Las vistas se auto-registran:

```ts
import { register } from '../core/router'
register('nombre', (route, container) => {
  // route.params.id, route.params.q, route.params.sub
  // renderizar dentro de `container` (ya limpio)
})
```

Rutas: `''/home`, `/search?q=`, `/charts`, `/track/:id`, `/playlist/:id`, `/user/:id`, `/queue`, `/likes`, `/settings`.

## UI

- `src/ui/el.ts`: builder `h(tag, attrs, children)`, `svgIcon(name, size)` (≈50 iconos: play, pause, next, prev, shuffle, repeat, repeatOne, heart, heartFill, search, queue, home, chart, comment, repost, download, more, settings, external, back, forward, close, check, music, playlist, user, trend, disc, clock, eye, github, trash, info, code, flag, list, sun, moon, headphone, waves, link, plus, minus, radio), `esc()`.
- `src/core/utils.ts`: `fmtTime(ms)`, `fmtCount(n)`, `timeAgo(iso)`, `formatDate(iso)`, `artworkUrl(url, 't500x500')`, `initials(label)`, `debounce`, `clamp`, `shuffle`.
- `src/ui/artwork.ts`: `artEl(url, label, {size, blur})` (lazy + fallback iniciales), `avatarEl(url, label, size)`.
- `src/ui/waveform.ts`: `waveformEl({ interactive, showHover, getDuration, onSeek })` → controller `{ el, setSamples(number[]), setProgress(ratio), setLoading(bool) }`.
- `src/components/trackrow.ts`: `trackRow(track, { rank?, showPlays?, onPlay? })` (fila estándar: arte, título, artista, like, añadir a cola, duración) y `trackRowSkeleton()`. Usar para TODAS las listas.
- `src/ui/toast.ts`: `toast(msg, kind)`, `toastOK`, `toastErr`.

### Sistema de diseño (design.css)

Tokens: `--bg #0f0f10`, `--surface`, `--surface2`, `--surface3`, `--border`, `--text`, `--text2`, `--text3`, `--accent #ff5500`, `--accent2 #ff2d78`, `--accent-grad`, `--accent-soft`, `--radius 10px`, `--header-h 60px`, `--player-h 74px`. Tema claro vía `[data-theme="light"]` (todos los tokens redefinidos — NO poner colores hardcodeados).

Clases: `btn btn-primary btn-ghost btn-danger btn-sm`, `icon-btn` (+ `.active`), `chip chip.active chip-row`, `card card-pad`, `track-row`, `skeleton`, `empty-state`, `h-display h-section text-dim text-faint text-accent truncate link-hover`, `grid-tracks` (auto-fill minmax 300px), `load-more`, `spinner`, `page-error`, `.input .select .field .field-label`.

IMPORTANTE: no frameworks, no librerías de UI, no Tailwind. Solo TS vanilla + CSS. No añadir comentarios al código. IDs/nombres de clases en kebab-case.

## Patrón de vistas (infinite scroll)

```ts
let offset = 0
let loading = false
let done = false
async function loadMore() {
  if (loading || done) return
  loading = true
  try {
    const res = await api.method({ ... }) // con offset
    done = !res.next_href || res.collection.length === 0
    offset = res.collection.length // o re-fetch next_href con api.page()
    appendRows(res.collection)
  } catch { done = true } finally { loading = false }
}
```
Usar `IntersectionObserver` en un centinela `.load-more`.

Suscribirse al store con auto-descarte (evita leaks al navegar):

```ts
const unsub = player.store.subscribe((state) => {
  if (!container.isConnected) { unsub(); return }
  // actualizar UI
})
```

## Convenciones

- TS estricto, `verbatimModuleSyntax` (imports de tipos con `import type`).
- `npm run typecheck -w apps/web` debe pasar antes de terminar cualquier tarea.
- Sin comentarios en el código. Texto de UI en español.
- Estados de carga: skeletons (nunca spinners gigantes); errores: `.page-error` o `toast`.
- Favores: `player.toggleLike(track)` + `toast('Guardado en favoritos', 'ok')`.
- Navegación interna siempre con `href="#/..."` o `navigate()`.
