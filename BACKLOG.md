# Backlog — RolCall

Issues y mejoras pendientes identificadas en la revisión de arquitectura. Este repo es privado y de uso entre amigos, así que los issues de seguridad son de baja urgencia real — solo relevantes si algún día se hace público.

---

## Leyenda de Prioridad

| Prioridad | Significado |
|-----------|-------------|
| **CRITICAL** | Arreglar antes de hacer el repo público |
| **HIGH** | Importante para buena UX |
| **MEDIUM** | Nice to have |
| **LOW** | Cuando haya tiempo/ganas |

---

## Security

### 1. Server trusts client-provided role for Master privileges
**Prioridad:** CRITICAL (si se hace público)

**Problema:** En `api/join-room/+server.ts:23`, el servidor acepta `role === 'master'` del cliente sin validación. Cualquiera podría modificar la petición y obtener privilegios de admin.

**Solución propuesta:**
- Al crear la sala, generar un "master token" secreto (ej: `nanoid(20)`)
- Devolverlo solo al creador de la sala
- Para unirse como master, el cliente debe enviar ese token
- Sin token válido → siempre player

**Archivos afectados:**
- `src/routes/api/create-room/+server.ts`
- `src/routes/api/join-room/+server.ts`
- `src/routes/+page.svelte`
- `src/routes/sala/[roomId]/+page.svelte`

---

### 2. Any player can spoof kick/room-closed DataChannel commands
**Prioridad:** CRITICAL (si se hace público)

**Problema:** Los comandos `kick` y `room-closed` se envían por DataChannel. Como todos los jugadores tienen `canPublishData: true`, cualquiera podría enviar estos mensajes y expulsar a otros o cerrar la sala.

**Solución propuesta:**
- Opción A: Validar en el receptor que el `participant.identity` del sender corresponde al master
- Opción B: Mover kick/close a endpoints del servidor que usen la API REST de LiveKit (`roomService.removeParticipant()`)

**Archivos afectados:**
- `src/routes/sala/[roomId]/+page.svelte` (handleDataReceived)
- Nuevo: `src/routes/api/kick/+server.ts`
- Nuevo: `src/routes/api/close-room/+server.ts`

---

### 3. Add TTL to JWT tokens
**Prioridad:** MEDIUM

**Problema:** Los tokens JWT generados en `api/join-room/+server.ts:26` no tienen expiración. Un token capturado sería válido indefinidamente.

**Solución propuesta:**
```ts
const token = new AccessToken(key, secret, { 
  identity, 
  name,
  ttl: '4h'  // o '2h' para sesiones más cortas
});
```

**Archivos afectados:**
- `src/routes/api/join-room/+server.ts`

---

## Bugs

### 4. Mic/cam UI shows enabled even when permissions denied
**Prioridad:** HIGH

**Problema:** Si el usuario deniega permisos de cámara/micrófono, el `catch` en `connectToRoom()` captura el error pero `micEnabled` y `camEnabled` quedan en `true`. Los botones muestran estado incorrecto.

**Solución propuesta:**
```ts
try {
  await room.localParticipant.enableCameraAndMicrophone();
} catch (e: unknown) {
  // ... error handling existente ...
  micEnabled = false;
  camEnabled = false;
}
```

**Archivos afectados:**
- `src/routes/sala/[roomId]/+page.svelte:110-118`

---

### 5. Error messages not visible once in call
**Prioridad:** HIGH

**Problema:** Si ocurre un error después de unirse (ej: el warning de permisos de cámara), se setea `error` pero el banner de error solo se renderiza en el estado "waiting room" o "connecting", no dentro de la llamada.

**Solución propuesta:**
- Añadir un toast flotante o banner dentro del estado `joined` que muestre `error` cuando no esté vacío
- Auto-dismiss después de 5-10 segundos

**Archivos afectados:**
- `src/routes/sala/[roomId]/+page.svelte` (sección `{:else if joined}`)

---

## Enhancements

### 6. Server-side room close (destroy room on LiveKit)
**Prioridad:** HIGH

**Problema:** "Cerrar sala" solo envía un mensaje DataChannel. La sala sigue existiendo en LiveKit hasta el `emptyTimeout` (10 min).

**Solución propuesta:**
- Crear endpoint `POST /api/close-room`
- Usar `roomService.deleteRoom(roomId)` del SDK de servidor
- Llamarlo desde el cliente cuando el master cierra

**Archivos afectados:**
- Nuevo: `src/routes/api/close-room/+server.ts`
- `src/routes/sala/[roomId]/+page.svelte` (función closeRoom)

---

### 7. Rate limiting on API endpoints
**Prioridad:** MEDIUM

**Problema:** No hay límite de peticiones. Alguien podría spamear `/api/create-room` y crear miles de salas.

**Solución propuesta:**
- Usar un middleware simple de rate limiting (ej: `@sveltejs/kit` hooks + Map en memoria)
- Límites sugeridos: 5 rooms/min por IP, 20 joins/min por IP

**Archivos afectados:**
- `src/hooks.server.ts` (nuevo archivo)

---

### 8. Active speaker indicator
**Prioridad:** LOW

**Problema:** No hay indicación visual de quién está hablando.

**Solución propuesta:**
- LiveKit emite eventos de `activeSpeaker`
- Añadir un borde verde/glow al tile del participante que está hablando

**Archivos afectados:**
- `src/routes/sala/[roomId]/+page.svelte`

---

### 9. Reactions / Dice roll
**Prioridad:** LOW

**Problema:** Feature request — sería útil poder enviar reacciones rápidas o tirar dados.

**Solución propuesta:**
- Nuevo topic de DataChannel: `reaction`
- Botones de emojis (🎯⚔️🛡️🎲)
- Para dados: botón que envía resultado random y lo muestra a todos

---

## Tech Debt

### 10. Fix HTML lang attribute (en → es)
**Prioridad:** LOW

**Problema:** `src/app.html:2` tiene `lang="en"` pero toda la UI está en español.

**Solución:**
```html
<html lang="es">
```

**Archivos afectados:**
- `src/app.html`

---

### 11. Update docs to reflect current code
**Prioridad:** MEDIUM

**Problema:** Después de los cambios de polish, algunos docs están desactualizados:
- `README.md` dice `adapter-auto`, pero usamos `adapter-node`
- `README.md` no menciona `PUBLIC_LIVEKIT_URL` en el setup
- `AGENTS.md` y `ARCHITECTURE.md` dicen que el LiveKit URL está hardcodeado

**Archivos afectados:**
- `README.md`
- `AGENTS.md`
- `ARCHITECTURE.md`

---

### 12. Add basic tests
**Prioridad:** LOW

**Problema:** No hay tests automatizados.

**Solución propuesta:**
- Tests unitarios para las funciones de utilidad
- Tests de integración para los endpoints API
- Playwright para e2e (opcional, más complejo)

---

### 13. Add CI workflow
**Prioridad:** LOW

**Problema:** No hay CI. Los errores de build o tipos solo se detectan localmente.

**Solución propuesta:**
- GitHub Actions workflow que corra `npm run check` y `npm run build` en cada push

---

## Resumen por Prioridad

### CRITICAL (si se hace público)
- [ ] #1 — Role escalation
- [ ] #2 — DataChannel command spoofing

### HIGH
- [ ] #4 — Mic/cam state mismatch
- [ ] #5 — Error visibility in call
- [ ] #6 — Server-side room close

### MEDIUM
- [ ] #3 — Token TTL
- [ ] #7 — Rate limiting
- [ ] #11 — Update docs

### LOW
- [ ] #8 — Active speaker indicator
- [ ] #9 — Reactions / dice
- [ ] #10 — HTML lang fix
- [ ] #12 — Add tests
- [ ] #13 — Add CI
