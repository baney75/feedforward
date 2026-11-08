# Security policy

Feedforward is a small open-source project run by one person. It still takes security seriously, because people sign in, comment, chat and connect agents.

## Report a vulnerability

Report it privately through GitHub:

1. Go to the [Security tab](https://github.com/baney75/feedforward/security) of this repository.
2. Choose **Report a vulnerability**.
3. Describe what you found, how to reproduce it and what it lets an attacker do.

Please do not open a public issue or pull request for a vulnerability, and please do not test against other people's accounts. Make your own test accounts. They are free and need no email.

There is no security email address. GitHub private reporting is the only channel.

## Supported versions

Only the live site (https://feedforward.dbaney.com) and the `main` branch are supported. There are no numbered releases and no back-ported fixes. The live site runs `main`.

## What to expect

This is volunteer work, so these are goals and not guarantees.

- An acknowledgment within 7 days.
- A first assessment (confirmed, not a bug, or need more detail) within 14 days.
- A fix or a clear plan within 30 days for a confirmed high-severity issue. Lower-severity issues are fixed as time allows.
- Credit in the fix, if you want it. Tell us how to name you.

There is no bug bounty.

## In scope

- The Worker (`worker/`): accounts, sessions, roles, comments, chat, sessions, skills, tokens and the MCP server.
- The static app (`public/`), including the service worker and the labs.
- Anything that exposes another person's data, lets someone act above their role, or bypasses a limit that protects people.

## Out of scope

- **Rate-limit tuning.** Whether a limit should be 10 or 20 is a product choice. A way to bypass a limit entirely is in scope.
- **Self-XSS.** Anything that needs the victim to paste code into their own browser console or address bar.
- Volume-based denial of service.
- Issues in services we link to or load but do not run: YouTube, X, Cloudflare, Jitsi, jsDelivr and Hugging Face.
- Reports from automated scanners with no demonstrated impact.

## The security model, in plain words

This is a summary of how the code works today, so you know what to test. The source is in `worker/` and `migrations/`.

### Accounts have no passwords

An account is a **code**: four words and two digits, like `otter-maple-rocket-acorn-42`. The Worker picks it from a list of 1,115 words, so there are about 1.5 x 10^14 possible codes (accounts from before the change keep their three-word codes). The code is shown once. There is no email.

- Codes are stored only as `SHA-256(PEPPER + code)`. The pepper is a server-side secret that lives outside the repo and outside the database. Local development reads it from `.dev.vars`, which is gitignored.
- Sign-in returns a **session token**: 40 random characters. Only its SHA-256 hash is stored. The token travels in an `Authorization: Bearer` header, not in a cookie, so another site can't ride a session. (The WebSocket chat takes it as a `t.<token>` subprotocol, because browsers can't set headers there.)
- Rotating your code deletes every other session. Banning a user deletes all their sessions.
- The browser keeps your token and code in `localStorage` on your device. Anyone with your device and your code can sign in as you. Treat the code like a password.

### Invite-only

Feedforward is invite-only. `worker/gate.js` holds the rules.

- **What's public:** the app shell and its link previews, icons, the front-door endpoints (`/api/account`, `/api/login`, `/api/logout`, `/api/gate`, `/api/pow`, `/api/apply`, `/api/invite/<code>`), live counts (`/api/pulse`), health and OAuth. Everything else under `/api/*`, the catalog files under `/data/*`, the labs under `/labs/*` and `/mcp` without a token answer 401 to non-members.
- **The gate cookie:** sign-in sets `__Host-ff_gate`, an HMAC-signed `user.expiry` value (7 days, `HttpOnly`, `Secure`, `SameSite=Lax`), so static files and lab iframes can be gated. It only unlocks reads. Every change still needs the Bearer session, so the cookie adds no CSRF surface. A Bearer session (or a chat socket's `t.<token>`) also counts as a member. Member-only files are sent `Cache-Control: private`.
- **Joining** needs a staff invite or a member's referral link. A member's link brings in at most 5 people a day (contributors 10, mods 25, admins 100, the owner no cap). Staff invites can grant a role below the maker's own, plus (admins only) a teaching role and the check; the grant is checked again against the maker's role when the invite is used, and limited invites take each use atomically.
- **Applying:** without an invite, a person applies. They get their code at once; it's stored hashed on the application and becomes their account's code when a mod or admin approves, so no email is needed. Until then, signing in with it says the application is pending.
- **Bots:** joining, applying and signing in each need a proof of work: a signed challenge from `/api/pow` (single use, 10 minutes) and a nonce whose SHA-256 starts with 18 zero bits, about a second of a phone's time. Joining also refuses work less than 2 seconds old and applying less than 4, so a script can't fill the form instantly. A hidden honeypot field rejects form-fillers, and the per-network limits below still apply.

### Rate limits

Writes are limited by IP address, by user, or both. Counters are fixed windows stored in D1, keyed by IP address or user id. Examples:

| Action | Limit |
| --- | --- |
| New accounts | 5 per hour per IP |
| Sign-in attempts | 10 per 15 minutes per IP |
| Comments | 8 per 10 minutes and 60 per day, per user |
| Chat | 1 message every 2.5 seconds per user |
| Likes, ratings | 300 and 200 per hour per user |
| Suggestions | 10 per day per user |
| Shared skills | 5 per day per user |
| Avatar uploads | 10 per hour per user |
| Code rotation | 5 per day per user |
| Agent token creation | 10 per day, and at most 10 tokens per user |
| MCP calls | 120 per hour per IP without a token, 600 per hour per token |

### Roles

Roles are ranked: Learner < Contributor < Moderator < Admin < Owner. Nobody can act on a person at or above their own rank, and nobody can change their own account.

| Role | What it can do beyond a Learner |
| --- | --- |
| Learner | Like, rate, comment, chat, suggest, share a skill (it waits for review), make agent tokens, join live sessions. Comments with links wait until the account is a day old. |
| Contributor | Publish skills without review. Post links on day one. No moderation powers. |
| Moderator | Hide, unhide and delete comments and chat messages from lower ranks. Ban and unban users below them. Remove an avatar. Approve, decline or delete skills. Cancel live sessions. Read the moderation queue. Can't change roles. |
| Admin | Everything a moderator can do, plus: give the Learner, Contributor and Moderator roles, set the verified check, approve or decline suggestions, make invite links, name professors. |
| Owner | Everything an admin can do, plus naming admins. |

Teaching roles sit beside these. A **professor** (named by an admin or the owner) can name tutors and host live sessions. A **tutor** can host live sessions. Session links must be `https`; anything else is replaced with a Jitsi room.

Role changes, bans, hides, comment deletes and chat message deletes by staff are written to a moderation log. Three reports from different people hide a comment until a moderator looks.

### The chat identity header

Chat runs in a Cloudflare Durable Object, one per room. The room learns who you are from an `x-ff-user` header. **Only the Worker sets it.** Before forwarding a chat connection, the Worker deletes any `x-ff-user` the client sent, then sets the header itself from your verified session. Visitors with no valid session, and banned users, get no identity and can read but not post. A forged header gets read-only chat. `scripts/api.smoke.mjs` tests this.

### Agent (MCP) tokens

Agents connect to `/mcp` with a member's personal token, or to `/mcp/me` through OAuth. Calls with no token are refused, because Feedforward is invite-only.

- Tokens look like `ffk_` plus 40 random characters. They are shown once, then stored only as a SHA-256 hash.
- Each token has a **scope**: `read` or `write`. `write` only allows saving items to your own library.
- You can revoke a token at any time and it stops working at once. A banned user's tokens stop working too.
- An `ffk_` token works only on `/mcp`. The account API does not accept it.
- The MCP server has no tool to comment, chat, moderate, make tokens or change an account. Agents can't post, chat or moderate.
- The MCP endpoint refuses requests that carry an `Origin` header for another site, so a web page can't drive it with a stored token.

See [docs/AGENTS.md](docs/AGENTS.md).

### Avatars

Avatars must be PNG, JPEG or WebP, 300,000 bytes or less. SVG is refused. The Worker checks the declared content type and the size, stores the file in R2 under a random key, and serves it from `/u/a/<key>` with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'` and a long immutable cache. Replacing an avatar deletes the old file.

### User text

Names, comments, chat messages, suggestions and skill summaries are stripped of control and invisible direction characters and length limited on the server. A word-list filter blocks off-topic politics and profanity, and also checks the body of a shared skill. Every client view escapes user text before rendering it, and shared skills are always displayed as plain text. The word lists are a moderation aid, not a security control.

### Privacy and trackers

- No analytics, no ad code and no third-party tracking scripts. The app sets no cookies of its own.
- History, saved items and progress stay on your device unless you sign in. If you do, they sync to your account.
- The page does load some outside content: thumbnails from YouTube and X image hosts, videos from `youtube-nocookie.com` when you press play, and a pinned library from jsDelivr or model files from Hugging Face when you open a lab that needs them.
- Cloudflare serves the site. Worker observability is on at 10 percent sampling.
- The rate limiter keeps counters keyed by IP address in D1.

## Safe harbor

If you follow this policy, test only with your own accounts, avoid harming other people's data and give us a reasonable time to fix the issue, we will not pursue action against you for good-faith research.
