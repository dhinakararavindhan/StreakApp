# Chase 500

Daily cricket draft game (PWA). Draft an XI from spun squads, chase 500 in 50 overs.

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
