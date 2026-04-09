# 🎲 RolCall

> Voice and video calls for online tabletop RPG sessions.

RolCall is a minimalist, ephemeral video-call app built specifically for tabletop RPG groups. No accounts, no persistent rooms — just create a session, share the link, and start playing.

---

## Features

- 🎙️ **Voice & video** — up to 6 participants per room
- 🖥️ **Screen sharing with system audio** — Master can share maps, PDFs, or VTT boards with sound
- 💬 **In-session chat** — text chat alongside the video grid, no extra tab needed
- 👑 **Master controls** — kick players, copy invite link, close the room for everyone
- 🔗 **Invite by link** — players join without an account; they just enter their name
- 📱 **Responsive** — works on desktop and mobile browsers
- ♻️ **Ephemeral rooms** — no data persisted; rooms auto-destroy after 10 minutes empty

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [SvelteKit](https://kit.svelte.dev/) (Svelte 5 with runes) |
| Language | TypeScript (strict mode) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| Real-time | [LiveKit Cloud](https://livekit.io/) |
| Client SDK | [`livekit-client`](https://github.com/livekit/client-sdk-js) |
| Server SDK | [`livekit-server-sdk`](https://github.com/livekit/server-sdk-js) |
| Room IDs | [`nanoid`](https://github.com/ai/nanoid) |
| Build tool | Vite 8 |

---

## Prerequisites

- **Node.js 20+** (ESM support required)
- **npm 10+** (or pnpm / yarn equivalent)
- A **[LiveKit Cloud](https://cloud.livekit.io/)** account (free tier is sufficient)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-username/rolcall.git
cd rolcall
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` with your LiveKit Cloud credentials:

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

You can find these values in your [LiveKit Cloud dashboard](https://cloud.livekit.io/) → Project Settings → Keys.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## How It Works

```
Master                          SvelteKit Server                LiveKit Cloud
  │                                    │                              │
  ├──── POST /api/create-room ─────────►                              │
  │                                    ├── RoomServiceClient ─────────►
  │                                    │   createRoom(id, max=6)      │
  │◄─── { roomId } ────────────────────┤◄──────────────────────────── │
  │                                    │                              │
  ├──── POST /api/join-room ───────────►                              │
  │     { roomId, role: "master" }     ├── AccessToken (roomAdmin=✓) │
  │◄─── { token: JWT } ───────────────┤                              │
  │                                    │                              │
  ├──── room.connect(wss://..., token) ──────────────────────────────►
  │◄────────────────────────── WebRTC negotiation ───────────────────┤
  │                                    │                              │
  [Master copies link and shares it]   │                              │
  │                                    │                              │
Player                                 │                              │
  ├──── POST /api/join-room ───────────►                              │
  │     { roomId, role: "player" }     ├── AccessToken (roomAdmin=✗) │
  │◄─── { token: JWT } ───────────────┤                              │
  │                                    │                              │
  ├──── room.connect(wss://..., token) ──────────────────────────────►
  │◄────────────────────────── WebRTC negotiation ───────────────────┤
```

1. **Master** opens RolCall → clicks "Crear sala"
2. Server generates a unique 10-character room ID via `nanoid` and registers the room on LiveKit Cloud
3. Master is redirected to `/sala/<roomId>?role=master&name=Master` and auto-joins
4. Master copies the invite link and shares it with players
5. **Players** open the link, enter a display name, and click "Entrar a la partida"
6. Everyone is connected via WebRTC through LiveKit Cloud
7. When done, the Master clicks "Cerrar sala" — all participants receive a `room-closed` DataChannel message and are disconnected

---

## Project Structure

```
rolcall/
├── src/
│   ├── app.css                          # Tailwind CSS import
│   ├── app.html                         # HTML shell
│   ├── app.d.ts                         # SvelteKit global type declarations
│   ├── lib/
│   │   └── index.ts                     # $lib alias root (currently empty)
│   └── routes/
│       ├── +layout.svelte               # Global layout: dark theme wrapper
│       ├── +page.svelte                 # Home page: Master creates room
│       ├── api/
│       │   ├── create-room/
│       │   │   └── +server.ts           # POST: creates LiveKit room, returns roomId
│       │   └── join-room/
│       │       └── +server.ts           # POST: generates JWT with role-based grants
│       └── sala/[roomId]/
│           └── +page.svelte             # Room page: waiting room + call + chat
├── .env.example                         # Environment variable template
├── svelte.config.js                     # SvelteKit config (runes mode enforced)
├── vite.config.ts                       # Vite config (tailwindcss + sveltekit plugins)
├── tsconfig.json                        # TypeScript config (strict mode)
└── package.json
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server at http://localhost:5173 |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run check` | Type-check with `svelte-check` |
| `npm run check:watch` | Type-check in watch mode |

---

## Deployment

RolCall uses `@sveltejs/adapter-auto`, which auto-detects your deployment platform. To deploy:

### Vercel / Netlify / Cloudflare Pages
Deploy directly — `adapter-auto` will choose the right adapter automatically.

### Node.js server
Replace the adapter in `svelte.config.js`:

```bash
npm install @sveltejs/adapter-node
```

```js
// svelte.config.js
import adapter from '@sveltejs/adapter-node';
```

### Environment variables on production
Set the following on your hosting platform:

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret
```

> ⚠️ **Never expose your `LIVEKIT_API_SECRET` to the client.** These variables are only used server-side (SvelteKit API routes import them via `$env/static/private`).

---

## Security Notes

- JWT tokens are minted server-side and scoped to a single room + participant identity
- The `LIVEKIT_API_SECRET` is never sent to the browser
- Rooms auto-expire after 10 minutes with no participants
- Master permission (`roomAdmin`) allows kicking participants at the LiveKit level

---

## License

MIT
