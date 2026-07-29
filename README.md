# CMS

A lightweight content management system built with Node.js, Express, and SQLite. It ships three things in one small app:

- **REST API** (`/api/…`) — auth, content, tags, media, users, settings
- **Admin panel** (`/admin`) — write and manage content in the browser
- **Public site** (`/`) — renders published posts and pages with Markdown

## Quick start

```bash
npm install
npm start
```

Then open:

- Public site: http://localhost:3000
- Admin panel: http://localhost:3000/admin

On first run a default admin user is created — username `admin`, password `admin123`. **Change it immediately** in Settings, or set `ADMIN_USERNAME` / `ADMIN_PASSWORD` before the first start.

## Features

- **Posts and pages** — posts appear on the home feed at `/posts/<slug>`; pages get root-level URLs like `/about` and show up in the site nav.
- **Markdown editing** with drafts and publishing; slugs are auto-generated from titles and de-duplicated.
- **Tags** — tag posts, filter by tag on the home page (`/?tag=news`) and in the admin list.
- **Media library** — upload images and files (10 MB limit), served from `/uploads`.
- **Users and roles** — `admin` (full access, manages users and settings) and `editor` (manages content, media, tags).
- **Site settings** — title and description, editable in the admin panel.

## Configuration

Everything is optional; sensible defaults apply.

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Where the SQLite database lives |
| `UPLOAD_DIR` | `./uploads` | Where uploaded media is stored |
| `JWT_SECRET` | random per boot | Auth token signing key — set this in production so logins survive restarts |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123` | First-run admin account |

## API overview

All `/api` routes accept and return JSON. Authentication uses an httpOnly cookie set by the login endpoint.

| Method | Route | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | — | Log in (`{username, password}`) |
| POST | `/api/auth/logout` | ✓ | Log out |
| GET | `/api/auth/me` | ✓ | Current user |
| POST | `/api/auth/password` | ✓ | Change own password |
| GET | `/api/content` | ✓ | List content (`?type=&status=&tag=&search=`) |
| POST | `/api/content` | ✓ | Create (`{type, title, body, excerpt, status, slug, tags}`) |
| GET/PUT/DELETE | `/api/content/:id` | ✓ | Read / update / delete one item |
| GET | `/api/tags` | ✓ | List tags with usage counts |
| DELETE | `/api/tags/:id` | ✓ | Delete a tag |
| GET/POST | `/api/media` | ✓ | List / upload (multipart `file` field) |
| DELETE | `/api/media/:id` | ✓ | Delete a file |
| GET/POST | `/api/users` | admin | List / create users |
| DELETE | `/api/users/:id` | admin | Delete a user |
| GET | `/api/settings` | — | Read site settings |
| PUT | `/api/settings` | admin | Update site settings |

## Tests

```bash
npm test
```

Runs an end-to-end suite (`node --test`) against an in-memory database: auth, content CRUD, slug de-duplication, draft/publish visibility, role enforcement, and settings.

## Project layout

```
server.js            entry point
src/app.js           express app wiring
src/db.js            schema, migrations, seed data
src/auth.js          JWT cookie auth
src/routes/          API + public site routes
public/admin/        admin panel SPA
test/                end-to-end API tests
```
