# Contribuir a SoundClear

Gracias por pasarte. Este proyecto tiene una tesis muy concreta —**una app de SoundCloud completa en ~80 KB de JavaScript, sin frameworks**— y casi todas las reglas de abajo existen para protegerla. Léelas antes de escribir código y te ahorras un PR rechazado.

## Requisitos

- **Node ≥ 22.18** (`npm` con workspaces; Node 24 recomendado).
- **Rust estable** solo si vas a tocar la app de escritorio (`apps/desktop/src-tauri`).
- Nada más. El proyecto no usa linter ni formateador: la puerta de calidad es el compilador y los tests.

```bash
npm install
npm run dev          # web  → http://localhost:5173
npm run dev:desktop  # escritorio (requiere Rust)
```

## La puerta de calidad

Estos tres comandos tienen que pasar antes de abrir el PR. Es exactamente lo que corre CI:

```bash
npm run typecheck    # tsc --noEmit en los workspaces TypeScript
npm test             # pruebas con node:test, sin dependencias de runtime
npm run build        # tsc + vite build de apps/web
npm run release:check
npm run i18n -- --estricto
npm run css:audit -- --estricto
```

CI también compila y prueba Rust en Windows y macOS, empaqueta el Worker sin desplegarlo y comprueba las dependencias con `npm audit`. Si cambias escritorio, ejecuta `cargo check --locked` y `cargo test --locked` desde `apps/desktop/src-tauri`.

**El Rust no corre en cada push.** Está en su propio workflow (`.github/workflows/desktop.yml`) y solo se dispara cuando el push toca `apps/desktop`, `apps/web/src`, `packages/soundcloud-api` o los manifiestos. Un cambio de textos o de CSS no gasta minutos de Actions. Si haces push dos veces seguidas, `cancel-in-progress` cancela la corrida anterior.

## Publicar una release sin Actions

No hace falta GitHub Actions para sacar binarios. En tu máquina:

```bash
npm run release:local
```

Eso encadena toda la puerta de calidad y termina compilando el escritorio. Los artefactos quedan en:

```
apps/desktop/src-tauri/target/release/bundle/
```

Ahí salen el `.msi` y el `.exe` (NSIS) en Windows, el `.app` y el `.dmg` en macOS, y el `.deb` y el `AppImage` en Linux. Desde ahí se sube el archivo a la release de GitHub a mano.

El workflow de Actions queda para cuando quieras que las tres plataformas se compilen solas; también se puede lanzar a mano desde **Actions › Release › Run workflow** escribiendo la etiqueta.

Si tu cambio toca la API de SoundCloud, corre también `npm run probe` (16 sondas contra la API real). No está en CI porque depende de la red y de que SoundCloud siga vivo, pero es la única forma de verificar una suposición sobre la API en vez de confiar en ella.

## Convenciones no negociables

- **Cero dependencias de UI.** La única dependencia de runtime es `hls.js`, cargada de forma lazy y en su propio chunk. Nada de React, Vue, Svelte, Tailwind ni librerías de componentes. Un PR que añada una dependencia de runtime necesita justificar el peso en KB gzip antes de escribirse.
- **Sin comentarios en el código.** Si un bloque necesita explicación, el sitio es `AGENTS.md`, no el fuente.
- **Texto de UI en español**, envuelto en `t()`. IDs y clases en kebab-case.
- **TypeScript estricto** con `verbatimModuleSyntax` y `noUnusedLocals` / `noUnusedParameters`: los tipos se importan con `import type`.
- **DOM con `h()` y `svgIcon()`** de `ui/el.ts`. `esc()` es **solo** para `innerHTML`; pasárselo a `h()` produce entidades visibles en pantalla.
- **Filas de tracks con `trackRow()`**, errores con `.page-error` o `toast()`.
- **Todo estado de carga es un esqueleto** de `ui/skeleton.ts`, nunca un spinner ni un «Cargando…». Si añades una vista, añade su esqueleto con la misma geometría que el componente real.
- **Overlays con `components/menu.ts`, `ui/modal.ts` o `components/palette.ts`.** No montes menús ni modales a mano: esas piezas ya resuelven foco, `Escape` y cierre al pulsar fuera.
- **Colores solo desde los tokens de `styles/design.css`.** `--accent` es fondo; para primer plano, `--accent-text`.
- **Nunca `fetch` a la API desde una vista.** Todo pasa por `getAPI()`; cualquier función que ofrezca sesión o escrituras comprueba `isDesktop()` / `canWrite()` antes de pintarse.

`AGENTS.md` es la referencia profunda: gotchas verificados de la API v2, el motor acrílico, el puente de sesión del escritorio y los patrones de vista. Muchas de esas notas documentan bugs que ya se pagaron una vez — consúltalo antes de tocar llamadas a la API, CSS o la sesión.

## Accesibilidad

No es opcional. Todo tiene que ser alcanzable con teclado, el foco siempre visible y los objetivos de 24 px. En `npm run dev` la app expone `await soundclear.auditRoutes()` en la consola, que pasa la auditoría de accesibilidad por las rutas principales: debe salir con 0 hallazgos.

## Añadir una vista

Dos pasos: `register('nombre', (route, container) => …)` en `views/nombre.ts` y un `import './views/nombre'` en `boot.ts`. El `container` llega limpio y los errores se pintan solos como `.page-error`.

Si añades un eje visual a los ajustes, añádelo también al script inline de `index.html` que aplica los `data-*` antes del primer pintado, o habrá un salto en el primer frame.

## Pull requests

1. Fork y rama (`feat/nombre`, `fix/nombre`).
2. Un PR = un cambio. Si tocas cuatro cosas, son cuatro PRs.
3. Mensajes de commit en español con prefijo: `feat:`, `fix:`, `docs:`, `refactor:`.
4. Describe **qué** cambia y **cómo se verifica** — mira la [plantilla](./.github/pull_request_template.md).
5. Si el cambio se ve, adjunta captura o GIF (tema oscuro y claro si tocas CSS).

## Qué no vamos a aceptar

- Frameworks, librerías de UI o dependencias de runtime que engorden el bundle.
- Cualquier cosa que salte restricciones de SoundCloud: descargar tracks que el autor no ha habilitado, esquivar el recorte de 30 s de los tracks Go+ (`policy: 'SNIP'`) o el DRM. La app respeta esos límites a propósito y va a seguir respetándolos.
- Scraping agresivo o peticiones en bucle contra la API.
- Reescrituras masivas sin issue previo donde se haya discutido el enfoque.

## Bugs y vulnerabilidades

Los bugs, con las [plantillas de issue](./.github/ISSUE_TEMPLATE). Las vulnerabilidades **no**: eso va en privado, como explica [SECURITY.md](./SECURITY.md).

## Convivencia

El proyecto tiene un [código de conducta](./CODE_OF_CONDUCT.md) corto y en serio. Se resume en discutir el código sin faltar a quien lo escribió.

## Legal

Al contribuir aceptas que tu código se publique bajo la licencia [MIT](./LICENSE) del proyecto. SoundClear no tiene afiliación con SoundCloud; no aceptamos aportaciones que usen su marca o su logotipo como identidad de la app.
