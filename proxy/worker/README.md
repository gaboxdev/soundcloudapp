# @soundlite/proxy-worker

Proxy de Cloudflare Worker para Soundlite en producción web. `api-v2.soundcloud.com` bloquea CORS para orígenes que no sean soundcloud.com, así que la web app en producción necesita un proxy que añada `Access-Control-Allow-Origin: *` e inyecte el `client_id`.

## Endpoints

- `GET /sl-proxy?url=<encoded>` — hace fetch a `api-v2.soundcloud.com` (solo ese host) inyectando el `client_id` si falta, y devuelve la respuesta con CORS abierto.
- `GET /sl-client-id` — devuelve `{ "client_id": "..." }` extraído del HTML de soundcloud.com (cacheado 15 min).
- Cualquier otra ruta → 404.

## Desplegar

```bash
npm install
npm run deploy   # requiere: npx wrangler login (una vez)
```

Dev local:

```bash
npm run dev
```

## Usarlo en Soundlite

1. Despliega el worker y copia la URL (p. ej. `https://soundlite-proxy.<tu-subdominio>.workers.dev`).
2. En Soundlite: Ajustes → campo `apiBase` → pega la URL del worker (sin barra final).

La web app hará `GET <apiBase>/sl-client-id` y `GET <apiBase>/sl-proxy?url=...` para todas las llamadas a la API.
