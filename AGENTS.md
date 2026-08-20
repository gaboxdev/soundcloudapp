# SoundClear

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
- Debug: `debug_log` escribe en `$TMPDIR/soundclear-debug.log` (cap 512KB). Comando `log_debug`. Modo auto-test: `SOUNDCLEAR_SELFTEST=1 cargo run` — hace client_id → `/me` → abre/cierra login → loguea todo → exit(0).

En web (`ProxyTransport`) `authedRequest` lanza error → las vistas deben comprobar `isDesktop()` (`apps/web/src/api/auth.ts`) antes de ofrecer login.

### Puerta de entrada (login obligatorio)

Al abrir la app se muestra la pantalla de acceso (`src/components/logingate.ts`) cubriendo toda la UI hasta que haya sesión: sin sesión no se puede usar la app.

- `accountStore` (`src/core/account.ts`): estado `{ status: 'unknown'|'guest'|'ready', user }`. `refreshAccount()` lo actualiza (GET /me). `watchSessionWindow()` re-comprueba al cerrar la ventana `sl-login`.
- La gate hace polling de `refreshAccount()` cada 2.5s mientras no haya sesión (solo desktop). En web muestra un aviso + enlace a la app de escritorio.
- `settings.ts` y la gate se suscriben a `accountStore` (patrón auto-descarte).

### Core (`@soundclear/api`)

- `Transport` (interfaz): `getClientId()`, `getJSON(url)`, `rewriteHref(href)`, `authedRequest(method, url, body?)` (solo Tauri; en web lanza error). Implementaciones: `ProxyTransport(base)`, `TauriTransport`.
- `SoundCloudAPI` (instancia única vía `getAPI()` en `apps/web/src/api/index.ts`):
  - `search(q, offset, limit, filters)` → `SearchResponse<Searchable>` (colección heterogénea: tracks/playlists/users, filtrar por `.kind`)
  - `searchSuggestions(q)`, `track(id)`, `trackComments(id)`, `trackRelated(id)`, `playlist(id)`, `user(id)`, `userContent(id, kind)`, `charts(genreUrn, kind, offset)`, `featured(genre)`, `mixedSelections()`, `resolve(url)`, `page<T>(href)` (next_href ya reescrito por el transport)
  - `searchTracks(q, offset, limit, filters)` con `filters: { duration, createdAt, genre, commercial }` → `filter.duration` / `filter.created_at` / `filter.genre` / `filter.license`
  - `stationTracks('track'|'artist', id)` → radio de SoundCloud (50 tracks, ya hidratados)
  - `userTopTracks(id)`, `relatedArtists(id)`, `trackPlaylists(id)` («aparece en»), `userPosts(id)` (posts + reposts)
  - `searchGenres()` → los géneros que el filtro de búsqueda acepta de verdad
  - Escrituras (escritorio): `setFollowing(userId, bool)`, `setRepost(trackId, bool)`, `createPlaylist(title, ids, isPublic)`, `setPlaylistTracks(id, ids)`, `playlistTrackIds(id)`, y lectura de estado con `followingIds()` / `repostIds()`
  - Cuenta (escritorio): `stream(limit, next)` (feed de quien sigues) y `playHistory(limit, next)` (historial que cruza dispositivos)
  - `streamUrl(track)` → `{ url, protocol, mimeType, snipped } | null` (progressive MP3; fallback HLS)
  - `waveformSamples(track)` → `number[] | null` (fetch directo)
  - `downloadUrl(track)` → string | null (solo si `track.downloadable`)
  - `me()` → `User | null` (autenticado, desktop), `meLikes(userId, limit, next?)` → `SearchResponse<Searchable>`, `toggleAccountLike(trackId, liked, userId?)` (PUT/DELETE `/users/{tuId}/track_likes/{trackId}`, con reserva al viejo `/me/likes/{id}`)
  - `isDrmOnly(track)` / `plainTranscodings(track)` → funciones puras, sin red: dicen si un track solo se entrega cifrado antes de pedir nada
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
  - **Tracks solo-DRM: la causa real de «no está disponible para streaming»** (verificado 19 ago 2026 con 8 tracks y 209 muestras). Los sellos grandes ya publican con entrega cifrada: el track trae `cbc-encrypted-hls` + `ctr-encrypted-hls` (presets `aac_160k`, `aac_96k`, `abr_sq`) **y además** un `progressive`/`hls` con preset `mp3_1_0` y `is_legacy_transcoding: true` que **siempre responde 404 `{}`**. Es un señuelo: el audio real solo está detrás de EME/Widevine. Regla de detección (la que implementa `isDrmOnly`): hay algún transcoding `*-encrypted-hls` **y** todos los `progressive`/`hls` son `is_legacy_transcoding: true`. Si existe un plano NO legacy, el track se reproduce con normalidad (verificado: `hls/aac_160k` → 200). Ojo con la magnitud: en el perfil de deadmau5 son **109 de 124 tracks**, y en búsquedas genéricas 0 de 209 → es un fenómeno de catálogo comercial, no un caso raro. `policy` sigue siendo `ALLOW` y `streamable: true`, así que ninguna bandera de la API lo delata.
  - `track_authorization` **no hace falta** para el envelope de un transcoding plano (verificado: mismos 200 con y sin él, y mismos 404 en los legacy de un track cifrado) → no se envía.
  - **Rutas de escritura de la cuenta: `/me/*` está medio muerto** (verificado 19 ago 2026, mezclando el log de escritorio con sesión real y sondas anónimas donde 403 = la ruta existe y 404 = no existe). Dar/quitar favorito con `PUT|DELETE /me/likes/{trackId}` devuelve **404 aun con sesión** (12 intentos seguidos en producción) → la ruta viva es **`PUT|DELETE /users/{tuId}/track_likes/{trackId}`** (403 anónimo). Seguir es **`POST /me/followings/{userId}`** (403 anónimo; el `PUT` da 404, y la cadena de reserva `PUT`→`POST` de `writeWithVerbFallback` es lo que lo salvaba). Repostear sí es **`/me/track_reposts/{trackId}`** (403 anónimo). También 404: `/me/track_likes/{id}`, `/users/{id}/followings/{userId}`, `/users/{id}/track_reposts/{id}`, `/users/{id}/playlist_reposts/{id}`.
  - Los likes de un usuario autenticado se listan con `GET /users/{id}/likes` (NO `/me/library/all`, que es otro formato y mezcla playlists/system-playlists; `/me/likes` da 404). Los items vienen como `{ kind: 'like', track?|playlist?, created_at }` → `meLikes()` los desenvuelve (`unwrapLike`) antes de devolverlos; la paginación es por cursor en `next_href` (offset por fechas), nunca por offset numérico.
  - Además, los tracks de `mixed-selections`/`featured` a veces vienen **sin `streamable`** y sus transcodings dan `{}` o 401 anónimo: `streamUrl` ya intenta un fallback `authedRequest` (desktop) para esos casos; no fiarse solo de `track.streamable`.
  - El home NO debe tratar los items de `mixedSelections` como tracks: devuelven **playlists planas SIN array `tracks`** (solo metadatos: id, title, artwork_url, track_count, user, is_album, set_type). No se pueden expandir sobre la marcha → renderizarlas como tarjetas de playlist hacia `#/playlist/:id`, o pedir `/playlists/{id}` por sección. Tipo: `SelectionItem`/`PlaylistSummary`, no `Track`.
  - Playlists embed tracks completos excepto stubs → hidratar con `tracksByIds()` (`GET /tracks?ids=`). **Lotes de máximo 50** (60 ids → HTTP 400) y **el orden de respuesta NO respeta el de la petición** → hay que reordenar en cliente (`tracksByIds` ya lo hace). Verificado 2026: la API embebe **exactamente 5** tracks completos por playlist, sea cual sea su tamaño (una playlist de 492 llega con 5 + 487 stubs) → sin hidratar, la cola se queda en 5.
  - **`track.access` NO lo devuelve nunca la API anónima**, así que la detección de SNIP no puede depender de él: usar `policy === 'SNIP'` + `media.transcodings.every(t => t.snipped)`. En un SNIP, `duration` es 30000 y la duración real está en `full_duration`.
  - **Los álbumes llegan con `kind: "playlist"`**, no `'album'`: la detección real es `is_album` / `set_type === 'album'`.
  - **`/charts` está muerto salvo `genre=soundcloud:genres:all-music` + `kind=trending`** (verificado 2026): cualquier otro género da 404 (también con URN codificado o `high_tier_only=false`) y `kind=top` da 404 siempre. Para navegar por género se usa **`/recent-tracks/{slug}`** con el slug pelado (el URN devuelve colección vacía): 28 géneros con datos, pagina por cursor. `featured_tracks/top/{slug}` responde pero solo da 3-4 tracks e ignora el `offset`.
  - **`/search?filter.track=true` NO filtra nada** (verificado 2026: la colección sigue mezclando user/track/playlist). Para filtrar por tipo hay que usar `/search/tracks`, `/search/playlists`, `/search/albums`, `/search/users`, que sí devuelven un `kind` homogéneo.
  - **`/users/{id}/likes` y `/recent-tracks/{slug}` NO aceptan `offset` numérico distinto de 0** (HTTP 400, `invalid cursor format`): paginan por cursor, hay que seguir `next_href` con `api.page()`.
  - **Los filtros de `/search/tracks` sí funcionan** (verificado 2026): `filter.duration=short|medium|long|epic` (<2 min, 2–10, 10–30, >30), `filter.created_at=last_hour|last_day|last_week|last_month|last_year` y `filter.license=to_modify_commercially` (devuelve CC). Lo que NO funciona: `sort=popular|recent` (apenas reordena) ni `filter.track=true` en `/search`.
  - **`filter.genre` compara el string literal del campo `genre` del track, sin taxonomía y sin normalizar guiones**: `rock`, `house`, `hip hop`, `drum & bass`, `r&b`, `lo-fi` devuelven resultados (case-insensitive), pero `drum-and-bass`, `danceedm` o `Dance & EDM` dan 0. Por eso `searchGenres()` lista etiquetas reales («Drum & Bass», «Hip Hop»), no los slugs de `genres()` que usan los charts.
  - **La radio de SoundCloud es `/stations/soundcloud:track-stations:{id}/tracks`** (también `artist-stations:{userId}`), anónima y sin OAuth. Devuelve **siempre 50 tracks**, ignora `limit` y `offset` y no trae `next_href`. Los tracks vienen **parciales**: sin `waveform_url`, `playback_count`, `likes_count`, `genre` ni `streamable` → hay que hidratarlos con `tracksByIds()` (`stationTracks()` ya lo hace) o la onda y las estadísticas salen vacías.
  - `/users/{id}/toptracks` (tracks completos), `/users/{id}/relatedartists` y `/tracks/{id}/playlists_without_albums` funcionan anónimos. `/users/{id}/reposts` da 404: los reposts salen de **`/stream/users/{id}`**, cuyos items son `{ type: 'track' | 'track-repost' | …, track, user, created_at }`. `/users/{id}/spotlight`, `/users/{id}/albums` y `/users/{id}/web-profiles` responden vacío o 400: no se usan.
  - El JSON de waveform es `{ width, height, samples }` y el máximo real de `samples` es **`height`** (140 típico), **no 255**. `waveformSamples()` devuelve los valores ya normalizados a 0..1.
  - `subscribe()` de `createStore` invoca el callback **síncronamente** al suscribirse: el nodo aún no está en el DOM. Un patrón `const unsub = store.subscribe(() => { if (!el.isConnected) unsub() })` lanza `ReferenceError` por TDZ → declarar `let unsub` y saltarse la comprobación en la primera invocación.

## Estado global (stores)

- `player` (`apps/web/src/player/player.ts`): singleton con **dos stores**.
  - `player.store` — lo que cambia poco: `{ queue, index, playing, repeat: 'off'|'all'|'one', shuffle, volume, muted, rate, current, duration, loading, error, likes, likesRev, isLiked, likesTruncated, history, radioIds, radioLoading, sleepAt }`.
  - `player.tick` — **solo `{ progress, buffered }`**, lo que cambia en cada frame. Está separado a propósito: `store.set()` avisa a TODOS los suscriptores y cada fila de track tiene dos suscripciones, así que con 500 favoritos en pantalla un `timeupdate` disparaba ~1000 callbacks por frame, cada uno recorriendo el array de likes. Quien pinte tiempo u onda se suscribe a `player.tick`; quien pinte metadatos, a `player.store`. `player.progressMs()` da el valor puntual.
  - `likesRev` es un contador que sube en cada cambio de favoritos: las filas comparan la revisión antes de recalcular, y `player.isLiked()` es O(1) porque el player mantiene un `Set` de ids en paralelo al array. **No mutes `likes` desde fuera** (`store.set({ likes: [] })` dejaría el `Set` desincronizado): usa `player.clearLocalLikes()`.
  - `radioIds` marca los tracks que entraron por radio automática y se escribe **en el mismo `set()` que la cola** (`addManyToQueue(tracks, fromRadio)`). Si se escribe en un `set()` posterior, las vistas que comparan la cola por ids no repintan y las insignias «Radio» no aparecen nunca (pasó).
  - API: `playTrack`, `playQueue`, `toggle`, `next`, `prev`, `jumpTo`, `seekTo`, `seekBy`, `seekRatio`, `setVolume`, `nudgeVolume`, `toggleMute`, `cycleRepeat`, `toggleShuffle`, `addToQueue`, `playNext`, `addManyToQueue(tracks, fromRadio?)`, `removeFromQueue`, `moveInQueue`, `removePlayed`, `dedupeQueue`, `clearQueue`, `startRadio(track, 'track'|'artist')`, `isRadioTrack(id)`, `setRate`, `cycleRate`, `rates()`, `setSleepTimer(min|null)`, `retry()`, `clearError()`, `isLiked`, `toggleLike`, `clearLocalLikes`, `syncAccountLikes`.
  - **Radio infinita** (ajuste `autoplay`, activa por defecto): cuando no queda nada por delante, `next()` y el propio `timeupdate` (25 s antes del final) piden la estación del track actual y añaden hasta 15 temas nuevos. `radioSeeds` evita repedir la misma semilla y `radioPending` serializa la petición.
  - **El volumen es perceptual**: el slider guarda 0–1 y el elemento de audio recibe `volume = v²`. Lo que se muestra y se persiste es el valor del slider.
  - Al vaciar la cola quitando el último track, `current` pasa a `null` (antes se quedaba la ficha sonando sin fuente).
  - La cola, repeat, shuffle y volumen persisten en localStorage. `likes` se sincroniza con la cuenta de SoundCloud en desktop (si no hay sesión o en web, usa el caché local).
  - **Reanudar posición.** `sl:player:queue` guarda además `{ trackId, progress }`. El `trackId` NO es redundante: `playTrack()` y `jumpTo()` llaman a `persist()` ANTES de `setCurrent()`, así que en ese instante `state.progress` todavía es el del track anterior. Al restaurar solo se aplica `progress` si `trackId === queue[index].id`; si no, se descarta. Se guarda cada 5 s mientras suena, al pausar, y en `pagehide` + `visibilitychange`. Estos dos últimos leen `audio.currentTime` DIRECTO en vez del store, porque el `timeupdate` está envuelto en `requestAnimationFrame` y no corre con la ventana oculta — sin eso, cerrar la app minimizada guardaría una posición congelada. Al arrancar solo se reanuda por encima de 5 s y nunca a menos de 5 s del final; el salto se aplica en `loadedmetadata` (poner `currentTime` antes de tener metadatos no hace nada, ni en progresivo ni en HLS). No se auto-reproduce: se restaura la posición y se reanuda al dar a play.
- `createStore` (`src/core/store.ts`): micro-store pub/sub.
- Settings (`src/core/settings.ts`): `{ version, theme, glass, topbar, accent, accentHue, density, backdrop, autoplay, rate, apiBase, volume }` con `getSettings()/updateSettings()/resetSettings()`. Se sanea campo a campo al cargar y al escribir (theme del conjunto permitido, `accentHue` normalizado a 0–359, `volume` con clamp 0–1, `apiBase` validado con `new URL()` y sin barra final) y migra por `version`. `watchSystemTheme()` re-aplica el tema al cambiar el del sistema.

## Router

Hash-based, en `src/core/router.ts`. Las vistas se auto-registran:

```ts
import { register } from '../core/router'
register('nombre', (route, container) => {
  // route.params.id, route.params.q, route.params.sub
  // renderizar dentro de `container` (ya limpio)
})
```

Rutas: `''/home`, `/search?q=&tab=&dur=&when=&genre=&cc=`, `/charts?genre=`, `/track/:id`, `/playlist/:id`, `/user/:id`, `/queue`, `/now`, `/feed`, `/likes`, `/settings`.

Los filtros de búsqueda viven en la URL a propósito: una búsqueda filtrada se puede compartir y sobrevive a un recargado.

## UI

- `src/ui/el.ts`: builder `h(tag, attrs, children)`, `svgIcon(name, size)` (≈50 iconos: play, pause, next, prev, shuffle, repeat, repeatOne, heart, heartFill, search, queue, home, chart, comment, repost, download, more, settings, external, back, forward, close, check, music, playlist, user, trend, disc, clock, eye, github, trash, info, code, flag, list, sun, moon, headphone, waves, link, plus, minus, radio), `esc()`.
- `src/core/utils.ts`: `esc()`, `fmtTime(ms)`, `fmtCount(n)`, `timeAgo(iso)`, `formatDate(iso)`, `artworkUrl(url, 't500x500')`, `initials(label)`, `debounce`, `clamp`, `shuffle`. **`esc()` es SOLO para interpolar en `innerHTML`**: `h()` inserta los hijos con `createTextNode`, que ya escapa, así que pasarle `esc(...)` produce entidades visibles (`Rock &amp;amp; Roll`).
- `src/ui/artwork.ts`: `artEl(url, label, {size, href, title})` (lazy + fallback iniciales), `artOverlay(icon, size)`, `avatarEl(url, label, size)`. Con `href` el nodo devuelto es un `<a>` (no un `div`) y lleva `.art-open`, que revela el `.art-overlay` al pasar el ratón. **La portada de un track SIEMPRE abre la ficha del track** (fila, héroe de inicio, isla del reproductor); el resto de la fila reproduce. Funciona porque el `click` de `.track-row` sale antes si el objetivo está dentro de un `<a>`. Nunca poner blur sobre la portada: la miniatura ya es la única pista visual de qué canción es. El `<img>` va **después** del `.art-fallback` en el DOM y **ambos deben ser `position:absolute`**: si la imagen queda estática, el fallback (que sí está posicionado) se pinta encima y tapa la portada en toda la app. Al aplicar clases al nodo devuelto usar `classList.add()`, **nunca `className =`**: reemplazar la clase tira `art-frame` y con ella el `aspect-ratio`, el `overflow` y el fundido de `.loaded`.
- `src/ui/waveform.ts`: `waveformEl({ interactive, showHover, getDuration, onSeek })` → controller `{ el, setSamples(number[]), setProgress(ratio), setLoading(bool) }`.
- `src/components/trackrow.ts`: `trackRow(track, { rank?, showPlays?, onPlay? })` (fila estándar: arte, título, artista, like, añadir a cola, duración). Usar para TODAS las listas.
- `src/ui/toast.ts`: `toast(msg, kind)`, `toastOK`, `toastErr`.
- `src/ui/skeleton.ts` + `src/styles/skeleton.css`: **todos** los esqueletos de carga de la app. Primitivas (`skShape`, `skLine`, `skCircle`, `skChip`, `skStatus`) y piezas ya compuestas por forma de contenido: `skTrackRow/skTrackRows/skTrackList/skMore`, `skResultRows('playlist'|'user')`, `skPlaylistCards/skCardGrid`, `skCarousel`, `skAvatarRow`, `skAppearsRow`, `skHero/skHome`, `skTrackPage`, `skPlaylistPage`, `skProfileHead`, `skComments`, `skFeedItems`, `skAccountCard/skAccountPreview`, `skPickerRows`, `skPaletteRows`, `skWave`, y `skReveal(el)` para el fundido del contenido real cuando sustituye al esqueleto.

  Reglas del sistema:
  - **El esqueleto imita el hueco real, no una lista genérica.** Cada pieza reusa las clases y las medidas del componente que sustituye (`--row-art`/`--row-pad` en las filas, 288 px de portada en la ficha de track, 220 px en la playlist, avatar de 96 px en el perfil, tarjetas dentro de `card card-pad`), así que al llegar los datos no hay salto de layout. Si cambias la geometría de un componente, cambia también la de su esqueleto.
  - **Un solo brillo, con fase escalonada.** El barrido lo pinta `.skeleton` con un degradado teñido de `--accent`; cada elemento raíz lleva `--sk-i` (índice) y de ahí sale un `animation-delay` NEGATIVO, para que la ola recorra la lista sin que ninguna fila arranque apagada. La entrada (`sk-rise`) sí usa retardo positivo, que es lo que da el escalonado al aparecer.
  - Colores solo desde `--sk-fill`/`--sk-edge`/`--sk-glint`/`--sk-tint`, redefinidos para el tema claro. Con `prefers-reduced-motion` se apagan todas las animaciones y queda el relleno plano.
  - Los contenedores de esqueleto van con `aria-hidden="true"`: son ruido para un lector de pantalla.
  - **Ya no queda ni un spinner en la app** (la clase `.spinner` se borró de `design.css`): los centinelas de scroll infinito usan `skMore(2)` — dos filas atenuadas que además anticipan lo que va a llegar.
  - Las portadas (`artEl`, `avatarEl`) llevan `art-loading` mientras la imagen viaja y pintan el mismo barrido. **La regla excluye las filas** (`:not(.art)`): en una lista virtualizada de cientos de filas con `loading="lazy"` habría cientos de animaciones vivas para imágenes que ni siquiera han empezado a descargarse.
- `views/now.ts` (`#/now`, «Ahora suena»): carátula a tamaño grande con su propio glow, onda de 76 px, controles principales, velocidad, temporizador, radio y la cola en vivo («A continuación», con salto directo por `jumpTo`). Es la vista que justifica el reproductor compacto: la isla de abajo no tiene sitio para todo esto.
  **Al copiar los hijos de `artEl()` a otro contenedor** (aquí y en la isla del reproductor) ese contenedor necesita la clase `art-frame`: sin ella el `<img>` deja de ser `position: absolute` y el `.art-fallback` con iniciales se pinta encima de la portada.

### Chrome de interacción (menú, modal, paleta)

Tres piezas genéricas, todas con foco atrapado, `Escape`, cierre al pulsar fuera y devolución del foco al elemento que las abrió:

- `ui/modal.ts` → `openModal({ title, className, onClose })` devuelve `{ root, body, head, close }`. Pone `modal-open` en `<html>` (bloquea el scroll) y cuenta modales anidados, así que cerrar uno no desbloquea el de debajo.
- `components/menu.ts` → `openMenu(entries, anchorOElemento)`. Solo hay **un menú abierto a la vez** (`closeMenu()`); se coloca en coordenadas de viewport con volteo si no cabe abajo, y se cierra al hacer scroll o redimensionar porque su ancla ya no es válida. Navegación con flechas/Home/End y `role="menu"`.
- `components/palette.ts` → `openPalette(query?)`, la paleta de comandos (⌘K/Ctrl+K). Mezcla comandos locales (navegación, reproducción, apariencia, temporizador) con resultados en vivo de la API (tracks + usuarios, `debounce` 240 ms y token de secuencia para descartar respuestas viejas). El filtro de comandos normaliza acentos, así que «ajustes» encuentra «Ajustes» y «Ámbar» se encuentra escribiendo «ambar».
- `components/shortcuts.ts` → hoja de atajos (`?`), que lee la **única** lista de verdad: `core/shortcuts.ts`. Los ajustes pintan esa misma lista; si añades un atajo en `app.ts`, añádelo ahí o la ayuda miente.

Los atajos de una sola letra no se disparan si el foco está en un campo (`isInteractiveTarget`) ni con un overlay abierto (`overlayOpen()`), y `⌘K` sí funciona siempre.

### Filas de track y accesibilidad

`trackRow()` no hace la fila focalizable (sería un `button` con enlaces dentro): las acciones son botones reales dentro de `.row-actions`, que se revelan con `:hover` **y con `:focus-within`**, más `@media (hover: none)` para táctil. El orden de tabulación de una fila es portada → título → artista → reproducir → favorito → cola → más. El clic en la fila sigue reproduciendo para el ratón, y `contextmenu` abre el mismo menú que el botón «⋯» (`trackMenu()`), así que teclado, ratón y táctil llegan a las mismas acciones.

`toast()` vive en un contenedor con `role="status"` + `aria-live="polite"`; repetir el mismo mensaje reanima el toast existente en vez de apilar copias.

La fila pinta dos insignias junto al título: `30s` cuando `policy === 'SNIP'` y **`DRM`** cuando `isDrmOnly(track)` (ver los gotchas de la API). La segunda es la diferencia entre «no pasa nada al pulsar» y saber antes de pulsar que ese track no se puede reproducir aquí.

### Motor de audio (`player/audiograph.ts` + los dos platos del player)

Con `dsp` activado (ajuste por defecto) el player deja de ser un `<audio>` y pasa a **dos platos** enrutados a un grafo WebAudio:

```
plato A ─┐
         ├─ deckGain ─→ entry ─→ 5 biquad (EQ) ─→ [limitador] ─→ master (volumen) ─→ analyser ─→ destination
plato B ─┘
```

- **Dos elementos de audio** (`Deck`) para poder solapar. El activo es `this.decks[this.activeDeck]`; `this.audio` es un getter sobre él, así que el resto del player siguió funcionando sin tocar sus 45 usos. Cada plato tiene sus propios listeners y **todos empiezan con `if (!active()) return`**: un `ended` o un `pause` del plato ocioso no debe mover la UI ni avanzar la cola. El `error` del plato ocioso solo cancela la precarga, en silencio.
- **Precarga**: 20 s antes del final (o `crossfade + 2`, el mayor) se resuelve el `streamUrl` del siguiente y se carga en el plato ocioso. Si la cola cambia y ese track ya no es el siguiente, se descarta y se vuelve a precargar; al empezar el fundido se revalida `queue[index].id === trackId`.
- **Crossfade de potencia constante**: `setValueCurveAtTime` con `cos`/`sin` (65 puntos). Con un fundido **lineal** el nivel se hunde ~6 dB en el centro (medido: mínimo 0,0045 frente a 0,0091 de régimen); con las curvas de potencia constante la suma `g₀² + g₁²` sale **1,00 en las 30 muestras** del fundido. Con `crossfade = 0` el relevo es encadenado: el plato nuevo arranca 0,18 s antes del final, sin hueco de silencio (medido: nivel mínimo 0,0048, nunca cerca de cero).
- Al cambiar de plato, `adoptDeck()` hace lo que haría `loadAndPlay` sin recargar nada: fija `index`/`current`, empuja el historial, persiste y actualiza la Media Session.
- **`cancelFade()`** ante cualquier `next`/`prev`/`jumpTo`/`clearQueue`: `cancelAndHoldAtTime` + `cancelScheduledValues` y ganancias a 1/0. Verificado interrumpiendo un fundido de 8 s a mitad: quedó un solo plato sonando, ganancias `[0, 1]`, el otro parado y limpio.

Trampas que solo se ven midiendo (todas comprobadas con `soundclear.player.diagnostics()` en la consola de `npm run dev`):

- **`DynamicsCompressorNode` de Chrome mete ganancia interna oculta**: con `makeup = 1` el nivel medio subía **+4,3 dB** al activarlo, y con otro material **+6,6 dB**. Es imposible compensarlo con una constante. Por eso el limitador es un **`WaveShaper`** con curva `tanh(drive·x)/drive` (pendiente 1 en el origen, `drive = 1.6`, `oversample = '4x'`) más un trim fijo de `1.25`: medido A/B/A/B sobre 51 muestras por condición, **+0,3 dB de nivel medio, −0,9 dB de pico y factor de cresta 1,59 → 1,39**. Eso es lo que promete el ajuste: misma sonoridad, menos picos.
- **El volumen tiene que entrar en el grafo**, no quedarse en `el.volume`: si el volumen escala el audio *antes* del limitador, a volumen bajo la curva trabaja en su zona lineal y el nivelado no hace nada. Con el grafo activo los elementos van a `volume = 1` y el volumen perceptual (`v²`) es el `master`. Sin grafo, se queda en `el.volume` como siempre.
- **El detector de silencio tiene que escalar con el volumen.** Primera versión con umbral absoluto (`0.0004`): a volumen 0,06 el RMS legítimo era 0,0002 y el vigilante **apagó el motor solo** a los 2 s de reproducción. Ahora compara contra `SILENCE_RMS · v²` y no corre por debajo de `v² = 0,02`.
- `crossOrigin = 'anonymous'` es obligatorio para que `createMediaElementSource` no devuelva silencio, y **solo se pone en los platos enrutados**. Verificado que los tres hosts de media mandan `access-control-allow-origin: *`: `cf-media.sndcdn.com` (progressive), `cf-preview-media.sndcdn.com` (previews de SNIP) y `playback.media-streaming.soundcloud.cloud` (playlists HLS).
- **Con el grafo activo se fuerza hls.js** en vez del HLS nativo: un elemento que decodifica HLS nativo y va a un `MediaElementSource` es el caso clásico de silencio en WebKit. Verificado en Chromium forzando `streamUrl(track, 'hls')`: reproduce, el nivel es > 0 y **el crossfade funciona con dos instancias de hls.js a la vez** (potencia 1,00 en las 16 muestras del fundido). En WKWebView, si `Hls.isSupported()` fuera falso, se cae al HLS nativo y la red de seguridad es el detector de silencio.
- Si `createMediaElementSource` falla, el grafo se marca como no disponible y se **reconstruyen los platos desde cero** (elementos nuevos, nunca enrutados): un elemento enrutado no se puede «desenrutar».
- `AudioContext` se crea en la **primera reproducción**, no al arrancar (el navegador lo dejaría suspendido), y además se hace `resume()` en el primer `pointerdown`/`keydown`.
- Con `dsp` desactivado hay **un solo plato sin enrutar** y el comportamiento es exactamente el de antes de esta fase: sin EQ, sin nivelado y sin transiciones.

### Accesibilidad: lo que hay que no romper

- **`.row-actions` no puede volver a `display: none`.** Estaba oculto así hasta el `:hover`, con un `:focus-within` que **nunca podía dispararse** (un elemento en `display: none` no es focalizable), así que con teclado **no se llegaba a ningún botón de ninguna fila**. Ahora se oculta con `opacity: 0` + `pointer-events: none` y se revela con `:hover` y `:focus-within`. El `pointer-events` es la mitad importante: sin él, un clic sobre la zona invisible de una fila no señalada lo comería un botón en vez de reproducir la fila (verificado con `elementFromPoint`).
- **Flechas en las listas** (`components/trackrow.ts`, un solo listener delegado en `document`): con el foco dentro de una fila, `↓`/`↑` mueven al **mismo control** de la fila siguiente o anterior, y `Home`/`End` a la primera y la última. Sin esto, recorrer 500 filas con Tab son 3.500 saltos. Funciona igual en listas virtualizadas porque solo mira las filas montadas.
- **Región viva**: la barra del reproductor tiene un `<p class="sr-only" aria-live="polite">` que anuncia «Suena X de Y» al cambiar de track. Es lo único que anuncia; no hay que meter ahí el progreso ni el play/pausa o se vuelve un loro.
- **Objetivos de 24 px** (WCAG 2.5.8): los `input[type=range]` miden 24 px de alto con la pista fina pintada en `::-webkit-slider-runnable-track` (antes eran 20 px). `.btn` tiene `min-height: 32px`, y `.see-more`, `.desc-toggle` y `.comment-at` llevan altura mínima. **Excepciones conscientes**: los enlaces de título y artista dentro de una fila (son enlaces en línea y la misma acción está en el menú «⋯», que sí mide 30 px) y los marcadores de comentario sobre la onda, que ahora son `tabindex="-1"` + `aria-hidden="true"` porque duplican el salto por tiempo que ya está en cada comentario (y quitaban 30 paradas de tabulación de la ficha).
- **Tinta sobre acento**: `--accent-on` **no es siempre blanco**. Con el acento naranja de SoundCloud, blanco daba 3,21:1 (falla AA). Ahora ese acento usa tinta oscura en oscuro (6,05:1) y en claro se oscureció el propio acento (4,87:1). Medido para los 7 acentos × 2 temas: **la peor tinta es 4,56:1 y el peor anillo de foco 4,77:1**, todos por encima del mínimo.
- **Ningún `outline: none` sin sustituto**: los campos y el buscador usan `box-shadow: 0 0 0 2px var(--accent-text)` (sólido, no el halo del 18% de antes) y `.menu-item:focus-visible` marca con una barra interior de acento.
- **La auditoría es parte del repo**: `dev/a11y.ts` (solo en desarrollo, cero en producción) comprueba nombres accesibles, objetivos de 24 px, `alt`, ids duplicados y la región viva. Se usa desde la consola: `await soundclear.auditRoutes()` recorre las rutas y devuelve «limpio» o la lista de fallos. **Ojo con medir contraste recorriendo el DOM**: con el motor acrílico (capas semitransparentes, `backdrop-filter` y degradados de cristal) los composites calculados dan números falsos — un botón perfectamente legible salía a 1,07:1. Para contraste, medir **pares de tokens** contra los fondos del peor caso que documenta la escalera, no nodos.

### Escritorio nativo (bandeja, atajos globales, mini reproductor)

Tres plugins (`global-shortcut`, `window-state`, `notification`) y la bandeja de `tauri::tray`. Todo se maneja **desde Rust**: la parte de TS solo escucha eventos y llama comandos, así que no entra ni una dependencia npm nueva.

- **Atajos globales**: `⌘⌥Espacio` (play/pausa), `⌘⌥←/→`, `⌘⌥F` (favorito) y `⌘⌥M` (mini). **Las teclas de medios del teclado no se pueden registrar en macOS**: `Code::MediaPlayPause`, `MediaTrackNext` y `MediaTrackPrevious` fallan con `Failed to watch media key event` (verificado; el sistema no las cede a apps que no son nativas). El registro es 5/8 y la UI de Ajustes lo dice en vez de fingir que funcionan.
- El atajo emite `sl:cmd` con una cadena (`toggle`/`next`/`prev`/`like`); la bandeja emite lo mismo. `api/native.ts` lo escucha en la ventana `main` y lo aplica al player. Cada comando recibido deja rastro en el log (`nativo: comando recibido …`), que es lo que permite verificar el circuito completo sin poder pulsar teclas.
- **Bandeja**: menú con el track actual (item deshabilitado que se actualiza con el comando `set_now_playing`), play/pausa, anterior, siguiente, mini, mostrar y salir. Si la ventana principal se cerró, «Mostrar SoundClear» **la recrea** con `WebviewWindowBuilder::from_config` leyendo la config de `tauri.conf.json`; sin eso, cerrar la principal dejaba la app viva y sin forma de volver.
- **Mini reproductor** (`mini/mini.ts`): ventana de 360×160 sin decoración, siempre encima, fuera de la barra de tareas y con `set_content_protected(true)` para que **no salga en las capturas ni al compartir pantalla**.
  - Es un **mando, no un reproductor**: no importa `player.ts`. Dos ventanas con el player instanciado serían dos reproductores y dos audios. Pinta lo que llega en `sl:state` y manda `sl:cmd`; al cargar avisa con `sl:mini-ready` (la principal responde con el estado y solo entonces empieza a mandar `sl:state` cada 500 ms) y al cerrarse manda `sl:mini-bye`.
  - Para que la mini no cargue la app entera, `main.ts` quedó como entrada mínima (CSS base + ajustes + decidir ventana) y todo lo demás vive en `boot.ts` detrás de un `import()` dinámico. La mini carga **~14 KB gzip** en vez de ~77.
- Trampas medidas en macOS:
  - **`set_position` después de crear la ventana no la mueve** (devuelve `Ok` y la ventana se queda centrada, verificado dos veces con el log). Hay que pasar la posición al **constructor** (`builder.position(x, y)`, en coordenadas lógicas) y crear la ventana con `.visible(false)` para mostrarla ya colocada.
  - La posición se calcula con `monitor.position() + monitor.size()` del monitor **de la ventana principal**, no `primary_monitor()`: en un monitor secundario la esquina no es la del primario y la mini se iba fuera de pantalla (medido: `y = -819`).
  - `capabilities/default.json` está **por etiqueta de ventana**: sin añadir `"mini"` a `windows`, la mini no puede ni escuchar eventos.
  - El plugin `window-state` guarda y restaura tamaño y posición; la mini, el puente y el login van en su `denylist` (la mini se coloca sola, el puente y el login no deben recordar nada).

### Sin conexión (`core/offline.ts`)

Guardar audio en el dispositivo para escucharlo sin red. El almacén es **IndexedDB**, no OPFS: el `FileSystemWritableFileStream` de OPFS no está garantizado en WKWebView (donde corre el escritorio) y un track son 1–10 MB, tamaño que un `Blob` en IDB aguanta sin drama. Dos object stores: `audio` (blob por id de track) e `index` (metadatos por id).

- `initOffline()` (lo llama `app.ts`) lee el índice y llena `offlineStore` **y un `Set` de ids en memoria**, que es lo que consulta `offlineHas()` sin tocar disco. Ese `Set` es la razón por la que el player puede decidir en síncrono si hay copia local.
- El player pide `offlineBlobUrl(id)` **antes** de resolver `streamUrl`: si hay copia, la reproduce desde `blob:` y no toca la red. Cada plato recuerda su `localUrl` y `resetDeck()` hace `revokeObjectURL` — sin eso, cada cambio de track filtraría el blob entero en memoria.
- La precarga del crossfade también mira primero el almacén local.
- **Qué no se guarda**: previews SNIP de 30 s, tracks solo-DRM y tracks que solo llegan por HLS (habría que remuxar los segmentos; queda pendiente y el mensaje lo dice). `offlineReason(track)` devuelve el motivo exacto en texto, y es lo que pintan el menú y la ficha.
- **Presupuesto** en `sl:settings` (`offlineBudget`, en MB: 0/250/500/1000/2000/5000). Se comprueba dos veces: con el `content-length` antes de descargar y con el tamaño real del blob antes de escribir. Con 0 MB no se guarda nada.
- El progreso se lee del `ReadableStream` de la respuesta (`saving[trackId]` de 0 a 1 en el store).
- La UI se sincroniza por un **evento de ventana** `sl:offline` (`{ trackId, state: 'saving' | 'saved' | 'gone' }`) que escucha **una sola vez** `trackrow.ts` a nivel de módulo y aplica la insignia a `.track-row[data-id="…"]`. Con listas virtualizadas y miles de filas, una suscripción por fila sería el patrón caro; este es O(filas montadas) y solo cuando algo cambia de verdad.
- Gestión de espacio en **Ajustes › Datos**: barra de uso, presupuesto, lista con tamaño por track, quitar uno y vaciar todo.

**Descarga del archivo original** (distinto de lo anterior): solo si el autor la permite (`downloadable` y `has_downloads_left !== false`), usando el endpoint propio de SoundCloud (`/tracks/{id}/downloads`). En web abre la URL firmada; en escritorio la escribe el comando Rust **`download_to_music`** en `~/Música/SoundClear` (con `audio_dir()` y `download_dir()` de reserva), con lista blanca de hosts (`*.sndcdn.com`, `soundcloud.com`, `*.soundcloud.cloud`), nombre saneado, extensión deducida del `content-disposition` o de la URL y sufijo `(n)` para no pisar nada. El CSP ya permitía `https://*.sndcdn.com` en `connect-src`, que es lo que necesita el `fetch` del guardado sin conexión; el `blob:` de reproducción ya estaba en `media-src`.

### Listas virtuales (`ui/virtuallist.ts`)

Ventana de nodos sobre el scroll **de la página** (no un contenedor con scroll propio) y altura de fila uniforme:

```ts
const v = virtualList({ row: (index) => buildRow(index) })
list.appendChild(v.el)
v.setCount(items.length)   // también repinta
v.refresh()                // tras mostrar un panel oculto o cambiar los datos
v.destroy()                // al desmontar la vista
```

Cómo funciona y por qué así:

- Las filas se colocan `position: absolute` en `top: index * (rowHeight + gap)` y el contenedor mide `count * stride - gap`, así que la barra de scroll de la página es la real desde el primer pintado.
- **No hay caché de nodos**: cada vez que una fila entra en la ventana se vuelve a construir. Reutilizar un nodo desmontado sería más rápido, pero `trackRow()` se suscribe al player y una fila separada del DOM se desuscribe sola → volvería con estado viejo (favorito o «sonando» mentirosos).
- La altura real se **mide** de la primera fila montada (`offsetHeight`) y se vuelve a medir al cambiar `data-density` (un `MutationObserver` sobre `<html>`) y al redimensionar. Con densidad compacta el `stride` cambia y las posiciones se recalculan.
- Nunca desmonta la fila que contiene `document.activeElement`, e inserta en orden de índice, así el orden de tabulación sigue el visual.
- `paint()` se auto-destruye si el elemento ya estuvo conectado y deja de estarlo: una vista que se va sin llamar a `destroy()` no deja escuchas de `scroll`/`resize` colgando. Igual, llama a `destroy()` explícitamente.
- Umbral común: **`VIRTUAL_MIN = 60`** filas. Por debajo se sigue pintando por bloques (la carga por red no cambia: sigue siendo la misma paginación por cursor).

Dónde está aplicada y qué medimos (19 ago 2026):

| Vista | Resultado |
|---|---|
| `#/likes` (Favoritos e Historial) | 500 filas → 21 nodos de fila; 32 al hacer scroll |
| `#/user/:id` (Populares, Tracks, Likes) | 170 entradas → 22 nodos; al volver de otra pestaña reposiciona en el índice 61 correcto |
| `#/queue` | 170 tracks → 21 nodos, 1.244 nodos en toda la página |

- Las pestañas de perfil **solo** se virtualizan mientras la pestaña es homogénea de tracks. Los likes y las publicaciones de un usuario pueden traer playlists mezcladas: en cuanto aparece una tarjeta (alturas distintas) la vista **cae a lista normal** y repinta en el orden original (verificado con un perfil cuya primera playlist llega en el índice 131). La pestaña Playlists es una rejilla y nunca se virtualiza.
- En la cola, las filas llevan `data-qindex`: `markCurrent()` y las marcas de arrastre consultan el DOM montado en vez de guardar un array de filas. El `dragend` de limpieza va **también en el contenedor**, porque al arrastrar cerca del borde la página hace auto-scroll y la fila de origen puede desmontarse a mitad del arrastre.

### Feed e historial de la cuenta (solo escritorio)

`/stream` (lo que publican los que sigues) y `/me/play-history/tracks` existen y piden sesión (401 anónimo, verificado). `/me/activities`, `/me/activities/tracks`, `/me/play-history` y `/recently-played` dan 404: no existen, no perder tiempo con ellos.

- **Los items de `/stream` son sobres, no tracks**: `{ type, created_at, user, caption, track?, playlist? }`, con `type` en `track` / `track-repost` / `playlist` / `playlist-repost` y también valores promocionales **sin contenido**. `stream()` descarta todo item sin `track` ni `playlist`; la vista los agrupa por `type:id` para no repetir cuando dos personas repostean lo mismo.
- **`/stream/users/{id}` devuelve el mismo sobre y es anónimo**, así que sirve de doble para desarrollar y verificar la vista del feed sin sesión. Es como se probó `views/feed.ts` con datos reales (paginación por cursor y deduplicado incluidos).
- **Paginación por cursor**: los dos endpoints aceptan `linked_partitioning=1` y hay que seguir `next_href` tal cual (el transport le inyecta el `client_id`). Nunca `offset` numérico.
- **El historial de cuenta trae entradas sin `track`** (solo `track_urn`): `playHistory()` las filtra. En `#/likes` › Historial hay dos fuentes: «Tu cuenta» (cruza dispositivos, no se puede borrar desde aquí) y «Este dispositivo» (el local de `sl:history`, que sí se borra).

### Escrituras autenticadas (solo escritorio)

Favoritos, seguir, repostear y playlists son las cuatro cosas que SoundClear escribe en la cuenta del usuario. Todas van por el mismo sitio: `authed_request` → webview `sl-bridge` → `fetch` con `credentials: 'include'`, `Authorization: OAuth …` y `Content-Type: application/json`. El puente acepta cualquier verbo y serializa el cuerpo como JSON, así que **no hubo que tocar Rust** para añadir escrituras nuevas.

`core/social.ts` es el estado de lo social: `followingIds`, `repostIds`, `busy` y un `rev` para que los botones sepan repintarse (mismo patrón que `likesRev`). Todo pasa por `canWrite()` (escritorio + sesión lista): en web ninguna de estas acciones existe en el DOM, no se pintan deshabilitadas.

Reglas que salieron de estrellarse contra la API:

- **Un 404 anónimo no significa que la ruta no exista.** `PUT /me/likes/{id}` —que funciona en producción— devuelve 404 sin sesión, igual que `PUT /me/followings/{id}`. Para saber si una ruta existe hay que mirar el `DELETE` (401 = existe y pide sesión). Sondear escrituras dispara además el antibot (DataDome empieza a devolver captchas), así que **no** se sondean en bucle.
- **Leer a quién sigues: `/users/{tuId}/followings?limit=200&linked_partitioning=1`** (verificado con sesión real: 200). `/me/followings/ids` está **muerto** (404 incluso anónimo) y `/me/followings` también dio 404 con sesión: no volver a intentarlo.
- **`limit` máximo real: 200.** `/me/track_reposts/ids?limit=5000` devuelve **400 con sesión** (anónimo da 401, así que esto solo se ve con cuenta); con `limit=200&linked_partitioning=1` responde 200. Cualquier lista de ids se pagina de 200 en 200 siguiendo `next_href`.
- **El log de escritorio es la única forma de ver esto.** `$TMPDIR/soundclear-debug.log` registra cada `authed <VERBO> <url>` y su `status`; los ids del puente se asignan por orden de adquisición del mutex, así que la enésima línea `authed GET` se empareja con el enésimo `eval intento (id N)`. Ahí se cazaron los dos fallos anteriores.
- **Verbo incierto → cadena de reserva.** Seguir y repostear intentan `PUT` y, solo si responde 404 / 405 / 422, reintentan con `POST`. Igual con la lectura de estado: `GET /me/followings/ids` y, si falla, `GET /me/followings` desenvolviendo `{id}`.
- **`PUT /playlists/{id}` reemplaza la lista entera, no añade.** Hay que leer los ids (`playlistTrackIds`), concatenar y reescribir. El cuerpo va como `{ playlist: { tracks: [{ id }] } }` y, si la API lo rechaza con 400/422, se reintenta con ids planos. Al reescribir se deduplica: mandar un id dos veces es la forma fácil de corromper una playlist ajena al orden esperado.
- **`POST /playlists` no es idempotente y el puente reintenta una vez.** Si la petición se aplicó pero la respuesta se perdió, un reintento crearía dos playlists. Por eso, cuando la creación falla, `createPlaylistWith()` **reconcilia**: relee las playlists del usuario y, si ya existe una con ese título, la trata como creada en vez de volver a crear.
- **Todo optimista con reversión.** Seguir/repostear pintan el estado nuevo al instante, marcan el id como `busy` (botón deshabilitado, «Guardando…») y, si la petición falla, vuelven al estado anterior con un toast que dice qué no se pudo hacer. Verificado en local forzando el fallo.
- Las playlists nuevas se crean **privadas por defecto**; publicarlas es un clic explícito con el aviso de que cualquiera podrá verlas.

### Puerta de entrada y modo invitado

La puerta (`components/logingate.ts`) ya no es un muro: además de iniciar sesión ofrece **«Explorar sin cuenta»**, que guarda `sl:guest` y deja usar la app entera (buscar, escuchar, cola, favoritos locales). En web es la única vía posible — la sesión de SoundCloud solo existe en escritorio — así que sin esto la PWA era una pantalla de descarga. `core/account.ts` expone `guestAllowed()`, `allowGuest()` y `revokeGuest()`; los ajustes permiten volver a pedir sesión al abrir.

### Comprobar sesión sin pantalla de carga

Mientras `accountStore` está en `unknown` la puerta entra en `data-phase='checking'` y pinta **solo** `.login-check`: el logo animado, «Comprobando tu sesión», un raíl fino y una nota. Nada de tarjeta ni de esqueleto de botones — es el único estado de carga de la app que no usa `ui/skeleton.ts`, porque aquí no se está rellenando una lista sino esperando a saber si hay sesión, y una tarjeta completa con huecos parpadeando era más ruido que información.

Es interactivo a propósito: el logo es un `<button>` que relanza `refreshAccount()`, y a los 3.5 s aparece «Explorar sin cuenta» con la nota de que tarda más de lo normal (antes ese callejón sin salida obligaba a recargar).

**`hidden` no basta si la clase pone `display`.** `.login-card` y `.login-check` tienen `display: flex`, así que el atributo `hidden` no las oculta: hace falta la regla `.login-card[hidden], .login-check[hidden] { display: none }`. Lo mismo vale para `.chip`, `.empty-state` y `.track-row` (ver `views.css`) — el filtro de charts oculta filas con `hidden` y sin esa regla no ocultaba nada.

### Tour de bienvenida (`components/welcome.ts`)

Al primer arranque, `welcomePending()` (= `!settings.onboarded`) abre un tour de 5 pasos que **hay que completar**: tema → acento → cristal y densidad → barra (etiquetas, estilo de icono, flechas) → resumen. Cada elección llama a `updateSettings()` en el acto, así que se aplica a la app entera; el «Continuar» del paso queda deshabilitado hasta que se toca una opción de ese paso (elegir es obligatorio, aunque la opción ya estuviera activa).

- La **vista previa** de la izquierda no es un dibujo: reutiliza las clases reales (`.logo`, `.nav-item`, `.title-icon`, `.h-display`, `--row-pad`/`--row-art`, `--accent-grad`, `--wave`). Como toda la personalización vive en `data-*` de `<html>`, la maqueta refleja los cambios sin una línea de JS de sincronización. Si añades un eje al tour, represéntalo ahí o el paso no se puede ver.
- `Escape` **no** cierra el tour mientras `onboarded` sea falso; después sí (se puede reabrir desde Ajustes → «Abrir la personalización guiada»).
- `resetSettings()` **conserva `onboarded`** y vuelve a persistir los ajustes en vez de dejar el storage vacío: restaurar ajustes no debe reabrir el tour por sorpresa.

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
| `--accent-text` | `#b3a1ff` | 5.1:1 | 6.0:1 |

En claro el caso peor es el espejo (carátula NEGRA sobre velo blanco, fondo `rgb(209,209,211)`): `#101014` 13.4:1, `#3d3d46` 7.0:1, `#56565f` 4.8:1, `#4c2fd0` 5.2:1. El preset `cristal` sube `--text2`/`--text3` un tramo dentro de su propio bloque, porque con menos velo la escalera base se quedaba en 3.7:1.

**Si tocas `--ambient-veil`, recalcula la escalera.** Es la única dependencia numérica real del sistema.

**Acentos alternativos** (`data-accent` en `<html>`, Ajustes › Apariencia › Acento). El violeta es el de siempre; los otros cuatro se eligieron **calculando** el color más vivo que sigue cumpliendo los mínimos contra los peores fondos conocidos (ambiente `rgb(58,58,61)` y tarjeta `rgb(47,47,50)` en oscuro; `rgb(209,209,211)` en claro):

| acento | `--accent` / `--accent2` | blanco encima | `--accent-text` oscuro | `--accent-text` claro |
| --- | --- | --- | --- | --- |
| violeta | `#7857ff` / `#6344e8` | 4.6 / 6.0 | `#b3a1ff` 5.1 | `#4c2fd0` 5.2 |
| cian | `#0f8097` / `#0c6a7d` | 4.6 / 6.2 | `#20b5d3` 4.6 | `#0b6172` 4.7 |
| ámbar | `#a66407` / `#8c5406` | 4.7 / 6.2 | `#e99116` 4.6 | `#7f4c05` 4.7 |
| verde | `#16864e` / `#126e40` | 4.6 / 6.3 | `#28bd73` 4.7 | `#10653b` 4.7 |
| rosa | `#de1b6d` / `#c51861` | 4.7 / 5.7 | `#ea88b1` 4.7 | `#aa1553` 4.7 |

Un ámbar «bonito» (naranja claro) no cabe en este sistema: el texto blanco de `.btn-primary` se cae por debajo de 4.5:1. Por eso el ámbar es bronce. Si algún día un acento necesita texto oscuro encima, existe `--accent-on` (por defecto blanco) y hay que redefinirlo en su bloque, no cambiar los botones.

`--accent-grad`, `--accent-soft` y las sombras de acento derivan de `--accent` con `color-mix`, así que un acento nuevo solo necesita cuatro tokens.

**Tono libre** (`accent: 'tono'` + `accentHue` 0–359, Ajustes › Apariencia › Tono libre). El mismo cálculo de la tabla, pero en tiempo real: `core/accent.ts` recorre OKLCH sobre el matiz elegido y devuelve los cuatro tokens. Para `--accent` baja la luminosidad desde 0.72 hasta que el blanco encima llega a 4.6:1 y se queda con el 96% del croma en gama; `--accent2` es el mismo croma 0.062 de luminosidad más abajo; `--accent-text` sube hasta 4.9:1 contra `rgb(58,58,61)` y su variante clara baja hasta 4.9:1 contra `rgb(209,209,211)`. Auditado en los 360 matices: peor caso 4.60 (blanco sobre `--accent`), 5.86 (blanco sobre `--accent2`), 4.90 (`--accent-text` en ambos temas). Los matices de los cinco presets reproducen sus hexadecimales a mano (286° → `#7757fa` vs `#7857ff`, 217° → `#107f96` vs `#0f8097`), así que el generador y la tabla son el mismo sistema.

No es CSS: `applyTone()` escribe un `<style id="sl-accent-tone">` con las dos reglas (`:root[data-accent='tono']` y su variante `[data-theme='light']`) y cachea ese texto en `sl:accent-css`. El script inline de `index.html` lo inyecta antes del primer pintado, igual que hace con `data-glass`. Nada de `oklch()` en la hoja: el color se calcula en TS y sale como hexadecimal, así que no depende de cómo mapee cada webview los colores fuera de gama.

**Densidad** (`data-density`): `comoda` (defecto) y `compacta` mueven `--row-pad` y `--row-art`. Cualquier lista nueva debe usar esos tokens en vez de números fijos para que el ajuste la afecte.

**La onda** (`--wave`) es un gráfico: el mínimo es 3:1, no 4.5:1. No se cumple subiendo el blanco (al 37% haría falta, y en un track comprimido se lee como una plancha opaca). Se resuelve dando a `.waveform` su propio canal con `--veil-panel`, con lo que su fondo deja de depender de la carátula: 36% en oscuro y 46% en claro dan ~3.2:1. En claro hace falta más porque el canal se compone contra blanco.

**Accesibilidad.** `@media (prefers-reduced-transparency: reduce)` sube todos los velos a 1, quita los blur y esconde el ambiente. No basta con quitar los filtros: quedaría una interfaz semitransparente sobre una carátula nítida, que es peor que cualquiera de las dos cosas.

**Hook `data-backdrop="system"`** (en `<html>`): quita el suelo y el ambiente para que se vea el cristal del compositor (Tauri + `window-vibrancy` + ventana transparente). Lo decide el ajuste **Fondo de la ventana** (`backdrop: auto | caratula | sistema`) y lo aplica el script inline de `index.html` antes del primer pintado. En `auto` solo se activa si el sistema tiene cristal nativo (macOS o Windows): en Linux `apply_window_glass` no hace nada, así que activarlo dejaba una ventana transparente **sin suelo ni ambiente** — es decir, fondo negro. Quien prefiera ver la carátula difuminada en vez del escritorio elige `caratula`.

**Hook `data-shell="desktop"`** (en `<html>`, lo pone el script de arranque de `index.html` cuando existe `__TAURI_INTERNALS__`): en escritorio la cabecera ES la barra de título, así que el logo pasa a ser marca decorativa (`opacity: 0` + `pointer-events: none`) y solo aparece al pasar el ratón por `.titlebar-brand`. El hueco que ocupa queda libre para arrastrar. En web el logo sigue siendo el enlace a inicio.

### Arrastrar y maximizar la ventana (escritorio)

Con `titleBarStyle: "Overlay"` + `hiddenTitle` la webview cubre TODA la ventana, incluida la barra de título nativa: sin regiones de arrastre declaradas la ventana no se puede mover ni maximizar con doble clic. Los permisos ya están en `capabilities/default.json` (`allow-start-dragging`, `allow-toggle-maximize`); lo que hace falta es el marcado.

Tauri 2.11 acepta tres valores en `data-tauri-drag-region` (ver `tauri/src/window/scripts/drag.js`): sin valor = solo el impacto directo en ese elemento arrastra; `"deep"` = arrastra cualquier descendiente; `"false"` = bloquea el arrastre en ese subárbol. El recorrido va de `composedPath()[0]` hacia arriba y **los elementos clicables (`A`, `BUTTON`, `INPUT`, `SELECT`, `TEXTAREA`, `LABEL`, `SUMMARY`, `[tabindex]`, roles interactivos) cortan el arrastre por sí solos** — no hay que excluirlos a mano.

- `.app-header` lleva `"deep"`: se arrastra por cualquier hueco y el doble clic maximiza. Botones, enlaces y el avatar quedan excluidos solos.
- `.header-search` lleva `"false"`: el envoltorio del buscador no es clicable, así que sin esto un clic en el icono de la lupa o en el padding arrancaría un arrastre en vez de enfocar el campo.
- `.login-gate` lleva el atributo **sin valor**: arrastra solo el fondo, nunca la tarjeta. Importante porque con sesión cerrada la puerta tapa la cabecera y dejaría la ventana sin ningún asidero.

En macOS el maximizar ocurre en `mouseup` (se cancela si el ratón se movió), no en `mousedown`. El arrastre hace `preventDefault()` en `mousedown`, así que dentro de una región de arrastre no se puede seleccionar texto: no marcar `.app-main` ni contenedores de contenido.

`:root[data-titlebar='overlay'] .app-header` reserva `padding-left: 88px` para los semáforos de macOS.

### Barra superior escondible (`data-topbar`)

Tres modos en `<html>` (Ajustes › Barra superior, preset en el script inline de `index.html`), con la lógica en `ui/topbar.ts`:

- `fija` (defecto) — `sticky`, siempre visible.
- `auto` — sigue siendo `sticky` y se va con `translateY(-101%)` al bajar; vuelve al subir, al llegar arriba, al acercar el ratón al borde o al recibir foco. **Sigue ocupando su hueco en el flujo a propósito**: si se sacara del flujo, el contenido daría un salto de 60 px en cada aparición. El hueco vacío deja ver el escritorio, que es justo el efecto buscado.
- `oculta` — pasa a `fixed` y el contenido recupera esos 60 px.

`.topbar-edge` es una franja fija en el borde superior (10 px en web, 30 px en escritorio) que hace dos cosas a la vez: es la zona que revela la barra y lleva `data-tauri-drag-region`, porque con la barra escondida no queda ningún otro asidero para mover la ventana. Se oculta en modo `fija` (ahí la cabecera ya es la región de arrastre).

Con `titleBarStyle: Overlay` la webview llega al borde, así que en `oculta` `.app-main` sube su `padding-top` a 36 px para que el contenido no se meta bajo los semáforos.

La clase `.topbar-off` sólo tiene efecto dentro de `[data-topbar='auto'|'oculta']`: así, al volver a `fija`, la cabecera reaparece aunque la clase se haya quedado puesta. `ui/topbar.ts` observa el atributo con un `MutationObserver` para repintar al cambiar el ajuste sin acoplar `core/settings.ts` a la UI.

### Sistema de diseño (design.css)

Tokens de superficie: `--surface`/`--surface2`/`--surface3` y `--border`/`--border2` son **velos**, no colores — están mapeados a `--veil*` y `--hairline*` de acrylic.css. Por eso toda hoja de vista que ya los usaba se volvió acrílica sin tocarla. `--bg` es el suelo opaco.

Excepciones deliberadas: `--solid`, `--solid-2`, `--scrim`. Para lo que tiene que RECORTAR o TAPAR de verdad (anillo del avatar sobre la portada, globo de tiempo de la onda, scrim del login). Un velo ahí no recorta: deja ver el borde.

Ejes de personalización en `<html>`: además de `data-theme`/`data-glass`/`data-topbar`/`data-density`/`data-backdrop` están `data-navlabels` (`iconos` esconde `.nav-label`; por defecto la barra va sin texto), `data-icons` (`plano` deja los iconos de `h-display` sin insignia de cristal — es el defecto, porque sobre cristal la pastilla añade una superficie que no aporta; `insignia` recupera la anterior) y `data-historynav` (`no` esconde las flechas atrás/adelante). Presets de acento: `violeta` (defecto), `cian`, `ambar`, `verde`, `rosa`, `soundcloud` (el naranja de SoundCloud, `#f50` en oscuro y `#e34c00` en claro para no perder el 4.5:1 con blanco encima) y `tono` (libre, calculado en `core/accent.ts`).

Otros tokens: `--text`, `--text2`, `--text3`, `--accent #7857ff`, `--accent2 #6344e8`, `--accent-grad`, `--accent-soft`, `--accent-text`, `--wave`, `--wave-progress`, `--radius 16px`, `--radius-sm 10px`, `--radius-lg 22px`, `--header-h 60px`, `--player-h 92px`, `--player-gap 12px`, `--ease`. Tema claro vía `[data-theme="light"]` (todos redefinidos — NO poner colores hardcodeados).

**Reproductor en reposo** (`.app-player.idle`): sin nada en cola no se pintan ceros. La carátula pasa a ser el logo animado sobre un degradado de acento, el texto dice «Aún no suena nada / Elige por dónde empezar», la onda y los tiempos se esconden y en su sitio aparecen tres chips (Tendencias, Tus favoritos, Buscar). El botón grande no queda muerto: con la cola vacía carga los charts y los reproduce. El vacío de `/now` sigue la misma idea con el logo rellenándose y atajos a la vista.

Layout: la cabecera es lámina de borde a borde y el reproductor es una **isla flotante** (`fixed` con `--player-gap` por los cuatro lados). La isla lleva `overflow: hidden`, así que `--player-h` tiene que caber de verdad: controles 42 + hueco 4 + onda 36 + 10 de aire = 92. Como barra pegada al borde el desbordamiento no se veía; en una isla se recorta.

El acento es lo único NO translúcido de la interfaz: en un mundo de cristal, una sola pieza sólida y encendida se lleva la mirada sin necesidad de tamaño ni de peso tipográfico.

**Ficha de track** (`views/track.css`): la cabecera es una tarjeta (`card card-pad track-hero`) con la portada a 288 px y, detrás de ella, `.track-art-glow` — la misma portada difuminada 38 px y saturada al 190%, en óvalo y al 50%. Es el único sitio donde la carátula vuelve a pintar fondo, y va CONTENIDA en la tarjeta (`overflow: hidden`) y lejos del texto: da identidad de color por track sin tocar el contraste. Se apaga con `prefers-reduced-transparency`. Las estadísticas van como tira de iconos (`.track-stat`), no como chips: seis chips de texto pesaban más que el título. Sólo reproducir y añadir a la cola son botones con etiqueta; descargar, compartir y abrir en SoundCloud son `icon-btn` con `title`.

Clases: `btn btn-primary btn-ghost btn-danger btn-sm`, `icon-btn` (+ `.active`), `chip chip.active chip-row`, `card card-pad`, `track-row` (+ `.playing`, con filo de acento a la izquierda), `skeleton` (+ la familia `sk-*` de `styles/skeleton.css`), `empty-state`, `h-display h-section text-dim text-faint text-accent truncate link-hover`, `grid-tracks` (auto-fill minmax 300px), `load-more`, `page-error`, `.input .select .field .field-label`, `.avatar`. De acrylic.css: `glass`, `glass-flat`, `glass-panel`, `on-glass`.

**`--accent` es color de FONDO, nunca de primer plano.** El violeta tiene poca luminancia: como texto o icono sobre cristal oscuro se queda en 2.5–2.9:1, por debajo del 3:1 mínimo para gráficos. Para cualquier cosa que se dibuje SOBRE el fondo (iconos activos, el corazón de «me gusta», el check de verificado) va `--accent-text`, que está calculado para eso en ambos temas. Con el naranja anterior esto no se notaba porque era mucho más claro; al cambiar a violeta hubo que corregir tres sitios.

Las sombras de acento salen de `color-mix(in srgb, var(--accent) N%, transparent)`, no de un `rgb()` fijo: así siguen al tema sin duplicar la regla.

**Nada de degradados de tonos opuestos.** `--accent-grad` va entre dos violetas vecinos (`#7857ff` → `#6344e8`) y AMBOS extremos mantienen el blanco encima por encima de 4.5:1 (4.6 y 6.0). Un degradado que se aclara al final deja el texto blanco en 3:1 justo donde acaba el botón.

### Marca e iconos

La marca son 5 barras simétricas. Hay dos formas y no son intercambiables:

- `ui/logo.ts` → **solo las barras**, `viewBox 0 0 332 332`, `fill="currentColor"`. Es la que se usa dentro de la app (cabecera, puerta de sesión) y por eso se adapta al tema. No lleva el cuadrado: la puerta ya tiene su propio contenedor redondeado y anidar dos era el defecto anterior. `appLogoLive()` devuelve las mismas barras con `class="logo-bar"` y `--bar` por barra, para animarlas escalonadas.
- El logo de la cabecera es un enlace a `/` **también en escritorio** (`data-tauri-drag-region="false"` sobre el enlace; el resto de `.titlebar-brand` sigue arrastrando la ventana). Se pinta con el acento: la marca en `--accent-text` con halo, y `.logo-name` con degradado `--text → --accent-text` recortado al texto. Cambiar de acento repinta la marca sin tocar JS.
- **Relleno de color** (`.logo-fillable`): dos copias apiladas de `appLogoLive()`, la base en `--wave` y la tinta en `--accent-text` recortada con `clip-path: inset()` animado de abajo arriba. Las dos copias se insertan a la vez, así que sus animaciones de barra van en fase; una copia estática sobre otra animada se desalinea. Se usa en la comprobación de sesión y en el vacío de `/now`.
- `public/icon.svg` + `scripts/gen-icons.mjs` → **icono de sistema**, con el cuadrado de tinta `#0b0b0f` y las barras en blanco puro. Solo para el SO/PWA.

`gen-icons.mjs` pinta a mano el PNG (sin dependencias) con supersampling 4×4: sin él los tamaños pequeños (32 px, favicon) salen con los bordes dentados. `inRoundedRect` necesita el clamp al rectángulo interior — sin él elige la esquina equivocada en las bandas centrales y se come el fondo.

Iconos de interfaz (`ui/el.ts`): trazo `1.75` sobre rejilla 24×24, `currentColor`, extremos redondeados. **Ningún path duplicado**: si dos nombres pintan lo mismo, uno de los dos está mal (pasó con `queue`/`playlist`/`list` y con `repost`/`repeat`). `ICON_PATHS[name] ?? ''` devuelve vacío en silencio, así que borrar una entrada usada no rompe el build: se ve como un hueco. Al tocar el set, comprobar que no quede ningún `svg.icon` sin hijos en la página.

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

### Filtrar una lista con scroll infinito (charts)

Charts tiene búsqueda libre además de los chips de género: el campo filtra en vivo los tracks ya cargados (título, artista, género y `tag_list`, sin acentos ni mayúsculas), conservando el puesto real del ranking en cada fila, y ofrece dos salidas — el chip «Ver charts de X» cuando lo escrito coincide con un género, y «Buscar en todo SoundCloud» (`/search?q=`), que también dispara `Enter`.

**Ojo con el centinela.** Al ocultar filas la lista se encoge, el `.load-more` sube a la vista y el `IntersectionObserver` pide página tras página: un filtro sin coincidencias vaciaría los charts enteros contra la API. Por eso `FILTER_MAX_LOADS` (6) corta la carga automática mientras hay texto y el centinela ofrece «Seguir buscando más abajo» — nunca dejes que un filtro alimente el scroll infinito sin tope. El estado vacío del filtro solo se pinta cuando ya no queda nada por cargar (o se alcanzó el tope), para no decir «no hay nada» mientras siguen llegando páginas.

## Convenciones

- TS estricto, `verbatimModuleSyntax` (imports de tipos con `import type`).
- `npm run typecheck -w apps/web` debe pasar antes de terminar cualquier tarea.
- Sin comentarios en el código. Texto de UI en español.
- Estados de carga: esqueletos de `ui/skeleton.ts` con la forma del contenido que va a llegar (nunca spinners de página, nunca «Cargando…» a secas); errores: `.page-error` o `toast`.
- Favores: `player.toggleLike(track)` + `toast('Guardado en favoritos', 'ok')`.
- Navegación interna siempre con `href="#/..."` o `navigate()`.
- Atajos: la lista viva está en `core/shortcuts.ts` y la teclea `app.ts` (Espacio, ←/→ ±5 s, ⇧←/→ ±15 s, ↑/↓ volumen, N/P, M, F favorito, S aleatorio, R repetir, X radio, A ahora suena, Q cola, / buscar, `,` ajustes, ⌘K paleta, ? ayuda).
