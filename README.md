# Nova CMS ✦

**The CMS any team on earth can adopt in an afternoon — and never outgrow.** See [ROADMAP.md](ROADMAP.md) for where this is headed.

A multi-company content platform built with Node.js, Express, and SQLite. Any company can onboard itself and use Nova to power its website — with its own look, its own domain, its own people, and fully isolated content.

It ships three things in one small app:

- **REST API** (`/api/…`) — auth, companies, members, content, tags, media, settings, platform stats
- **Admin panel** (`/admin`) — a compact UI with **light and dark modes** (toggle in the navbar, light by default), set in self-hosted Geist Sans, with a top navbar, collapsible sidebar, role-portal logins, live dashboard, approvals queue, command palette (Ctrl/⌘+K), Markdown editor with cover images, and per-company branding controls
- **Public sites** — `/` is a directory of company sites; each company publishes at `/t/<slug>` or on its own custom domain

## The three-tier role architecture

| Tier | Role | Who | Can do |
| --- | --- | --- | --- |
| Platform | **superadmin** | us — the platform operators | Everything: platform dashboard and stats, all companies, user administration, platform settings (title, open/closed registration) |
| Company | **admin** | company owners | Run their company: profile, URL slug, custom domain, theme and branding, members and their roles, deletion — plus everything managers can do |
| Company | **manager** | company employees | Day-to-day content work: posts, pages, media, tags, dashboard — everything they write goes through admin approval before reaching the site |

Users can belong to several companies (with different roles in each) and switch between them in the sidebar. A company always keeps at least one admin. Superadmins pass through any company as an admin.

## Onboarding a company

1. **Register** at `/admin` (self-serve; superadmins can switch the platform to invite-only).
2. **Create the company workspace** — the creator becomes its admin and adds employees by username as managers (or co-admins).
3. **Start the site in one click** (optional, from the Company page):
   - **Starter kits** — six pre-configured site templates (Personal blog, Product site, Documentation, Portfolio, Café & local shop, Changelog) that apply a matching theme + typography + layout and publish real, ready-to-edit starter pages and posts. Existing content is never touched.
   - **AI site builder** — describe the company in a sentence and Claude designs the whole site: theme, headings typeface, layout, accent color, and written-in-your-voice starter pages and posts. Requires `ANTHROPIC_API_KEY` on the server (admin-only, rate-limited).
4. **Publish** from the admin panel; the site is immediately live at `/t/<slug>`.
5. **Make it theirs** — two integration modes:
   - **Hosted site**: pick from an **11-theme gallery** (Auto, Paper, Forest, Ocean, Mint, Lavender, Midnight, Slate, Noir, Sunset, Terminal) with visual swatches, choose a **headings typeface** (sans / serif / monospace) and a **home layout** (card grid or list), set a brand accent color and custom CSS, and connect a **custom domain** — point DNS at the server and the site is served at the domain root with no platform branding.
   - **Headless**: keep an existing website and pull published content as JSON from the public, CORS-open content API — `GET /api/public/<company>/content` and `…/content/<slug>` (raw Markdown + rendered HTML + cover image). Drafts are never exposed.

## World-ready content (i18n)

- Every item has a **locale** (`en`, `es`, `pt-br`, …); each company sets its **default language**.
- **Translation groups** link an original to its translations (one per locale, enforced) — created from the editor's Translations panel, which copies the source as a draft in the new locale.
- The site home shows the default locale; other locales live at `/t/<slug>/<locale>` (or `/<locale>` on a custom domain) with a **language switcher** in the nav. Posts and pages emit **`hreflang` alternates** for search engines.
- Feeds accept `?locale=`, sitemaps include locale homes, and the headless API filters with `?locale=` and returns `translations` on single items.

## Integrations

- **Webhooks** (company admins): signed POSTs (HMAC-SHA256, `X-Nova-Signature`) on `content.published`, `content.updated`, `content.unpublished`, `content.deleted` — perfect for static-site rebuilds. Per-hook delivery status; the signing secret is shown once.
- **API keys** (company admins): `Bearer nova_…` tokens for scripts and CI. `read` keys can GET everything including drafts; `write` keys act as a *manager*, so anything they write still goes through approval — a leaked CI key can never publish. Keys are stored as hashes and shown once; revocation is immediate.
- **Export**: one click downloads the whole company (content with tags, settings, members, media metadata) as JSON. No lock-in.

## Approval workflow

Managers have full CRUD on content, but nothing they touch goes live on its own:

- A manager saves work as **Draft** or submits it as **Pending review** — publishing directly returns 403.
- Company admins see a badge-counted **Approvals** queue with a **side-by-side review**: the live version and the proposed version rendered next to each other with line-level diff highlighting (removals struck through on the left, additions highlighted on the right, changed fields flagged). Approve or reject (with a note) from the queue or the review screen; rejected items return to draft and the note is shown to the author in the editor.
- If a manager edits already-published content, the edits go to **Pending** while the **previously approved version stays live** (snapshotted, URL frozen) — the public site and headless API only ever serve approved content. Approving swaps the new version in; rejecting keeps the old one up.
- Admins and superadmins can still publish directly.
- **Version history**: every save is recorded and restorable (restores obey the same workflow rules). **Comment threads** (Markdown supported) let reviewers and authors discuss an item in the editor and review screens. An **audit log** (Activity page) records approvals, rejections, restores, membership and settings changes.
- **Scheduling**: set `publish_at` (go live later) and `expire_at` (come down later) — enforced everywhere published content is served, including feeds, sitemaps, and the headless API.

## Admin panel highlights

- **Dashboard** — per-company KPIs (published, in review, drafts, posts, pages, media, members) and recently updated content.
- **Command palette** — Ctrl/⌘+K anywhere: jump between pages, create content, switch companies, and search content by title.
- **Editor** — Markdown body with a formatting toolbar, live Write/Preview toggle, media-library image insertion, autosave for drafts, excerpt (inline Markdown), tags, slug control, language + scheduling fields, a cover image picker with live preview, version history with restore, and the item's discussion thread. Rendered Markdown in the admin is always sanitized.
- **Company page** — profile, custom domain, theme/branding, headless API reference, and member management with role control.
- **Platform page** (superadmins) — platform-wide KPIs, newest companies, user administration, and platform settings.

## Content features

- **Five body formats**, chosen per item in the editor: **Markdown** (toolbar + live preview), **Plain text** (paragraphs preserved, HTML escaped), **HTML** (rendered as-is on your site — full control), **Image** (body is the image URL, excerpt becomes the caption, rendered as a figure), and **Embed** (YouTube/Vimeo URLs become privacy-friendly players). The editor adapts to each format; the headless API exposes `format` and format-correct `body_html`; version history preserves the format.
- **Markdown everywhere** it fits beyond bodies: excerpts and site descriptions (inline — rendered on cards, heroes, footers, and as `excerpt_html` in the headless API; stripped to plain text for meta tags), and discussion comments.
- **Posts and pages** with drafts and publishing, excerpts, and **cover images** (shown on site cards, post heroes, and in the headless API).
- **Custom content types** (company admins): define your own types — Jobs, Recipes, Properties — with typed field schemas (`text`, `longtext`, `number`, `date`, `url`, `select`). Fields are validated on write, edited with generated inputs in the editor, rendered as a definition list on the hosted site, exposed as `fields` in the headless API, preserved in version history, and covered by the approval snapshot. Custom items are served at `/t/<company>/<slug>` and appear in sitemaps.
- **Importers** (company admins): upload WordPress WXR exports (`.xml` — posts, pages, tags, statuses, publish dates; classic-editor paragraphs handled), Markdown files with front matter (`.md` — title, date, tags, status, slug, type), or a Nova JSON export (`.json` — full round trip including custom types and settings). Published items go live immediately; everything else lands as drafts.
- **Slugs** auto-generated from titles and de-duplicated *within each company*.
- **Tags** per company, with filtering on the public site and in the admin.
- **Media library** per company — images and files up to 10 MB, served from `/uploads`.
- **Public sites** with hero sections, card-grid or list layouts, sticky blurred navigation, and per-company theming (11 presets × 3 heading typefaces × accent color × custom CSS).

## Quick start

```bash
npm install
npm start
```

- Company directory: http://localhost:3000
- Admin panel: http://localhost:3000/admin

On first run a **superadmin** is created — username `admin`, password `admin123` — along with a starter company. **Change the password immediately**, or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` before the first start.

To fill the platform with realistic demo companies and content (Northwind Coffee, Orbital Labs, Fern & Field):

```bash
node scripts/seed-demo.js          # against http://localhost:3000
```

## Deploy with Docker

```bash
docker compose up -d      # builds the image, persists /data, restarts on failure
```

Or roll your own: `docker build -t nova-cms . && docker run -p 3000:3000 -v nova-data:/data -e JWT_SECRET=<random> nova-cms`. A container healthcheck hits `/api/health`. Behind a TLS proxy set `COOKIE_SECURE=1` and `TRUST_PROXY=1`. CI (GitHub Actions) runs the test suite on every push.

## Production notes

- **Rate limiting**: login and registration are limited per IP (tune with `RATE_LIMIT_LOGIN` / `RATE_LIMIT_REGISTER`).
- **Security headers** are set on every response; auth cookies are httpOnly + SameSite=Lax (+ Secure when `COOKIE_SECURE=1`).
- **SEO built in**: every hosted site gets `feed.xml` (RSS), `sitemap.xml`, meta descriptions, and Open Graph tags; `/robots.txt` and the platform sitemap are domain-aware, so a custom-domain site gets its own at the root.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database lives |
| `UPLOAD_DIR` | `./uploads` | Where uploaded media is stored |
| `JWT_SECRET` | random per boot | Auth token signing key — set this in production so logins survive restarts |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | First-run superadmin account |
| `COOKIE_SECURE` | off | Set `1` when serving over HTTPS |
| `TRUST_PROXY` | off | Set `1` behind a reverse proxy so client IPs and protocol are correct |
| `RATE_LIMIT_LOGIN` / `RATE_LIMIT_REGISTER` | `30` / `30` | Auth attempts allowed per IP per window |
| `ANTHROPIC_API_KEY` | unset | Enables the AI site builder (without it the feature shows as unavailable) |
| `NOVA_AI_MODEL` | `claude-opus-5` | Claude model used by the AI site builder |

## API overview

All `/api` routes accept and return JSON. Authentication uses an httpOnly cookie set by login/register. Company-scoped routes require membership; superadmins can access any company.

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | — | Create an account (`{username, password}`) |
| POST | `/api/auth/login` / `/logout` | — / ✓ | Session management |
| GET | `/api/auth/me` | ✓ | Current user |
| POST | `/api/auth/password` | ✓ | Change own password |
| GET/POST | `/api/teams` | ✓ | My companies (superadmin: all) / create one — creator becomes its admin |
| GET/PUT/DELETE | `/api/teams/:id` | member / admin / admin | Read / update (name, slug, custom_domain) / delete |
| GET | `/api/teams/:id/stats` | member | Dashboard KPIs + recent content |
| GET/POST | `/api/teams/:id/members` | member / admin | List / add by username (`{username, role: admin\|manager}`) |
| PUT/DELETE | `/api/teams/:id/members/:userId` | admin (self-removal allowed) | Change role / remove or leave |
| GET/PUT | `/api/teams/:id/settings` | member / admin | Site title, description, theme, accent color, custom CSS |
| GET | `/api/site-templates` | ✓ | Starter-kit catalog + whether the AI builder is configured |
| POST | `/api/teams/:id/apply-template` | company admin | Apply a starter kit (`{template}`) — settings + published starter content |
| POST | `/api/teams/:id/ai-build` | company admin | AI site builder (`{prompt}`) — Claude designs theme + starter content |
| GET/POST | `/api/teams/:id/content` | member | List (`?type=&status=&tag=&search=`) / create (incl. `cover_image`) |
| GET/PUT/DELETE | `/api/teams/:id/content/:cid` | member | Read / update / delete one item (managers can't set `published`) |
| POST | `/api/teams/:id/content/:cid/approve` | company admin | Approve pending content — goes live |
| POST | `/api/teams/:id/content/:cid/reject` | company admin | Reject pending content back to draft (`{note}`) |
| GET | `/api/teams/:id/content/:cid/versions` | member | Version history (newest first) |
| POST | `/api/teams/:id/content/:cid/versions/:vid/restore` | member | Restore a version (workflow rules apply) |
| GET/POST | `/api/teams/:id/content/:cid/comments` | member | Discussion thread on an item |
| GET | `/api/teams/:id/audit` | company admin | Audit log (last 100 entries) |
| GET/POST/DELETE | `/api/teams/:id/webhooks[/:whid]` | company admin | Manage signed event webhooks |
| GET/POST/DELETE | `/api/teams/:id/api-keys[/:kid]` | company admin | Manage scoped Bearer tokens |
| GET/POST | `/api/teams/:id/content-types` | member / admin | List / define custom content types with field schemas |
| PUT/DELETE | `/api/teams/:id/content-types/:ctid` | company admin | Update schema / delete (only while unused) |
| POST | `/api/teams/:id/import` | company admin | Import WXR (.xml), Markdown (.md), or Nova export (.json) — multipart `files` |
| GET | `/api/teams/:id/export` | company admin | Full company JSON export (incl. custom types and fields) |
| GET/DELETE | `/api/teams/:id/tags[/:tagId]` | member | List / delete tags |
| GET/POST/DELETE | `/api/teams/:id/media[/:mid]` | member | List / upload (multipart `file`) / delete |
| GET | `/api/platform/stats` | superadmin | Platform-wide KPIs and newest companies |
| GET/POST/DELETE | `/api/users[/:id]` | superadmin | Platform-wide user administration |
| GET/PUT | `/api/settings` | — / superadmin | Platform settings incl. `allow_registration` |
| GET | `/api/public/:company` | — | Public company profile (JSON, CORS-open) |
| GET | `/api/public/:company/content[/:slug]` | — | Published content as JSON — list (`?type=&tag=&locale=`) or single with `body_html` + `translations` |

## Tests

```bash
npm test
```

51 end-to-end tests (`node --test`, in-memory database): registration, company creation, the three-tier role model, cross-company isolation, content CRUD with cover images, per-company slug scoping, draft/pending/publish visibility, the approval workflow, custom content types with field validation, the WordPress/Markdown/Nova importers, feeds/sitemaps/SEO, rate limiting, theming, starter kits and the AI site builder (mock mode), custom-domain routing, the headless API, dashboards, and platform stats.

## Project layout

```
server.js            entry point
src/app.js           express app wiring
src/db.js            schema, migrations, seed, slug helpers
src/auth.js          JWT cookie auth + role middleware (superadmin/admin/manager)
src/content-types.js custom content types: schemas + field validation
src/importers.js     WordPress WXR, Markdown front matter, Nova JSON import
src/templates.js     starter-kit site templates + site-spec engine
src/ai.js            AI site builder (Claude)
src/routes/teams.js  companies, members, settings, stats + nested content/tags/media
src/routes/          auth, users, platform stats, platform settings, public sites
public/admin/        Nova admin panel SPA
scripts/seed-demo.js demo companies + content
test/                end-to-end API tests
```
