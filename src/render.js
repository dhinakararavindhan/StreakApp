const { marked } = require('marked');

/** Server-side body rendering for every content format. Used by the public
    sites, the headless API, and admin previews (which sanitize on top). */

const FORMATS = ['markdown', 'text', 'html', 'image', 'embed'];

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

/** The one entry point: HTML for a body in any format. */
function renderBody(format, body, excerpt = '') {
  switch (format) {
    case 'text':
      return textToHtml(body);
    case 'html':
      return String(body || '');
    case 'image':
      return imageToHtml(body, excerpt);
    case 'embed':
      return embedToHtml(body);
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

module.exports = { FORMATS, renderBody, fallbackExcerpt, textToHtml, embedToHtml, imageToHtml };
