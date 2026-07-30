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
  "pages": [ { "title": "...", "body": "markdown", "excerpt": "" } ],
  "posts": [ { "title": "...", "body": "markdown", "excerpt": "one sentence", "tags": ["..."] } ]
}
Guidelines:
- Pick the theme, font, and layout that genuinely fit the business (e.g. terminal+mono for dev tools, paper+serif for writers or cafés, noir for portfolios).
- Write 2-3 pages (About plus what the business needs: Menu, Pricing, Docs, Contact...) and 2-4 posts of real, specific, publishable starter content in the company's voice — no lorem ipsum, no placeholders like [Your Name].
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

module.exports = { aiAvailable, generateSite, DEFAULT_MODEL };
