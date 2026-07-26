# Shikaar

Type a phone, get a wall of real-user photos pulled from the communities you
choose. Text posts filtered out server-side.

This is the V1 build described in `Shikaar-PRD.docx` — the two-tier shape from
§6.1: a static frontend and a thin backend proxy, because §2.3 already proved a
browser-only build can't read Reddit.

```
public/index.html   the whole frontend. one file, no build step, no framework
lib/reddit.js       the source adapter. Path 1 + Path 2 behind one interface
lib/api.js          request validation, shared by both deploy targets
api/search.js       serverless entry point (Vercel)
server.js           local server, zero dependencies
test/               parsing tests — §8 flags this as the fragile part
```

---

## Run it

```bash
node server.js          # → http://localhost:3000
```

No `npm install`. Node 18+.

```bash
node --test test/       # 7 tests, no network needed
```

---

## Getting live results

**Read this part.** It's the difference between the app working and the app
returning empty sheets.

### Path 1 — public JSON (default)

Works with zero setup. Reddit's public `.json` endpoints, called from the
backend. Good enough to validate the product on your own machine.

It will **not** hold up on a deployed server. Reddit now blocks most datacenter
IPs on the public path, so a fresh Vercel deploy typically returns `403` on
every community. The app degrades honestly — you'll see a red chip per
community saying exactly that — but you won't get results.

### Path 2 — OAuth (do this before you deploy)

PRD §6.3 calls this the production path. It takes about two minutes.

1. Go to <https://www.reddit.com/prefs/apps> → **create another app**
2. Type: **web app**. Redirect URI: `http://localhost:3000` (unused, but required).
3. Copy the client ID (under the app name) and the secret.
4. Set three environment variables:

```bash
REDDIT_CLIENT_ID=xxxxxxxxxxxx
REDDIT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
SHIKAAR_USER_AGENT="web:shikaar:1.0.0 (by /u/your_username)"
```

That's it. `lib/reddit.js` detects the credentials, fetches an app-only token,
and switches to `oauth.reddit.com`. No other file changes — which is the point
of keeping the source layer swappable.

The header badge tells you which path is live: `live · oauth` or `live · public`.

`SHIKAAR_USER_AGENT` matters on both paths. Reddit blocks generic agents.

---

## Deploy

```bash
npm i -g vercel
vercel                                    # first deploy
vercel env add REDDIT_CLIENT_ID
vercel env add REDDIT_CLIENT_SECRET
vercel env add SHIKAAR_USER_AGENT
vercel --prod
```

Vercel picks up `public/` as static assets and `api/search.js` as a function
with no extra config. Any host that runs Node works too — point it at
`server.js`.

---

## API

```
GET /api/search?sub=IndiaTech,indiasocial&q="finally bought"&sort=new&t=month
```

| Param | Values | Default |
| --- | --- | --- |
| `sub` | comma-separated community names, max 12 | required |
| `q` | search terms; supports quoted phrases and `OR` | empty → newest photo posts |
| `sort` | `new` `top` `relevance` `hot` `comments` | `new` |
| `t` | `hour` `day` `week` `month` `year` `all` | `month` |
| `limit` | 5–100 per community | 50 |
| `galleries` | `1` → only posts with 2+ photos | `0` |
| `nsfw` | `1` → include over-18 posts | `0` |
| `ping` | `1` → health check | — |

Response:

```json
{
  "ok": true,
  "mode": "oauth",
  "cached": false,
  "subs": ["IndiaTech", "indiasocial"],
  "errors": [{ "sub": "PhonesIndia", "message": "404 — community not found" }],
  "results": [{
    "id": "t3_1abcxyz",
    "title": "Papa gifted me this on my 18th birthday",
    "source": "reddit:IndianTeenagers",
    "thumb": "https://i.redd.it/m1-640.jpg",
    "images": ["https://i.redd.it/m1.jpg", "https://i.redd.it/m2.jpg"],
    "count": 2,
    "ratio": 1.3333,
    "score": 4821,
    "created": 1785055454,
    "link": "https://www.reddit.com/r/IndianTeenagers/comments/1abcxyz/papa_gifted/"
  }]
}
```

`errors` is never fatal. A failing community becomes a chip in the UI; the rest
of the sheet still renders (FR-11).

---

## Where each requirement lives

| | | |
| --- | --- | --- |
| FR-1 | Search input, Hunt button, Enter-to-search | `index.html` → `hunt()` |
| FR-2 | Preset chips, composed into real Reddit query syntax | `PRESETS`, `buildQuery()` |
| FR-3 | Multi-select picker + add any community | `COMMUNITIES`, `renderPicker()` |
| FR-4 | Parallel query, merge, de-duplicate | `reddit.js` → `Promise.allSettled`, `seen` set |
| FR-5 | Image/gallery only, filtered server-side | `reddit.js` → `normalise()` drops `is_self` |
| FR-6 | 2+ photos toggle | `galleries` param, applied server-side |
| FR-7 | Sort and time controls | `.seg` groups |
| FR-8 | Thumbnail, title, community, score, age, frame count | `card()` |
| FR-9 | Every result opens the original post in a new tab | `target="_blank" rel="noopener"` |
| FR-10 | Mobile-first, installable | `manifest.webmanifest`, `sw.js` |
| FR-11 | Per-community error isolation | `errors[]` → `.fault` chips |
| FR-12 | Caching | LRU+TTL in `reddit.js`, `Cache-Control` in `api/search.js` |
| FR-13 | Mark keepers, survives reload | `S.marked`, chinagraph circle |
| FR-14 | Export | **not built** — Phase 3 |

§6.4's internal schema is enforced in one function (`normalise`). A second
source — Instagram, a forum, anything — means one new file exporting the same
shape. The frontend doesn't change.

---

## Two things the PRD asks for that aren't here

- **FR-14, collection export.** Marked frames are kept, but there's no
  contact-sheet or link export yet. Phase 3.
- **A real service-worker offline story.** `sw.js` caches the shell so the app
  launches offline; searches always hit the network. Deliberate — stale results
  are worse than no results here.

## One thing worth deciding early

Marked frames currently live in `localStorage`, so they're per-device and vanish
if the browser clears storage. Phase 2 says "save/bookmark collections" — if
that's meant to survive across your phone and laptop, it needs accounts and a
database, which V1 explicitly rules out (§3.3). Worth confirming which you
actually want before building further on it.

---

## Legal posture (§9)

Shikaar links, it doesn't re-host. No image is copied or stored — `thumb` and
`images` are Reddit's own URLs, rendered directly from Reddit's CDN, and every
card links back to the original post with the author's community visible. Marked
frames store the link and metadata, not the picture.
