# @soundlite/desktop

App de escritorio de Soundlite construida con [Tauri 2](https://v2.tauri.app/) (Rust) que envuelve la web app.

## Requisitos

- Node.js >= 18
- Rust (stable) — [rustup](https://rustup.rs/)
- macOS: Xcode Command Line Tools (`xcode-select --install`)

## Desarrollo

```bash
npm run dev:desktop
```

Arranca la web app de Vite (puerto 5173) y abre la ventana nativa de Tauri apuntando a ella.

## Build

```bash
npm run build -w apps/desktop
```

Genera el binario y el instalador en `src-tauri/target/release/bundle/`.

## Cómo funciona

- `src-tauri/src/lib.rs` expone dos comandos que la web app usa en vez del proxy HTTP:
  - `get_client_id`: extrae el `client_id` del HTML de soundcloud.com (cacheado 20 min).
  - `proxy_fetch`: hace el fetch de `api-v2.soundcloud.com` inyectando el `client_id`, sin CORS.
- El transporte de la web (`TauriTransport` en `packages/soundcloud-api`) detecta Tauri automáticamente y usa `invoke` en lugar del fetch al proxy.
- Los medios (mp3, waveforms) se descargan directo desde el webview: sus CDNs envían `Access-Control-Allow-Origin: *`.

## Iconos

Los iconos se generan con un script sin dependencias que pinta el logo waveform a mano:

```bash
npm run icons -w apps/desktop
```

Genera `src-tauri/icons/icon.png` (1024) y `apps/web/public/icon-512.png` (512), y luego ejecuta `tauri icon` para derivar todos los formatos (icns, ico, android, ios).
