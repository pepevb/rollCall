# ARCHITECTURE.md — RolCall Technical Architecture

## Table of Contents

1. [Technology Decisions](#technology-decisions)
2. [System Architecture](#system-architecture)
3. [Room Lifecycle](#room-lifecycle)
4. [Permission Model](#permission-model)
5. [DataChannel Protocol](#datachannel-protocol)
6. [Video Grid Layout Strategy](#video-grid-layout-strategy)
7. [Security Considerations](#security-considerations)
8. [Future Considerations](#future-considerations)

---

## Technology Decisions

### Why SvelteKit

SvelteKit provides both the frontend UI and the backend API routes in a single project with zero friction. For a small app like RolCall — which needs only two API endpoints and one complex page — a full backend framework would be overkill, but a purely client-side SPA would expose API secrets. SvelteKit's server routes run in Node (or an edge runtime) and have access to `$env/static/private`, which keeps credentials off the client without adding a separate service.

Svelte 5 runes mode is enforced globally to ensure modern reactive patterns (`$state`, `$derived`) throughout the codebase.

### Why LiveKit Cloud

LiveKit is a purpose-built WebRTC infrastructure platform with a generous free tier. The key reasons for choosing it:

- **No SFU (Selective Forwarding Unit) to operate** — LiveKit Cloud handles the media relay, codec negotiation, and connection resilience. RolCall has zero media infrastructure to maintain.
- **SDK quality** — both the browser client and the Node server SDK are well-maintained and TypeScript-first.
- **DataChannel support** — LiveKit exposes a reliable DataChannel API (`publishData`) on top of the WebRTC data channel, which RolCall uses for chat, kick, and room-close commands.
- **Adaptive stream + dynacast** — automatic quality degradation under poor network conditions, enabled by default in RolCall.
- **JWT-based auth** — granular per-participant permissions expressed as JWT grants, minted server-side.

### Why No Database

RolCall rooms are ephemeral by design. There is no user identity system, no message history, and no persistent room state. The LiveKit Cloud room itself IS the only state. When the last participant leaves (or the Master closes the room), the room is gone. This dramatically simplifies the architecture and eliminates the need for any storage tier.

### Why Tailwind CSS v4

Tailwind v4 drops the config file in favor of CSS-native custom properties and a Vite plugin. For a project this size, the single-import approach (`@import "tailwindcss"` in `app.css`) is ideal — no config to maintain, no theme file, all styling in markup.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               SvelteKit Client (CSR)                    │   │
│  │                                                         │   │
│  │  +page.svelte (home)   sala/[roomId]/+page.svelte       │   │
│  │  ─────────────────     ──────────────────────────────   │   │
│  │  • Create room button  • Waiting room (player name)     │   │
│  │  • Redirect to room    • Video grid                     │   │
│  │                        • Chat panel                     │   │
│  │                        • Control bar                    │   │
│  │                        • livekit-client Room object     │   │
│  └───────────────┬─────────────────────┬────────────────────┘  │
│                  │ HTTP fetch()         │ WebRTC / DataChannel  │
└──────────────────┼─────────────────────┼────────────────────────┘
                   │                     │
                   ▼                     ▼
┌──────────────────────────┐    ┌─────────────────────────┐
│  SvelteKit Server (SSR)  │    │     LiveKit Cloud        │
│                          │    │                         │
│  POST /api/create-room   │    │  • SFU (media relay)    │
│  ─────────────────────── │    │  • Room management      │
│  • nanoid(10) → roomId   │    │  • JWT validation       │
│  • RoomServiceClient     │    │  • Track subscription   │
│    .createRoom(...)      │    │  • DataChannel broker   │
│  • returns { roomId }    │    │                         │
│                          │    └─────────────────────────┘
│  POST /api/join-room     │              ▲
│  ─────────────────────── │              │
│  • AccessToken (JWT)     │──────────────┘
│  • role-based grants     │  RoomServiceClient (HTTPS REST)
│  • returns { token }     │  AccessToken minting (JWT)
└──────────────────────────┘
         │
         │ $env/static/private
         ▼
┌─────────────────────┐
│  Environment (.env) │
│  LIVEKIT_URL        │
│  LIVEKIT_API_KEY    │
│  LIVEKIT_API_SECRET │
└─────────────────────┘
```

### Data Flow Summary

1. **Room creation**: Browser → `POST /api/create-room` → SvelteKit server mints a room ID and registers it with LiveKit Cloud's REST API → returns `{ roomId }` to browser
2. **Token minting**: Browser → `POST /api/join-room` → SvelteKit server creates a signed JWT with role-based grants → returns `{ token }` to browser
3. **WebRTC connection**: Browser's `livekit-client` uses the JWT to open a WebSocket to LiveKit Cloud → LiveKit handles WebRTC negotiation → media flows peer-to-peer (when possible) or through the SFU
4. **App messaging**: Browser uses LiveKit's DataChannel (`publishData`) to send chat messages, kick commands, and room-close events — all brokered through LiveKit Cloud

---

## Room Lifecycle

```
[Master clicks "Crear sala"]
        │
        ▼
POST /api/create-room
  → nanoid(10) generates roomId (e.g. "aB3xK9mRpQ")
  → RoomServiceClient.createRoom({ name: roomId, maxParticipants: 6, emptyTimeout: 600 })
  → LiveKit creates the room (will auto-destroy after 10 min empty)
  → redirect to /sala/aB3xK9mRpQ?role=master&name=Master
        │
        ▼
[onMount detects role=master → auto-calls joinRoom()]
        │
        ▼
POST /api/join-room { roomId, participantName: "Master", role: "master" }
  → AccessToken with roomAdmin=true, canPublishSources=[camera,mic,screen_share,screen_share_audio]
  → room.connect(LIVEKIT_WSS_URL, token)
  → room.localParticipant.enableCameraAndMicrophone()
        │
        ▼
[Master is in the call — copies invite link]
Invite URL: https://rolcall.example.com/sala/aB3xK9mRpQ
  (no role/name params — players enter their name on the waiting room screen)
        │
        ▼
[Player opens invite URL → sees "Unirse a la partida" form]
[Player enters name → clicks "Entrar a la partida"]
        │
        ▼
POST /api/join-room { roomId, participantName: "Aragorn", role: "player" }
  → AccessToken with roomAdmin=false, canPublishSources=[camera,mic]
  → room.connect(...) → media established
        │
        ▼
[Call in progress — up to 6 participants]
        │
[Master clicks "Cerrar sala"]
        │
        ▼
publishData("close", { reliable: true, topic: "room-closed" })
  → All participants receive DataReceived event with topic="room-closed"
  → Each participant calls room.disconnect() and redirects to "/"
  → LiveKit room becomes empty → auto-destroys after emptyTimeout
```

---

## Permission Model

Permissions are encoded as LiveKit JWT grants, minted server-side in `api/join-room/+server.ts`. The client never gets to choose its own permissions — it only submits a `role` string, which the server maps to a fixed grant set.

### Grant Matrix

| JWT Grant | Master | Player | Notes |
|---|---|---|---|
| `roomJoin` | ✅ | ✅ | Required to enter the room |
| `canPublish` | ✅ | ✅ | Can send audio/video tracks |
| `canSubscribe` | ✅ | ✅ | Can receive others' tracks |
| `canPublishData` | ✅ | ✅ | Can send DataChannel messages |
| `canPublishSources` | camera, microphone, screen_share, screen_share_audio | camera, microphone | Controls which media sources are allowed |
| `roomAdmin` | ✅ | ✗ | Allows server-side kick operations |

### Identity Collision Prevention

Participant identity is `${participantName}-${Date.now()}`. This ensures two players with the same display name (e.g. both named "Ana") get distinct identities in LiveKit. The `name` field (what appears in the UI) is set to `participantName` alone for a clean display.

### Why Role Is Not a Security Boundary in the URL

The invite URL (`/sala/<roomId>`) intentionally contains no role information. A player cannot grant themselves Master privileges by modifying the URL because:
1. The `role` param only exists in the Master's auto-redirect URL (`?role=master&name=Master`)
2. Even if a player sent `role=master` in the join-room request, they would get a JWT with `roomAdmin=true` — **but the LiveKit room itself does not restrict who can join with admin grants**
3. The real security boundary is the `LIVEKIT_API_SECRET`, which only the server knows; without it, no one can mint valid JWTs

For the threat model of a casual RPG session, this is acceptable. For a production app with stricter access control, the server should validate room membership before minting admin tokens.

---

## DataChannel Protocol

RolCall uses LiveKit's DataChannel API for all application-level messaging. Messages are broadcast to all participants in the room (`destinationIdentities` is omitted, meaning broadcast).

All messages use `reliable: true` (TCP-like delivery guarantee over the DataChannel).

### Message Format

Messages are UTF-8 encoded strings. The `topic` field (a LiveKit DataChannel feature) distinguishes message types.

#### `chat` — In-session text message

```
topic:   "chat"
payload: JSON string → { sender: string, text: string }
direction: any participant → all
```

Example:
```json
{ "sender": "Aragorn", "text": "I cast Fireball!" }
```

The receiver appends a timestamp on arrival (`new Date().toLocaleTimeString('es-ES', ...)`). Timestamps are local to each client — there is no server-side clock synchronization.

#### `kick` — Eject a participant

```
topic:   "kick"
payload: plain UTF-8 string — the target participant's identity (e.g. "Aragorn-1712345678901")
direction: master → all
```

Each participant checks if the payload matches `room.localParticipant.identity`. If it matches, that participant calls `room.disconnect()` and sets the `error` state to show a "kicked" message.

Note: `roomAdmin=true` in the master's JWT also allows server-side participant removal via LiveKit's REST API, but RolCall uses DataChannel kick instead, which is purely client-enforced. A determined participant could ignore the kick message. For a casual app this is acceptable.

#### `room-closed` — Close the room for everyone

```
topic:   "room-closed"
payload: plain UTF-8 string — "close"
direction: master → all
```

All participants (including the master, after a 500ms delay) call `room.disconnect()` and navigate to `/`.

### Why DataChannel Instead of Server API Calls

For chat and kick, using the DataChannel is simpler and faster than routing through the server. There is no need for a persistent message store, and the round-trip for a chat message is:

```
sender.publishData() → LiveKit SFU → receiver.DataReceived event
```

vs. a server-round-trip:

```
sender → POST /api/chat → server → push to all clients
```

The DataChannel path is lower latency and requires no additional server infrastructure.

---

## Video Grid Layout Strategy

The video grid in `sala/[roomId]/+page.svelte` uses CSS Grid with a dynamically computed `grid-cols-*` class.

### Normal Mode (no screen share)

The `gridCols(count)` function returns the appropriate Tailwind class:

| Participants | Class | Layout |
|---|---|---|
| 1 | `grid-cols-1` | Single full-width tile |
| 2 | `grid-cols-1 md:grid-cols-2` | Stacked on mobile, side-by-side on desktop |
| 3–4 | `grid-cols-2` | 2×2 grid |
| 5–6 | `grid-cols-2 md:grid-cols-3` | 2 cols on mobile, 3 on desktop |

Each participant tile uses `aspect-video` to maintain a 16:9 ratio.

### Screen Share Mode

When a screen share track is active:
- The screen share video takes the main area (`flex-1`) with `object-contain`
- Participant tiles move to a thumbnail strip with `max-h-40 grid-cols-6` (horizontal scrollable row)
- Participant tiles lose their `aspect-video` constraint (height is capped by `max-h-40`)

### Track Attachment

LiveKit tracks are attached to DOM elements directly (`track.attach(videoElement)`), not through Svelte bindings. The flow is:

1. A LiveKit event fires (`TrackSubscribed`, `ParticipantConnected`, etc.)
2. `refreshParticipants()` updates the `participants` reactive array
3. Svelte re-renders the grid, creating `<video>` elements with `data-participant="N"` on their containers
4. `requestAnimationFrame(() => attachAllTracks())` runs after the DOM update
5. `attachAllTracks()` queries each `[data-participant="N"]` container and calls `track.attach(videoEl)`

This pattern is necessary because LiveKit's SDK works imperatively (it needs a real DOM element), not declaratively.

The local participant's video is muted (`muted={p === room?.localParticipant}`) to prevent audio feedback. Remote audio is attached to dynamically created `<audio autoplay>` elements appended inside each participant container.

---

## Security Considerations

### Credential Isolation

`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are loaded via `$env/static/private`, which SvelteKit inlines at build time and guarantees never appear in client bundles. Any attempt to import them in a `+page.svelte` or `+page.ts` (client-side) file causes a build error.

### JWT Scoping

Each JWT is scoped to:
- A single room (`room: roomId`)
- A single participant identity (`identity: "${name}-${Date.now()}"`)
- A fixed set of capability grants

Tokens do not expire by default in this implementation. For production use, consider setting `ttl` on the `AccessToken` (e.g., 1 hour).

### No Persistent Data

RolCall never writes to a database. The only state is:
1. The LiveKit room (managed by LiveKit Cloud, auto-expires)
2. In-memory reactive state in the user's browser tab (lost on refresh)

There is no PII stored anywhere, no session cookies, and no authentication system.

### Room ID Entropy

Room IDs are generated with `nanoid(10)` using nanoid's default alphabet (A-Za-z0-9, 64 characters). This yields `64^10 ≈ 1.2 × 10^18` possible IDs — effectively unguessable. There is no room listing or discovery mechanism; you can only join a room if you have the exact URL.

### Known Security Limitations

1. **Client-enforced kick**: The DataChannel kick is not server-enforced. A participant who modifies their client can ignore the kick message. True server-side removal requires calling LiveKit's REST API with admin credentials.
2. **Role escalation via URL param**: A player who sends `role=master` in the join-room request receives an admin JWT. This is acceptable for a casual app but should be addressed in a production scenario by validating room ownership server-side.
3. **No token expiry**: JWTs do not have a TTL set. A captured token remains valid indefinitely (or until the room expires).

---

## Future Considerations

### Move LIVEKIT_URL to Public Env

The WebSocket URL is currently hardcoded in `sala/[roomId]/+page.svelte`. It should be moved to `$env/static/public` (prefixed `PUBLIC_LIVEKIT_URL`) so it can be configured per-environment without a code change.

```ts
// vite.config.ts or .env
PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud

// sala/[roomId]/+page.svelte
import { PUBLIC_LIVEKIT_URL } from '$env/static/public';
await room.connect(PUBLIC_LIVEKIT_URL, token);
```

### Server-Side Kick

Replace the DataChannel-based kick with a LiveKit REST API call from the server:

```ts
// api/kick/+server.ts
await roomService.removeParticipant(roomId, participantIdentity);
```

This would make kick enforcement server-side and immune to client-side tampering.

### Token TTL

Add a `ttl` to `AccessToken` to limit the validity window of issued JWTs:

```ts
const token = new AccessToken(key, secret, { identity, name, ttl: '2h' });
```

### Participant Reactions / Raise Hand

A natural extension using the existing DataChannel infrastructure: add a `react` topic for emoji reactions or a `hand-raise` topic for the classic "raise hand" signal.

### Persistent Chat (Optional)

For groups that want a persistent record of the session chat, a simple append-only log endpoint could receive all chat messages. Since RolCall intentionally avoids a database, this would be a server-sent file or an external service (e.g., a Discord webhook).

### Room Password Protection

A simple password gate on the server side: `POST /api/join-room` could require a `password` field that is checked against an in-memory map of `roomId → hashedPassword`. Since rooms are ephemeral, the in-memory store is sufficient (no persistence needed).

### Component Decomposition

The room page (`sala/[roomId]/+page.svelte`) is currently a monolithic component (~365 lines). For larger feature additions, it would benefit from decomposition into:

- `VideoGrid.svelte` — participant grid + track attachment logic
- `ChatPanel.svelte` — chat UI and message state
- `ControlBar.svelte` — mic, cam, screen share, leave/close buttons
- `ScreenShareView.svelte` — full-screen share display
- `lib/livekit.ts` — `connectToRoom`, event handlers, DataChannel helpers
