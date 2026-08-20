# Política de seguridad

SoundClear es un proyecto independiente mantenido por voluntarios. No hay servidores nuestros ni cuentas de usuario: la app corre en tu máquina y habla directamente con SoundCloud. Aun así, hay superficie que puede fallar y preferimos enterarnos en privado.

## Cómo reportar

**No abras un issue público para una vulnerabilidad.** Usa el reporte privado de GitHub:

1. Ve a la pestaña **Security** del repositorio.
2. **Report a vulnerability**.
3. Cuenta qué encontraste, cómo reproducirlo y qué impacto tiene.

Somos un proyecto pequeño: intentamos contestar en pocos días, pero no hay SLA ni programa de recompensas. Si el fallo es real, lo arreglamos, publicamos el parche y te acreditamos si quieres.

Al reportar, **no incluyas tu `oauth_token` de SoundCloud, cookies ni capturas con tu sesión**. Redacta esos valores.

## Qué versiones se soportan

Solo `main` y la última release. No hay parches retroactivos para versiones anteriores.

## Qué nos interesa

- Fuga de la sesión de SoundCloud: cualquier camino por el que la cookie `oauth_token` salga de la webview del sistema o acabe en un log, en la UI, en el portapapeles o en una petición a un tercero.
- Ejecución de código o XSS a partir de datos de la API (títulos, descripciones, comentarios): todo lo que llega de SoundCloud es texto ajeno y solo debe entrar en el DOM vía `h()` o escapado con `esc()`.
- Escapes del CSP del escritorio (`apps/desktop/src-tauri/tauri.conf.json`) o comandos de Tauri invocables desde una página que no debería poder invocarlos.
- Abuso del proxy: `/sl-proxy` (dev y Worker) solo debe aceptar los hosts de la lista blanca de `proxy/shared/clientid.ts`. Cualquier forma de convertirlo en un proxy abierto es un fallo de seguridad, no una mejora.
- Escritura en el disco fuera de lo esperado por `download_to_music` u otro comando Rust.

## Qué no es una vulnerabilidad

- Que la app use endpoints no documentados de la API v2 de SoundCloud, o que SoundCloud rote el `client_id` y algo deje de funcionar.
- Que la webview del sistema en macOS no soporte passkeys (limitación de WebKit, documentada en el README).
- Rate limits, bloqueos o cambios de comportamiento del lado de SoundCloud.
- Que el binario de escritorio no esté firmado ni notarizado: es una limitación conocida y está documentada en el README.

## Qué hace la app con tus datos

- La sesión de SoundCloud vive en las cookies de la webview del sistema, en tu equipo. No se copia a ningún servidor del proyecto — no hay ninguno.
- Ajustes, cola, historial y favoritos locales están en `localStorage`; las copias sin conexión, en IndexedDB. Todo local.
- El proxy de producción (Cloudflare Worker) es opcional y lo despliegas tú, en tu cuenta. Solo reenvía peticiones a la API de SoundCloud y no registra contenido.
- «Copiar informe» en Ajustes › Diagnóstico está pensado para no incluir datos personales. Si encuentras algo identificable ahí, es un bug reportable.
