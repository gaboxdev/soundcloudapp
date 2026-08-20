---
name: run-soundclear
description: Lanza y maneja SoundClear para ver un cambio funcionando — la app de escritorio (Tauri, el objetivo real) o la web en el navegador. Úsala cuando pidan abrir, arrancar, correr o probar la app, o confirmar que un cambio funciona de verdad y no solo en los tests.
---

# Correr SoundClear

**El escritorio es la app de verdad.** La web solo llega a la mitad: en
navegador no hay sesión de SoundCloud, `authed_request` lanza error y
todo lo que pasa por `canWrite()` (seguir, repostear, playlists, likes
de cuenta) ni siquiera se pinta. Para un cambio que toque sesión,
social, offline, mini, atajos o notificaciones, la web no prueba nada.
Arranca escritorio salvo que el cambio sea puramente visual y te valga
iterar rápido.

## Escritorio (por defecto)

```bash
npm run dev:desktop        # = tauri dev en apps/desktop
```

`beforeDevCommand` levanta Vite en **5173** por su cuenta. Si ya tienes
uno corriendo ahí, Vite se va a 5174 y Tauri sigue cargando el 5173
viejo — sin HMR de tus cambios y persiguiendo un fantasma. Libera el
puerto antes:

```bash
lsof -ti :5173 | xargs -r kill                     # macOS/Linux
```

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }   # Windows
```

Requiere Rust (`cargo --version`). El primer build tarda mucho; con
`apps/desktop/src-tauri/target/` ya poblado son ~1-2 min. Lánzalo en
background y espera a la línea `Running \`target/debug/soundclear\``;
si en su lugar aparece `error[E…]` o `could not compile`, es fallo de
compilación, no de la app. En Windows la línea es
`Running \`target\debug\soundclear.exe\`` y el enlazador escupe un
`warning: linker stdout: Creando biblioteca …` que es inofensivo.

La ventana `main` abre a 1240x820 con título **SoundClear**.

### `Server responded with status code 431` en el log (macOS)

Vite corre sobre Node, cuyo `max-http-header-size` son 16KB. Una
petición del webview con una cabecera `Cookie` más grande que eso se
va con **431** y Vite lo escupe en bucle. Medido: cookie de 20KB → 431,
sin cookie → 200.

No es fatal — la app arranca y funciona igual, son peticiones sueltas.
Si molesta o si algún módulo no carga, dale más margen a Node:

```bash
NODE_OPTIONS=--max-http-header-size=65536 npm run dev:desktop
```

Diagnóstico en un segundo, sin tocar la app:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/     # 200 esperado
```

Si eso da 200 y el webview sigue con 431, es la cookie del webview, no
el servidor.

### Confirmar que arrancó de verdad

No basta con ver la ventana. `$TMPDIR/soundclear-debug.log` —en Windows
`%TEMP%\soundclear-debug.log`— te dice si la sesión está viva:

```
me() ok: <usuario>
authed GET https://api-v2.soundcloud.com/stream?...
auth-bridge (navegación): id N status 200 (46335 bytes)
```

`me() ok:` es la prueba de que el puente autenticado funciona. Si no
aparece, la sesión no está montada por mucho que la UI se pinte.

### Humo sin GUI

Antes de mirar la ventana, esto valida la cadena client_id → /me →
login y sale con código 0:

```bash
cd apps/desktop/src-tauri && SOUNDCLEAR_SELFTEST=1 cargo run
```

```powershell
cd apps\desktop\src-tauri; $env:SOUNDCLEAR_SELFTEST = '1'; cargo run   # Windows
```

### Ver qué hace

`log_debug` desde TS escribe en `$TMPDIR/soundclear-debug.log`:

```bash
tail -f "$TMPDIR/soundclear-debug.log"
```

```powershell
Get-Content "$env:TEMP\soundclear-debug.log" -Wait -Tail 20          # Windows
```

Es la vía principal de observación en escritorio — la consola del
webview no la tienes a mano desde aquí.

## Web (iteración rápida de UI)

```bash
npm run dev                # http://localhost:5173
open http://localhost:5173/          # en Windows: start http://localhost:5173/
```

Humo por HTTP sin navegador:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
curl -s http://localhost:5173/sl-client-id     # {"client_id":"…","refreshed":false}
```

Si `/sl-client-id` no devuelve un `client_id`, el scraping de client_id
se rompió y **ninguna** vista va a cargar datos: arréglalo antes de
seguir mirando la UI.

## La puerta de login tapa todo

`components/logingate.ts` cubre la app hasta que haya sesión o el
usuario pulse «Explorar sin cuenta». Si arrancas y ves un panel en vez
de la home, no está rota: falta elegir invitado. Para saltártela de
entrada, en la consola del navegador antes de cargar:

```js
localStorage.setItem('sl:guest', '1')
```

Y si `onboarded` es falso sale además el tour de personalización
(`components/welcome.ts`), por encima de la puerta. Ciérralo o marca
`onboarded` en `sl:settings`.

## Manejarla, no solo abrirla

Abrir y mirar la home prueba que el bundle resuelve. Ve a la ruta que
tocaste:

`home`, `explore`, `charts?genre=`, `search?q=&tab=&dur=&when=&genre=&cc=`,
`track/:id`, `playlist/:id`, `user/:id`, `queue`, `now`, `feed`,
`likes`, `settings` — todas por hash, p.ej. `#/search?q=aphex`.

En dev (`import.meta.env.DEV`, no está en producción) la app expone
`window.soundclear`:

```js
soundclear.player.diagnostics()   // graph, suspended, active, level,
                                  // crossfade, fading, eq[], leveling, decks[]
await soundclear.auditRoutes()    // a11y por las rutas principales
soundclear.audit()                // a11y de la vista actual
soundclear.settings()             // ajustes actuales
soundclear.update({ theme: 'light' })
soundclear.offline                // módulo de copias locales
```

Para audio, `diagnostics()` es la medición real — mirar la onda no dice
si el grafo está bien conectado.

## Trampas al mirar

- **La mini (`label: 'mini'`)** carga `mini/mini.ts` y **no** instancia
  el player. Un cambio de player no se ve ahí por diseño.
- Cualquier ventana cuya etiqueta no sea `main` ni `mini` **sale sin
  arrancar nada** — las de login y el puente cargan el mismo bundle. Si
  arrancaran, romperían la sesión.
- **Estado de carga = esqueleto**, nunca spinner. Si ves un salto de
  geometría al llegar los datos, el esqueleto no copia al componente
  real y eso es el bug.
- Ventanas permitidas en `capabilities/default.json`: solo `main` y
  `mini`. Una ventana nueva sin registrar ahí no tiene permisos.
- Host nuevo al que hable el escritorio → `connect-src` del CSP en
  `tauri.conf.json`, o la petición muere en silencio.

## Windows

Compila y corre igual, pero con tres diferencias medidas:

- **Atajos globales: `Ctrl+Alt`**, no ⌘⌥ — la tecla Windows la tiene el
  sistema y Win+Alt+flechas/F/M salen con «HotKey already registered».
  Aun con Ctrl+Alt puede quedar alguno fuera si otra app lo tiene
  cogido; el log dice cuántos de 8 entraron y los ajustes lo pintan.
- **Barra de título nativa** encima de la cabecera de la app:
  `titleBarStyle` y `hiddenTitle` son solo de macOS, así que
  `data-titlebar='overlay'` no se aplica (`index.html` lo condiciona
  bien) y salen las dos.
- **El cristal es `apply_acrylic`**, no la vibrancy de macOS: difumina
  el escritorio de detrás, así que sobre un fondo con color se
  ensucia más que en Mac.

Lo que sí funciona sin tocar nada: sesión (`me() ok:`), puente
autenticado, bandeja, mini con protección de contenido, enlaces
profundos y los dos instaladores (`nsis/*-setup.exe` y `msi/*.msi`).

## Al terminar

`npm run typecheck` + `npm test` + `npm run build` en verde. Es
exactamente la puerta de CI y no hay linter que la cubra.
