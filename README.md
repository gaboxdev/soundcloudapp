# SoundClear

> Cliente libre para SoundCloud. Rápido, open source y sin frameworks.
>
> *Proyecto independiente, sin afiliación con SoundCloud.*

SoundClear es un **cliente nativo de SoundCloud** — no es un wrapper de la web. Habla directamente con la API de SoundCloud, renderiza su propia UI, y funciona como **PWA en el navegador** y como **app de escritorio (Tauri)** con el mismo código.

**~21 KB de JavaScript** (gzip) para la app completa. Sin React, sin Vue, sin Svelte: TypeScript vanilla + CSS. El resto es disciplina.

Un regalo para la comunidad de SoundCloud. MIT, para quien lo quiera, como se hizo siempre.

---

## ✨ Características

| | |
|---|---|
| 🎧 **Reproductor con waveform** | Scrubber visual interactivo, seek por rangos HTTP, preview de 30s para tracks Go+ (SNIP) |
| 🔑 **Inicio de sesión con SoundCloud** | App de escritorio: entra con tu propia cuenta, ve tu perfil y tus likes sincronizados |
| 🔎 **Búsqueda en vivo** | Sugerencias mientras escribes, resultados por tracks / playlists / usuarios, scroll infinito |
| 📈 **Charts** | Tendencias globales con ranks + 28 géneros para explorar |
| 🏠 **Feed de inicio** | Selecciones curadas de SoundCloud (mixed-selections) |
| 🎵 **Tracks y playlists** | Descripción, comentarios con scroll infinito, tracks relacionados, descargas cuando el autor las permite |
| 👤 **Perfiles** | Tracks, playlists y likes de cualquier usuario |
| 📚 **Cola** | Repeat (off/todo/uno), shuffle, persistencia en localStorage |
| ❤️ **Favoritos e historial** | Tus favoritos sincronizados con tu cuenta de SoundCloud; historial local |
| ⚡ **Atajos** | `Espacio` play/pausa · `←/→` ±5s · `N/P` siguiente/anterior · `M` silenciar. Soporta Media Session (teclas multimedia del sistema) |
| 🌗 **Temas** | Oscuro / claro / sistema |
| 📱 **PWA** | Instalable, service worker con caché de arte y waveforms. La sesión es obligatoria y hoy solo existe en escritorio (ver abajo) |
| 🖥️ **Escritorio** | Tauri 2: binario nativo de pocos MB, sin Electron |
| 🎨 **Skeletons + blur-up** | La UI nunca se siente vacía: carga instantánea, imágenes lazy |

## 🚀 Empezar

```bash
npm install
npm run dev          # web app → http://localhost:5173
npm run dev:desktop  # app de escritorio (requiere Rust)
```

### Uso en web

La API de SoundCloud bloquea CORS desde cualquier origen que no sea `soundcloud.com`. El `client_id` se extrae del propio HTML de SoundCloud (bloque hydratable) y se cachea. Por eso la app web necesita un proxy fino:

- **Dev**: ya incluido en Vite (`apps/web/vite.config.ts`) — `/sl-proxy` y `/sl-client-id`.
- **Producción**: despliega el Cloudflare Worker en `proxy/worker` (~100 líneas) y pon su URL en **Ajustes → Proxy**. Funciona gratis en el plan free de Cloudflare.

El audio y los waveforms se sirven directo desde los CDNs de SoundCloud (`Access-Control-Allow-Origin: *`), sin pasar por el proxy.

> **Importante**: SoundClear exige iniciar sesión para usarse, y la sesión con SoundCloud solo puede establecerse desde la app de escritorio (cookies de terceros + CORS lo impiden en el navegador). Por eso, hoy **el build web muestra la pantalla de acceso y no permite entrar**: sirve para desarrollo y para desplegar el proxy, pero la app de verdad es la de escritorio. Levantar esa restricción (modo invitado) está en el roadmap.

### Cuenta e inicio de sesión (escritorio)

Al abrir la app, **lo primero que verás es la pantalla de inicio de sesión**: para usar SoundClear hay que conectar tu cuenta de SoundCloud (así la app siempre está lista para ti y no pierdes tus likes). 

SoundCloud cerró el registro de apps OAuth para nuevos desarrolladores, así que SoundClear se conecta con el **login nativo de SoundCloud**: la app abre una ventana con `soundcloud.com`, inicias sesión ahí (con tu cuenta, 2FA incluido) y la sesión queda guardada en la webview. Las peticiones autenticadas (`/me`, tus likes, quitar like) se hacen desde un webview oculto en el mismo origen que la API, donde el CORS de SoundCloud sí permite `soundcloud.com`.

Disponible en **Ajustes → Cuenta** y en **Favoritos → Tu cuenta**:

- Tu perfil (avatar, nombre, seguidores)
- Tus likes de SoundCloud, con play en cola y quitar like
- Cerrar sesión (desde la ventana de sesión)

**Sobre passkeys y botones sociales (Google/Apple)**: la webview del sistema en macOS no soporta passkeys (WebAuthn de plataforma) — es una limitación de WebKit, [issue abierta en Tauri](https://github.com/tauri-apps/tauri/issues/7926) desde 2023. Si al iniciar sesión con Google o Apple te pide passkey, elige **«Usar contraseña» / «Otras opciones»**: el login con email + contraseña (+ código 2FA) funciona perfectamente en la app. La ventana de login muestra un aviso automático en esas pantallas. En Windows (WebView2/Chromium) los passkeys sí funcionarán.

La versión web navegador no puede guardar la sesión (cookies de terceros + CORS), por eso la pantalla de acceso te indica cómo obtener la app de escritorio.

## 🏗️ Arquitectura

```
packages/soundcloud-api   # Cliente tipado de la API v2 de SoundCloud (transport pluggable)
apps/web                  # SPA: Vite + TypeScript vanilla (0 frameworks)
apps/desktop              # Tauri 2 (Rust): comandos proxy_fetch y get_client_id
proxy/worker              # Cloudflare Worker para el build web en producción
.github                   # CI + plantillas de issues/PRs
```

- **Transport pluggable**: `ProxyTransport` (web) o `TauriTransport` (escritorio) — un solo `SoundCloudAPI` para ambos.
- **Micro-store pub/sub**: `createStore` (~20 líneas) alimenta al reproductor, la cola y las vistas.
- **Router hash-based**: vistas auto-registradas, sin dependencias.
- El bundle de `hls.js` (solo para tracks sin MP3 progresivo) se carga *lazy*.

Detalles técnicos en [AGENTS.md](./AGENTS.md).

## 🧠 Detalles que importan

- `artwork_url` es `null` ~34% de las veces → fallback con iniciales siempre.
- `policy: 'SNIP'` = preview de 30s (exclusivo Go+). `duration` viene clamped.
- Los comentarios necesitan `threaded=1`.
- El `next_href` de la API no trae client_id — el transport lo inyecta y reescribe.
- Si SoundCloud rota el client_id, la app se re-autentica sola (retry con cache reset).

## 🗺️ Roadmap

- [x] Cuenta y sincronización de likes (resuelto con el login nativo en la webview, sin OAuth)
- [ ] Modo invitado en la versión web (hoy la sesión es obligatoria y solo existe en escritorio)
- [ ] Estaciones de radio (artist station)
- [ ] Más tamaños de arte (CDN) y opción de calidad
- [ ] Versión móvil nativa
- [ ] Compilados para Windows/Linux
- [ ] Soporte de idiomas (i18n)

¿Ideas? Abre un issue o un PR — este proyecto es tuyo también.

## 🤝 Contribuir

1. Fork + branch (`feat/nombre`)
2. `npm run typecheck` y `npm run build` pasan
3. PR con descripción clara — mira el [template](./.github/pull_request_template.md)

Normas: sin comentarios en el código, UI en español, TS estricto, clases kebab-case, nada de frameworks.

## ⚖️ Legal

**SoundClear es un proyecto independiente de código abierto, sin afiliación, patrocinio ni respaldo de SoundCloud.** No está desarrollado, avalado ni revisado por SoundCloud.

«SoundCloud» es una marca registrada de SoundCloud Global Limited & Co. KG. Sus marcas, logotipos y contenido pertenecen a sus respectivos dueños y aquí se mencionan únicamente de forma descriptiva, para indicar con qué servicio funciona este cliente. SoundClear no usa el nombre ni el logotipo de SoundCloud como identidad propia: tiene su propio nombre y su propia marca.

SoundClear solo accede a endpoints públicos que el propio sitio web de SoundCloud utiliza, y no aloja, redistribuye ni descarga contenido protegido salvo cuando el propio autor lo habilita en SoundCloud. Licencia [MIT](./LICENSE).

---

Hecho con ❤️ para la comunidad. *"El primero de muchos."*
