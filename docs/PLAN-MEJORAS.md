# SoundClear — auditoría y plan de mejora

Fecha: 19 de agosto de 2026 · Base: `main` (38839bd) · Alcance: web + escritorio + proxy

Este documento tiene tres partes: **lo que hay** (auditoría honesta del estado actual), **lo que se hizo en esta ronda** (con cómo verificarlo) y **el plan por fases** de lo que queda. No es una lista de deseos: cada fase lleva alcance, riesgo, criterio de aceptación y coste estimado, y todo lo que afirma sobre la API de SoundCloud está verificado contra la API real, no supuesto.

---

## 1. Cómo se hizo esta auditoría

1. **Lectura completa del código**: los 4 workspaces, 21 ficheros TS de la app, 1.900 líneas de CSS, el `lib.rs` de Tauri y el Worker.
2. **Verificación contra la API real**: se extrajo un `client_id` con la misma lógica que el proxy y se sondearon ~60 endpoints y combinaciones de parámetros. Todo lo que se afirma en el anexo A salió de una respuesta HTTP real de agosto de 2026.
3. **Prueba en navegador**: `npm run dev` + navegación real (inicio, charts, búsqueda con filtros, ficha de track, perfil, cola, «ahora suena», ajustes, paleta, menús contextuales, atajos), leyendo consola y red.
4. **Puerta de calidad**: `npm run typecheck` (4 workspaces) + `npm run build` en verde tras cada fase.

Lo que **no** se pudo verificar y por qué:

- **Reproducción de audio**: el navegador de automatización trabaja con la pestaña en segundo plano (`document.visibilityState === 'hidden'`) y Chrome aplaza la carga de medios en ese estado; el elemento se queda en `readyState 0`. Se comprobó en su lugar que la URL firmada de `cf-media.sndcdn.com` responde `206 audio/mpeg`, que el envelope de streaming se resuelve y que el estado del reproductor avanza hasta «playing». La reproducción real hay que oírla en una ventana en primer plano.
- **Todo lo que exige sesión de SoundCloud** (likes de cuenta, `/me`, escrituras): solo existe en la app de escritorio, que necesita Rust y un login humano. La Fase A escribe por ese camino, así que su lógica se probó con un transporte falso (verbos, cuerpos y cadenas de reserva) y su UI forzando los fallos en local; lo que queda por confirmar con una sesión real está listado en la propia fase.

---

## 2. Estado actual

### 2.1 Lo que está muy bien

| | |
|---|---|
| **Arquitectura** | Una sola app web para dos entornos, con la diferencia encapsulada en `Transport`. Es la decisión correcta y está respetada en todo el código: ninguna vista hace `fetch` a api-v2. |
| **Documentación** | `AGENTS.md` es mejor que la de la mayoría de proyectos comerciales: documenta los bugs ya pagados y los números de los que depende el sistema visual. Ha ahorrado horas en esta auditoría. |
| **Sistema visual** | El motor acrílico está razonado de verdad (tres capas, no anidar `backdrop-filter`, escalera de contraste dimensionada contra el peor fondo posible). Es un diseño con tesis. |
| **Robustez de la API** | Los *gotchas* de la v2 están domados: hidratación por lotes de 50 con reordenación, paginación por cursor, transcodings vacíos, detección de SNIP sin `access`. |
| **Presupuesto** | Cero dependencias de UI y `hls.js` en un chunk aparte que solo se descarga si hace falta. |

### 2.2 Deudas encontradas (antes de esta ronda)

Ordenadas por impacto real en el usuario.

| # | Severidad | Hallazgo | Dónde |
|---|---|---|---|
| 1 | **Alta** | **La app web era inusable.** La puerta de sesión tapaba toda la UI hasta tener sesión, y la sesión solo existe en escritorio: la PWA era, en la práctica, una pantalla de descarga. | `components/logingate.ts` |
| 2 | **Alta** | **Coste O(n) por frame en listas largas.** `progress` vivía en el store único; cada `timeupdate` (una vez por frame) despertaba a *todos* los suscriptores, y cada fila de track tenía dos que recorrían el array de likes. Con 500 favoritos en pantalla: ~1.000 callbacks y cientos de miles de comparaciones por frame. | `player/player.ts`, `components/trackrow.ts` |
| 3 | **Alta** | **Listas no operables con teclado.** Las filas eran `div` con `click`; las acciones (favorito, cola) solo aparecían con `:hover`, así que con teclado no había forma de reproducir ni de guardar un track desde una lista. | `components/trackrow.ts`, `styles/design.css` |
| 4 | **Media** | **Los errores de reproducción eran invisibles.** `state.error` se escribía y nunca se pintaba: un track que falla saltaba al siguiente sin decir nada. | `components/playerbar.ts` |
| 5 | **Media** | **Fondo negro en Linux.** El arranque activaba `data-backdrop="system"` en cualquier Tauri; en Linux no hay vibrancy nativa, así que se quitaban suelo y ambiente y quedaba una ventana transparente sin nada detrás. | `index.html`, `src-tauri/src/lib.rs` |
| 6 | **Media** | **Quitar el último track de la cola dejaba fantasma.** `current` seguía apuntando al track eliminado, con el reproductor mostrando algo que ya no tenía fuente. | `player/player.ts` |
| 7 | **Baja** | Iniciales de carátula partiendo pares surrogados: «House 🔥» pintaba `H` + medio emoji (glifo roto). | `core/utils.ts` |
| 8 | **Baja** | Caché de waveforms sin tope (crecía toda la sesión) y toasts duplicados apilándose. | `components/playerbar.ts`, `ui/toast.ts` |
| 9 | **Baja** | Sin `aria-live` para avisos, sin salto al contenido, sin `aria-current` en la navegación. | varios |
| 10 | **Informativa** | El README prometía «~21 KB gzip» cuando la app ya pesaba 39 KB. | `README.md` |

### 2.3 Funcionalidad que faltaba (huecos de producto)

Sin ninguna de estas cosas la app se sentía como un buen visor de SoundCloud, no como un reproductor de uso diario:

- La cola se acababa y **se hacía el silencio** (sin autoplay ni radio).
- No existía **«reproducir a continuación»**, ni menú contextual, ni acciones por teclado.
- La búsqueda no tenía **filtros** (duración, antigüedad, género, licencia) aunque la API los soporta.
- No había **vista de reproducción a pantalla completa**, ni velocidad, ni temporizador.
- El perfil de artista no mostraba **populares**, **reposts** ni **artistas relacionados**.
- La ficha de track no decía **en qué playlists aparece** ni exponía sus **etiquetas**.
- El inicio no ofrecía **«sigue escuchando»** ni acceso rápido por género.
- Ajustes tenía tres ejes visuales y ninguno de reproducción.

---

## 3. Entregado en esta ronda

Once fases más la **Fase A** del plan (escrituras en tu cuenta, detallada abajo), todas con `typecheck` + `build` en verde y probadas en navegador.

### F1 · Capa de API (endpoints nuevos, todos verificados)
`stationTracks()` (radio de SoundCloud, con hidratación porque la estación devuelve tracks parciales), `userTopTracks()`, `relatedArtists()`, `trackPlaylists()`, `userPosts()` (posts + reposts), `searchTracks()` con filtros y `searchGenres()`. Detalle y trampas en el **anexo A**.

### F2 · Núcleo del reproductor
- **Store partido**: `player.store` (metadatos) y `player.tick` (`progress`/`buffered`). Resuelve la deuda #2: el trabajo por frame pasa a ser proporcional a los dos consumidores de tiempo (isla del reproductor y vista abierta), no al número de filas en pantalla.
- **Favoritos O(1)**: `Set` de ids + contador `likesRev` para que las filas sepan si tienen que repintarse.
- **Radio infinita**: al quedarse sin cola (o 25 s antes del final del último track) se piden temas de la estación y se añaden. Con `radioSeeds` para no repetir semilla y `radioPending` para serializar.
- **Nuevas operaciones de cola**: `playNext`, `addManyToQueue`, `removePlayed`, `dedupeQueue`.
- **Velocidad** (0.75×–2×) y **temporizador** (15/30/60/120 min).
- **Volumen perceptual** (`volume = v²`): el slider por fin se comporta como espera el oído.
- Arreglos #4 y #6: el error se expone (`retry()`, `clearError()`) y vaciar la cola limpia `current`.

### F3 · Ajustes
Cinco ejes nuevos: **acento** (5 paletas), **densidad**, **fondo de la ventana** (arregla la deuda #5), **radio infinita** y **velocidad**, más «Restaurar ajustes». Saneado campo a campo, migración por `version` (v5) y aplicación pre-pintado en el script inline.

### F4 · Chrome de interacción
`ui/modal.ts` (foco atrapado, `Escape`, apilable), `components/menu.ts` (menú contextual con teclado y colocación con volteo) y **paleta de comandos** `⌘K`: navegación, controles, ajustes y **búsqueda en vivo** contra la API en el mismo sitio. Más hoja de atajos (`?`) alimentada por la lista única de `core/shortcuts.ts`.

### F5 · Filas de track accesibles
Botón de reproducir explícito, favorito, cola y «⋯», visibles con `:hover` **y `:focus-within`**; menú por clic derecho con las mismas acciones. Arregla la deuda #3 sin caer en el antipatrón de anidar controles.

### F6 · Vista «Ahora suena» (`#/now`)
Carátula grande con glow propio, onda de 76 px, controles, velocidad, temporizador, radio y **la cola en vivo** con salto directo. Es lo que justifica que la isla inferior siga siendo compacta.

### F7 · Filtros de búsqueda
Duración, antigüedad, género (con la lista de etiquetas que la API acepta de verdad) y licencia reutilizable. **En la URL**, así que una búsqueda filtrada se comparte y sobrevive al recargado.

### F8 · Ficha de track
Etiquetas navegables (parseando `tag_list` con comillas), **«Aparece en»** (playlists reales que contienen el track), botón de radio y menú con «radio del artista».

### F9 · Perfil de artista
Pestañas **Populares** (por defecto) y **Publicaciones** (con reposts, vía `/stream/users/{id}`), y tira de **artistas relacionados** colocada junto a la cabecera —no al final del scroll infinito, donde nadie llega.

### F10 · Inicio y cola
Inicio: **«Sigue escuchando»** desde el historial, con «Radio con esto», y acceso rápido por género. Cola: **quitar reproducidos**, **quitar duplicados**, **copiar la cola** e insignias «Radio» en los tracks que entraron solos.

### F11 · Modo invitado y accesibilidad
«Explorar sin cuenta» en la puerta (arregla la deuda #1: la web vuelve a ser una app), enlace de salto al contenido, `aria-live` en los toasts, `aria-current` en la navegación, `aria-label` en los controles del reproductor, iniciales seguras con emoji, caché de waveforms con tope LRU y toasts que se reaniman en vez de apilarse.

**Coste en bytes de todo lo anterior:** 39 KB → **53 KB** gzip de JS y 9 → 11 KB de CSS. Para lo que entra (radio, paleta, menús, modales, vista nueva, filtros, tres secciones de datos nuevas), 14 KB es un precio honesto; el argumento de ligereza sigue en pie con dos órdenes de magnitud de margen frente a un cliente con framework.

---

## 4. Plan por fases

Cada fase es entregable por sí sola y deja `typecheck` + `build` en verde. El orden propuesto va de mayor valor por esfuerzo a menor, con las dependencias respetadas.

**Estado**: **las doce fases (A–L) entregadas** el 19 ago 2026, más dos correcciones de producción que aparecieron al verificar la Fase C (ver §4.1).

---

### Fase A · Escritura autenticada (escritorio) — ✅ entregada

**Entregado**
- **Seguir / dejar de seguir** desde el perfil, con estado leído de la cuenta (`followingIds`) y botón que refleja «Seguir» / «Siguiendo» / «Guardando…».
- **Repostear / quitar repost** en el menú de cualquier fila, en la ficha del track, en «Ahora suena» y en la paleta de comandos.
- **Añadir a una playlist** con un selector que lista tus playlists y permite **crear una nueva** con el track dentro.
- **Guardar la cola como playlist** (el orden actual, en un clic).
- `core/social.ts` como estado social (`followingIds`, `repostIds`, `busy`, `rev`), todo detrás de `canWrite()`; en web estas acciones **no existen en el DOM**.
- Sin cambios en Rust: el puente `sl-bridge` ya manda cualquier verbo con cuerpo JSON, cabecera `Authorization` y cookies.

**Cómo se mitigó lo que no se podía verificar sin sesión**
- **Cadenas de reserva** donde el verbo o la ruta eran inciertos: `PUT`→`POST` para seguir y repostear; `/me/followings/ids`→`/me/followings` para leer el estado; objetos `{id}`→ids planos al reescribir una playlist. Probadas con un transporte falso que simula 404/422 y registra exactamente qué se enviaría.
- **Reconciliación del `POST /playlists`**: como el puente reintenta una vez y crear no es idempotente, si la creación falla se releen las playlists y, si ya hay una con ese título, se trata como creada en vez de crear una segunda.
- **Reescritura segura de playlists**: `PUT /playlists/{id}` reemplaza la lista entera, así que se lee-modifica-escribe y se deduplica.
- **Optimista con reversión**, verificado forzando el fallo en local: el botón pinta el estado nuevo, se deshabilita mientras va la petición y vuelve atrás con un toast concreto si falla.
- Las playlists nuevas se crean **privadas** por defecto; publicarlas es un clic explícito y avisado.

**Verificado después, con la app de escritorio y una sesión real** (leyendo `$TMPDIR/soundclear-debug.log`), donde aparecieron **dos fallos que ninguna prueba sin cuenta podía enseñar**:
- `/me/followings/ids` devuelve **404 aunque haya sesión** (y `/me/followings` también). Sustituido por `/users/{tuId}/followings?limit=200&linked_partitioning=1`, que responde 200.
- `/me/track_reposts/ids?limit=5000` devuelve **400**: el `limit` real máximo es **200**. Corregido y paginado por cursor.
- Tras el arreglo, ambas lecturas responden 200 con la cuenta real, así que el botón «Siguiendo» y el estado de repost ya son correctos y no solo «desconocidos con degradación».

**Lo que sigue pendiente de comprobar con la cuenta**: una escritura de verdad (seguir, repostear, crear playlist) y que la playlist aparezca en soundcloud.com con el orden esperado. Nada de eso rompe la app si falla: degrada a botón sin estado + toast de error.

---

### Fase B · Tu feed y tu historial real — ✅ entregada

**Entregado**
- **Vista `#/feed`** («De quien sigues»): scroll infinito por cursor, línea de razón por item («X publicó» / «X reposteó · hace 2 h») con su icono, la leyenda del repost cuando la hay, posts de playlist como fila de playlist, «Actualizar» y «Reproducir lo nuevo».
- **Sección «De quien sigues» en el inicio** (con sesión), con «Ver todo» al feed; al pulsar una tarjeta suena esa y la cola queda con el resto del feed.
- **Historial de la cuenta** en `#/likes` › Historial, con dos fuentes: «Tu cuenta» (`/me/play-history/tracks`, cruza dispositivos) y «Este dispositivo» (el local). Por defecto la de cuenta, con aviso de que ese historial vive en SoundCloud y no se borra desde aquí.
- Entrada «Feed» en la navegación **solo en escritorio** (en web sería un callejón sin salida) y comando en la paleta.

**Verificación**
- **Endpoints comprobados**: `/stream` y `/me/play-history/tracks` responden 401 anónimo (existen); `/me/activities`, `/me/activities/tracks`, `/me/play-history` y `/recently-played` dan 404 y se descartaron.
- **Capa de API probada con transporte falso**: primera página con `linked_partitioning=1`, segunda siguiendo `next_href` tal cual, items promocionales sin contenido filtrados, y entradas de historial con solo `track_urn` filtradas.
- **Vista probada con datos reales sin sesión**: `/stream/users/{id}` devuelve el mismo sobre que `/stream`, así que se usó como doble temporal para verificar el renderizado completo — 20 → 28 items paginando, **0 duplicados**, razones correctas por tipo, «Reproducir lo nuevo» encolando el feed, y el sentinel limpio al agotarse. Después se revirtió al endpoint real.
- **Puerta en web verificada**: sin sesión no hay entrada «Feed» en el nav, la ruta directa muestra el aviso honesto con enlace a la app de escritorio, y los chips de fuente del historial no aparecen.

**Verificado después con sesión real**: `/stream?limit=20&linked_partitioning=1` responde **200** (100 KB) y la llamada del inicio (`limit=10`) también (46 KB). Queda por confirmar `/me/play-history/tracks` con cuenta (basta abrir Favoritos › Historial en la app de escritorio) y que `played_at` venga en milisegundos. Si no cuadrara, el filtro defensivo deja la lista vacía con su estado, nunca una vista rota.

---

### Fase C · Virtualización de listas — ✅ entregada

**Entregado**
- `ui/virtuallist.ts`: ventana de nodos sobre el scroll de la página, filas en `position: absolute`, altura del contenedor = `count * stride - gap` (la barra de scroll es la real desde el primer pintado), repintado con `requestAnimationFrame`, altura de fila **medida** de la primera fila montada y re-medida al cambiar `data-density` o al redimensionar.
- Aplicada en **Favoritos e Historial** (`#/likes`), **pestañas de perfil** (`#/user/:id`) y **la cola** (`#/queue`), con umbral `VIRTUAL_MIN = 60`. Por debajo de esa cifra se pinta por bloques como antes; la estrategia de red (paginación por cursor) no cambia en ningún caso.
- Decisiones que no eran obvias: **no** se reutilizan nodos (una fila desmontada pierde su suscripción al player y volvería con el favorito o el «sonando» mentirosos); nunca se desmonta la fila que tiene el foco; se inserta en orden de índice para que tabular siga el orden visual; y la lista se auto-destruye si su elemento deja de estar conectado, para no dejar escuchas de `scroll`/`resize` colgando.

**Medido** (19 ago 2026, Chrome, densidad normal)

| Caso | Antes | Ahora |
|---|---|---|
| 500 favoritos | 500 filas en el DOM | **21** (32 haciendo scroll) |
| 170 tracks en un perfil | 170 filas | **22**, y al volver de otra pestaña reposiciona en el índice 61 correcto |
| 170 tracks en la cola | 170 filas | **21**; 1.244 nodos en toda la página |

**Lo que quedó fuera, a propósito**
- La rejilla de Playlists de un perfil (alturas de tarjeta, no de fila).
- Las pestañas **mixtas**: los likes y las publicaciones de un usuario pueden traer playlists entre los tracks, y con dos alturas distintas la ventana uniforme no vale. En cuanto aparece una tarjeta, la vista cae a lista normal y repinta en el orden original — verificado con un perfil cuya primera playlist llega en el índice 131.

**Verificado a mano en el navegador**: reordenar la cola con las flechas y **arrastrando** funciona virtualizada (el `dragend` de limpieza va también en el contenedor, porque al arrastrar contra el borde la página auto-scrollea y la fila de origen puede desmontarse a mitad), quitar de la cola descuenta bien, la marca de «sonando» sobrevive a salir y volver con el scroll, y reproducir la fila 70 de una lista virtualizada suena la fila 70 (no otra).

---

### 4.1 · Correcciones de producción cazadas al verificar la Fase C

**1. Los favoritos no llegaban a la cuenta.** El log de escritorio con sesión real mostraba `PUT /me/likes/{id}` → **404, doce veces seguidas**. Sondeando rutas (403 = existe, 404 = no existe) la viva es **`PUT|DELETE /users/{tuId}/track_likes/{trackId}`**. Corregido en `toggleAccountLike(trackId, liked, userId)`, que además conserva la vieja como reserva. De paso quedó confirmado que seguir es `POST /me/followings/{id}` (el `PUT` da 404 y lo estaba salvando la cadena de reserva) y que repostear sí va por `/me/track_reposts/{id}`.

**2. «Este track no está disponible para streaming» tenía una causa concreta.** Los sellos grandes ya publican con entrega cifrada: el track trae `cbc-encrypted-hls` + `ctr-encrypted-hls` **y además** un `progressive`/`hls` con preset `mp3_1_0` y `is_legacy_transcoding: true` que **siempre responde 404 `{}`**. `policy` sigue siendo `ALLOW` y `streamable: true`, así que ninguna bandera lo delata. En el perfil de deadmau5 son **109 de 124 tracks**. Ahora:
- `isDrmOnly(track)` lo detecta **sin pedir nada** (hay algún transcoding cifrado y todos los planos son legacy), así que el aviso sale en ~200 ms en vez de tras dos peticiones fallidas.
- El mensaje dice la verdad: «SoundCloud entrega este track cifrado (DRM): solo suena en su propia app».
- Las filas llevan una insignia **DRM** junto al título, para no descubrirlo al pulsar.
- Si el track venía dentro de una cola, el reproductor **salta al siguiente** (con tope de 5 fallos seguidos, para que una cola entera cifrada no se convierta en un bucle de peticiones).

---

### Fase D · Audio de verdad — ✅ entregada

**Entregado**
- `player/audiograph.ts`: grafo WebAudio con **ecualizador de 5 bandas** (60 Hz shelf, 250 Hz, 1 kHz, 4 kHz peaking, 12 kHz shelf; ±12 dB), **6 presets** (Plano, Realce, Graves, Voz, Agudos, Cinta), **limitador** para el nivelado suave, **volumen maestro** y analizador para medir.
- El player pasa a **dos platos de audio**: precarga del siguiente track 20 s antes del final y **transición** configurable de 0 a 12 s (0 = encadenado sin silencio).
- Tarjeta **Audio** en Ajustes: interruptor del motor, presets, cinco deslizadores con su valor en dB, «Dejar plano», nivelado y transición. Todo persiste en `sl:settings` (v7: `dsp`, `eq`, `leveling`, `crossfade`).
- Degradación honesta: con el motor apagado hay **un solo plato sin enrutar** y el comportamiento es idéntico al anterior a esta fase. Si el grafo diera silencio (caso conocido de WebKit con HLS nativo), un vigilante lo detecta, lo apaga solo y sigue reproduciendo desde el mismo punto.

**Medido** (Chrome, `soundclear.player.diagnostics()`, RMS del analizador)

| Prueba | Resultado |
|---|---|
| EQ +12 dB en las 5 bandas | **+10,4 dB** de nivel; −12 dB → **−7,7 dB**; volver a plano → **0,0 dB** |
| Nivelado (A/B/A/B, 51 muestras por condición) | **+0,3 dB** de nivel medio, **−0,9 dB** de pico, cresta **1,59 → 1,39** |
| Crossfade de 6 s | duración real **6,0 s**; `g₀² + g₁² = 1,00` en las **30** muestras; sin hueco |
| Encadenado (0 s) | relevo a 0,04–0,18 s del final, **sin silencio** (nivel mínimo 0,0048) |
| Interrumpir un fundido con «siguiente» | un solo plato sonando, ganancias `[0, 1]`, el otro limpio |
| Apagar y encender el motor en caliente | 2 platos ↔ 1 plato, reproducción continúa desde el mismo segundo |
| HLS forzado (dos instancias de hls.js) | reproduce con el grafo y el fundido mantiene potencia **1,00** |

**Lo que se descartó por medirlo**
- `DynamicsCompressorNode` de Chrome: mete ganancia interna oculta (**+4,3 dB** con un material, **+6,6 dB** con otro), así que activar el nivelado se oía como un salto de volumen. Sustituido por un `WaveShaper` con curva `tanh` y trim fijo.
- Dejar el volumen en `el.volume`: el limitador quedaba fuera de rango a volumen bajo. El volumen perceptual vive ahora en el grafo (`master`) y los elementos van a 1.
- Fundido lineal: hunde el nivel ~6 dB en el centro. Curvas de potencia constante.

---

### Fase E · Descargas y sin conexión — ✅ entregada

**Entregado**
- `core/offline.ts`: almacén local en **IndexedDB** (blob + índice), presupuesto configurable (0 / 250 MB / 500 MB / 1 / 2 / 5 GB), progreso de descarga leído del `ReadableStream`, y un `Set` de ids en memoria para que el player pueda preguntar «¿hay copia?» en síncrono.
- **El player mira primero el almacén local**: si el track está guardado suena desde `blob:` y no toca la red (también en la precarga del crossfade). Cada plato revoca su `blob:` al soltar el track.
- **Indicador por track** (insignia en la fila, con estado «guardando»), entradas en el menú de cualquier fila y botón en la ficha del track.
- **Gestión de espacio en Ajustes › Datos**: barra de uso, presupuesto, lista con el tamaño de cada track, quitar uno y vaciar todo.
- **Descarga del archivo original** cuando el autor la permite: en web abre la URL firmada de SoundCloud; en escritorio el comando Rust `download_to_music` la escribe en `~/Música/SoundClear` con lista blanca de hosts, nombre saneado, extensión deducida y sufijo `(n)` para no pisar archivos.
- Límites explícitos en la UI: no se guardan previews SNIP de 30 s, ni tracks solo-DRM, ni los que solo llegan por HLS (haría falta remuxar los segmentos).

**Medido** (Chrome, con `soundclear.offline` y `soundclear.player.diagnostics()`)

| Prueba | Resultado |
|---|---|
| Guardar un track de 75 s | **1,1 MB en 1,5 s**, `audio/mpeg`, índice y bytes al día |
| Recargar la app | el índice se reconstruye desde IndexedDB (1 entrada, 1,2 MB) y `offlineHas` responde bien |
| **Red cortada** (todo `fetch` rechazado) | el track guardado **suena completo desde local** (`local: true`, duración 75,18 s, progreso avanzando); el no guardado falla con mensaje claro |
| Presupuesto a 0 MB | rechaza con «No cabe en el espacio reservado» |
| Presupuesto a 250 MB | guarda y reporta 249 MB libres |
| SNIP y solo-DRM | rechazados con el motivo exacto |
| Insignia en las filas | aparece solo en la fila del track guardado, en vivo |

**Decisión sobre el alcance**: el plan proponía restringir *todo* a tracks con descarga permitida por el autor. Medido, eso serían **0–28 % de los tracks** según la búsqueda (0 de 51 en una, 14 de 50 en otra), lo que dejaría la función inútil justo para la biblioteca de cada uno. Así que quedan separadas: **descargar el archivo** sigue estrictamente el permiso del autor y su endpoint oficial; **guardar sin conexión** es una copia local, por acción explícita del usuario, acotada por presupuesto, borrable en un clic y avisada en la UI de que el contenido sigue siendo de sus autores. Nunca se guarda nada de forma automática.

**Lo que no se hizo y por qué**: OPFS. El `FileSystemWritableFileStream` no está garantizado en WKWebView (donde corre el escritorio) y para 1–10 MB por track un `Blob` en IndexedDB es suficiente y funciona igual en los dos entornos.

---

### Fase F · Escritorio nativo de primera — ✅ entregada

**Entregado**
- **Atajos globales** con `tauri-plugin-global-shortcut`: `⌘⌥Espacio` (play/pausa), `⌘⌥←/→`, `⌘⌥F` (favorito) y `⌘⌥M` (mini reproductor). Funcionan con la app en segundo plano.
- **Bandeja/menubar**: menú con el track que suena (se actualiza solo), play/pausa, anterior, siguiente, mini reproductor, mostrar SoundClear y salir. Si la ventana principal se cerró, «Mostrar SoundClear» la **recrea**.
- **Mini reproductor**: ventana de 360×160 sin marco, siempre encima, con carátula, título, artista, barra de progreso pinchable y cinco controles. **Fuera de las capturas de pantalla** (`set_content_protected`). Es un mando: no instancia el reproductor, habla con la ventana principal por eventos.
- **Aviso opcional al cambiar de track** (notificación del sistema), apagado por defecto.
- **La ventana recuerda tamaño y posición** (`tauri-plugin-window-state`), con el puente, el login y la mini fuera de esa memoria.
- Tarjeta **Escritorio** en Ajustes: abrir/cerrar la mini, interruptor de avisos y la lista de atajos con **cuáles se pudieron registrar de verdad**.
- Reestructura de arranque: `main.ts` pasa a ser una entrada mínima y la app entera vive detrás de un `import()` en `boot.ts`, así la ventana mini carga **~14 KB gzip en vez de ~77**.

**Verificado con `SOUNDCLEAR_SELFTEST=1` (lo que el log demuestra)**

| Prueba | Resultado |
|---|---|
| Registro de atajos | **5 de 8**: las cuatro combinaciones ⌘⌥ y ⌘⌥M sí; las **tres teclas de medios del teclado, no** |
| Bandeja | creada y presente (`bandeja: icono creado`) |
| Mini reproductor | creada, visible, 360×160, colocada en (3056, 1240) sobre un monitor de 3440×1440 |
| Protección de contenido | `set_content_protected(true)` aceptado (`mini: protección de contenido activa`) |
| Circuito atajo → app | el evento emitido desde Rust aparece como `nativo: comando toggle` y la app responde `nativo: comando recibido toggle` |
| Convivencia de ventanas | `["mini", "sl-bridge", "main"]` |

**Lo que no pude verificar desde aquí, y por qué**
- **Pulsar físicamente** las teclas: la automatización no tiene permiso de Accesibilidad en este equipo (`osascript is not allowed to send keystrokes`). Queda comprobado el registro y el circuito completo desde el emisor; el último eslabón (la tecla) se confirma pulsando `⌘⌥Espacio` una vez.
- **Ver la captura de pantalla sin la mini**: `screencapture` tampoco tiene permiso de Grabación de Pantalla (`could not create image from display`). Lo que sí consta es que la API que lo garantiza (`NSWindowSharingType.none` vía `set_content_protected`) se aplicó sin error.

**Tres trampas de macOS que salieron midiendo**
- Las **teclas de medios no se pueden registrar**: `Failed to watch media key event`. Por eso los atajos con ⌘⌥ son la vía real y la UI lo dice en vez de fingir.
- **`set_position` después de crear la ventana no la mueve**: devuelve `Ok` y la ventana se queda centrada. Hay que pasar la posición al constructor y crear la ventana oculta.
- Calcular la esquina con `primary_monitor()` dejaba la mini **fuera de pantalla** (`y = -819`) en un montaje con más de un monitor: hay que usar el monitor de la ventana principal y sumar su `position()`.

---

### Fase G · Accesibilidad AA completa — ✅ entregada

**El bug que justifica la fase entera**: `.row-actions` estaba en `display: none` hasta el `:hover`, con un `:focus-within` que **no podía dispararse nunca** (lo que está en `display: none` no es focalizable). Resultado: **con teclado no se llegaba a ningún botón de ninguna fila** — ni reproducir, ni favorito, ni cola, ni menú — en toda la app. Ahora se oculta con `opacity` + `pointer-events` y se revela con `:hover` **y** con `:focus-within`, verificado enfocando y comprobando además con `elementFromPoint` que un clic en la zona invisible sigue llegando a la fila.

**Entregado**
- **Flechas en las listas**: con el foco en una fila, `↓`/`↑` van al mismo control de la fila siguiente/anterior y `Home`/`End` a los extremos. Un listener delegado, sin tocar la estructura de las filas ni su orden de tabulación. Recorrer 500 favoritos ya no son 3.500 tabulaciones.
- **Anuncio del track**: región viva (`aria-live="polite"`) en la barra del reproductor que dice «Suena X de Y» al cambiar de track, y solo eso.
- **Objetivos de 24 px** (WCAG 2.5.8): los deslizadores pasan de 20 a 24 px sin engordar la pista, `.btn` gana `min-height`, y `.see-more`, `.desc-toggle` y el salto por tiempo de los comentarios llegan al mínimo. Los marcadores de comentario sobre la onda salen del orden de tabulación (`tabindex="-1"` + `aria-hidden`): duplicaban una acción que ya está en cada comentario y metían 30 paradas en la ficha.
- **Foco siempre visible**: ningún `outline: none` se queda sin sustituto; los campos pasan del halo del 18 % a un anillo sólido de 2 px, y el menú marca el elemento enfocado con una barra de acento.
- **Tinta sobre acento por acento**: con el naranja de SoundCloud, el texto blanco sobre acento daba **3,21:1** (falla AA). Corregido con tinta oscura en tema oscuro y oscureciendo el acento en tema claro.
- **La auditoría vive en el repo**: `dev/a11y.ts`, cero dependencias y cero peso en producción, se ejecuta con `await soundclear.auditRoutes()`.

**Medido**

| Prueba | Antes | Ahora |
|---|---|---|
| Botones de fila alcanzables con teclado | **ninguno** | todos |
| Hallazgos de la auditoría en 11 rutas | 30–45 por ruta | **0 en las 11** |
| Tinta sobre acento (7 acentos × 2 temas) | 3,21 el peor (falla) | **4,56 el peor** |
| Anillo de foco sobre el fondo | — | **4,77 el peor** (mínimo 3) |
| Regiones vivas | 0 | 1, con el track actual |

**Dónde el plan no se cumplió a la letra, y por qué**
- **`axe-core` en CI**: habría sido la primera dependencia de desarrollo grande del proyecto y no puede correr sin navegador. En su lugar hay un auditor propio en el repo que cubre nombres accesibles, objetivos, `alt`, ids duplicados y región viva.
- **Objetivos de 44 px**: 44 es el mínimo AAA (2.5.5); el AA (2.5.8) es 24 y es lo que se aplicó, para no hinchar filas y barras que hoy caben bien en pantalla.
- **Patrón *grid* de una columna**: se descartó hacer la fila focalizable (contradice una decisión documentada y rompería el orden de tabulación que ya existe). Las flechas dan el mismo recorrido sin cambiar la semántica.
- **Contraste medido nodo a nodo**: imposible de fiar con el motor acrílico (capas translúcidas, `backdrop-filter`, degradados de cristal). Un botón perfectamente legible salía a 1,07:1. El contraste se verifica por **pares de tokens** contra los fondos del peor caso, que es como está dimensionada la escalera.
- **Lector de pantalla real**: no puedo activar VoiceOver desde aquí. Lo verificable sin él (nombre accesible de cada control, landmarks, región viva, orden de tabulación) está en verde; escuchar el recorrido completo con VoiceOver sigue siendo un clic humano.

---

### Fase H · Calidad: pruebas sin dependencias — ✅ entregada

**Entregado**: la lógica pura de la cola sale a `player/queueops.ts` (quitar, mover, recortar lo escuchado, deduplicar, orden aleatorio con el actual primero, siguiente con repeat/wrap) y el player la usa. **63 casos con `node:test`** — TypeScript ejecutado directo por Node, cero dependencias nuevas — sobre cola (31), saneado de ajustes (14), librería con fallos de cuota (9) y utilidades (9). `npm test` entra en CI (Node 24) junto a typecheck y build.

**Además**: `scripts/api-probe.mjs` (`npm run probe`) extrae un `client_id` real y pasa **16 sondas** por los endpoints del Anexo A; distingue críticos (rompen la app, salida ≠ 0) de avisos (degradan una función). Verificado: 63/63 tests en **116 ms** y 16/16 sondas en verde.

**Corregido por los tests**: dos expectativas mías estaban mal, no el código (`fmtCount(null)` devuelve «—» y `initials('deadmau5')` devuelve «DE»).

---

### Fase I · Explorar — ✅ entregada

**Entregado**: `#/explore` con cuatro bloques y su entrada en la barra. Radios por género (10 chips, **0 peticiones** hasta que pulsas: entonces 1 para la semilla + la estación), etiquetas que sí filtran (**0 peticiones**, salen de `searchGenres()`), álbumes y selecciones (**1 petición**) y «se parece a lo tuyo» (**1 petición**: la estación del último track de tu historial, quitando lo ya escuchado). Verificado: 10 chips, 32 etiquetas, 12 álbumes y 12 tracks similares, sin errores de página; cada bloque degrada a un texto tranquilo si el endpoint responde raro.

---

### Fase J · Compartir y enlaces — ✅ entregada

**Entregado**: `core/links.ts` reconoce enlaces de soundcloud.com (también `on.soundcloud.com` y `m.`), los resuelve con `/resolve` y navega a la ficha, el perfil o la playlist. Pegar un enlace en **⌘K** muestra «Abrir este enlace» como primera opción. Los botones de compartir usan **`navigator.share`** donde exista y caen al portapapeles donde no. El manifest declara **`share_target`**, así que el sistema puede compartir un enlace *hacia* SoundClear y la app lo resuelve al arrancar. En escritorio, `tauri-plugin-deep-link` registra el esquema **`soundclear://`** y su URL llega a la app por el evento `sl:link`.

**Límite honesto**: en macOS el esquema solo queda registrado cuando la app está empaquetada, así que en `npm run dev:desktop` no se puede probar; el registro se anota en el log al arrancar.

---

### Fase K · i18n — ✅ entregada

**Entregado**: `core/i18n.ts` con `t()`, detección por `navigator.language`, ajuste `lang` (`auto`/`es`/`en`) y selector en Ajustes › Apariencia. **547 cadenas envueltas con `t()` y 547 traducidas** (0 sin traducir), más **70 entradas que llegan por `t(variable)`** desde constantes de módulo: 617 cadenas de UI en inglés. `npm run i18n` lo comprueba y `--estricto` falla si aparece una cadena envuelta sin traducción.

**Decisión de diseño**: la clave del diccionario **es el texto en español**, no un identificador. Así, lo que se escape sigue mostrándose en español en vez de aparecer como `settings.audio.title`, y no hay claves muertas posibles. El diccionario inglés viaja en **su propio chunk (13 KB gzip)**: quien use español no lo descarga.

**Trampas que costaron sangre**
- Un `t()` en una **constante de módulo** se congela con el idioma del arranque: la barra de navegación seguía en inglés al cambiar a español. Las constantes se quedan en español y se traducen **en el punto de uso** (`t(item.label)`).
- El envoltorio automático tocó cosas que no eran UI: nombres de teclas (`'ArrowDown'`, `'Escape'`), `normalize('NFD')` y una unión de tipos. Todos desenvueltos; hay un barrido que también deshace los `=== t('…')`.
- Cambiar de idioma **remonta la app** (`remountApp()`), no recarga: la música sigue sonando (verificado).

**Residuo declarado**: quedan **117 literales de UI sin envolver ni traducir** (casi todos plantillas con `${}`, que necesitan `t('… {var}', { var })` a mano). `npm run i18n --detalle` los lista fichero a fichero.

---

### Fase L · Diagnóstico local (sin telemetría) — ✅ entregada

**Entregado**: Ajustes › Diagnóstico con versión, entorno, estado del `client_id`, proxy en uso, **latencia real** de las últimas llamadas (mediana, peor y fallos, medidas envolviendo el `getJSON` del transport), tamaño de `localStorage`, uso sin conexión, cachés del navegador con su cuota, estado del motor de audio y las últimas rutas llamadas. Botón «Copiar informe» para pegar en un issue.

**Privacidad**: todo se calcula en el dispositivo. El informe no lleva nombre, correo ni títulos; las rutas van con los identificadores tapados (`/users/{id}/likes`). Verificado en el navegador: 10 líneas, cabe de sobra en un comentario de GitHub.

---

### Fuera de alcance, a propósito

Telemetría o analítica de cualquier tipo, cuentas propias de SoundClear, anuncios, saltarse restricciones de la plataforma (los SNIP se quedan en 30 s) y descargar contenido que el autor no marcó como descargable.

---

## 5. Decisiones que necesitan al dueño

1. **¿La web debe quedarse en modo invitado o merece sesión propia?** Hoy invitado desbloquea la app. Darle sesión real en web exigiría un proxy con cookies (más complejo y con implicaciones de privacidad y de términos de servicio). Recomendación: quedarse en invitado y empujar el escritorio para lo de cuenta.
2. **Fase A antes que Fase D, o al revés.** A da funciones sociales; D da calidad de audio. Recomendación: A primero, porque la fricción de «no puedo guardar esto en una playlist» se nota cada día.
3. **¿Cuánto disco puede usar el modo sin conexión por defecto?** Propuesta: 2 GB con aviso al 80 %.
4. **Idiomas**: ¿solo es/en o también pt/fr? Cada idioma es mantenimiento perpetuo.

---

## Anexo A · Hallazgos de API verificados (agosto 2026)

| Endpoint / parámetro | Resultado | Nota operativa |
|---|---|---|
| `filter.duration=short\|medium\|long\|epic` | ✅ funciona | <2 min / 2–10 / 10–30 / >30 min, comprobado con las duraciones devueltas |
| `filter.created_at=last_hour…last_year` | ✅ funciona | Aproximado en el borde (una semana devolvió algo de 18 días) |
| `filter.license=to_modify_commercially` | ✅ funciona | Devuelve `cc-by` / `cc-by-sa` |
| `filter.genre=<texto>` | ⚠️ literal | Compara el string del campo `genre` sin taxonomía: `rock`, `hip hop`, `drum & bass`, `r&b`, `lo-fi` sí; `drum-and-bass`, `danceedm` no |
| `sort=popular\|recent` | ❌ inútil | Apenas reordena; no se usa |
| `/stations/soundcloud:track-stations:{id}/tracks` | ✅ funciona anónimo | Siempre 50 tracks, ignora `limit`/`offset`, sin `next_href`, **tracks parciales** (sin onda ni contadores) → hidratar |
| `/stations/soundcloud:artist-stations:{userId}/tracks` | ✅ funciona | Igual que la anterior |
| `/stations/soundcloud:genre-stations:{slug}/tracks` | ❌ 500 | No existe |
| `/users/{id}/toptracks` | ✅ tracks completos | Sin paginación; ~20 items |
| `/users/{id}/relatedartists` | ✅ funciona | ~10 usuarios |
| `/tracks/{id}/playlists_without_albums` | ✅ funciona | Playlists completas, pagina |
| `/stream/users/{id}` | ✅ funciona | Items `{ type: 'track' \| 'track-repost' \| …, track, user }` — única vía para reposts |
| `/users/{id}/reposts` | ❌ 404 | Muerto |
| `/users/{id}/spotlight`, `/albums` | ⚠️ vacío | Responden 200 con colección vacía |
| `DELETE /me/followings/{id}` | 401 | La ruta existe (401 = pide sesión) |
| `PUT /me/likes/{id}` | ❌ 404 **también con sesión** | Muerto (12 intentos en producción). La ruta viva es `PUT\|DELETE /users/{tuId}/track_likes/{trackId}` (403 anónimo) |
| `POST /me/followings/{id}` | 403 anónimo = existe | El `PUT` da 404: seguir es `POST` |
| Transcodings `*-encrypted-hls` + planos `mp3_1_0` legacy | ❌ los planos dan 404 `{}` | Track solo-DRM: `isDrmOnly()` lo detecta sin red. 109 de 124 tracks en un perfil de sello |
| `track_authorization` en el envelope | ⚠️ innecesario | Mismos 200 con y sin él; no arregla los legacy de un track cifrado |
| `DELETE /me/track_reposts/{id}` | 401 | La ruta de reposts existe |
| `GET /me/track_reposts/ids` | 401 | Existe; sirve para saber qué has reposteado |
| `POST /reposts?ids=` | 404 | No existe |
| Escrituras repetidas sin sesión | 403 + captcha | DataDome corta el sondeo: no insistir |
| `GET /stream` | 401 | Existe; acepta `linked_partitioning=1` y pagina por cursor |
| `GET /me/play-history/tracks` | 401 | Existe; trae entradas con solo `track_urn` que hay que filtrar |
| `GET /users/{id}/followings?limit=200` | 200 | La vía buena para leer a quién sigues (con sesión, la tuya) |
| `GET /me/followings/ids` | 404 | Muerto: 404 anónimo **y con sesión** |
| `GET /me/track_reposts/ids?limit=5000` | 400 con sesión | El `limit` real máximo es **200** |
| `GET /me/activities`, `/me/activities/tracks`, `/me/play-history`, `/recently-played` | 404 | No existen |
| `/users/{id}/web-profiles` | ❌ 400 | Con URN da `200 []`; no aporta |

## Anexo B · Contraste de los acentos nuevos

Peores fondos conocidos del sistema (documentados en `AGENTS.md`): ambiente `rgb(58,58,61)` y tarjeta `rgb(47,47,50)` en oscuro; `rgb(209,209,211)` en claro. Mínimos: 4.5:1 para texto, 3:1 para gráficos.

| acento | `--accent` / `--accent2` | blanco sobre acento | `--accent-text` oscuro | `--accent-text` claro |
|---|---|---|---|---|
| violeta (defecto) | `#7857ff` / `#6344e8` | 4.56 / 5.96 | `#b3a1ff` → 5.11 | `#4c2fd0` → 5.25 |
| cian | `#0f8097` / `#0c6a7d` | 4.60 / 6.18 | `#20b5d3` → 4.63 | `#0b6172` → 4.66 |
| ámbar | `#a66407` / `#8c5406` | 4.71 / 6.23 | `#e99116` → 4.61 | `#7f4c05` → 4.66 |
| verde | `#16864e` / `#126e40` | 4.63 / 6.34 | `#28bd73` → 4.66 | `#10653b` → 4.68 |
| rosa | `#de1b6d` / `#c51861` | 4.67 / 5.69 | `#ea88b1` → 4.66 | `#aa1553` → 4.67 |

Los valores se obtuvieron buscando, para cada tono, el color **más vivo** que aún cumple el mínimo — no eligiendo a ojo. Un ámbar naranja claro no cabe en este sistema porque el blanco de `.btn-primary` se caería por debajo de 4.5:1; por eso el ámbar es bronce.

## Anexo C · Presupuesto de rendimiento propuesto

| Métrica | Hoy | Objetivo |
|---|---|---|
| JS gzip (app, sin HLS) | 80,5 KB (9,7 de entrada + 70,8 de la app) | < 90 KB con todo el plan |
| CSS gzip | 16,6 KB (9,6 + 7,0) | < 18 KB |
| Diccionario inglés | 13 KB gzip, en su chunk | solo si el idioma es inglés |
| Peso de la ventana mini | 14 KB gzip (JS + CSS) | mantener por debajo de 20 KB |
| Trabajo por frame durante la reproducción | 2 suscriptores | independiente del tamaño de la lista (mantener) |
| Nodos DOM con listas largas | ~5 por fila, sin techo | ✅ 21–32 filas montadas, constante (Fase C) |
| Tiempo hasta primera lista útil | ~1 petición + skeletons | mantener |
