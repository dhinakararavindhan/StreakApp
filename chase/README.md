# Chase 300 — Franchise T20

Daily franchise-T20 draft game (PWA). Draft an XI from spun franchise-season squads, chase 300 in 20 overs.

## Game modes
- **Batting challenge:** draft an XI (11 spins) and chase a target set by your **level**: level 1 = chase **200**, level 2 = 210 ... level 13 = **320** in 20 overs. Beating a level unlocks the next one; you can replay any level as often as you like.
- **Bowling challenge:** draft 5 bowlers (4 overs each: 2 new-ball, 2 middle, 1 death) and hold the day's opponent (a squad from the pool, same for everyone) under **50**. Fewest runs conceded ranks first.
- Either daily challenge keeps the shared day streak alive. Leaderboards are separate per mode.
- `node scripts/tune-super.mjs` checks the Super Over (about 10-11 runs each side, win about 40-50%).
- `npm run tune` (batting, win% per level; `N=200000 npm run tune` for tail precision) and `node scripts/tune-bowl.mjs` check balance. Batting has a per-innings "form" factor so very big totals are rare but possible: level 13 (320) is about 0.1% for a strong draft.

## Depth features
- **Daily conditions:** every day (and every friend challenge / practice game) has a pitch (flat deck, spinning, green seamer, heavy dew, slow & low) and a draft twist (region lock, era lock, underdog day, one per city, or free). Both come from the seed, so everyone gets the same ones, and the server enforces the twist.
- **Pitch hints:** cards show POWER / ANCHOR / bowler tags (spin, new ball, death) and "suits pitch" chips. Tags are fan heuristics in `src/rules.js`.
- **Tactics:** after the draft, pick a **captain** (required) and tweak order. Batting: up to 2 players one place out of position. Bowling: swap slots; specialists get +8 in their phase (new ball slots 1-2, middle 3-4, death 5) and a small penalty out of phase.
- **Super Over:** 3 hitters + 1 bowler, bat one over, then defend it vs the day's opponent trio. Daily counts for streak and weekly points.
- **Full match:** draft an XI, pick bat-first or bowl-first, choose your five bowlers, then play both innings against the day's opponent. Win 120 / tie 60 / loss 25 weekly points (first daily only; verified server-side). `node scripts/tune-full.mjs` checks balance (about 46% win for a random draft, 55-58% for a stronger one).
- **Skip a pick:** every draft (batting, full match, bowling) lets you drop one drafted player once (✂️ next to the re-roll). He can't come back and you get a fresh spin.
- **Impact player (IPL rule):** tick "Impact player" on the Full match card to draft a 12th player. He subs in for the 2nd innings in place of a player you choose (bowls in your defence if you bat first, bats in the chase if you bowl first). Verified server-side.
- **Match database:** every finished game is posted to `/api/match`, re-run and verified by the server, and appended to `matches-YYYY-MM.ndjson` next to the db (anonymous hashed device id, no names, 12 months, skipped for opt-outs and under-18s). Admin: `/admin` shows totals and downloads CSV; `GET /api/admin/matches?days=30&kind=&mode=&format=csv` with the `x-admin-token` header.
- **Leaderboards:** every game counts. Each player appears once with their best game of the day (or ever), ranked by the highest level they have WON, then runs. Scores post automatically once a player has a name (a random name like "Swift Yorker 47" is pre-filled; they can keep it, reroll it or type their own). Extra / free-play games are verified with a recent timestamp seed. Weekly points use a player's best game per mode per day.
- **Weekly tournament:** points from every daily game (batting, bowling, Super Over), Monday to Sunday, server-computed (`dailyPoints` in `src/rules.js`).
- **Yesterday's best XIs:** top 3 per mode with their drafted players and captain.
- **Streak freeze:** each daily win earns a freeze (max 3) that covers one missed day.

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

## Analytics and audience data
Anonymous usage events (`src/analytics.js`, `server/analytics.js`), an optional consented profile (`src/privacy.jsx`), a token-protected `/admin` dashboard (`server/admin.html`) and push broadcasts. See DEPLOY.md. Players under 18 are never profiled and get no analytics.

## Load test
`node scripts/loadtest.mjs <base-url> [players=250] [games-each=3] [concurrency=40]` runs virtual players that open the app, draft an XI, run the same chase simulation as the app, post the score, and read the boards. It checks every posted score against the server's own re-run and prints latency percentiles. Test players are deleted afterwards (`CLEANUP=0` keeps them). Use `SPOOF_IP=1` against a local server so each virtual player has its own client IP (the API allows 120 requests per minute per IP).
