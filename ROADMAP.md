# Nova CMS — Roadmap to a world-scale CMS

The goal: a CMS any team on earth can adopt in an afternoon — self-hosted or SaaS —
and never outgrow. This roadmap orders the work by leverage: each phase makes the
next one more valuable.

## Phase 0 — Foundation ✅ (shipped)

- Multi-company platform with strict data isolation (companies, members, content, tags, media, settings)
- Three-tier roles: superadmin → company admin → manager, with role-portal logins
- Approval workflow: manager CRUD → pending → admin approve/reject, side-by-side diff review, live-version snapshots (approved content never vanishes while edits are in review)
- Hosted sites (themes, accent colors, custom CSS, custom domains) **and** headless delivery (public CORS-open JSON API)
- Compact light/dark admin (Geist Sans) with dashboard, command palette, media library, cover images
- 28 end-to-end tests

## Phase 1 — Production readiness ✅ (shipped)

Anyone can run Nova in production, safely, today.

- [x] **Docker**: production image + compose file, persistent volume, container healthcheck
- [x] **CI**: GitHub Actions running the test suite on every push and PR
- [x] **Security hardening**: rate-limited auth endpoints, security headers, opt-in secure cookies, proxy trust setting
- [x] **Two-factor authentication**: TOTP (RFC 6238, dependency-free) with verified enable, login challenge, and code-gated disable
- [x] **Health endpoint** (`/api/health`) for load balancers and uptime monitors
- [x] **Open-web citizenship** (every hosted site): RSS feeds, XML sitemaps, robots.txt, meta descriptions and Open Graph tags
- [x] **License + contribution guide** (MIT) — open source is the adoption engine

## Phase 2 — Editorial depth ✅ (shipped)

Make the newsroom-grade workflow complete.

- [x] Content version history — every save recorded (capped at 50/item), restorable through the same workflow rules
- [x] Scheduled publishing (`publish_at`) and expiry (`expire_at`), enforced at query time on sites, feeds, sitemaps, and the headless API
- [x] Audit log: content lifecycle, approvals/rejections, restores, membership and settings changes — Activity page for company admins
- [x] Word-level diffs and rendered-markdown preview in the review screen
- [x] Editor upgrades: image embedding from the media library, autosave for drafts
- [x] Comment threads on content (reviewer ↔ author), in the editor and the review screen
- [x] Block editor: visual, reorderable blocks (text, headings, images, lists, quotes, code, embeds, buttons, forms) as a sixth body format
- [ ] Slash commands in the editor (deferred)

## Phase 3 — World-scale content ✅ (shipped)

Content for every audience, in every language, of every shape.

- [x] **i18n**: per-item locales, linked translation groups (one per locale, enforced), per-site default locale, locale homes (`/t/<slug>/<locale>`), language switcher, `hreflang` alternates, locale-filtered feeds and headless API
- [x] **Webhooks**: `content.published/updated/unpublished/deleted` events, HMAC-SHA256 signed, per-hook delivery status
- [x] **API keys**: company-scoped Bearer tokens — `read` (GETs incl. drafts) and `write` (acts as a manager, so writes go through approval); hashes only at rest, shown once
- [x] Full-company **JSON export** (content, settings, members, media metadata) — no lock-in
- [x] **Body formats**: Markdown, plain text, raw HTML, image, and embed (YouTube/Vimeo) — per item, format-aware editor and rendering everywhere
- [x] **Custom content types**: per-company user-defined types (Jobs, Recipes, Properties…) with typed field schemas (text, longtext, number, date, url, select) — validated on write, editable in the admin, rendered on sites, exposed in the headless API, versioned, and covered by the approval snapshot
- [x] **Relations**: `reference` fields link content items (optionally pinned to a type), validated per company, expanded in both APIs, linked on sites only while the target is live
- [x] **Importers**: WordPress WXR exports, Markdown files with front matter, and Nova's own JSON export (full round trip incl. custom types and settings) — export *and* import, so no lock-in in either direction

## Phase 4 — Scale-out

From one box to the planet.

- [ ] Database abstraction: Postgres driver alongside SQLite (SQLite stays the zero-config default)
- [ ] Object storage for media (S3-compatible) with local disk as default
- [ ] Redis-backed cache + rate limiting for multi-node deployments
- [x] Automatic TLS for custom domains: first-class Caddy setup (`deploy/Caddyfile` + `deploy/docker-compose.tls.yml`) with on-demand Let's Encrypt certificates gated by `/api/tls-check`, so certs are only ever issued for domains the platform serves
- [x] CDN-friendly caching headers + stale-while-revalidate on public pages and the content API
- [x] Observability: structured JSON request logs (`NOVA_LOG=json`), Prometheus metrics (`/api/metrics`, superadmin or `METRICS_TOKEN`), error reporting to `NOVA_ERROR_WEBHOOK`
- [x] One-click consistent platform backups: superadmin downloads a point-in-time SQLite snapshot (`/api/platform/backup`)

## Phase 5 — Ecosystem

The moat is other people's work running on Nova.

- [ ] Plugin API (server hooks + admin panel extension points)
- [x] Theme gallery: 11 presets × heading typefaces (sans/serif/mono) × home layouts (cards/list) × accent + custom CSS
- [x] Editorial calendar: month view of go-lives, publishes, and expiries; day-click opens the Time Machine; ICS feed for Google/Outlook/Apple Calendar
- [x] Content radar on the dashboard: expiring soon, stuck in review, stale published pages, idle drafts
- [x] Contact forms: form blocks on any page, honeypot + rate limiting, admin Inbox, `form.submission` webhooks
- [x] Image processing: automatic WebP variants on upload (1200px/400px), used by the editor and admin
- [x] Navigation menu manager: custom `Label | /url` menus overriding the automatic nav
- [x] Site search on every hosted site (`/search`, linked in the nav) and the headless API (`?q=`)
- [x] Content trash: soft delete with restore, admin-only permanent purge; one-click duplicate-as-draft
- [x] New-company onboarding: pick a business template, run the AI builder, or start blank — right at creation
- [x] In-app notifications: submissions notify admins; approvals, rejections (with note), and comments notify authors — bell with unread badge
- [x] Shareable preview links: signed, expiring, noindex URLs that show drafts to people without accounts
- [x] Draft preview on the real site (`?preview=draft`, member-only, banner, uncached) + read-only change diff for authors — check your changes before submitting
- [x] ⏱ Time machine: preview the whole site at any future moment (`?preview_at=`) — scheduled content shown, expiring content hidden; signed-in users only, never cached
- [x] ✦ AI pre-review: Claude reviews every submission before human editors — change summary, concrete notes, looks-good/needs-attention verdict in the approvals queue
- [x] ✦ AI translation: one-click translated drafts into i18n translation groups, markup preserved, human review required
- [x] Starter kits: 41 business templates across six categories (hospitality, services, property, creative & retail, community & education, product & publishing) — theme + typography + real published starter content in one click, with custom content types where the business has structured data (hotel Rooms, brewery Taps, travel Trips, real-estate Properties, coworking Spaces, museum Exhibitions, gym/yoga Classes, school Courses, band Shows, food-truck Stops)
- [x] AI site builder: describe the company, Claude designs the theme, writes the starter site, and defines custom content types when the business calls for them (`ANTHROPIC_API_KEY`, admin-only, rate-limited, offline mock mode for tests)
- [ ] Theme system beyond presets: installable themes, template overrides
- [ ] Official SDKs (JS/TS first) generated from an OpenAPI spec
- [ ] Docs site built on Nova itself (dogfooding), template gallery, showcase
- [ ] Hosted SaaS offering with billing — the open-source core stays complete

## Operating principles

1. **Zero-config first run, forever.** `npm start` (or `docker run`) must always produce a working platform with no setup.
2. **The approval workflow is sacred.** Nothing unapproved ever reaches a public surface, in any feature, ever.
3. **Isolation is sacred.** No feature may weaken cross-company data isolation.
4. **Hosted and headless are equals.** Every content feature ships in both the rendered sites and the JSON API.
5. **No lock-in.** Export everything, always.
