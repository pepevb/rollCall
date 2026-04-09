# Deploy de RolCall

Guía para poner RolCall online y que tu grupo pueda jugar desde cualquier lugar.

---

## Opciones de deploy

### Local (para probar)

- `npm run dev` → abre en [http://localhost:5173](http://localhost:5173)
- Para probar con otro dispositivo en la misma red WiFi, acceder a `http://<ip-local>:5173`
  - En macOS: `ifconfig | grep "inet "` para encontrar tu IP local
  - En Windows: `ipconfig` → buscar "Dirección IPv4"

---

### Deploy online

| Plataforma | Gratis | Dificultad | Nota |
|-----------|--------|------------|------|
| Railway | $5 crédito gratis/mes | Fácil | Conecta GitHub, configura env vars, listo |
| Render | Tier gratis | Fácil | Similar a Railway |
| Fly.io | Tier gratis | Media | Necesita CLI, pero buen rendimiento |
| Vercel | Gratis | Fácil | Requiere cambiar a `adapter-vercel` (serverless) |

---

## Recomendación: Railway

Es la opción más sencilla. No necesitás CLI ni configuración extra — todo desde la web.

### Pasos

1. Ir a [railway.app](https://railway.app) y crear una cuenta
2. Clic en **New Project → Deploy from GitHub repo**
3. Conectar el repo de GitHub (`pepevb/rollCall`)
4. Railway detecta automáticamente que es un proyecto Node.js y configura el build
5. Ir a la pestaña **Variables** y agregar las cuatro variables de entorno (ver tabla abajo)
6. El deploy se dispara solo — en 1-2 minutos la app está online

Railway asigna una URL pública automáticamente (ej. `rolcall-production.up.railway.app`). Se puede configurar un dominio propio desde **Settings → Domains**.

---

## Variables de entorno necesarias

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `LIVEKIT_URL` | WebSocket URL de tu proyecto LiveKit Cloud (solo servidor) | `wss://mi-proyecto-abc123.livekit.cloud` |
| `LIVEKIT_API_KEY` | API Key del proyecto en LiveKit Cloud | `APIxxxxxxxxxxxxxxxx` |
| `LIVEKIT_API_SECRET` | API Secret del proyecto en LiveKit Cloud | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `PUBLIC_LIVEKIT_URL` | Igual que `LIVEKIT_URL`, pero expuesta al navegador para la conexión WebSocket | `wss://mi-proyecto-abc123.livekit.cloud` |

> Todos estos valores se obtienen desde [cloud.livekit.io](https://cloud.livekit.io) → tu proyecto → **Settings → Keys**.

---

## Costos estimados

### El servidor de RolCall es ultra-ligero

RolCall solo hace tres cosas en el servidor:
- Servir la web estática
- Crear salas (1 llamada a la API de LiveKit)
- Generar tokens JWT para autenticar participantes

**Todo el tráfico de video y audio va directo por LiveKit Cloud**, no pasa por el servidor de RolCall. Esto significa que el servidor consume muy pocos recursos.

### Railway

- ~$0.50–1.50/mes para una app Node.js con tráfico bajo
- Railway da **$5 de crédito gratis por mes** — sobra para meses de uso sin gastar nada

### LiveKit Cloud (tier gratis)

- **50 GB de ancho de banda por mes**, participantes ilimitados
- Para un grupo de 4–6 personas jugando 3–4 horas × 4 veces al mes: consumo estimado de **10–20 GB/mes**
- Entra cómodo en el tier gratis

### Conclusión

Para un grupo de RPG jugando semanalmente, RolCall es **gratis o prácticamente gratis** ($0–1.50/mes).

---

## Adapter (si cambiás de plataforma)

El proyecto usa `@sveltejs/adapter-node` por defecto — ideal para Railway, Render, Fly.io y cualquier VPS.

Si querés deployar en otra plataforma:

### Vercel (serverless)

Instalar el adapter y cambiar `svelte.config.js`:

```bash
npm install @sveltejs/adapter-vercel
```

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-vercel';
```

### Cloudflare Pages

```bash
npm install @sveltejs/adapter-cloudflare
```

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-cloudflare';
```

> **Nota**: en entornos serverless (Vercel, Cloudflare), el módulo `livekit-server-sdk` debe ser compatible con el runtime de la plataforma. Verificar que las rutas API funcionan correctamente antes de ir a producción.
