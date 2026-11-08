## What and why

<!-- What does this change, and why? One or two plain sentences. Link the issue if there is one. -->

## Checks run

- [ ] `npm test` passes
- [ ] `node scripts/api.smoke.mjs http://127.0.0.1:8795` passes (needed for Worker, account, chat, skills and MCP changes)
- [ ] I followed the code rules: no build step, tokens only, SVG icons, no em or en dashes, all user text escaped
- [ ] I did not commit generated data (`data/raw/`, `data/cache/`, `public/data/videos.json` and the other catalog files) or secrets

<!-- If you skipped a check, say which one and why. -->

## Screenshots

<!-- Required for UI changes: 390px and 1280px wide, dark and light if you can. Delete this section for changes with no UI. -->

## Notes for the reviewer

<!-- Anything the owner should test on the build machine, such as a change that needs the real catalog. -->
