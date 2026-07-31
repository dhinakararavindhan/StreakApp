/** Nova CMS JavaScript SDK — zero dependencies, works in Node 18+ and
    browsers (served at /sdk/nova-sdk.js on every Nova install).

    const nova = new NovaClient({ baseUrl: 'https://cms.example.com', apiKey: 'nova_…' });
    const posts = await nova.site('acme').posts();            // public, no key needed
    const drafts = await nova.team(3).content.list();          // read key: drafts included
    await nova.team(3).content.create({ title: 'Hello' });     // write key: lands as draft/pending

    API keys are company-scoped: read keys can GET everything including
    drafts; write keys act as a manager, so writes go through the approval
    workflow — a leaked CI key can never publish. */

class NovaError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'NovaError';
    this.status = status;
    this.body = body;
  }
}

class NovaClient {
  constructor({ baseUrl = '', apiKey = null, fetch: fetchImpl } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!this.fetch) throw new Error('No fetch available — pass { fetch } explicitly');
  }

  async request(method, path, { body, formData, query } = {}) {
    const url = new URL(this.baseUrl + path, this.baseUrl || 'http://localhost');
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    const headers = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetch(this.baseUrl ? url.toString() : url.pathname + url.search, {
      method,
      headers,
      body: formData !== undefined ? formData : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new NovaError(data.error || `Request failed (${res.status})`, res.status, data);
    return data;
  }

  /** Authenticated, company-scoped surface (requires an API key or session). */
  team(teamId) {
    const base = `/api/teams/${teamId}`;
    const req = this.request.bind(this);
    return {
      content: {
        list: (query) => req('GET', `${base}/content`, { query }),
        get: (id) => req('GET', `${base}/content/${id}`),
        create: (data) => req('POST', `${base}/content`, { body: data }),
        update: (id, data) => req('PUT', `${base}/content/${id}`, { body: data }),
        trash: (id) => req('DELETE', `${base}/content/${id}`),
        untrash: (id) => req('POST', `${base}/content/${id}/untrash`),
        duplicate: (id) => req('POST', `${base}/content/${id}/duplicate`),
        approve: (id) => req('POST', `${base}/content/${id}/approve`),
        reject: (id, note) => req('POST', `${base}/content/${id}/reject`, { body: { note } }),
        versions: (id) => req('GET', `${base}/content/${id}/versions`),
        comments: (id) => req('GET', `${base}/content/${id}/comments`),
        comment: (id, body) => req('POST', `${base}/content/${id}/comments`, { body: { body } }),
        shareLink: (id, days) => req('POST', `${base}/content/${id}/share-link`, { body: { days } }),
        aiTranslate: (id, locale) => req('POST', `${base}/content/${id}/ai-translate`, { body: { locale } }),
      },
      types: {
        list: () => req('GET', `${base}/content-types`),
        create: (data) => req('POST', `${base}/content-types`, { body: data }),
        update: (id, data) => req('PUT', `${base}/content-types/${id}`, { body: data }),
        remove: (id) => req('DELETE', `${base}/content-types/${id}`),
      },
      media: {
        list: () => req('GET', `${base}/media`),
        upload: (file, filename) => {
          const fd = new FormData();
          fd.append('file', file, filename);
          return req('POST', `${base}/media`, { formData: fd });
        },
      },
      forms: {
        list: () => req('GET', `${base}/forms`),
        remove: (id) => req('DELETE', `${base}/forms/${id}`),
      },
      stats: () => req('GET', `${base}/stats`),
      settings: {
        get: () => req('GET', `${base}/settings`),
        update: (data) => req('PUT', `${base}/settings`, { body: data }),
      },
      export: () => req('GET', `${base}/export`),
      applyTemplate: (template) => req('POST', `${base}/apply-template`, { body: { template } }),
    };
  }

  /** The public, no-auth headless API for one company's site. */
  site(companySlug) {
    const base = `/api/public/${companySlug}`;
    const req = this.request.bind(this);
    return {
      profile: () => req('GET', base),
      content: (query) => req('GET', `${base}/content`, { query }),
      posts: (query) => req('GET', `${base}/content`, { query: { type: 'post', ...query } }),
      get: (slug) => req('GET', `${base}/content/${encodeURIComponent(slug)}`),
      search: (q, query) => req('GET', `${base}/content`, { query: { q, ...query } }),
      submitForm: (data) => req('POST', `${base}/forms`, { body: data }),
    };
  }

  health() {
    return this.request('GET', '/api/health');
  }
}

/* eslint-disable no-undef */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NovaClient, NovaError };
} else if (typeof window !== 'undefined') {
  window.NovaClient = NovaClient;
  window.NovaError = NovaError;
}
