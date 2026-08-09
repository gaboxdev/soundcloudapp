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

api-v2.soundcloud.com bloquea CORS para todo origen que no sea soundcloud.com. El `client_id` se extrae del HTML de soundcloud.com (bloque hydratable) y se cachea con TTL. Si el bloque falla, las tres capas recurren al **fallback**: buscar los bundles `https://a-v2.sndcdn.com/assets/*.js` referenciados en el HTML y extraer de ahí.

- **Dev**: middleware en `apps/web/vite.config.ts` — endpoints `/sl-proxy?url=` y `/sl-client-id`.
- **Prod web**: `proxy/worker` (Cloudflare Worker, los mismos endpoints).
- **Desktop**: comandos Rust `proxy_fetch` y `get_client_id` (sin CORS).
- La lógica compartida (extracción, inyección, lista blanca, caché) vive en `proxy/shared/clientid.ts`, importado por ruta relativa desde Vite y desde el Worker (no es un workspace npm).

**`/sl-proxy?url=` solo acepta `https://api-v2.soundcloud.com`** (403 en cualquier otro host): sin esa lista blanca el servidor de dev era un proxy abierto contra la LAN. Inyecta el `client_id` si la URL no lo trae, y todos los fetch llevan timeout de 10 s.

**Rotación del `client_id`**: `GET /sl-client-id[?refresh=<v>]` → `{ client_id, refreshed }`. Cualquier valor salvo `0`/`false`/vacío **salta la caché del servidor** (con anti-tormenta de 15 s); en desktop el equivalente es `invoke('get_client_id', { refresh: true })`. El cliente lo usa **solo** en el reintento tras un 401 — el camino normal tira de caché. Sin esto, `resetClientIdCache()` limpiaba solo la caché del navegador y el servidor seguía devolviendo el id caducado hasta 20 minutos. El caché del cliente (`transport.ts`) usa dos slots de promesa + contador de generación, para que una carga normal rezagada no pise el id recién refrescado.

Los medios (CDN mp3 `cf-media.sndcdn.com`, waveforms `wave.sndcdn.com`) sí envían `Access-Control-Allow-Origin: *` — se fetch directo desde el navegador. **El service worker NO intercepta audio** (solo artwork y waveforms, con LRU): las peticiones con `Range` devuelven 206 y `cache.put` las rechaza.

### Sesión de cuenta (solo desktop)

SoundCloud no permite registrar apps OAuth nuevas → la sesión se hace con el login nativo de soundcloud.com dentro de la webview de Tauri (cookies compartidas entre ventanas del mismo data store). Comandos Rust en `apps/desktop/src-tauri/src/lib.rs`:

- `login_window` / `logout_window`: abren una ventana con soundcloud.com / soundcloud.com/logout. La ventana de login lleva un script inyectado que (1) consulta `/me` cada 2s y al detectar sesión navega a `tauri://localhost/auth-login-complete` (Rust la cierra junto a los popups) y (2) muestra avisos flotantes (en /login: usar email+contraseña, passkeys no soportados; fuera de /login: cerrar ventana) + botón «He iniciado sesión · Continuar» (cierra la ventana y fuerza la re-verificación). Los popups de OAuth se crean como ventanas Tauri `sl-popup-N` (comparten cookies y se pueden cerrar). `close_login_windows` cierra login + popups, trae `main` al frente y emite `sl-session-check`.
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
  - `me()` → `User | null` (autenticado, desktop), `meLikes(userId, limit, next?)` → `SearchResponse<Searchable>`, `toggleAccountLike(trackId, liked)` (PUT/DELETE `/me/likes/{id}`)
- Sincronización con la cuenta: al arrancar con sesión, `player.syncAccountLikes()` pagina `/users/{id}/likes` (cursor `next_href`) y sustituye `state.likes`. `player.toggleLike(track)` hace update optimista local + llamada remota (rollback si falla). La vista `#/likes` tiene Favoritos (los de la cuenta, autosincronizados), Tus playlists (vía `userContent(id,'playlists')`), Historial y Tu cuenta.
- Tipos: `Track`, `Playlist`, `User`, `Comment`, `ChartItem`, `SearchResponse<T>`, `Selection` (mixed-selections), `TrackStub` (tracks borrados dentro de playlists: `typeof t.title !== 'string'`).
- Gotchas verificados:
  - **api-v2 exige el header `Authorization: OAuth <oauth_token>` además de las cookies.** La cookie `oauth_token` (dominio .soundcloud.com, no HttpOnly, legible con `document.cookie`) existe cuando hay sesión, pero `/me` responde 401 si NO se envía el header. El fetch del puente `sl-bridge` y el poll de la ventana de login leen `document.cookie` y adjuntan ese header. (Verificado 2026: sin él, 401 aunque estés logueado; con él, 200.)
  - `artwork_url` es `null` ~34% de las veces → SIEMPRE fallback con iniciales.
  - `next_href` NO trae client_id → el transport lo inyecta.
  - Comentarios necesitan `threaded=1`.
  - `system-playlists/*` está muerto (404) → usar `featured`/`charts`.
  - `policy: 'SNIP'` = preview de 30s (Go+ exclusivo), `duration` está clamped.
  - `transcodings[].url` es una URL absoluta (api-v2) → `buildUrl` NO debe anteponer `API_BASE` si `path` ya empieza por `http` (verificado 2026: sin ese fix el streaming generaba `API_BASE + url` duplicado).
  - Algunos transcodings DEAD devuelven `{}` como envelope (sin `url`) → `streamUrl` debe probar los transcodings en orden y saltarse los vacíos; formatos DRM (`cbc-encrypted-hls`, `ctr-encrypted-hls`) no tienen progressive.
  - Los likes de un usuario autenticado se listan con `GET /users/{id}/likes` (NO `/me/library/all`, que es otro formato y mezcla playlists/system-playlists; `/me/likes` da 404). Los items vienen como `{ kind: 'like', track?|playlist?, created_at }` → `meLikes()` los desenvuelve (`unwrapLike`) antes de devolverlos; la paginación es por cursor en `next_href` (offset por fechas), nunca por offset numérico.
  - Además, los tracks de `mixed-selections`/`featured` a veces vienen **sin `streamable`** y sus transcodings dan `{}` o 401 anónimo: `streamUrl` ya intenta un fallback `authedRequest` (desktop) para esos casos; no fiarse solo de `track.streamable`.
  - El home NO debe tratar los items de `mixedSelections` como tracks: devuelven **playlists planas SIN array `tracks`** (solo metadatos: id, title, artwork_url, track_count, user, is_album, set_type). No se pueden expandir sobre la marcha → renderizarlas como tarjetas de playlist hacia `#/playlist/:id`, o pedir `/playlists/{id}` por sección. Tipo: `SelectionItem`/`PlaylistSummary`, no `Track`.
  - Playlists embed tracks completos excepto stubs → hidratar con `tracksByIds()` (`GET /tracks?ids=`). **Lotes de máximo 50** (60 ids → HTTP 400) y **el orden de respuesta NO respeta el de la petición** → hay que reordenar en cliente (`tracksByIds` ya lo hace). Verificado 2026: la API embebe **exactamente 5** tracks completos por playlist, sea cual sea su tamaño (una playlist de 492 llega con 5 + 487 stubs) → sin hidratar, la cola se queda en 5.
  - **`track.access` NO lo devuelve nunca la API anónima**, así que la detección de SNIP no puede depender de él: usar `policy === 'SNIP'` + `media.transcodings.every(t => t.snipped)`. En un SNIP, `duration` es 30000 y la duración real está en `full_duration`.
  - **Los álbumes llegan con `kind: "playlist"`**, no `'album'`: la detección real es `is_album` / `set_type === 'album'`.
  - **`/charts` está muerto salvo `genre=soundcloud:genres:all-music` + `kind=trending`** (verificado 2026): cualquier otro género da 404 (también con URN codificado o `high_tier_only=false`) y `kind=top` da 404 siempre. Para navegar por género se usa **`/recent-tracks/{slug}`** con el slug pelado (el URN devuelve colección vacía): 28 géneros con datos, pagina por cursor. `featured_tracks/top/{slug}` responde pero solo da 3-4 tracks e ignora el `offset`.
  - **`/search?filter.track=true` NO filtra nada** (verificado 2026: la colección sigue mezclando user/track/playlist). Para filtrar por tipo hay que usar `/search/tracks`, `/search/playlists`, `/search/albums`, `/search/users`, que sí devuelven un `kind` homogéneo.
  - **`/users/{id}/likes` y `/recent-tracks/{slug}` NO aceptan `offset` numérico distinto de 0** (HTTP 400, `invalid cursor format`): paginan por cursor, hay que seguir `next_href` con `api.page()`.
  - El JSON de waveform es `{ width, height, samples }` y el máximo real de `samples` es **`height`** (140 típico), **no 255**. `waveformSamples()` devuelve los valores ya normalizados a 0..1.
  - `subscribe()` de `createStore` invoca el callback **síncronamente** al suscribirse: el nodo aún no está en el DOM. Un patrón `const unsub = store.subscribe(() => { if (!el.isConnected) unsub() })` lanza `ReferenceError` por TDZ → declarar `let unsub` y saltarse la comprobación en la primera invocación.

## Estado global (stores)

- `player` (`apps/web/src/player/player.ts`): singleton, `player.store.subscribe(fn)` — estado: `{ queue: Track[], index, playing, repeat: 'off'|'all'|'one', shuffle, volume, current, duration, progress, buffered, loading, error, likes: Track[], isLiked, history }`.
  - API: `playTrack(track, queue?, index?)`, `playQueue(tracks, start)`, `toggle()`, `next()`, `prev()`, `jumpTo(i)`, `seekTo(ms)`, `seekRatio(r)`, `setVolume(v)`, `toggleMute()`, `cycleRepeat()`, `toggleShuffle()`, `addToQueue(track)`, `removeFromQueue(i)`, `clearQueue()`, `isLiked(track)`, `toggleLike(track)`, `syncAccountLikes()`.
  - La cola, repeat, shuffle y volumen persisten en localStorage. `likes` se sincroniza con la cuenta de SoundCloud en desktop (si no hay sesión o en web, usa el caché local).
- `createStore` (`src/core/store.ts`): micro-store pub/sub.
- Settings (`src/core/settings.ts`): `{ version, theme, apiBase, volume }` con `getSettings()/updateSettings()`. Se sanea campo a campo al cargar y al escribir (theme del conjunto permitido, `volume` con clamp 0–1, `apiBase` validado con `new URL()` y sin barra final) y migra por `version`. `watchSystemTheme()` re-aplica el tema al cambiar el del sistema.

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
- `src/core/utils.ts`: `esc()`, `fmtTime(ms)`, `fmtCount(n)`, `timeAgo(iso)`, `formatDate(iso)`, `artworkUrl(url, 't500x500')`, `initials(label)`, `debounce`, `clamp`, `shuffle`. **`esc()` es SOLO para interpolar en `innerHTML`**: `h()` inserta los hijos con `createTextNode`, que ya escapa, así que pasarle `esc(...)` produce entidades visibles (`Rock &amp;amp; Roll`).
- `src/ui/artwork.ts`: `artEl(url, label, {size, blur})` (lazy + fallback iniciales), `avatarEl(url, label, size)`. El `<img>` va **después** del `.art-fallback` en el DOM y **ambos deben ser `position:absolute`**: si la imagen queda estática, el fallback (que sí está posicionado) se pinta encima y tapa la portada en toda la app. Al aplicar clases al nodo devuelto usar `classList.add()`, **nunca `className =`**: reemplazar la clase tira `art-frame` y con ella el `aspect-ratio`, el `overflow` y el fundido de `.loaded`.
- `src/ui/waveform.ts`: `waveformEl({ interactive, showHover, getDuration, onSeek })` → controller `{ el, setSamples(number[]), setProgress(ratio), setLoading(bool) }`.
- `src/components/trackrow.ts`: `trackRow(track, { rank?, showPlays?, onPlay? })` (fila estándar: arte, título, artista, like, añadir a cola, duración) y `trackRowSkeleton()`. Usar para TODAS las listas.
- `src/ui/toast.ts`: `toast(msg, kind)`, `toastOK`, `toastErr`.

### Motor acrílico (acrylic.css)

`styles/acrylic.css` define el MATERIAL; `styles/design.css` decide qué está hecho de él. Se importa primero en `main.ts` porque design.css consume sus tokens.

**Por qué existe.** `backdrop-filter` sólo puede muestrear lo que ya se pintó DENTRO del documento. Si detrás de una lámina no hay nada, el motor fotografía el vacío y lo compone en NEGRO. Aquí no hay compositor del sistema que ponga el cristal (esto no es Zen/Mica): el fondo lo pone la app, y lo pone la música.

**Tres capas, en este orden:**

1. **Suelo** — `--floor`, color opaco en `body`. Nunca se ve entero; garantiza que nunca haya «nada detrás».
2. **Ambiente** — `.ambient`, hermano de `#app` en `z-index: 0` (`#app` va a 1). Es la carátula que suena, difuminada a pantalla completa (`ui/ambient.ts`), más velo, brillo y viñeta. Es lo que muestrea todo `backdrop-filter`.
3. **Cristal** — velo propio (`--veil*`) + blur + `--edge-light`.

**Regla de oro: no anidar `backdrop-filter`.** Va SÓLO en láminas que tienen el ambiente debajo: `.app-header`, `.app-player`, `.card`, `.search-box`, `.suggest-box`, `.toast`, `.login-gate`. Un chip dentro de una tarjeta NO lleva blur (su backdrop ya es la tarjeta: difuminaría dos veces, sale lechoso y cuesta el doble). Lo que se repite mucho (`.home-card`, `.playlist-card`) tampoco: velo y canto sin blur, para no pagar un repintado por elemento en cada scroll.

**`blur()` y `saturate()` van siempre juntos.** Al difuminar, los colores se promedian y salen lavados; `--glass-sat: 145%` devuelve el color del álbum. Es lo que hace que se lea como cristal y no como plástico gris.

**Presets** (`data-glass` en `<html>`, ajuste en Ajustes › Cristal): `cristal` / `equilibrado` (defecto) / `solido`. Mueven `--glass-tint`, `--glass-chrome`, `--glass-panel`, `--ambient-veil` y `--glass-blur`. El preset se aplica en el script inline de `index.html` antes del primer pintado, para que no se vea el salto de velo al cargar.

**El velo del ambiente fija el techo de contraste.** `--ambient-veil` no baja tanto como el resto a propósito: es lo que hace que el fondo más claro posible sea conocido pase lo que pase por debajo. Con el preset por defecto y una carátula BLANCA PURA (el caso peor), el fondo se queda en `rgb(58,58,61)` y una tarjeta en `rgb(47,47,50)`. Contra eso se dimensionó la escalera de texto:

| token | dark | ratio sobre ambiente | ratio sobre tarjeta |
| --- | --- | --- | --- |
| `--text` | `#f7f7fa` | 10.4:1 | 12.2:1 |
| `--text2` | `#cbcbd6` | 7.0:1 | 7.7:1 |
| `--text3` | `#a6a6b2` | 4.6:1 | 5.4:1 |
| `--accent-text` | `#ff8a4d` | 4.9:1 | 5.7:1 |

En claro el caso peor es el espejo (carátula NEGRA sobre velo blanco, fondo `rgb(209,209,211)`): `#101014` 13.4:1, `#3d3d46` 7.0:1, `#56565f` 4.8:1, `#9c2b00` 5.0:1. El preset `cristal` sube `--text2`/`--text3` un tramo dentro de su propio bloque, porque con menos velo la escalera base se quedaba en 3.7:1.

**Si tocas `--ambient-veil`, recalcula la escalera.** Es la única dependencia numérica real del sistema.

**La onda** (`--wave`) es un gráfico: el mínimo es 3:1, no 4.5:1. No se cumple subiendo el blanco (al 37% haría falta, y en un track comprimido se lee como una plancha opaca). Se resuelve dando a `.waveform` su propio canal con `--veil-panel`, con lo que su fondo deja de depender de la carátula: 36% en oscuro y 46% en claro dan ~3.2:1. En claro hace falta más porque el canal se compone contra blanco.

**Accesibilidad.** `@media (prefers-reduced-transparency: reduce)` sube todos los velos a 1, quita los blur y esconde el ambiente. No basta con quitar los filtros: quedaría una interfaz semitransparente sobre una carátula nítida, que es peor que cualquiera de las dos cosas.

**Hook `data-backdrop="system"`** (en `<html>`, apagado): para cuando el escritorio monte vibrancy nativa (Tauri + `window-vibrancy` + ventana transparente). Quita el suelo y el ambiente para que se vea el cristal del compositor.

### Sistema de diseño (design.css)

Tokens de superficie: `--surface`/`--surface2`/`--surface3` y `--border`/`--border2` son **velos**, no colores — están mapeados a `--veil*` y `--hairline*` de acrylic.css. Por eso toda hoja de vista que ya los usaba se volvió acrílica sin tocarla. `--bg` es el suelo opaco.

Excepciones deliberadas: `--solid`, `--solid-2`, `--scrim`. Para lo que tiene que RECORTAR o TAPAR de verdad (anillo del avatar sobre la portada, globo de tiempo de la onda, scrim del login). Un velo ahí no recorta: deja ver el borde.

Otros tokens: `--text`, `--text2`, `--text3`, `--accent #ff5500`, `--accent2 #ff2d78`, `--accent-grad`, `--accent-soft`, `--accent-text`, `--wave`, `--wave-progress`, `--radius 16px`, `--radius-sm 10px`, `--radius-lg 22px`, `--header-h 60px`, `--player-h 92px`, `--player-gap 12px`, `--ease`. Tema claro vía `[data-theme="light"]` (todos redefinidos — NO poner colores hardcodeados).

Layout: la cabecera es lámina de borde a borde y el reproductor es una **isla flotante** (`fixed` con `--player-gap` por los cuatro lados). La isla lleva `overflow: hidden`, así que `--player-h` tiene que caber de verdad: controles 42 + hueco 4 + onda 36 + 10 de aire = 92. Como barra pegada al borde el desbordamiento no se veía; en una isla se recorta.

El acento es lo único NO translúcido de la interfaz: en un mundo de cristal, una sola pieza sólida y encendida se lleva la mirada sin necesidad de tamaño ni de peso tipográfico.

Clases: `btn btn-primary btn-ghost btn-danger btn-sm`, `icon-btn` (+ `.active`), `chip chip.active chip-row`, `card card-pad`, `track-row` (+ `.playing`, con filo de acento a la izquierda), `skeleton`, `empty-state`, `h-display h-section text-dim text-faint text-accent truncate link-hover`, `grid-tracks` (auto-fill minmax 300px), `load-more`, `spinner`, `page-error`, `.input .select .field .field-label`, `.avatar`. De acrylic.css: `glass`, `glass-flat`, `glass-panel`, `on-glass`.

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
