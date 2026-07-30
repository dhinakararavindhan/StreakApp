# Contributing to Nova CMS

Thanks for helping build the CMS the whole world can use.

## Getting started

```bash
npm install
npm run dev        # server with auto-restart at http://localhost:3000
npm test           # end-to-end suite against an in-memory database
node scripts/seed-demo.js   # fill a running server with demo companies
```

## Ground rules

- **Every change ships with tests.** The suite in `test/` runs the real HTTP API against an in-memory SQLite database — extend it, don't mock around it.
- **Respect the operating principles** at the bottom of [ROADMAP.md](ROADMAP.md) — zero-config first run, approval workflow integrity, cross-company isolation, hosted/headless parity, no lock-in.
- **Migrations must be automatic.** If you change the schema, add a guarded migration in `src/db.js` so existing databases upgrade on boot.
- Keep the stack lean: plain Express, plain SQL, vanilla-JS admin. Reach for a dependency only when it clearly earns its weight.

## Pull requests

Small, focused PRs with a clear description of behavior changes. CI (GitHub Actions) must be green.
