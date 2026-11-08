# Architecture

Feedforward is a static web app plus one Cloudflare Worker. The app has no framework and no build step. The Worker serves the app, runs the API, hosts chat, answers MCP calls and refreshes a small "fresh" feed on a timer.

Everything here is checked against the code in this repository. File paths are given so you can check it too.

## The picture

```
 Browser (static app, no framework)                     Build machine (not in git)
 +--------------------------------------+               +-----------------------------+
 | index.html + ES modules in public/   |               | data/roster.json (in git)   |
 | router, views, labs, lazy pages      |               |   verify_roster.py          |
 | localStorage: history, saves, token  |               |   crawl_youtube/shorts/x    |
 | service worker (offline, caches)     |               |   classify.py (Claude)      |
 +----------+------------------+--------+               |   check_embed.py            |
            |                  |                        |   npm run data              |
   /data/*.json            /api/*  /mcp  /u/a/*         +--------------+--------------+
   (static assets)         WebSocket chat                              | writes public/data/*.json
            |                  |                                       | and worker/sources.json
            v                  v                                       v
 +--------------------------------------------------------------------------------+
 | Cloudflare Worker "feedforward"  (worker/index.js)           npm run deploy    |
 |                                                                                |
 |  static assets (public/) <- everything not matched below                       |
 |  /api/*  -> api.js    accounts, likes, comments, staff, sessions, skills, tokens|
 |  /mcp    -> mcp.js    MCP server (Streamable HTTP, JSON-RPC)                    |
 |  /u/a/*  -> avatars from R2                                                     |
 |  cron every 10 minutes -> refresh()                                             |
 +-----+-----------+-----------+-------------+------------------------------------+
       |           |           |             |
       v           v           v             v
   D1 "DB"     R2 AVATARS   KV FRESH    Durable Object CHAT
   accounts,   avatar       "fresh"     ChatRoom, one per room
   comments,   images       feed        (WebSocket, last 200 messages)
   tokens, ...
```

## The static app

Everything the browser runs is in `public/`. It is plain HTML, CSS and ES modules served as written.

- `index.html` loads `css/tokens.css` and `css/app.css`, then `js/app.js` as a module. `css/pages.css` loads once, the first time a lazy page runs.
- `js/app.js` is the router, the shell (rail, tab bar, search, theme, install prompt) and the keyboard shortcuts. It uses the History API. Links on the same origin are intercepted and handled without a reload. Unknown paths fall back to `index.html` (`not_found_handling: single-page-application` in `wrangler.jsonc`, and the same fallback in `scripts/dev.mjs`).
- `js/views.js` holds the main views: Home, Watch, People, The Wire, Learn tracks and labs, Search, Library, About, Shorts and Books.
- `js/pages/*.js` are separate modules loaded with `import()` on demand: `me` (account and tokens), `chat`, `sessions`, `skills`, `agents`, `admin`, `profile`, `research`, `dictionary` and `repos`.
- `js/data.js` loads and ranks the catalog (below). `js/account.js` is the account client. `js/social.js` renders likes, star ratings and comments. `js/store.js` keeps local state in `localStorage` under `lt:` keys. `js/tv.js` is TV mode. `js/ui.js` and `js/icons.js` are shared helpers (`esc()`, badges, SVG icons). `js/cite.js` formats paper citations and is also imported by the Worker.
- Labs live in `public/labs/<slug>.js`, one module each, following [LABS.md](../LABS.md). `public/labs/dev.html` previews one. The Learn page and the checks read the lab list from `public/data/learn.json`.
- Design tokens are in `css/tokens.css`. Themes are set with `data-theme` on `<html>` and remembered in `localStorage`.

### The catalog: starter bundle first, full catalog behind it

`js/data.js` loads the catalog in two phases so the first screen paints fast.

1. **Starter bundle.** `load()` fetches `/data/home.json`, `/data/learn.json` and `/data/books.json` together. `home.json` holds all people, the build metadata, a slice of videos (the top 10 per person plus other high-scoring ones, up to about 1,100), up to 200 posts (the best 140 plus the latest 60) and 40 Shorts. The test suite caps it at 450 KB. Pages marked "fast" in `app.js` (Home, Learn, Labs, About, People, Books, Shorts and the lazy pages) render from this alone.
2. **Full catalog.** `loadFull()` then fetches `/data/videos.json`, `/data/posts.json` and `/data/shorts.json` and merges them in. Other pages wait for it, showing a loading state.
3. **Fresh items.** After the full catalog, the app fetches `/api/fresh` and merges items the Worker's cron found since the last build. They are marked `fresh` and a toast says how many arrived.

Videos are arrays, not objects, to keep the files small: `[id, title, seconds, views, timestamp, personIndex, topicIndex, q, score]`. There are nine topics, in this order: `foundations`, `local`, `agents`, `research`, `math`, `cs`, `systems`, `making`, `labs`. `q` (0 to 3) is the teaching-value label from Claude. `score` (0 to 100) comes from views relative to the channel's median, `q` and recency.

"For you" picks a person first, with equal odds for everyone, and then the best of a few random draws from that person's videos, so small channels aren't buried. Likes from `/api/stats` lift a video's score a little.

Research and Dictionary read `/data/papers.json` and `/data/glossary.json`. Each shows an empty state when its file is missing.

### The service worker

`public/sw.js` is registered on `load`, but not on `localhost` or `127.0.0.1`. It only handles GET requests.

| Request | Strategy | Cache |
| --- | --- | --- |
| Page navigations | Network first, falling back to the cached `/` | `lt-app-v3` |
| `/api/*` | Network first | `lt-data-v3` |
| `/data/*` | Serve the cached copy and refresh it in the background | `lt-data-v3` |
| `/fonts/*`, `/icons/*` | Cache first | `lt-app-v3` |
| Other app files | Network first | `lt-app-v3` |
| Thumbnails and avatars from `i.ytimg.com`, `pbs.twimg.com`, `yt3.googleusercontent.com`, `yt3.ggpht.com` | Serve cached, refresh in the background, keep at most 600 | `lt-img-v1` |

On install it pre-caches the app shell and the three starter data files. On activate it deletes only caches whose names start with `lt-` and are not current, so a lab's model cache (`transformers-cache`) survives updates. Navigations are refetched as a plain same-origin GET. Forwarding the browser's own navigation request got a 403 from the edge on 2026-11-07, and a test in `scripts/check.test.mjs` guards that.

## The Worker

`worker/index.js` is the entry point. `wrangler.jsonc` sets `run_worker_first` for `/api/*`, `/u/*`, `/mcp`, `/oauth/*`, `/.well-known/*`, `/join/*` and the member-only `/data/*` and `/labs/*`. `worker/gate.js` decides what is public (see SECURITY.md, Invite-only). Every other request is answered from the static assets in `public/`.

### Routes

| Path | Handled by | What it does |
| --- | --- | --- |
| `GET /api/fresh` | `index.js` | The fresh feed from KV, cached for 5 minutes |
| `GET /api/health` | `index.js` | Last update time, counts, cron cursor and source count |
| `GET /u/a/<key>` | `index.js` | An avatar from R2, with `nosniff` and a locked-down CSP |
| `/mcp` | `mcp.js` | The MCP server (see below) |
| `/api/*` | `api.js` | Everything else, matched by a small route table; unmatched paths get a JSON 404 |

The routes in `api.js`, grouped:

- **Account:** `POST /api/account`, `POST /api/login`, `POST /api/logout`, `GET` and `PATCH /api/me`, `POST /api/me/code` (rotate your code), `PUT /api/me/avatar`, `POST /api/sync`.
- **Community:** `POST /api/like`, `POST /api/rate`, `GET /api/stats` (cached at the edge for a minute), `GET` and `POST /api/comments`, `DELETE /api/comments/<id>`, `POST /api/comments/<id>/report|hide|unhide`, `GET /api/u/<id>` (public profile), `POST /api/suggest`.
- **Staff:** `GET /api/admin/users`, `POST /api/admin/users/<id>` (role, verified, ban, remove avatar), `GET /api/admin/feed`, `POST /api/admin/suggestions/<id>`, `POST /api/admin/invites`.
- **Chat:** `GET /api/chat/<room>`, a WebSocket upgrade.
- **Teaching:** `POST /api/teach/<id>`, `GET` and `POST /api/sessions`, `POST /api/sessions/<id>/rsvp|unrsvp|cancel`.
- **Skills:** `GET /api/skills`, `GET /api/skills/<id>`, `POST /api/skills`, `POST /api/skills/<id>/approve|decline|delete`.
- **Agent tokens:** `GET` and `POST /api/tokens`, `DELETE /api/tokens/<id>`.

Every handler authenticates from the `Authorization: Bearer` header (or the `t` query parameter, used by WebSockets), checks the caller's rank, rate limits writes and cleans user text. The rules are summarized in [SECURITY.md](../SECURITY.md).

### D1 (`DB`)

The schema is in `migrations/`. `0001_init.sql` creates the accounts and community tables. `0002_teach_skills_agents.sql` adds the rest.

| Table | Holds |
| --- | --- |
| `users` | Public id, hashed sign-in code, name, avatar key, role, verified flag, referral code, ban flag, and the teaching role (`teach`, added in 0002) |
| `sessions` | Hashed session tokens, with user, created and last-seen times and a device label |
| `userdata` | Synced history, saves, progress and streak days, one JSON blob per kind per user |
| `likes`, `ratings` | One row per user and item. Item keys look like `v:<video>`, `s:<short>`, `p:<post>`, `b:<book>`, `r:<paper>`, `l:<lab>`, `d:<term>`, `k:<skill>` and a few more |
| `comments`, `reports` | Comments with hidden and report-count fields, and who reported what |
| `invites` | Invite links from admins and the owner, with an optional verified check |
| `suggestions` | Suggestions from learners, with a status that admins set |
| `modlog` | Role changes, bans, hides and comment deletes |
| `rl` | Fixed-window rate-limit counters, keyed by IP or user |
| `sessions_live`, `rsvps` | Live teaching sessions and who is going |
| `skills` | Shared `SKILL.md` files with a pending, approved or declined status |
| `api_tokens` | Hashed agent tokens, each with a name, a scope and a last-used time |

`sessions` is login sessions. `sessions_live` is teaching sessions. They are unrelated.

### R2 (`AVATARS`)

Bucket `feedforward-avatars` holds avatar images under keys like `<userId>-<random>`. The Worker validates type and size on upload and serves them at `/u/a/<key>`.

### The ChatRoom Durable Object (`CHAT`)

`worker/chat.js` defines `ChatRoom`. There is one object per room, addressed by room name. The rooms are `general`, `local-ai`, `agents`, `research`, `making` and `help`, plus one per live session, named `s-<sessionId>`. `wrangler.jsonc` declares the class as SQLite-backed (migration tag `chat-v1`).

The Worker upgrades `GET /api/chat/<room>` after checking the room exists, strips any client-sent `x-ff-user` header and sets it from the verified session. The object accepts the WebSocket with hibernation, so it sleeps between messages. On connect it sends a `hello` with the last 100 messages. It keeps the last 200 messages in its own storage and broadcasts new messages, deletions and the connection count. Signed-in users can send up to 500 characters, one message every 2.5 seconds. Visitors can only read. A user can delete their own messages, and moderators can delete messages from lower ranks. When someone is banned, the Worker calls the object's `/kick` path in each of the six main rooms.

### KV (`FRESH`) and the cron

The catalog only changes when someone rebuilds it. The cron fills the gap for new uploads and posts. It runs every 10 minutes (`*/10 * * * *`) and calls `refresh()` in `worker/index.js`:

1. Read the `fresh` key from KV: `{ videos, posts, cursor, updated }`.
2. Take the next 10 sources from `worker/sources.json` plus any people admins added (the `people_extra` table), starting at the stored cursor, and move the cursor on. The list is generated from the roster by `scripts/build_sources.py`, so a full pass takes several runs.
3. For each source with a YouTube channel id, fetch the channel's public RSS feed (`youtube.com/feeds/videos.xml`). Skip Shorts and anything the word-list backstop blocks. For channels in `ai` mode, keep only titles that look technical.
4. For each source with an X account, fetch recent posts from the public fxtwitter API. Keep the person's own posts and self-replies only, at least 80 characters, technical-looking and not blocked by the word list. No API keys are needed for either source.
5. Merge into what was stored, drop videos older than 45 days and posts older than 21 days, keep at most 600 of each, and write the result back.

Fresh items get a guessed topic and a default score, and the next full build replaces them with model-reviewed ones. `worker/worker.test.mjs` runs `refresh()` against canned feeds.

### The old domain

`worker/redirect.js`, deployed with `wrangler.redirect.jsonc` as the Worker `localtube`, sends the old LocalTube address to the same path on `feedforward.dbaney.com`. It also serves a `/sw.js` that clears old caches and moves open pages to the new domain.

## The MCP server

`worker/mcp.js` implements an MCP server over Streamable HTTP at `POST /mcp`. It is stateless: each request is one JSON-RPC message and gets one JSON response. Batches and server-sent events are not supported. It answers `initialize`, `ping`, `tools/list` and `tools/call`.

It reads catalog files from the static assets (`home.json`, `learn.json`, `books.json`, `papers.json`, `glossary.json`) and caches them in memory for 10 minutes. Search and recommendations use the starter bundle in `home.json`, not the full catalog. Two tools read D1: `upcoming_sessions`, and `my_library` and `save` for the signed-in learner. Tokens are checked against `api_tokens`, and every call is rate limited. The tool list, scopes and limits are in [AGENTS.md](AGENTS.md).

## The data pipeline

The catalog is generated on a build machine and deployed as static assets. It is not in git. [CONTRIBUTING.md](../CONTRIBUTING.md) lists the commands. In order:

1. **Roster.** `data/roster.json` lists each person: a name, a topic, a YouTube handle and/or an X account, a `ytMode` (`all` or `ai`) and a one-line `why`. This file is in git.
2. **Verify.** `scripts/verify_roster.py` resolves every handle (yt-dlp for YouTube, fxtwitter for X) and writes `data/roster.resolved.json`. It exits with 1 if any fail.
3. **Crawl.** `crawl_youtube.py` and `crawl_shorts.py` save each channel's upload and Shorts lists with yt-dlp into `data/raw/yt/` and `data/raw/shorts/`. `crawl_x.py` saves recent posts from the public fxtwitter API into `data/raw/x/`. `yt_avatars.py` caches channel avatar URLs. Crawls skip anything already downloaded unless you pass `--force` (YouTube).
4. **Classify with Claude.** `classify.py` sends titles and posts to the `claude` command line tool in batches and records `[topic, q]` for each item in `data/cache/class.json`. Haiku labels video and Short titles. Sonnet labels posts. The topic can also be `off` for ads, politics, religion and personal content, which drops the item. The cache means a rerun only labels new items.
5. **Embed check.** `check_embed.py` asks YouTube's oEmbed endpoint whether each labeled, on-topic video can be embedded, and records the answer in `data/cache/embed.json`. Videos that can't be embedded, or are gone, are left out.
6. **Build.** `npm run data` runs `build_data.py` and then `build_sources.py`. `build_data.py` drops videos under 60 seconds, `off` items, uploads of `ai`-mode channels that are unlabeled or scored 0, anything the word-list backstop matches, and non-embeddable videos. It keeps posts with `q` of 2 or more (short ones only at 3) and at most 80 per person. It scores everything and writes `videos.json`, `posts.json`, `shorts.json`, `people.json`, `meta.json` and the starter bundle `home.json` into `public/data/`. `build_sources.py` writes `worker/sources.json` for the cron.
7. **Deploy.** `npm run deploy` runs the tests and then `wrangler deploy`, which uploads `public/` and the Worker together. `public/data/repos.json` comes from a separate script, `scripts/build_repos.mjs`.

## Checks

`npm test` runs `scripts/check.test.mjs` (catalog integrity when data is present, copy rules, syntax, lab contract, install metadata, service worker rule) and `worker/worker.test.mjs` (the cron refresh and the old-domain redirect). `scripts/api.smoke.mjs` runs end to end against a local Worker. `.github/workflows/check.yml` runs `npm test` on every pull request and on pushes to `main`. CI has no catalog data, so it skips the catalog tests.
