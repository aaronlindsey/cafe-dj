# Café DJ

Take a photo of your coffee (or describe it) and get a Spotify playlist
generated to match the vibe — dropped into your account automatically. Two
authenticated users share a public history feed of what they've each been
drinking.

Stack: a single Cloudflare Worker (Hono) serving static HTML/JS/CSS and a
handful of API routes, with a D1 (SQLite) database for users + entries.
Gemini 3 Flash is the brain; Spotify Web API is the hands.

> The full design rationale lives in [PLAN.md](./PLAN.md). The build journal
> (decisions made during implementation, bugs hit, deviations from plan) is
> in [IMPLEMENTATION.md](./IMPLEMENTATION.md).

---

## How it works

```
[User] ──photo or text──► [Worker /api/generate]
                                   │
                                   ├─► /me/top/artists  ┐
                                   ├─► /me/top/tracks   ├─ Spotify (parallel)
                                   ├─► recent artists from D1 (exclusion list)
                                   │
                                   ├─► Gemini 3 Flash (multimodal, JSON schema)
                                   │   returns: {coffeeSummary, vibeSummary,
                                   │             playlistName, description,
                                   │             10-12 tracks, 6-10 artists}
                                   │
                                   ├─► /search?type=track  (resolve each track)  ┐
                                   ├─► /search?type=artist + /artists/.../top-tracks  ├ parallel
                                   │   (fallback when titles hallucinate)             ┘
                                   │
                                   ├─► curate to ~12 unique URIs (no back-to-back artists)
                                   │
                                   ├─► POST /me/playlists (create)
                                   ├─► POST /playlists/{id}/items (add tracks)
                                   ├─► INSERT entry into D1
                                   │
                                   └─► return { playlistId, summaries, name } ──► UI renders Spotify embed
```

A separate `GET /api/feed` returns the last 50 entries (both users) without
authentication, so anyone with the URL can see history and play the embeds.

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | — | Sign-in or generate page |
| GET | `/feed` | — | Public history feed |
| GET | `/auth/login` | — | Start OAuth |
| GET | `/auth/callback` | — | Finish OAuth, set session cookie |
| GET, POST | `/auth/logout` | — | Clear session |
| GET | `/api/me` | session | `{ spotifyId, displayName }` |
| POST | `/api/generate` | session | Body `{ inputType, text?, image? }` |
| GET | `/api/feed` | — | Last 50 entries from both users |

### Data

Two tables in D1, schema in [`schema.sql`](./schema.sql):

- **`users`** — `spotify_id`, `display_name`, OAuth tokens, expiry. Refreshed
  in place by `getValidToken()` whenever the token is within 60s of expiring.
- **`entries`** — one row per generated playlist. Stores summaries,
  `playlist_id`, and `artists_used` (JSON array — used to exclude recently-
  suggested artists from the next generation for the same user).

---

## Local development

### One-time setup

```bash
git clone <this repo>
cd coffee-thing
npm install
```

Create `.dev.vars` with your secrets:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
GEMINI_API_KEY=...
SESSION_SECRET=...   # generate: openssl rand -hex 32
```

Apply the database schema to the local D1 simulator:

```bash
npm run db:local
```

In the Spotify Developer Dashboard, on your app:

1. **Edit Settings** → Redirect URIs → add `http://127.0.0.1:8787/auth/callback`.
   (Use the IP literal, not `localhost` — Spotify exact-matches.)
2. **Settings → User Management** → add the email of every Spotify account that
   should be allowed to sign in (including yours). Without this, both creating
   playlists and adding tracks will 403 in dev mode.

### Running

```bash
npm run dev
```

Opens at <http://127.0.0.1:8787>. Hot-reloads on source edits. Logs print to
the terminal — playlist creation errors and Gemini diagnostics show up here.

### Reset local state

```bash
rm -rf .wrangler/state
npm run db:local
```

### Inspecting D1 locally

```bash
npx wrangler d1 execute coffee-thing-db --local --command="SELECT spotify_id, display_name FROM users"
npx wrangler d1 execute coffee-thing-db --local --command="SELECT id, user_display, playlist_name, datetime(created_at,'unixepoch') AS at FROM entries ORDER BY created_at DESC LIMIT 10"
```

### Type checking

```bash
npm run typecheck
```

---

## Deploying to production

### One-time setup

1. **Create the D1 database**:
   ```bash
   npx wrangler d1 create coffee-thing-db
   ```
   Copy the `database_id` from the output and paste it into `wrangler.toml`,
   replacing the placeholder UUID.

2. **Apply the schema to remote D1**:
   ```bash
   npm run db:remote
   ```

3. **Set production secrets**:
   ```bash
   npx wrangler secret put SPOTIFY_CLIENT_ID
   npx wrangler secret put SPOTIFY_CLIENT_SECRET
   npx wrangler secret put GEMINI_API_KEY
   npx wrangler secret put SESSION_SECRET
   ```

4. **First deploy** to provision the Worker:
   ```bash
   npm run deploy
   ```

5. **Add a custom domain** in the Cloudflare dashboard:
   Workers → coffee-thing → Settings → Triggers → Custom Domains →
   `coffee.lindsey.fyi` (or whatever you choose). Cloudflare provisions
   DNS + SSL automatically.

6. **In Spotify Dashboard** add the production redirect URI:
   `https://coffee.lindsey.fyi/auth/callback`. Add both users' Spotify-account
   emails under User Management.

### Subsequent deploys

```bash
npm run deploy
```

If you change `schema.sql`, also run `npm run db:remote`.

---

## Troubleshooting

**OAuth callback returns "Invalid state"** — your `oauth_state` cookie expired
(10-min lifetime) or you're using a different browser tab than the one that
started login. Click sign-in again.

**`POST /me/playlists` returns 403** — the signing-in Spotify account is not
on the app's User Management list. (Even the app owner has to be on it for
dev-mode apps.) Add the email and sign back in.

**`POST /playlists/{id}/items` returns 403** — same User Management issue, or
your code is hitting the deprecated `/playlists/{id}/tracks` (replaced
Feb 2026 with `/items`).

**Gemini call fails with 4xx** — check the `GEMINI_API_KEY` is current and
that the model name in `src/gemini.ts` (`gemini-3-flash-preview`) is still
listed in `https://generativelanguage.googleapis.com/v1beta/models`.

**Tracks don't resolve** — `searchTrack` returns `null` when Gemini hallucinates
a song. The artist-fallback path (`searchArtistTopTracks`) usually fills the
gap. If the final list is consistently short, tighten the system prompt's
"only suggest tracks you're sure are real" line.

**A playlist disappears from the feed** — Spotify deleted from the user's
account. The DB entry stays; the iframe shows Spotify's "content unavailable"
placeholder. There's no automatic cleanup.

---

## Project layout

```
coffee-thing/
├── src/
│   ├── index.ts          # Hono app + routes + /api/generate pipeline
│   ├── auth.ts           # OAuth, session signing, requireSession middleware
│   ├── spotify.ts        # Spotify Web API wrappers
│   ├── gemini.ts         # Prompt, JSON schema, callGemini, context block
│   ├── curate.ts         # Track de-dup + no-repeat-artist
│   ├── db.ts             # D1 query helpers
│   └── types.ts          # Env, session, row types
├── public/
│   ├── index.html        # generate page
│   ├── feed.html         # public feed
│   ├── app.js            # generate-page frontend
│   ├── feed.js           # feed-page frontend
│   └── styles.css
├── schema.sql
├── wrangler.toml
├── tsconfig.json
├── package.json
├── .dev.vars             # gitignored
├── PLAN.md               # original design doc
├── IMPLEMENTATION.md     # build journal
└── README.md
```
