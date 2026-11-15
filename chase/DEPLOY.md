# Going live (about 15 minutes)

You need: a host account (Fly.io is the default here), a domain (optional but recommended), and a contact email.

## Before you deploy (2 minutes)
1. Edit `public/privacy.html`: replace `REPLACE-WITH-YOUR-CONTACT-EMAIL`.
2. Generate push keys once and keep them secret:
   `npx web-push generate-vapid-keys`

## Option A: Fly.io (recommended)
```
curl -L https://fly.io/install.sh | sh
fly auth signup            # or: fly auth login
cd chase
# edit fly.toml: set a unique `app` name (and primary_region, e.g. bom, sin, lhr, iad)
fly launch --no-deploy --copy-config
fly volumes create chase_data --size 1
fly secrets set VAPID_PUBLIC=... VAPID_PRIVATE=... VAPID_SUBJECT=mailto:you@example.com
fly deploy
fly open
```
HTTPS is automatic. Custom domain: `fly certs add yourdomain.com`, then add the DNS records it prints.

## Option B: Render
Push the repo to GitHub, create a new Blueprint from `chase/render.yaml`, then fill VAPID_PUBLIC and VAPID_PRIVATE in the dashboard. Persistent disks need a paid plan.

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
