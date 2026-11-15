# Chase 300 — Franchise T20

Daily franchise-T20 draft game (PWA). Draft an XI from spun franchise-season squads, chase 300 in 20 overs.

## Game modes
- **Batting challenge:** draft an XI (11 spins), chase **300** in 20 overs.
- **Bowling challenge:** draft 5 bowlers (4 overs each: 2 new-ball, 2 middle, 1 death) and hold the day's opponent (a squad from the pool, same for everyone) under **60**. Fewest runs conceded ranks first.
- Either daily challenge keeps the shared day streak alive. Leaderboards are separate per mode.
- `npm run tune` / `node scripts/tune-bowl.mjs` check balance for each mode.

## Dev
```
npm install
npm run dev            # frontend on :5173 (proxies /api to :8787)
npm run server         # backend on :8787
npm run tune           # balance check for the simulation
```

## Production (single Node process serves the PWA + API)
```
npm run build
npx web-push generate-vapid-keys        # once; keep the keys secret
VAPID_PUBLIC=... VAPID_PRIVATE=... VAPID_SUBJECT=mailto:you@example.com \
DB_FILE=/data/db.json PORT=8787 npm run server
```
Push needs HTTPS in production (localhost is exempt). Without VAPID keys the server runs, but reminders are disabled.

## How it works
- **Leaderboard anti-cheat:** the client sends only the 11 player names; the server re-runs the same seeded simulation (`src/sim.js`) and stores its own result. Illegal XIs (unknown player, wrong batting slot, duplicates) are rejected. One score per device per day.
- **Reminders:** each subscribed device is checked every 10 min; at `REMINDER_HOUR` (default 18:00 local) a push is sent if that device hasn't played today, mentioning the streak at risk.
- **Storage:** a single JSON file (`DB_FILE`). Swap for SQLite/Postgres if traffic grows.
- Device identity is an anonymous random ID, so leaderboard entries are not account-bound.

## Branding / legal notes
- No league, franchise nickname, logo, kit or team-colour branding is used: teams appear as city + year only.
- Player names are plain text for identification; no photos or likenesses. Ratings are fan estimates.
- Keep it free/non-commercial, avoid league names in the domain, store listing and keywords, and be ready to rename or swap in fictional players if asked. Consider a short consult with an IP lawyer before any commercial launch.
