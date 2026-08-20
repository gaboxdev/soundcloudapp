# Estado del trabajo — 19 ago 2026

Traspaso corto para retomar sin releer nada. El detalle largo está en [PLAN-MEJORAS.md](./PLAN-MEJORAS.md).

## Dónde estamos

| | |
|---|---|
| Base | `main` (38839bd), sin commits nuevos: todo está en el árbol de trabajo |
| Puerta de calidad | `npm run typecheck` (4 workspaces) + `npm run build`, en verde |
| Tamaño | ventana principal 80,5 KB gzip de JS + 16,6 KB de CSS (era 39 + 9); ventana mini 14 KB; diccionario inglés 13 KB aparte |
| Entregado | Ronda de mejoras (11 fases) + **Fase A** (escrituras en la cuenta) + **Fase B** (feed e historial de cuenta) + **Fase C** (virtualización: Favoritos/Historial, pestañas de perfil y cola) |
| Corregido de producción | El favorito no llegaba a la cuenta (`PUT /me/likes/{id}` está muerto → `PUT\|DELETE /users/{tuId}/track_likes/{id}`) y el error «no está disponible para streaming» ya dice la verdad: son tracks **solo-DRM** (`isDrmOnly()`, insignia DRM en la fila, salto al siguiente en la cola) |
| Fase D | **Entregada**: grafo WebAudio con EQ de 5 bandas y presets, nivelado suave, dos platos con precarga y transición de 0–12 s, tarjeta Audio en Ajustes. Todo medido con el analizador (ver PLAN-MEJORAS §Fase D) |
| Fase E | **Entregada**: almacén local en IndexedDB con presupuesto, el player suena desde `blob:` sin red, insignia por track, gestión en Ajustes › Datos y descarga del archivo original (en escritorio, comando Rust `download_to_music`). Verificado con la red cortada |
| Fase F | **Entregada**: atajos globales (5/8 registrables en macOS), bandeja con menú, mini reproductor 360×160 fuera de capturas, avisos opcionales, memoria de ventana y `main.ts` partido en `boot.ts` para que la mini cargue ~14 KB en vez de ~77 |
| Fase G | **Entregada**: se cazó que con teclado no se llegaba a ningún botón de fila (`display:none` + `:focus-within` imposible); flechas en las listas, anuncio del track, objetivos de 24 px, foco siempre visible, tinta sobre acento corregida y auditoría propia en `dev/a11y.ts` (0 hallazgos en 11 rutas) |
| Fase H | **Entregada**: `player/queueops.ts` + **63 tests** con `node:test` (116 ms) en CI, y `npm run probe` con 16 sondas de API |
| Fase I | **Entregada**: `#/explore` con radios por género, etiquetas que filtran, álbumes y «se parece a lo tuyo» (≤1 petición por bloque) |
| Fase J | **Entregada**: pegar un enlace en ⌘K lo resuelve, `navigator.share`, `share_target` en el manifest y esquema `soundclear://` en escritorio |
| Fase K | **Entregada**: `t()` con clave en español, 617 cadenas de UI en inglés (0 sin traducir), diccionario en su chunk de 13 KB, cambio en vivo sin recargar |
| Fase L | **Entregada**: Ajustes › Diagnóstico con latencias medidas, cachés, `client_id` y «copiar informe» sin datos personales |
| Siguiente | El plan queda cerrado. Lo que asoma para otra ronda: virtualizar listas mixtas, envolver los 141 literales que faltan y verificar `soundclear://` con la app empaquetada |

## Ojo: ediciones en paralelo

El 19/8 a las 16:36–16:38 aparecieron cambios en `ui/el.ts` (`titleIcon`, `iconChip`, `labelBtn`), `views/charts.ts` y `views/likes.ts` que **no son de esta sesión**. Si hay otra sesión o persona tocando vistas, coordinad antes de editar los mismos ficheros. Las ediciones de esta sesión se hacen con reemplazos que **fallan en voz alta** si el texto ancla cambió, así que no pisan trabajo ajeno en silencio.

## Lo que hay corriendo ahora mismo

- `npm run dev` con `NODE_OPTIONS=--max-http-header-size=131072`. **El flag no es opcional en este equipo**: Chrome manda cookies enormes para `localhost` y Vite responde 431 sin él.
- App de escritorio (`npm run dev:desktop`) con sesión activa. Su log: `$TMPDIR/soundclear-debug.log`.

## Lo que solo se ve con sesión real (y ya se cazó ahí)

Leer el log de escritorio es la única forma de verificar las rutas de cuenta. Dos fallos aparecieron así, ya corregidos y verificados:

1. `/me/followings/ids` → **404 incluso con sesión**. Ahora se usa `/users/{tuId}/followings?limit=200&linked_partitioning=1` (200).
2. `/me/track_reposts/ids?limit=5000` → **400**. El `limit` real máximo es **200**; se pagina por cursor.

Verificado también con cuenta: `/me` (200), sincronización de likes (200, dos páginas), `/stream` con `limit=20` y `limit=10` (200).

## Ojo con el escritorio

La app de escritorio hay que **reiniciarla** para tener la Fase F: hay un proceso viejo de esta sesión (`target/debug/soundclear`, pid 53964) que sigue vivo con un binario anterior, sin bandeja ni atajos. Lo dejé como estaba por si lo estabas usando.

## Lo único pendiente de un clic humano

1. Pulsar `⌘⌥Espacio` con la app de escritorio en segundo plano: es el único eslabón que no pude probar (la automatización no tiene permiso de Accesibilidad para enviar teclas). El registro del atajo y el circuito hasta el reproductor ya constan en el log.
2. Abrir en la **app de escritorio** › **Favoritos › Historial** › pestaña «Tu cuenta» para ver `/me/play-history/tracks` responder con sesión. Si falla, el log dice por qué y la vista degrada a lista vacía con su estado.
3. Dar un favorito en la app de escritorio y comprobar en el log que `PUT /users/{tuId}/track_likes/{id}` responde 200 (la ruta se sondeó anónima: 403 = existe, pero el 200 solo se ve con sesión).

## Mapa rápido de lo nuevo

```
packages/soundcloud-api/src/client.ts   stationTracks, userTopTracks, relatedArtists, trackPlaylists,
                                        userPosts, stream, playHistory, followingIds, repostIds,
                                        setFollowing, setRepost, createPlaylist, setPlaylistTracks
apps/web/src/player/player.ts           dos stores (store + tick), radio infinita, velocidad, temporizador
apps/web/src/core/social.ts             seguir / repostear / playlists (optimista con reversión)
apps/web/src/core/shortcuts.ts          lista única de atajos (la usan app.ts, la hoja y los ajustes)
apps/web/src/components/menu.ts         menú contextual
apps/web/src/components/palette.ts      paleta ⌘K
apps/web/src/components/playlistpicker.ts  añadir a playlist / guardar la cola
apps/web/src/ui/modal.ts                modal con foco atrapado
apps/web/src/views/now.ts               «Ahora suena» (#/now)
apps/web/src/views/feed.ts              «De quien sigues» (#/feed)
apps/web/src/player/audiograph.ts       EQ de 5 bandas, limitador, volumen maestro, curvas de fundido
apps/web/src/core/offline.ts            copias locales en IndexedDB (sin conexión)
apps/web/src/core/download.ts           descarga del archivo original (web y escritorio)
apps/web/src/api/native.ts              puente con lo nativo (atajos, bandeja, mini, avisos)
apps/web/src/mini/mini.ts               mini reproductor (mando, sin player dentro)
apps/web/src/boot.ts                    arranque de la app (lo que main.ts ya no carga)
apps/web/src/dev/a11y.ts                auditoría de accesibilidad (solo en desarrollo)
apps/web/src/ui/virtuallist.ts          ventana de nodos para listas largas
```

## Efectos colaterales de las pruebas de hoy

- La **cola del navegador** (`localStorage` de `localhost:5173`) se usó para medir la virtualización con 170 tracks y quedó vaciada al final. La del escritorio no se tocó (otro origen).
- Se guardaron y borraron dos tracks de prueba en el almacén sin conexión del navegador; quedó vacío y el presupuesto en 500 MB (el valor por defecto).
- Para medir el audio hubo que reproducir de verdad: el **volumen del navegador** se bajó a 0,06–0,25 durante las pruebas y quedó restaurado en 0,9. Los ajustes de audio quedaron en sus valores por defecto (motor encendido, EQ plano, nivelado apagado, transición encadenada).
- El servidor de dev se ha caído tres veces con señal `SIGTERM` (código 143) durante la sesión; se relanza con `NODE_OPTIONS=--max-http-header-size=131072 npm run dev` y ya arranca en un segundo.

## Reglas que cuestan sangre (resumen; el detalle está en AGENTS.md)

- Pintar tiempo u onda → suscríbete a `player.tick`, nunca a `player.store`.
- No mutes `likes` desde fuera del player: usa `player.clearLocalLikes()`.
- `radioIds` se escribe **en el mismo `set()`** que la cola, o las insignias no aparecen.
- Al copiar los hijos de `artEl()` a otro contenedor, ese contenedor necesita la clase `art-frame`.
- Un 404 anónimo no descarta una ruta de escritura; un **403** sí confirma que existe (y un 404 **con sesión** sí la descarta).
- `policy: 'ALLOW'` y `streamable: true` no garantizan audio: si hay transcodings `*-encrypted-hls` y los planos son `is_legacy_transcoding`, el track es solo-DRM.
- Las listas virtuales no reutilizan nodos a propósito; ver la sección de `ui/virtuallist.ts` en AGENTS.md antes de «optimizarlo».
- Ojo al probar módulos desde la consola: `import('/src/core/x.ts')` en dev crea **otra instancia** del módulo (HMR le pone `?t=`), con su propio estado. Para probar de verdad hay que usar la instancia de la app (`window.soundclear`), no una importada a mano.
- En macOS: las teclas de medios no se pueden registrar como atajo global, y `set_position` tras crear una ventana no la mueve (hay que darle la posición al constructor). Detalles en AGENTS.md.
- Accesibilidad: `await soundclear.auditRoutes()` en la consola de desarrollo. Y **no** medir contraste recorriendo el DOM con el motor acrílico: da números falsos; medir pares de tokens.
- Un `t()` en una constante de módulo se congela con el idioma del arranque: traducir en el punto de uso.
- `npm test` (63 casos), `npm run probe` (API real) y `npm run i18n` son parte de la puerta de calidad.
- El audio se mide, no se supone: `soundclear.player.diagnostics()` en la consola de `npm run dev` (hook solo de desarrollo). Con el grafo activo, el volumen va en el grafo y los elementos a `volume = 1`.
- `DynamicsCompressorNode` de Chrome añade ganancia oculta: no usarlo para nivelar.
- `PUT /playlists/{id}` **reemplaza** la lista entera: leer, concatenar, deduplicar, escribir.
