# Contributing to Feedforward

Feedforward is a free learning hub for AI, computer science, GPUs, math, CAD and 3D printing. The site is https://feedforward.dbaney.com. The code is MIT licensed and the owner is [Donovan Baney](https://dbaney.com).

Small, clear contributions are the best kind: one fixed bug, one new lab, one good person added to the roster. Read this page once, then open a pull request or an issue.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, use [SECURITY.md](SECURITY.md), not a public issue.

## Quick start

You need Node 24 (CI uses it). The app has no build step and no npm dependencies.

```sh
git clone https://github.com/baney75/feedforward.git
cd feedforward
npm run dev        # static preview at http://127.0.0.1:8790
```

`npm run dev` runs `scripts/dev.mjs`. It serves `public/` with a single-page-app fallback and an empty `/api/fresh`. It has no accounts, chat or MCP.

### The catalog is not in git

A fresh clone has no catalog data, and the app shell needs `public/data/home.json` to start. Until you build the data (see below), the main app shows "couldn't load its catalog". Two things work without it:

- Labs. Open `http://127.0.0.1:8790/labs/dev.html?lab=<slug>`. The preview page loads one lab module and nothing else.
- The checks. `npm test` skips the catalog tests when the data is absent.

### Run the Worker locally

To work on accounts, comments, chat, sessions, skills or the MCP server, run the real Worker with a local D1 database:

```sh
# 1. Apply the schema to a local D1 database (stored in .wrangler/)
npx wrangler@4.154.0 d1 migrations apply feedforward --local

# 2. Make a local secret. .dev.vars is gitignored.
echo "PEPPER=$(openssl rand -hex 32)" > .dev.vars

# 3. The Worker imports worker/sources.json, which is generated and gitignored.
#    An empty list is enough for local work.
echo '[]' > worker/sources.json

# 4. Start the Worker and the static assets together
npx wrangler@4.154.0 dev --port 8795
```

The repo pins wrangler 4.154.0 in `npm run deploy` and in `scripts/api.smoke.mjs`. Use the same version so the local database format matches.

`PEPPER` is mixed into every sign-in code hash (see [SECURITY.md](SECURITY.md)). Pick a new random value for each local setup. If you change it, existing local accounts stop working. That is fine.

Wrangler simulates D1, R2, KV and the ChatRoom Durable Object on your machine. Nothing touches the live site. Do not run `wrangler deploy`. The owner deploys.

## How the catalog data is built

The catalog is generated, large and changes every build, so it is not reviewed in git. These paths are in `.gitignore`: `data/raw/`, `data/cache/`, `data/roster.resolved.json`, `worker/sources.json`, and in `public/data/`: `videos.json`, `posts.json`, `people.json`, `meta.json`, `home.json`, `shorts.json`. The owner keeps the build output on the build machine, with a backup in R2.

What is in git: `data/roster.json` (the list of people), `public/data/learn.json` (tracks and labs) and `public/data/books.json`.

The pipeline, in order:

| Step | Command | Output |
| --- | --- | --- |
| 1. Roster | edit `data/roster.json` | the curated people, with YouTube handles and X accounts |
| 2. Verify | `python3 scripts/verify_roster.py` | `data/roster.resolved.json`; exits 1 if any handle fails to resolve |
| 3. Crawl videos | `python3 scripts/crawl_youtube.py` (and `crawl_shorts.py`) | `data/raw/yt/`, `data/raw/shorts/` (needs `yt-dlp`) |
| 4. Crawl posts | `python3 scripts/crawl_x.py` | `data/raw/x/` (public fxtwitter API) |
| 5. Classify | `python3 scripts/classify.py` | topic and teaching-value labels in `data/cache/class.json` |
| 6. Embed check | `python3 scripts/check_embed.py` | `data/cache/embed.json`; hides videos that can't be embedded |
| 7. Build | `npm run data` | `public/data/*.json` and `worker/sources.json` |

Notes:

- `classify.py` calls the `claude` command line tool (`claude -p`), Haiku for video and Short titles and Sonnet for posts. It needs that CLI installed and signed in. It strips `ANTHROPIC_API_KEY` from the environment on purpose.
- Labels are cached in `data/cache/class.json`, so a rerun only classifies new items. Never delete that file.
- `npm run data` also runs a word-list backstop that drops politics, religion and ads even if a label missed them.
- `scripts/build_repos.mjs` builds `public/data/repos.json` from a hand-picked list, using the `gh` CLI.
- You do not need to build the catalog to contribute. Most pull requests do not touch it. If your change needs real data, say so in the pull request and the owner will test it on the build machine.

## Suggest a person, video, book, paper or term

You do not need to write code to improve the catalog.

- **On the site:** if you have an account, use the Suggest form. Moderators and admins see it, and admins approve or decline each one.
- **On GitHub:** open a [Suggestion issue](https://github.com/baney75/feedforward/issues/new?template=suggestion.yml). Give the name or title, a link, and one sentence on why it teaches something real.

To add a person yourself, edit `data/roster.json`. Each entry needs a name, a topic code, a YouTube handle and/or an X account, and a one-line `why`. Run `python3 scripts/verify_roster.py` first and fix any handle that fails.

Good additions teach real skills. Channels that mix topics are filtered to AI and CS by the classifier.

## Content rules

Feedforward covers **AI, computer science, GPUs, math, CAD and 3D printing**. That is all.

- No politics, religion, ads, sponsorships or giveaways.
- No personal posts, drama or career advice.
- Books must be official free editions. Papers must link to the real paper.
- Facts must be right. Check numbers against a primary source.

Comments, chat messages and suggestions on the site are also screened for off-topic politics and profanity. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Code rules

These come from [AGENTS.md](AGENTS.md). Pull requests that break them will be sent back.

- **No build step.** Plain ES modules in `public/`, served as written. No bundler, no framework, no npm dependencies in the app.
- **Tokens only.** Colors, spacing, radii and fonts come from `public/css/tokens.css`. No hard-coded values. One family (IBM Plex Sans, Plex Mono for numbers), one amber accent, three radii.
- **SVG icons.** UI icons are stroke SVGs from `public/js/icons.js`. No emoji as icons.
- **No em or en dashes.** Anywhere: code, copy, comments, docs. `npm test` fails on them in the app, labs and Worker.
- **Plain copy.** American English, short sentences, no hype words such as "seamless", "unlock", "revolutionary" or "delve".
- **Escape all user text.** Anything a person typed (names, comments, chat, skills, suggestions) goes through `esc()` from `public/js/ui.js` before it reaches `innerHTML`. Skills are always shown as plain text.
- **Phone first.** Everything works at 390px wide with no sideways scroll. Tap targets are at least 40px.
- **Accessible.** Every control has a visible label. Keyboard works. Respect `prefers-reduced-motion`.
- **Worker rules.** Every write is rate limited and goes through `clean()` in `worker/api.js`. Staff actions are written to the mod log. Never store a code or token unhashed.

## Add a lab

A lab is one ES module, `public/labs/<slug>.js`, that exports `meta` and `mount(root, ctx)`. [LABS.md](LABS.md) is the full contract: layout, tokens, accessibility, content shape (interactive part, **What's happening**, **Try this**, one **Check** question) and the rule for third-party libraries (pinned exact version, loaded inside `mount`, with a loading state and an error message).

To add one:

1. Write `public/labs/<slug>.js`.
2. Add it to the `labs` list in `public/data/learn.json` so the checks and the Learn page know about it.
3. Preview it at `/labs/dev.html?lab=<slug>` in dark and light, at 390px and 1280px.
4. Run `npm test`. It checks that every lab in `learn.json` has a module with the right exports.

## Checks to run

```sh
npm test
```

This runs `node --test scripts/check.test.mjs worker/worker.test.mjs`. It covers catalog integrity (when data is present), the politics filter, learning tracks, books, the lab contract, no em or en dashes, JavaScript syntax, the service worker rule, install metadata and the Worker's cron refresh. CI runs it on every pull request.

If you changed the Worker, accounts, roles, chat, skills or MCP, also run the end-to-end smoke test against a local Worker (the steps above, on port 8795):

```sh
node scripts/api.smoke.mjs http://127.0.0.1:8795
```

It creates throwaway accounts and walks through roles, moderation, comments, teaching, skills, agent tokens, MCP and chat. It edits your local D1 database through `wrangler d1 execute`, so use the local one. Every line should print `ok`.

One limit on a fresh clone: the MCP search check looks up "karpathy" in `public/data/home.json`, which is part of the catalog and not in git. Without it that check fails and the script stops. If you can't build the data, say which checks ran in your pull request.

For any change you can see on screen, also render it at 390px and 1280px, dark and light, and look at it. No horizontal overflow, no console errors.

## Pull requests

- **Keep them small.** One change, one reason. Split unrelated fixes.
- **Say what and why.** The pull request template asks for it, plus the checks you ran.
- **Screenshots for UI changes.** At 390px and 1280px, ideally in dark and light.
- **Don't commit generated data** (the paths above) or secrets. Never commit `.dev.vars`.
- **The owner reviews and merges.** Expect questions. A pull request that follows the rules above and passes `npm test` moves fastest.
- Don't edit the live site's data or settings through the API as part of a pull request.

## The contributor role on the site

Contributor is a role on feedforward.dbaney.com for people who help build the catalog. An admin grants it. You can't request it in the app. Ask in a pull request or an issue after your first accepted contribution.

What it does today:

- A purple angle-bracket "Contributor" badge next to your name, with the note "Adds to the catalog."
- Skills you share with the community publish right away instead of waiting for a moderator.
- Comments from your account can include links on day one. New accounts wait 24 hours.

It does not give moderation powers. Moderators and admins are separate roles. See the role table in [SECURITY.md](SECURITY.md).
