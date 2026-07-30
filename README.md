# Nova CMS ✦

A multi-company content platform built with Node.js, Express, and SQLite. Any company can onboard itself and use Nova to power its website — with its own look, its own domain, its own people, and fully isolated content.

It ships three things in one small app:

- **REST API** (`/api/…`) — auth, companies, members, content, tags, media, settings, platform stats
- **Admin panel** (`/admin`) — a compact dark UI set in self-hosted Geist Sans, with a top navbar, collapsible sidebar, role-portal logins, live dashboard, approvals queue, command palette (Ctrl/⌘+K), Markdown editor with cover images, and per-company branding controls
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
3. **Publish** from the admin panel; the site is immediately live at `/t/<slug>`.
4. **Make it theirs** — two integration modes:
   - **Hosted site**: pick a theme preset (Default, Midnight, Paper, Forest, Ocean), set a brand accent color and custom CSS, and connect a **custom domain** — point DNS at the server and the site is served at the domain root with no platform branding.
   - **Headless**: keep an existing website and pull published content as JSON from the public, CORS-open content API — `GET /api/public/<company>/content` and `…/content/<slug>` (raw Markdown + rendered HTML + cover image). Drafts are never exposed.

## Approval workflow

Managers have full CRUD on content, but nothing they touch goes live on its own:

- A manager saves work as **Draft** or submits it as **Pending review** — publishing directly returns 403.
- Company admins see a badge-counted **Approvals** queue and can **Approve** (goes live) or **Reject** with a note; rejected items return to draft and the note is shown to the author in the editor.
- If a manager edits already-published content, it is automatically pulled back to **Pending** (off the site) until re-approved — the public site and headless API only ever serve approved content.
- Admins and superadmins can still publish directly.

## Admin panel highlights

- **Dashboard** — per-company KPIs (published, in review, drafts, posts, pages, media, members) and recently updated content.
- **Command palette** — Ctrl/⌘+K anywhere: jump between pages, create content, switch companies, and search content by title.
- **Editor** — Markdown body, excerpt, tags, slug control, and a cover image picker fed by the company's media library with live preview.
- **Company page** — profile, custom domain, theme/branding, headless API reference, and member management with role control.
- **Platform page** (superadmins) — platform-wide KPIs, newest companies, user administration, and platform settings.

## Content features

- **Posts and pages** with Markdown bodies, drafts and publishing, excerpts, and **cover images** (shown on site cards, post heroes, and in the headless API).
- **Slugs** auto-generated from titles and de-duplicated *within each company*.
- **Tags** per company, with filtering on the public site and in the admin.
- **Media library** per company — images and files up to 10 MB, served from `/uploads`.
- **Public sites** with hero sections, card grids, sticky blurred navigation, and per-company theming.

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

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database lives |
| `UPLOAD_DIR` | `./uploads` | Where uploaded media is stored |
| `JWT_SECRET` | random per boot | Auth token signing key — set this in production so logins survive restarts |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | First-run superadmin account |

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
| GET/POST | `/api/teams/:id/content` | member | List (`?type=&status=&tag=&search=`) / create (incl. `cover_image`) |
| GET/PUT/DELETE | `/api/teams/:id/content/:cid` | member | Read / update / delete one item (managers can't set `published`) |
| POST | `/api/teams/:id/content/:cid/approve` | company admin | Approve pending content — goes live |
| POST | `/api/teams/:id/content/:cid/reject` | company admin | Reject pending content back to draft (`{note}`) |
| GET/DELETE | `/api/teams/:id/tags[/:tagId]` | member | List / delete tags |
| GET/POST/DELETE | `/api/teams/:id/media[/:mid]` | member | List / upload (multipart `file`) / delete |
| GET | `/api/platform/stats` | superadmin | Platform-wide KPIs and newest companies |
| GET/POST/DELETE | `/api/users[/:id]` | superadmin | Platform-wide user administration |
| GET/PUT | `/api/settings` | — / superadmin | Platform settings incl. `allow_registration` |
| GET | `/api/public/:company` | — | Public company profile (JSON, CORS-open) |
| GET | `/api/public/:company/content[/:slug]` | — | Published content as JSON — list (`?type=&tag=`) or single with `body_html` |

## Tests

```bash
npm test
```

28 end-to-end tests (`node --test`, in-memory database): registration, company creation, the three-tier role model, cross-company isolation, content CRUD with cover images, per-company slug scoping, draft/pending/publish visibility, the approval workflow, theming, custom-domain routing, the headless API, dashboards, and platform stats.

## Project layout

```
server.js            entry point
src/app.js           express app wiring
src/db.js            schema, migrations, seed, slug helpers
src/auth.js          JWT cookie auth + role middleware (superadmin/admin/manager)
src/routes/teams.js  companies, members, settings, stats + nested content/tags/media
src/routes/          auth, users, platform stats, platform settings, public sites
public/admin/        Nova admin panel SPA
scripts/seed-demo.js demo companies + content
test/                end-to-end API tests
```
