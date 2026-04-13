# AGENTS.md — RolCall AI Agent Guide

This file is the primary reference for AI agents working in this codebase. Read it before making any changes.

---

## Project Overview

**RolCall** is an ephemeral group video-call app for online tabletop RPG sessions.

- No database, no auth, no persistent state
- Master (admin) creates a room → shares a URL → players join by entering a name
- All real-time media and data goes through LiveKit Cloud via WebRTC
- The SvelteKit server only exists to mint JWT tokens and register rooms with the LiveKit API

---

## Stack and Key Dependencies

| Package | Version | Role |
|---|---|---|
| `svelte` | `^5.55.2` | UI framework (runes mode enforced) |
| `@sveltejs/kit` | `^2.57.0` | Full-stack framework |
| `tailwindcss` | `^4.2.2` | Utility-first CSS (v4 — no config file) |
| `@tailwindcss/vite` | `^4.2.2` | Tailwind v4 Vite plugin |
| `livekit-client` | `^2.18.1` | WebRTC client (browser) |
| `livekit-server-sdk` | `^2.15.1` | JWT minting + room management (server only) |
| `nanoid` | `^5.1.7` | Generates 10-char room IDs |
| `typescript` | `^6.0.2` | Language (strict mode) |
| `vite` | `^8.0.7` | Build tool |

**Tailwind v4 note**: Tailwind v4 does not use `tailwind.config.js`. Configuration is done via CSS custom properties or Vite plugin options. The only CSS file is `src/app.css` which contains `@import "tailwindcss"`.

---

## File Structure

```
src/
├── app.css                         # Single CSS file — just @import "tailwindcss"
├── app.html                        # HTML shell — standard SvelteKit shell
├── app.d.ts                        # Global type declarations (App namespace)
├── lib/
│   └── index.ts                    # $lib alias root — currently empty/unused
└── routes/
    ├── +layout.svelte              # Root layout: imports app.css, sets dark bg
    ├── +page.svelte                # Home page: Master creates a room
    ├── api/
    │   ├── create-room/
    │   │   └── +server.ts          # POST /api/create-room
    │   └── join-room/
    │       └── +server.ts          # POST /api/join-room
    └── sala/[roomId]/
        └── +page.svelte            # The entire call experience
```

### Route responsibilities

#### `+page.svelte` (home)
- Single "Crear sala" button
- On click: calls `POST /api/create-room`, then redirects to `/sala/<roomId>?role=master&name=Master`
- Master is auto-joined; they never see the "enter your name" screen

#### `api/create-room/+server.ts`
- Generates a 10-char room ID with `nanoid(10)`
- Creates the room on LiveKit via `RoomServiceClient`
- Config: `maxParticipants: 6`, `emptyTimeout: 600` (10 min)
- Returns `{ roomId }`

#### `api/join-room/+server.ts`
- Accepts `{ roomId, participantName, role }`
- Mints a LiveKit `AccessToken` with role-based grants (see Permission Model below)
- Identity is `${participantName}-${Date.now()}` (avoids collisions)
- Returns `{ token: JWT }`

#### `sala/[roomId]/+page.svelte`
- Three UI states: **waiting room** (player name entry), **in call**, **connecting/error**
- Masters auto-skip the waiting room (detected via `?role=master` URL param)
- Manages the LiveKit `Room` object and all event subscriptions
- Handles video/audio track attachment via direct DOM manipulation
- Contains chat, screen share display, participant grid, and control bar
- All DataChannel messaging (chat, kick, room-closed) is handled inline

---

## Key Patterns

### LiveKit Integration

The app uses LiveKit in two modes:

**Server-side** (`livekit-server-sdk`):
- `RoomServiceClient` — creates/manages rooms via the LiveKit REST API
- `AccessToken` — mints JWTs for client authentication
- Credentials come from `$env/static/private` (never exposed to the browser)

**Client-side** (`livekit-client`):
- `Room` object created in `connectToRoom()` with adaptive stream + dynacast enabled
- Video resolution: 1280×720 @ 24fps
- Event-driven: subscribes to `TrackSubscribed`, `ParticipantConnected`, `DataReceived`, etc.
- Audio/video elements are attached manually via `track.attach(element)` after `requestAnimationFrame`

### Role-Based Permissions

Roles are passed as URL query params and validated server-side when minting the JWT:

| Grant | Master | Player |
|---|---|---|
| `roomJoin` | ✅ | ✅ |
| `canPublish` | ✅ | ✅ |
| `canSubscribe` | ✅ | ✅ |
| `canPublishData` | ✅ | ✅ |
| `canPublishSources` | camera, mic, screen_share, screen_share_audio | camera, mic |
| `roomAdmin` | ✅ | ✗ |

**Important**: The `role` param in the URL is not a security mechanism — it only influences which JWT grants are requested. The JWT itself enforces the actual permissions.

### DataChannel Protocol

RolCall uses LiveKit's DataChannel (via `room.localParticipant.publishData`) for app-level messaging. All messages use the `reliable: true` delivery mode.

| Topic | Payload | Direction | Action |
|---|---|---|---|
| `chat` | JSON: `{ sender: string, text: string }` | any → all | Display in chat panel |
| `kick` | Plain text: participant identity string | master → all | Target disconnects if identity matches |
| `room-closed` | Plain text: `"close"` | master → all | All participants disconnect |

Received via `RoomEvent.DataReceived` handler in `handleDataReceived()`.

### Video Grid Layout

Grid columns are computed by `gridCols(count: number)`:
- 1 participant → `grid-cols-1`
- 2 participants → `grid-cols-1 md:grid-cols-2`
- 3–4 participants → `grid-cols-2`
- 5–6 participants → `grid-cols-2 md:grid-cols-3`

When screen sharing is active, participants move to a thumbnail strip (`max-h-40 grid-cols-6`) and the screen share gets the main area.

Track attachment is DOM-based: after each participant list refresh, `attachAllTracks()` queries `[data-participant="N"]` containers and attaches tracks to the `<video>` elements inside them.

---

## Environment Variables

All three variables are **server-only** — imported via `$env/static/private`. They must never appear in client-side code.

| Variable | Example | Description |
|---|---|---|
| `LIVEKIT_URL` | `wss://your-project.livekit.cloud` | WebSocket URL for LiveKit Cloud |
| `LIVEKIT_API_KEY` | `APIxxxxxxxx` | LiveKit project API key |
| `LIVEKIT_API_SECRET` | `xxxxxxxxxxxxxxxx` | LiveKit project API secret |

> **Note**: The `LIVEKIT_URL` is also hardcoded in `+page.svelte` for the client-side WebSocket connection (`room.connect('wss://your-project.livekit.cloud', token)`). If the project URL changes, update both `.env` and that hardcoded string.

---

## Build and Dev Commands

```bash
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Production build
npm run preview      # Preview production build
npm run check        # svelte-check type checking
npm run check:watch  # Type check in watch mode
```

---

## Known Issues

### Svelte 5 Runes Mode
The project forces runes mode globally in `svelte.config.js`:
```js
runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
```
This means all `.svelte` files must use the Svelte 5 runes API (`$state`, `$derived`, `$props`, etc.). The legacy Options API is disabled. Some `svelte-check` warnings may appear if any dependency ships Svelte components using the legacy API.

### Hardcoded LiveKit URL
`src/routes/sala/[roomId]/+page.svelte` line 96 hardcodes the WebSocket URL:
```ts
await room.connect('wss://your-project.livekit.cloud', token);
```
This should ideally be driven by the `LIVEKIT_URL` env var exposed as a public env var (`$env/static/public`). Currently it's a known tech debt item.

### Screen Share Audio Element Leak
`handleTrackSubscribed` appends an `<audio id="screen-share-audio">` element to `document.body`. If screen share is started/stopped multiple times rapidly, there could be lingering elements (though `handleTrackUnsubscribed` removes them by ID).

---

## Conventions

### UI Language
All UI text is in **Spanish**. Error messages, labels, button text, and placeholder text are in Spanish. Documentation (like this file) is in **English**.

### TypeScript
- Strict mode is enabled (`"strict": true` in `tsconfig.json`)
- Use explicit types for function parameters and return values
- Avoid `any` — use `unknown` and narrow with type guards
- SvelteKit-generated types are in `.svelte-kit/` — don't edit them

### Svelte 5 Runes
- State: `let foo = $state(value)`
- Derived: `let bar = $derived(expr)`
- Props: `let { prop } = $props()`
- DOM binding: `bind:this={element}` (still valid in Svelte 5)
- Events: `onclick={handler}` (not `on:click`)

### Tailwind CSS
- All styling via Tailwind utility classes — no custom CSS files beyond the single `@import`
- Dark theme: `bg-gray-950` body, `bg-gray-900` cards/panels, `bg-gray-800` inputs
- Accent: `indigo-600` (primary actions), `red-600`/`red-700` (destructive), `amber-600` (Master badge)
- Rounded corners: `rounded-xl` for cards, `rounded-lg` for inputs, `rounded-full` for icon buttons

### File Organization
- API routes in `src/routes/api/` — server-only, no Svelte components
- Room page is a single monolithic component — this is intentional for an app this size
- If adding new features, prefer adding to the existing room page component unless the feature warrants its own route or lib module

### Error Handling
- API errors return `{ error: string }` JSON with appropriate HTTP status codes
- Client-side errors display inline using the `error` reactive state variable
- Never `throw` uncaught errors in event handlers — always catch and set `error` state
