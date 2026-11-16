# Going live (about 15 minutes)

You need: a host account (Fly.io is the default here), a domain (optional but recommended), and a contact email.

## Before you deploy (2 minutes)
1. Set the `CONTACT_EMAIL` environment variable (shown on the privacy page). No file edit needed.
2. Push keys are generated automatically on first start and stored in the data file on the disk, so there is nothing to generate. (Optional: set `VAPID_PUBLIC`/`VAPID_PRIVATE` yourself to override.) Set `VAPID_SUBJECT` to `mailto:you@yourdomain` so push services can contact you.

## Option A: Fly.io (recommended)
```
curl -L https://fly.io/install.sh | sh
fly auth signup            # or: fly auth login
cd chase
# edit fly.toml: set a unique `app` name (and primary_region, e.g. bom, sin, lhr, iad)
fly launch --no-deploy --copy-config
fly volumes create chase_data --size 1
fly secrets set CONTACT_EMAIL=you@example.com VAPID_SUBJECT=mailto:you@example.com
fly deploy
fly open
```
HTTPS is automatic. Custom domain: `fly certs add yourdomain.com`, then add the DNS records it prints.

## Option B: Render (no command line)
1. Create an account at render.com and connect your GitHub.
2. New + > Blueprint > pick the repo. It reads `render.yaml` at the repo root (root directory `chase`, Docker, 1 GB disk at `/data`, health check `/healthz`).
3. Choose the branch (the blueprint pins `claude/beautiful-bohr-znhivj`; change to `main` once merged).
4. Fill in `CONTACT_EMAIL` and `VAPID_SUBJECT` (for example `mailto:you@example.com`) when prompted.
5. Deploy. HTTPS is automatic; add a custom domain under Settings > Custom Domains.
The disk needs the paid Starter plan (about $7/month). Do not use the free plan: it sleeps and loses data.

## After deploy: smoke test (5 minutes)
- `https://YOUR-APP/healthz` returns `{"ok":true}`.
- Open on a phone, play a batting game, post to the leaderboard, check it appears.
- Create a friend challenge, open the link in a second browser/device, confirm both scores show.
- Install to the home screen (Android: install prompt; iPhone: Share, Add to Home Screen).
- Turn on streak reminders (iPhone needs iOS 16.4+ and the installed app).
- Back up `/data/db.json` (e.g. `fly ssh sftp get /data/db.json`) before big changes.

## Operating notes
- One machine, one volume: don't scale to multiple machines (the data is a single JSON file).
- The server trusts `Fly-Client-IP` / `X-Forwarded-For` for rate limiting, so only run it behind a trusted proxy.
- Levels are trusted from the client; there are no accounts. Fine for launch, add accounts later if cheating matters.

## Analytics, audience report and broadcasts
- Set the `ADMIN_TOKEN` environment variable on the host (a long random secret, 20+ characters). Without it the admin features are disabled.
- Open `https://YOUR-APP/admin`, enter the token, and you get: daily/weekly/monthly active players, retention (next-day and 7-day), where players quit drafts, level difficulty (win % per level), countries/devices, and the sponsor audience report (age band, state, favourite team city; groups under 5 are hidden).
- The same page can send a push notification to everyone who opted in to reminders.
- Analytics events are stored as daily files (`events-YYYY-MM-DD.ndjson`) next to the data file on the persistent disk and deleted after 180 days. They contain a hashed device id, never IPs or names.
- Players control this in the app under **Privacy & data**: switch stats off, add or delete the optional profile (consent required, under-18s are never profiled), or delete all their data. `public/privacy.html` already describes all of this; keep it in sync if you change what is collected.
- Before sharing audience numbers with sponsors or running ads, have a privacy lawyer check your set-up against India's DPDP Act and any other laws that apply.
