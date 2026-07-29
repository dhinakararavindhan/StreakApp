# CMS

A lightweight multi-team content management system built with Node.js, Express, and SQLite. Any team can sign up, invite members, and run its own site — content, media, tags, and settings are fully isolated per team.

It ships three things in one small app:

- **REST API** (`/api/…`) — auth, teams, members, content, tags, media, settings
- **Admin panel** (`/admin`) — sign up, create teams, write and manage content in the browser
- **Public sites** — `/` is a directory of team sites; each team publishes at `/t/<team-slug>`

## Quick start

```bash
npm install
npm start
```

Then open:

- Team directory: http://localhost:3000
- Admin panel: http://localhost:3000/admin

On first run a platform admin is created — username `admin`, password `admin123` — along with a starter team. **Change the password immediately** in Settings, or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` before the first start.

## How teams work

- **Anyone can register** (toggleable by the platform admin) and create teams; the creator becomes the team's **owner**.
- **Owners** manage the team: rename it, change its URL slug, edit site settings, add/remove members, promote owners, delete the team. A team always keeps at least one owner.
- **Editors** manage the team's content, media, and tags.
- Members are added by username; users can belong to many teams and switch between them in the admin panel.
- **Platform admins** oversee everything: all teams, platform-wide user administration, and platform settings (title, description, whether registration is open).
- Each team's public site lives at `/t/<team-slug>` — posts at `/t/<team-slug>/posts/<slug>`, pages at `/t/<team-slug>/<slug>`, tag filtering with `/t/<team-slug>?tag=<tag>`.

## Content features

- **Posts and pages** with Markdown bodies, drafts and publishing, excerpts.
- **Slugs** auto-generated from titles and de-duplicated *within each team*.
- **Tags** per team, with filtering on the public site and in the admin list.
- **Media library** per team — images and files up to 10 MB, served from `/uploads`.
- **Per-team site settings** — each team controls its own site title and description.

## Configuration

Everything is optional; sensible defaults apply.

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database lives |
| `UPLOAD_DIR` | `./uploads` | Where uploaded media is stored |
| `JWT_SECRET` | random per boot | Auth token signing key — set this in production so logins survive restarts |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | First-run platform admin account |

## API overview

All `/api` routes accept and return JSON. Authentication uses an httpOnly cookie set by login/register. Team-scoped routes require membership in that team; platform admins can access any team.

| Method | Route | Access | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | — | Create an account (`{username, password}`) |
| POST | `/api/auth/login` | — | Log in |
| POST | `/api/auth/logout` | ✓ | Log out |
| GET | `/api/auth/me` | ✓ | Current user |
| POST | `/api/auth/password` | ✓ | Change own password |
| GET | `/api/teams` | ✓ | My teams (admins: all teams) |
| POST | `/api/teams` | ✓ | Create a team (`{name, slug?}`) — creator becomes owner |
| GET/PUT/DELETE | `/api/teams/:id` | member / owner / owner | Read / update / delete a team |
| GET | `/api/teams/:id/members` | member | List members |
| POST | `/api/teams/:id/members` | owner | Add a member by username (`{username, role}`) |
| PUT/DELETE | `/api/teams/:id/members/:userId` | owner (self-removal allowed) | Change role / remove or leave |
| GET/PUT | `/api/teams/:id/settings` | member / owner | Team site title and description |
| GET/POST | `/api/teams/:id/content` | member | List (`?type=&status=&tag=&search=`) / create |
| GET/PUT/DELETE | `/api/teams/:id/content/:cid` | member | Read / update / delete one item |
| GET/DELETE | `/api/teams/:id/tags[/:tagId]` | member | List / delete tags |
| GET/POST/DELETE | `/api/teams/:id/media[/:mid]` | member | List / upload (multipart `file`) / delete |
| GET/POST/DELETE | `/api/users[/:id]` | platform admin | Platform-wide user administration |
| GET/PUT | `/api/settings` | — / platform admin | Platform settings incl. `allow_registration` |

## Tests

```bash
npm test
```

Runs an end-to-end suite (`node --test`) against an in-memory database: registration, team creation, membership and role enforcement, cross-team isolation, content CRUD, per-team slug scoping, draft/publish visibility, public site rendering, and platform administration.

## Project layout

```
server.js            entry point
src/app.js           express app wiring
src/db.js            schema, seed data, slug helpers
src/auth.js          JWT cookie auth + team role middleware
src/routes/teams.js  teams, members, team settings + nested content/tags/media
src/routes/          auth, users, platform settings, public sites
public/admin/        admin panel SPA
test/                end-to-end API tests
```
