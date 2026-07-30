/** AI site builder — describe a company in a sentence and Claude designs
    the site: theme, typography, layout, accent color, and starter content.

    Requires ANTHROPIC_API_KEY. Model defaults to Claude Opus 5 and can be
    overridden with NOVA_AI_MODEL. NOVA_AI_MOCK=1 swaps in a deterministic
    offline generator (used by the test suite and useful for demos). */

const { normalizeSite, VALID_THEMES } = require('./templates');

const DEFAULT_MODEL = 'claude-opus-5';

function aiAvailable() {
  return process.env.NOVA_AI_MOCK === '1' || Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `You design websites for Nova CMS. Given a description of a company or project,
respond with ONLY a JSON object (no prose, no code fences) shaped exactly like:
{
  "site_title": "string — the site name",
  "site_description": "string — one-line tagline, max 140 chars",
  "theme": "one of: ${VALID_THEMES.join(', ')}",
  "accent_color": "a hex color like #0e7490, or \\"\\" to use the theme default",
  "heading_font": "one of: sans, serif, mono",
  "layout": "one of: cards, list",
  "content_types": [ { "key": "room", "name": "Room", "name_plural": "Rooms",
    "schema": [ { "label": "Price per night (USD)", "kind": "number" } ] } ],
  "pages": [ { "title": "...", "body": "markdown", "excerpt": "" } ],
  "posts": [ { "title": "...", "body": "markdown", "excerpt": "one sentence", "tags": ["..."] } ],
  "items": [ { "type": "room", "title": "...", "body": "markdown", "excerpt": "...",
    "fields": { "price_per_night_usd": 180 } } ]
}
Guidelines:
- Pick the theme, font, and layout that genuinely fit the business (e.g. terminal+mono for dev tools, paper+serif for writers or cafés, noir for portfolios).
- Write 2-3 pages (About plus what the business needs: Menu, Pricing, Docs, Contact...) and 2-4 posts of real, specific, publishable starter content in the company's voice — no lorem ipsum, no placeholders like [Your Name].
- content_types and items are OPTIONAL: use them only when the business has structured, repeating content — hotel rooms, real-estate listings, gym classes, courses, tour dates. Field "kind" is one of text, longtext, number, date, url, select (select needs "options": "A, B, C"). Field keys in "items" are the lowercased label with non-alphanumerics as underscores, e.g. "Price per night (USD)" -> "price_per_night_usd"; dates are YYYY-MM-DD; select values must match an option exactly. Omit both for businesses that only need pages and posts.
- Markdown bodies may use headings, lists, tables, blockquotes, and code blocks where fitting.`;

/** Deterministic offline generator — same shape as the real thing. */
function mockSite(prompt) {
  const words = String(prompt).trim().split(/\s+/).slice(0, 4).join(' ') || 'New Site';
  const title = words.replace(/[.!?,]+$/, '');
  return {
    site_title: title,
    site_description: `${title} — built with the Nova AI site builder.`,
    theme: 'ocean',
    accent_color: '#0e7490',
    heading_font: 'sans',
    layout: 'cards',
    pages: [
      { title: 'About', body: `# About\n\n${title} was described as: "${String(prompt).trim()}".\n\nThis starter site was generated offline (mock mode).`, excerpt: '' },
    ],
    posts: [
      { title: 'Welcome to our new site', body: `We're live! This site was generated for: ${String(prompt).trim()}`, excerpt: 'Our new site is live.', tags: ['News'] },
    ],
  };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model returned no JSON object');
  return JSON.parse(text.slice(start, end + 1));
}

/** Generate a normalized site spec from a free-text description. */
async function generateSite(prompt) {
  if (process.env.NOVA_AI_MOCK === '1') return normalizeSite(mockSite(prompt));

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const message = await client.messages
    .stream({
      model: process.env.NOVA_AI_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Design a site for: ${String(prompt).trim()}` }],
    })
    .finalMessage();

  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return normalizeSite(extractJson(text));
}

// ---------- AI pre-review (runs when content is submitted for approval) ----------

const REVIEW_SYSTEM = `You are the pre-reviewer for a CMS approval queue. A manager submitted content;
a human admin will approve or reject it. Give the admin a fast, honest read.
Respond with ONLY a JSON object (no prose, no fences):
{
  "summary": "one sentence: what this content is, or what changed vs the live version",
  "notes": ["up to 4 short, specific observations — typos, unclear passages, factual red flags, tone mismatches, missing pieces. Empty array if it's clean."],
  "verdict": "looks_good" or "needs_attention"
}
Be concrete ("'recieve' misspelled in paragraph 2"), never generic ("consider improving clarity").
Judge the writing, not the opinion. needs_attention only for real problems an admin should look at.`;

function mockReview({ title, body }) {
  const words = String(body || '').trim().split(/\s+/).filter(Boolean).length;
  const notes = [];
  if (/todo|tktk|xxx|lorem ipsum/i.test(`${title} ${body}`)) notes.push('Contains placeholder text (TODO/lorem) that should not go live.');
  if (words < 20) notes.push(`Very short body (${words} words) — is it complete?`);
  return {
    summary: `Mock review of "${title}" — ${words} words.`,
    notes,
    verdict: notes.length ? 'needs_attention' : 'looks_good',
  };
}

/** Review a pending submission. `live` is the still-published version, if any. */
async function reviewContent({ title, body, excerpt, format, live }) {
  if (process.env.NOVA_AI_MOCK === '1') return mockReview({ title, body });
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const liveBlock = live
    ? `\n\nThe currently LIVE version (for comparison — describe what changed):\nTitle: ${live.title}\n${String(live.body).slice(0, 6000)}`
    : '';
  const message = await client.messages
    .stream({
      model: process.env.NOVA_AI_MODEL || DEFAULT_MODEL,
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      system: REVIEW_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Submitted for approval (format: ${format}):\nTitle: ${title}\nExcerpt: ${excerpt || '—'}\n\n${String(body).slice(0, 12000)}${liveBlock}`,
        },
      ],
    })
    .finalMessage();
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(text);
  return {
    summary: String(parsed.summary || '').slice(0, 300),
    notes: (Array.isArray(parsed.notes) ? parsed.notes : []).slice(0, 4).map((n) => String(n).slice(0, 300)),
    verdict: parsed.verdict === 'needs_attention' ? 'needs_attention' : 'looks_good',
  };
}

// ---------- AI translation (fills i18n translation groups) ----------

const TRANSLATE_SYSTEM = `You translate CMS content. Respond with ONLY a JSON object (no prose, no fences):
{ "title": "...", "body": "...", "excerpt": "..." }
Rules: preserve Markdown/HTML structure exactly (headings, lists, links, code blocks — translate link text but never URLs or code).
Keep proper nouns and brand names. Match the source register. Translate the excerpt too; keep it one sentence.`;

function mockTranslate({ title, body, excerpt }, targetLocale) {
  const tag = `[${targetLocale}]`;
  return { title: `${tag} ${title}`, body: `${tag} ${body}`, excerpt: excerpt ? `${tag} ${excerpt}` : '' };
}

/** Translate title/body/excerpt into targetLocale, preserving markup. */
async function translateContent(source, targetLocale) {
  if (process.env.NOVA_AI_MOCK === '1') return mockTranslate(source, targetLocale);
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const message = await client.messages
    .stream({
      model: process.env.NOVA_AI_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: TRANSLATE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Translate from "${source.locale}" to "${targetLocale}" (format: ${source.format}):\nTitle: ${source.title}\nExcerpt: ${source.excerpt || '—'}\n\n${String(source.body).slice(0, 30000)}`,
        },
      ],
    })
    .finalMessage();
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(text);
  return {
    title: String(parsed.title || source.title).slice(0, 200),
    body: String(parsed.body || ''),
    excerpt: String(parsed.excerpt || '').slice(0, 500),
  };
}

module.exports = { aiAvailable, generateSite, reviewContent, translateContent, DEFAULT_MODEL };
