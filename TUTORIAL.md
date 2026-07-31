# Nova CMS — The Complete Walkthrough

From zero to a live, team-run, approval-guarded website — every step. Follow along in ~15 minutes.

> **TL;DR video**: a 70-second guided tour of everything below is recorded in the repo history; every chapter here matches a chapter in the video.

---

## Chapter 0 — Run it

```bash
npm install && npm start          # or: docker compose up -d
```

Open **http://localhost:3000/admin**. First run creates a **superadmin** (`admin` / `admin123` — change it, or set `ADMIN_USERNAME`/`ADMIN_PASSWORD`). Everything below works with zero further config. Optional env for the full experience: `ANTHROPIC_API_KEY` (AI features), `NOVA_LOG=json`, `NOVA_DEFAULT_PLAN=free` (only if you're operating a paid SaaS).

Seed a playground with three demo companies at any time:

```bash
node scripts/seed-demo.js
```

## Chapter 1 — Sign in, know your role

The login screen has three **portals**: Super Admin (platform operators), Admin (company owners), Manager (writers). One account can hold different roles in different companies. Register a fresh account — you're about to become a company admin.

## Chapter 2 — Create your company, pick a starting point

Creating a company drops you straight into the **setup screen**:

- **Search the 41 business templates** (hotel, restaurant, salon, law firm, brewery, museum…). Applying one sets a matching theme + typography + layout and publishes real starter content. Eleven kits also install **custom content types** — the hotel ships *Rooms* with rates and booking links, the brewery ships its *Tap list*.
- **Or describe your business** to the AI builder — Claude designs the theme, writes the pages and posts, and defines content types when the business needs structured data.
- **Or start blank.**

Try it: type `restaurant`, hit **Apply**. Your site is live at `/t/<your-slug>` before you've written a word.

## Chapter 3 — The dashboard

KPIs (published / in review / drafts / media / members), recent activity, and the **content radar**: items expiring within 14 days, submissions stuck in review 7+ days, pages untouched for 180+ days, drafts idle a month. The CMS tells you what needs attention before anyone asks.

## Chapter 4 — Your public site

Visit `/t/<slug>`: themed, responsive, with RSS, sitemap, robots.txt, Open Graph, and site search (⌕ in the nav) built in. Change the look on **Company → Public site**: 11 themes, serif/sans/mono headings, card or list layout, accent color, custom CSS, and your own **navigation menu** (`Label | /url` lines). Connect a **custom domain** — with `deploy/docker-compose.tls.yml`, HTTPS certificates issue themselves on first visit.

## Chapter 5 — Writing

**Content → + New.** Six body formats: **Blocks** (visual editor — paragraphs, headings, images, lists, quotes, code, video, buttons, dividers, and a working **contact form** whose submissions land in your Inbox), **Markdown** (toolbar + live preview), plain text, raw HTML, image, embed. Everything autosaves as a draft, every save is versioned and restorable, and images you upload get automatic WebP variants.

**Check your changes before anyone sees them**: *Preview on site ↗* renders your latest saved version on the real site (members only, never leaks); *Compare with live* shows a word-level diff; *🔗 Share preview* mints a signed, expiring link you can send to someone with no account at all.

## Chapter 6 — The approval workflow (the heart of Nova)

Add a teammate on **Company → Members** as a **manager**. Managers write everything, publish nothing:

1. The manager submits work as **Pending review**. Publishing directly returns 403 — always.
2. **Claude pre-reviews the submission** within seconds: a one-line summary (or what changed vs. live), concrete notes ("contains TODO placeholder text"), and a looks-good / needs-attention verdict — shown in the queue and on the review screen.
3. The admin opens **Approvals** → side-by-side diff → **Approve** (goes live) or **Reject** with a note (back to draft).
4. If a manager edits an *already-published* page, the approved version **stays live** while the edits wait — visitors never see anything unapproved, ever.
5. Everyone hears about it: the **🔔 bell** notifies admins of submissions and authors of decisions (rejection note included) and comments.

## Chapter 7 — Schedule and time-travel

Set **Go live at** / **Expire at** on any item — enforced everywhere, including feeds and the API. The **Calendar** page shows the month: 🚀 go-lives, ✅ publishes, ⏳ expiries — subscribable from Google/Outlook/Apple Calendar via `/api/teams/:id/calendar.ics?key=<read API key>`.

And the party trick: **⏱ the Time Machine**. Add `?preview_at=2026-12-01T10:00` to any page (or click any calendar day, or the button next to the scheduling fields) and see the *entire site* as it will look at that moment — scheduled content live, expired content gone.

## Chapter 8 — Structured content

**Company → Content types**: define your own types with typed fields — text, number, date, URL, select, and **reference** (a relation to another item, e.g. a Property's *Listing agent* must be an Agent). Custom items get archive pages in the site nav automatically, field sheets on their pages, and full exposure in the headless API. Going global? Every item has a locale, translations link into groups, and **✦ Translate with AI** drafts the translation for human review.

## Chapter 9 — In and out (no lock-in)

**Company → Import**: WordPress WXR exports, Markdown folders with front matter, or another Nova's JSON export — custom types and settings survive the round trip. **Export** gives you everything back as one JSON file, any time.

## Chapter 10 — Build on it

Everything is an API: OpenAPI 3.1 at `/api/openapi.json`, reference at **`/api/docs`**, official JS SDK at `/sdk/nova-sdk.js`:

```js
const { NovaClient } = require('./sdk/nova-sdk');
const nova = new NovaClient({ baseUrl: 'http://localhost:3000', apiKey: 'nova_…' });
await nova.site('my-company').posts();                 // public, no key
await nova.team(1).content.create({ title: 'Hi' });    // write key → approval workflow
```

Create keys on **Company → API keys** (read = GETs incl. drafts; write = acts as a manager). Add **webhooks** for `content.published` and friends (HMAC-signed) to trigger rebuilds or Slack alerts.

## Chapter 11 — Operate it

- **Security**: 2FA on the Account page; rate limits and security headers by default.
- **Account recovery**: add a recovery email on the Account page (or at sign-up) and "Forgot password?" on the sign-in screen emails you a single-use reset link — when the operator has configured `SMTP_URL` or `NOVA_EMAIL_WEBHOOK`. Your notifications land in your inbox too.
- **Observability**: `/api/metrics` (Prometheus), `NOVA_LOG=json`, `NOVA_ERROR_WEBHOOK`.
- **Backups**: superadmins download a consistent snapshot at `/api/platform/backup`.
- **Plans**: free/starter/pro with live usage meters — self-hosted defaults to unlimited; SaaS operators set plans from the Platform page.
- **Superadmin**: the Platform page — every company, every user, registration open/closed, plan control.

That's the whole loop: **onboard → template/AI → write → check → share → submit → AI pre-review → approve → schedule → time-travel → measure → build on the API.** Welcome to Nova. ✦
