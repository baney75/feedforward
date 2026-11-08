# Feedforward

- Check: `npm test` (catalog integrity, politics filter, learn content, lab contract, no em or en dashes, JS syntax, install metadata, Worker refresh). Done means it passes.
- UI changes: render at 390px and 1280px in dark and light (`node scripts/dev.mjs`, then a headless browser) and look at the screenshots. No horizontal overflow, no console errors.
- Design: one family (IBM Plex Sans, Plex Mono for numbers), tokens in `public/css/tokens.css`, one amber accent, three radii. UI icons are stroke SVGs from `public/js/icons.js`; no emoji as icons.
- Copy: plain American English. No em or en dashes. No hype words.
- Content rules: AI, computer science, GPUs, math and CAD/3D printing only. No politics, religion, ads or personal posts. Add people to `data/roster.json` with a one-line `why`; run `scripts/verify_roster.py` first.
- Data: run `scripts/pull_extras.py` first (people admins added on the site), then the crawl scripts, `scripts/classify.py`, then `npm run data`. Crawled and generated data are not in git (too large to review). They live on the build machine in `data/` and `public/data/`, with a backup at R2 `localtube-data/data.tar.gz` on the BarnLabs account. Labels are cached in `data/cache/class.json`; never delete it. CI skips the catalog tests when the data is absent; run `npm test` on the build machine before deploying.
- Deploy: `npm run deploy` (Cloudflare Worker `feedforward` on the BarnLabs account; the old `localtube` Worker only redirects, via `npm run deploy:redirect`), custom domain `feedforward.dbaney.com`). Confirm the live page after deploying.
