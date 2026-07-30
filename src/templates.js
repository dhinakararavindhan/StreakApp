/** Pre-configured site templates ("starter kits") and the shared engine
    that applies a site spec — template or AI-generated — to a company.

    A site spec is a plain object:
      { site_title?, site_description?, theme?, accent_color?, heading_font?,
        layout?, pages: [{title, body, format?}], posts: [{title, excerpt, body, tags?, format?}] }

    Applying a spec is an admin action, so starter content is inserted
    directly as `published` — the same right an admin exercises in the
    editor. Manager-authored edits to that content still go through the
    normal approval workflow afterwards. */

const { getDb, slugify, uniqueSlug } = require('./db');

// Keep in sync with THEMES / HEADING_FONTS in src/routes/public.js.
const VALID_THEMES = [
  'default', 'paper', 'forest', 'ocean', 'mint', 'lavender',
  'midnight', 'slate', 'noir', 'sunset', 'terminal',
];
const VALID_FONTS = ['sans', 'serif', 'mono'];
const VALID_LAYOUTS = ['cards', 'list'];
const VALID_FORMATS = ['markdown', 'text', 'html', 'image', 'embed'];

const SETTING_KEYS = ['site_title', 'site_description', 'theme', 'accent_color', 'heading_font', 'layout'];

const TEMPLATES = [
  {
    key: 'blog',
    name: 'Personal blog',
    description: 'A clean writing home — list layout, serif headings, warm paper theme.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'list', accent_color: '#b45309', site_description: 'Essays and notes, published occasionally.' },
    pages: [
      { title: 'About', body: "I write here about the things I'm learning and making. New posts land when they're ready — subscribe by [RSS](/feed.xml) and they'll find you.\n\nEverything on this site is my own opinion." },
      { title: 'Now', body: "A [now page](https://nownownow.com/about) — what I'm focused on at this moment:\n\n- Writing more, shorter\n- Reading: *The Making of the Atomic Bomb*\n- One ambitious project I'm not ready to talk about yet\n\n*Updated when things change.*" },
    ],
    posts: [
      { title: 'Hello, world', tags: ['Meta'], excerpt: 'Why this site exists, and what to expect.', body: "Every blog needs a first post, and this is mine.\n\nI'm starting this site to think in public. Expect essays, working notes, and the occasional strong opinion, loosely held.\n\n> The best time to start writing was ten years ago. The second best time is now.\n\nIf you want to follow along, there's an [RSS feed](/feed.xml)." },
      { title: 'What I read this month', tags: ['Reading'], excerpt: 'Three books, one regret, and a recommendation.', body: "## The list\n\n1. **A book I loved** — couldn't put it down\n2. **A book I respected** — dense but worth it\n3. **A book I abandoned** — life is short\n\nThe monthly reading post is a habit I'm stealing from better bloggers. It keeps me honest about actually finishing things." },
    ],
  },
  {
    key: 'marketing',
    name: 'Product site',
    description: 'A crisp company site — card layout, bold accent, announcement-ready.',
    settings: { theme: 'default', heading_font: 'sans', layout: 'cards', accent_color: '#4f46e5', site_description: 'The modern way to get it done.' },
    pages: [
      { title: 'About', body: "We started this company because the existing tools made easy things hard.\n\n**Our promise:** software that respects your time.\n\n## The team\n\nWe're a small, senior team that ships every week. We're default-remote and default-transparent." },
      { title: 'Pricing', body: "## Simple pricing\n\n| Plan | Price | For |\n|------|-------|-----|\n| Starter | Free | Trying it out |\n| Pro | $12/user/mo | Growing teams |\n| Enterprise | Let's talk | The big leagues |\n\nEvery plan includes every feature. Paid plans add seats, support, and SSO." },
      { title: 'Contact', body: "**Sales** — sales@example.com\n\n**Support** — support@example.com, answered within one business day\n\n**Everything else** — hello@example.com" },
    ],
    posts: [
      { title: 'Introducing our product', tags: ['Announcements'], excerpt: 'After a year of building, we are live. Here is what we made and why.', body: "# We're live\n\nToday we're opening the doors to everyone.\n\n## What it does\n\n- Sets up in minutes, not weeks\n- Works with the tools you already use\n- Priced so the whole team can be on it\n\n## What's next\n\nThis is day one. The [changelog](/) is where we'll announce everything that ships." },
      { title: 'Changelog: week one', tags: ['Changelog'], excerpt: 'Faster onboarding, two integrations, and a batch of fixes.', body: "## New\n\n- Two-minute guided onboarding\n- Integrations: Slack and GitHub\n\n## Improved\n\n- Dashboard loads 40% faster\n\n## Fixed\n\n- A dozen small paper cuts, reported by you" },
    ],
  },
  {
    key: 'docs',
    name: 'Documentation',
    description: 'A developer docs site — list layout, mono headings, terminal theme.',
    settings: { theme: 'terminal', heading_font: 'mono', layout: 'list', accent_color: '', site_description: 'Guides, reference, and examples.' },
    pages: [
      { title: 'Getting started', body: "## Install\n\n```bash\nnpm install your-package\n```\n\n## First steps\n\n```js\nconst thing = require('your-package');\nthing.start();\n```\n\nThat's it — you're running. Read the guides below for the full tour." },
      { title: 'API reference', body: "## `start(options)`\n\nBoots the service.\n\n| Option | Type | Default | Description |\n|--------|------|---------|-------------|\n| `port` | number | `3000` | Port to listen on |\n| `quiet` | boolean | `false` | Suppress startup logs |\n\n## `stop()`\n\nGraceful shutdown. Returns a promise that resolves when in-flight work drains." },
      { title: 'FAQ', body: "**Is it production-ready?**\nYes — versioned releases, semver, and a test suite.\n\n**How do I report a bug?**\nOpen an issue with a minimal reproduction. Minimal is the magic word.\n\n**Can I contribute?**\nPlease. Start with issues labeled `good first issue`." },
    ],
    posts: [
      { title: 'v1.0 release notes', tags: ['Releases'], excerpt: 'The API is stable. Here is everything in the first major release.', body: "# v1.0.0\n\nThe API is now **stable** — no breaking changes without a major version.\n\n## Highlights\n\n- Complete rewrite of the core loop: 3× faster\n- First-class TypeScript types\n- New plugin system\n\n## Upgrading\n\n```bash\nnpm install your-package@1\n```\n\nSee the migration guide for the two renamed options." },
    ],
  },
  {
    key: 'portfolio',
    name: 'Portfolio',
    description: 'A striking showcase — noir theme, serif headings, card layout.',
    settings: { theme: 'noir', heading_font: 'serif', layout: 'cards', accent_color: '#f43f5e', site_description: 'Selected work.' },
    pages: [
      { title: 'About', body: "I design and build things. This site collects the work I'm proudest of.\n\nCurrently **available for select projects** — reach out through the contact page." },
      { title: 'Contact', body: "The fastest way to reach me is email: **studio@example.com**\n\nFor project inquiries, include a sentence about scope and timeline and I'll reply within two days." },
    ],
    posts: [
      { title: 'Case study: the rebrand', tags: ['Case study'], excerpt: 'Twelve weeks from brief to launch — what worked and what I would do differently.', body: "# The brief\n\nA twenty-year-old company, a brand that had drifted. The ask: make it feel like the company its customers already believed it was.\n\n## The work\n\n- Research: 14 customer interviews\n- Identity: type, color, motion\n- Rollout: site, product, packaging\n\n## The result\n\nRecognition up, and — the metric I care about — the sales team started sending the deck unprompted." },
      { title: 'Side project: a tiny tool', tags: ['Side project'], excerpt: 'Built in a weekend, used every day since.', body: "Some projects are for clients. This one was for me: a small utility that removes one daily annoyance.\n\nBuilt in a weekend, refined over months. The lesson: **small scope, sharp edge**." },
    ],
  },
  {
    key: 'cafe',
    name: 'Café & local shop',
    description: 'A warm neighborhood storefront — paper theme, serif headings, menu page ready.',
    settings: { theme: 'paper', heading_font: 'serif', layout: 'cards', accent_color: '#b45309', site_description: 'Your neighborhood spot.' },
    pages: [
      { title: 'Menu', body: "## Coffee\n\n- Espresso — 3.50\n- Cappuccino — 4.50\n- Batch brew — 3.00\n- Seasonal single origin — ask us\n\n## Food\n\n- Morning bun — 4.00\n- Toast, jam, butter — 5.00\n- The good sandwich — 9.50\n\n*Everything baked in-house each morning.*" },
      { title: 'Visit', body: "**Hours**\n\n- Mon–Fri: 7am – 4pm\n- Sat–Sun: 8am – 5pm\n\n**Find us**\n\n123 Example Street — look for the striped awning. Bikes welcome, dogs adored." },
    ],
    posts: [
      { title: 'We are open', tags: ['News'], excerpt: 'The doors are open, the espresso is dialed in, and the first batch is out of the oven.', body: "# Come say hello\n\nAfter months of build-out, we're open.\n\nFirst week: every drink comes with something small and sweet from the oven, on us. Tell your neighbors." },
      { title: "This month's roast", tags: ['Coffee'], excerpt: 'A washed Ethiopian — bright, floral, and dangerously easy to drink.', body: "On the brew bar this month: a **washed Ethiopia Yirgacheffe**.\n\n- Tasting notes: jasmine, lemon, honey\n- Process: washed\n- Best as: pour-over, or black batch brew\n\nBeans available by the bag at the counter." },
    ],
  },
  {
    key: 'changelog',
    name: 'Changelog & updates',
    description: 'A product update feed — midnight theme, list layout, release-note posts.',
    settings: { theme: 'midnight', heading_font: 'sans', layout: 'list', accent_color: '#60a5fa', site_description: 'Every improvement, as it ships.' },
    pages: [
      { title: 'About this changelog', body: "We ship continuously and write it all down here. Follow along by [RSS](/feed.xml).\n\n**Versioning:** dates, not numbers. Every entry is something you can use today." },
    ],
    posts: [
      { title: 'New: dark mode', tags: ['New'], excerpt: 'The most-requested feature is live for everyone.', body: "## Dark mode is here\n\nFlip it in **Settings → Appearance**, or let it follow your system preference.\n\nThanks to the hundreds of you who asked — keep the requests coming." },
      { title: 'Improved: search is 5× faster', tags: ['Improved'], excerpt: 'A rebuilt index makes every query feel instant.', body: "We rebuilt the search index from scratch:\n\n- Median query: **38ms → 7ms**\n- Typo tolerance: now on by default\n- Filters combine properly\n\nNo action needed — it's already live." },
      { title: 'Fixed: a batch of paper cuts', tags: ['Fixed'], excerpt: 'Eleven small annoyances, gone.', body: "This week was a cleanup week:\n\n- Keyboard focus no longer escapes modals\n- Timezones respected in every date picker\n- Nine more, each reported by exactly one very persistent user\n\nKeep reporting the small stuff — we read all of it." },
    ],
  },
];

/** The template list as sent to the admin UI (no bodies — keep it light). */
function templateSummaries() {
  return TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    theme: t.settings.theme,
    accent_color: t.settings.accent_color || '',
    heading_font: t.settings.heading_font,
    layout: t.settings.layout,
    pages: t.pages.length,
    posts: t.posts.length,
  }));
}

function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null;
}

const str = (v, max = 400) => String(v == null ? '' : v).trim().slice(0, max);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** Clamp an untrusted site spec (e.g. AI output) to safe, valid values. */
function normalizeSite(spec = {}) {
  const items = (list, max) =>
    (Array.isArray(list) ? list : [])
      .slice(0, max)
      .map((it) => ({
        title: str(it && it.title, 200),
        body: str(it && it.body, 20000),
        excerpt: str(it && it.excerpt, 500),
        format: pick(it && it.format, VALID_FORMATS, 'markdown'),
        tags: (Array.isArray(it && it.tags) ? it.tags : []).slice(0, 5).map((t) => str(t, 40)).filter(Boolean),
      }))
      .filter((it) => it.title);
  return {
    site_title: str(spec.site_title, 120),
    site_description: str(spec.site_description, 300),
    theme: pick(spec.theme, VALID_THEMES, 'default'),
    accent_color: /^#[0-9a-f]{3,8}$/i.test(spec.accent_color || '') ? spec.accent_color : '',
    heading_font: pick(spec.heading_font, VALID_FONTS, 'sans'),
    layout: pick(spec.layout, VALID_LAYOUTS, 'cards'),
    pages: items(spec.pages, 6),
    posts: items(spec.posts, 8),
  };
}

/** Apply a site spec to a company: settings + published starter content.
    Returns { settings, created } — created is the number of content items. */
function applySite(teamId, spec, user) {
  const db = getDb();
  const putSetting = db.prepare(
    `INSERT INTO team_settings (team_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(team_id, key) DO UPDATE SET value = excluded.value`
  );
  const applied = {};
  for (const key of SETTING_KEYS) {
    if (spec.settings ? spec.settings[key] !== undefined : spec[key] !== undefined) {
      const value = String((spec.settings ? spec.settings[key] : spec[key]) ?? '');
      putSetting.run(teamId, key, value);
      applied[key] = value;
    }
  }

  const insertContent = db.prepare(
    `INSERT INTO content (team_id, type, title, slug, body, format, excerpt, status, author_id, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'published', ?, datetime('now'))`
  );
  const findTag = db.prepare('SELECT id FROM tags WHERE team_id = ? AND slug = ?');
  const insertTag = db.prepare('INSERT INTO tags (team_id, name, slug) VALUES (?, ?, ?)');
  const linkTag = db.prepare('INSERT OR IGNORE INTO content_tags (content_id, tag_id) VALUES (?, ?)');

  let created = 0;
  const insertItem = (type, item) => {
    const slug = uniqueSlug(item.title, teamId);
    const result = insertContent.run(
      teamId, type, item.title, slug,
      item.body || '', item.format || 'markdown', item.excerpt || '',
      user ? user.id : null
    );
    for (const name of item.tags || []) {
      const tagSlug = slugify(name);
      const existing = findTag.get(teamId, tagSlug);
      const tagId = existing ? existing.id : insertTag.run(teamId, name, tagSlug).lastInsertRowid;
      linkTag.run(result.lastInsertRowid, tagId);
    }
    created++;
  };

  db.transaction(() => {
    for (const page of spec.pages || []) insertItem('page', page);
    for (const post of spec.posts || []) insertItem('post', post);
  })();

  return { settings: applied, created };
}

module.exports = { TEMPLATES, templateSummaries, getTemplate, normalizeSite, applySite, VALID_THEMES };
