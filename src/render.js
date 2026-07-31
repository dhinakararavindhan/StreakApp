const { marked } = require('marked');

/** Server-side body rendering for every content format. Used by the public
    sites, the headless API, and admin previews (which sanitize on top). */

const FORMATS = ['markdown', 'text', 'html', 'image', 'embed', 'blocks'];

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text → paragraphs; single newlines become <br>. */
function textToHtml(body) {
  return String(body || '')
    .split(/\n{2,}/)
    .filter((p) => p.trim() !== '')
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** Recognized video URLs become privacy-friendly iframes; anything else a link. */
function embedToHtml(url) {
  const u = String(url || '').trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/);
  if (yt) {
    return `<div class="embed-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${esc(yt[1])}" title="Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  const vimeo = u.match(/vimeo\.com\/(\d{6,12})/);
  if (vimeo) {
    return `<div class="embed-wrap"><iframe src="https://player.vimeo.com/video/${esc(vimeo[1])}" title="Video" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  return u ? `<p><a href="${esc(u)}" rel="noopener">${esc(u)}</a></p>` : '';
}

function imageToHtml(url, caption) {
  const u = String(url || '').trim();
  if (!u) return '';
  return `<figure class="body-image"><img src="${esc(u)}" alt="${esc(caption || '')}">${
    caption ? `<figcaption>${esc(caption)}</figcaption>` : ''
  }</figure>`;
}

const inline = (md) => marked.parseInline(String(md || ''));

/** Parse a 'blocks' body: a JSON array of typed blocks. */
function parseBlocks(body) {
  try {
    const parsed = JSON.parse(String(body || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Block-based bodies → HTML. ctx.formAction wires up contact-form blocks
    (absent in admin previews, where the form renders inert). */
function blocksToHtml(body, ctx = {}) {
  return parseBlocks(body)
    .map((b) => {
      switch (b && b.t) {
        case 'h': {
          const level = Math.min(4, Math.max(2, Number(b.level) || 2));
          return `<h${level}>${inline(b.md)}</h${level}>`;
        }
        case 'quote':
          return `<blockquote><p>${inline(b.md)}</p></blockquote>`;
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          const items = (Array.isArray(b.items) ? b.items : []).map((i) => `<li>${inline(i)}</li>`).join('');
          return `<${tag}>${items}</${tag}>`;
        }
        case 'code':
          return `<pre><code>${esc(b.code || '')}</code></pre>`;
        case 'img':
          return imageToHtml(b.src, b.caption);
        case 'embed':
          return embedToHtml(b.url);
        case 'button':
          return b.href ? `<p><a class="btn-block" href="${esc(b.href)}">${esc(b.label || 'Learn more')}</a></p>` : '';
        case 'hr':
          return '<hr>';
        case 'form':
          return contactFormHtml(ctx.formAction);
        case 'p':
        default:
          return b && b.md ? `<p>${inline(b.md)}</p>` : '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

/** The contact form a 'form' block renders on hosted sites. The hidden
    "website" field is a honeypot — humans never see it, bots fill it. */
function contactFormHtml(action) {
  return `<form class="contact-form" method="post" action="${esc(action || '#')}"${action ? '' : ' onsubmit="return false"'}>
  <label>Name<input name="name" required maxlength="120"></label>
  <label>Email<input type="email" name="email" required maxlength="200"></label>
  <label>Message<textarea name="message" rows="5" required maxlength="5000"></textarea></label>
  <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
  <button type="submit">Send message</button>
</form>`;
}

/** The one entry point: HTML for a body in any format. */
function renderBody(format, body, excerpt = '', ctx = {}) {
  switch (format) {
    case 'text':
      return textToHtml(body);
    case 'html':
      return String(body || '');
    case 'image':
      return imageToHtml(body, excerpt);
    case 'embed':
      return embedToHtml(body);
    case 'blocks':
      return blocksToHtml(body, ctx);
    case 'markdown':
    default:
      return marked.parse(String(body || ''));
  }
}

/** A plain-text teaser for cards and feeds when no excerpt was written. */
function fallbackExcerpt(format, body, max = 140) {
  const s = String(body || '');
  switch (format) {
    case 'html':
      return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    case 'blocks': {
      const first = parseBlocks(s).find((b) => b && (b.t === 'p' || b.t === 'h' || b.t === 'quote') && b.md);
      return first ? String(first.md).replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';
    }
    case 'image':
    case 'embed':
      return '';
    case 'text':
      return s.replace(/\s+/g, ' ').trim().slice(0, max);
    case 'markdown':
    default:
      return s.replace(/[#*_`>\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }
}

module.exports = { FORMATS, renderBody, fallbackExcerpt, textToHtml, embedToHtml, imageToHtml, blocksToHtml, parseBlocks };
