/* Nova CMS admin — hash-routed SPA over the REST API.
   Roles: superadmin (platform) > admin (company owner) > manager (employee). */
(() => {
  const app = document.getElementById('app');
  document.documentElement.dataset.theme = localStorage.getItem('nova_theme') || 'light';
  let me = null;
  let companies = [];
  let company = null; // active company

  const esc = (s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></svg>';
  const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z"/></svg>';

  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
    content: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>',
    media: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15.5l-4.5-4.5L6 21"/></svg>',
    tags: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.6 13.4L11 3.8H4v7l9.6 9.6a2 2 0 002.8 0l4.2-4.2a2 2 0 000-2.8z"/><circle cx="7.5" cy="7.3" r="1.2"/></svg>',
    company: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><circle cx="17" cy="9" r="2.3"/><path d="M17 14.5c2.3 0 4 1.6 4 3.8"/></svg>',
    platform: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>',
    account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>',
    approvals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8.2 12.4l2.6 2.6 5-5.6"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5l3.2 1.9"/></svg>',
  };

  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
      ...options,
      body:
        options.body instanceof FormData
          ? options.body
          : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  const capi = (path, options) => api(`/teams/${company.id}${path}`, options);

  // ---------- toasts ----------

  function toast(text, kind = 'ok') {
    let host = document.getElementById('toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toasts';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), kind === 'ok' ? 2600 : 5000);
  }
  const flash = (el, text, kind = 'ok') => toast(text, kind);

  // ---------- auth screens ----------

  const PORTALS = {
    superadmin: { label: 'Super Admin', hint: 'Platform operators — full platform oversight.' },
    admin: { label: 'Admin', hint: 'Company owners — branding, domain, members, content.' },
    manager: { label: 'Manager', hint: 'Company employees — content, media, and tags.' },
  };

  function renderLogin(mode = 'login', portal = 'manager') {
    const isLogin = mode === 'login';
    const segs = Object.entries(PORTALS)
      .map(([key, p]) => `<button type="button" data-portal="${key}" class="${key === portal ? 'on' : ''}">${p.label}</button>`)
      .join('');
    app.innerHTML = `
      <div class="login-wrap"><form class="login-box" id="login-form">
        <div class="brand brand-lg">NOVA<span class="spark"> ✦</span></div>
        <p class="tagline">${isLogin ? 'The multi-company content platform.' : 'Create your account — then launch your company workspace.'}</p>
        ${isLogin ? `<div class="seg" id="portal-seg">${segs}</div><p class="portal-hint" id="portal-hint">${PORTALS[portal].hint}</p>` : ''}
        <label>Username</label><input name="username" required autofocus autocomplete="username">
        <label>Password${isLogin ? '' : ' (min 8 chars)'}</label><input name="password" type="password" required autocomplete="${isLogin ? 'current-password' : 'new-password'}">
        <p><button class="btn" style="width:100%;justify-content:center">${isLogin ? `Sign in as ${PORTALS[portal].label}` : 'Create account'}</button></p>
        <p style="text-align:center;font-size:0.82rem;color:var(--muted)">
          ${isLogin
            ? 'New here? <a href="#" id="switch">Create an account</a>'
            : 'Already registered? <a href="#" id="switch">Sign in</a>'}
        </p>
      </form></div>`;
    document.getElementById('switch').addEventListener('click', (e) => {
      e.preventDefault();
      renderLogin(isLogin ? 'register' : 'login', portal);
    });
    if (isLogin) {
      document.querySelectorAll('#portal-seg button').forEach((b) =>
        b.addEventListener('click', () => renderLogin('login', b.dataset.portal))
      );
    }
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        me = await api(isLogin ? '/auth/login' : '/auth/register', {
          method: 'POST',
          body: { username: f.get('username'), password: f.get('password') },
        });
        // Verify the account actually holds the portal's role.
        if (isLogin && !(await portalAllows(portal))) {
          await api('/auth/logout', { method: 'POST' });
          me = null;
          toast(portalDeniedMessage(portal), 'error');
          return;
        }
        location.hash = '#/dashboard';
        boot();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  /** Superadmins pass every portal; admins need an admin seat; managers any membership. */
  async function portalAllows(portal) {
    if (me.role === 'superadmin') return true;
    if (portal === 'superadmin') return false;
    const mine = await api('/teams');
    if (portal === 'admin') return mine.some((c) => c.my_role === 'admin');
    return true; // manager portal: membership is checked at company selection
  }

  function portalDeniedMessage(portal) {
    return portal === 'superadmin'
      ? 'This account is not a platform superadmin. Use the Admin or Manager sign-in.'
      : 'This account has no company admin seat. Use the Manager sign-in.';
  }

  function renderCreateCompany() {
    app.innerHTML = `
      <div class="login-wrap"><form class="login-box" id="company-form">
        <div class="brand brand-lg">NOVA<span class="spark"> ✦</span></div>
        <p class="tagline">Launch your company workspace — content, media, members, and a public site, fully yours.</p>
        <label>Company name</label><input name="name" required autofocus placeholder="e.g. Acme Inc.">
        <p><button class="btn" style="width:100%">Create company</button></p>
        <p style="text-align:center;font-size:0.85rem"><a href="#" id="logout">Sign out</a></p>
      </form></div>`;
    document.getElementById('logout').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/auth/logout', { method: 'POST' });
      me = null;
      renderLogin();
    });
    document.getElementById('company-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const created = await api('/teams', { method: 'POST', body: { name: f.get('name') } });
        companies.push(created);
        setActiveCompany(created);
        location.hash = '#/dashboard';
        render();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function setActiveCompany(c) {
    company = c;
    localStorage.setItem('cms_active_team', String(c.id));
  }

  // ---------- shell ----------

  const NAV = [
    ['#/dashboard', 'Dashboard', 'dashboard'],
    ['#/content', 'Content', 'content'],
    ['#/media', 'Media', 'media'],
    ['#/tags', 'Tags', 'tags'],
    ['#/approvals', 'Approvals', 'approvals', 'company-admin'],
    ['#/activity', 'Activity', 'activity', 'company-admin'],
    ['#/company', 'Company', 'company'],
    ['#/platform', 'Platform', 'platform', 'superadmin'],
    ['#/account', 'Account', 'account'],
  ];

  const isCompanyAdmin = () => me.role === 'superadmin' || (company && company.my_role === 'admin');

  function shell(active, inner) {
    const links = NAV.filter(([, , , need]) =>
      !need || (need === 'superadmin' ? me.role === 'superadmin' : need === 'company-admin' ? isCompanyAdmin() : true)
    )
      .map(
        ([href, label, icon]) =>
          `<a class="navlink ${active === href ? 'active' : ''}" href="${href}" title="${label}">${ICONS[icon]}<span class="label">${label}</span></a>`
      )
      .join('');
    const options = companies
      .map((c) => `<option value="${c.id}" ${company && c.id === company.id ? 'selected' : ''}>${esc(c.name)}</option>`)
      .join('');
    const roleChip =
      me.role === 'superadmin'
        ? '<span class="role-chip super">SUPER ADMIN</span>'
        : `<span class="role-chip">${esc((company && company.my_role) || 'member').toUpperCase()}</span>`;
    const activeLabel = (NAV.find(([href]) => href === active) || [null, 'Dashboard'])[1];
    const collapsed = localStorage.getItem('nova_side') === 'min';
    app.innerHTML = `
      <div class="app ${collapsed ? 'collapsed' : ''}" id="frame">
        <aside class="sidebar">
          <div class="side-head"><div class="brand">NOVA<span class="spark"> ✦</span></div></div>
          <select class="switcher" id="company-switch" title="Active company">${options}</select>
          <a class="new-co" href="#" id="new-company">+ New company</a>
          ${links}
          <div class="spacer"></div>
          <a class="navlink" href="/t/${esc(company.slug)}" target="_blank" title="View site">${ICONS.platform}<span class="label">View site ↗</span></a>
          <div class="foot"><kbd>Ctrl</kbd>+<kbd>K</kbd> palette</div>
        </aside>
        <div class="main">
          <header class="topbar">
            <button class="iconbtn" id="side-toggle" title="Toggle sidebar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
            </button>
            <div class="crumb"><b>${esc(company.name)}</b><span class="sep">/</span>${esc(activeLabel)}</div>
            <div class="grow"></div>
            <button class="searchbtn" id="open-palette">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
              Search or jump to…<kbd>Ctrl K</kbd>
            </button>
            <button class="iconbtn" id="theme-toggle" title="Toggle light/dark">
              ${document.documentElement.dataset.theme === 'light' ? ICON_MOON : ICON_SUN}
            </button>
            <div class="userbox">
              <a class="avatar" href="#/account" title="Account">${esc(me.username[0].toUpperCase())}</a>
              <span class="name">${esc(me.username)}</span>
              ${roleChip}
            </div>
            <button class="iconbtn" id="logout" title="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            </button>
          </header>
          <div class="content" id="page">${inner}</div>
        </div>
      </div>`;
    document.getElementById('side-toggle').addEventListener('click', () => {
      const frame = document.getElementById('frame');
      if (window.innerWidth <= 780) {
        frame.classList.toggle('side-open');
        return;
      }
      frame.classList.toggle('collapsed');
      localStorage.setItem('nova_side', frame.classList.contains('collapsed') ? 'min' : 'full');
    });
    document.getElementById('open-palette').addEventListener('click', openPalette);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('nova_theme', next);
      document.getElementById('theme-toggle').innerHTML = next === 'light' ? ICON_MOON : ICON_SUN;
    });
    if (isCompanyAdmin()) {
      capi('/stats')
        .then((s) => {
          const link = document.querySelector('a.navlink[href="#/approvals"]');
          if (link && s.pending > 0) link.insertAdjacentHTML('beforeend', `<span class="badge">${s.pending}</span>`);
        })
        .catch(() => {});
    }
    document.getElementById('company-switch').addEventListener('change', (e) => {
      const next = companies.find((c) => c.id === Number(e.target.value));
      if (next) {
        setActiveCompany(next);
        render();
      }
    });
    document.getElementById('new-company').addEventListener('click', (e) => {
      e.preventDefault();
      const name = prompt('Company name:');
      if (!name) return;
      api('/teams', { method: 'POST', body: { name } })
        .then((created) => {
          companies.push(created);
          setActiveCompany(created);
          toast(`Company "${created.name}" created.`);
          render();
        })
        .catch((err) => toast(err.message, 'error'));
    });
    document.getElementById('logout').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/auth/logout', { method: 'POST' });
      me = null;
      company = null;
      renderLogin();
    });
    return document.getElementById('page');
  }

  // ---------- dashboard ----------

  async function renderDashboard() {
    const page = shell('#/dashboard', `<h1>Dashboard <span class="sub">${esc(company.name)}</span></h1><div id="body">Loading…</div>`);
    const s = await capi('/stats');
    const kpi = (n, l, hi) => `<div class="kpi ${hi ? 'hi' : ''}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    page.querySelector('#body').innerHTML = `
      <div class="kpis">
        ${kpi(s.published, 'Published', true)}${kpi(s.pending, 'In review', s.pending > 0)}${kpi(s.drafts, 'Drafts')}${kpi(s.posts, 'Posts')}${kpi(s.pages, 'Pages')}${kpi(s.media, 'Media files')}${kpi(s.members, 'Members')}
      </div>
      <div class="toolbar">
        <a class="btn" href="#/edit/new">+ New content</a>
        <a class="btn secondary" href="/t/${esc(company.slug)}" target="_blank">Open public site ↗</a>
      </div>
      <h2 class="sec">Recently updated</h2>
      ${s.recent.length ? `
      <table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>By</th><th>Updated</th></tr></thead>
      <tbody>${s.recent
        .map(
          (r) => `<tr>
            <td><a href="#/edit/${r.id}"><b>${esc(r.title)}</b></a></td>
            <td>${esc(r.type)}</td>
            <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td>
            <td>${esc(r.author || '—')}</td>
            <td>${esc(r.updated_at.slice(0, 16))}</td>
          </tr>`
        )
        .join('')}</tbody></table>` : '<p style="color:var(--muted)">Nothing yet — create your first piece of content.</p>'}`;
  }

  // ---------- content list ----------

  async function renderContentList() {
    const page = shell('#/content', '<h1>Content <a class="btn" href="#/edit/new">+ New</a></h1><div id="list">Loading…</div>');
    const listEl = page.querySelector('#list');
    const state = { type: '', status: '', search: '' };

    async function load() {
      const q = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
      const rows = await capi(`/content?${q}`);
      listEl.innerHTML = `
        <div class="toolbar">
          <select id="f-type"><option value="">All types</option><option value="post">Posts</option><option value="page">Pages</option></select>
          <select id="f-status"><option value="">All statuses</option><option value="draft">Draft</option><option value="pending">Pending</option><option value="published">Published</option></select>
          <input id="f-search" placeholder="Search…" value="${esc(state.search)}">
        </div>
        <table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
              <td><a href="#/edit/${r.id}"><b>${esc(r.title)}</b></a><br><span class="path">/${esc(r.slug)}</span></td>
              <td>${esc(r.type)}</td>
              <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td>
              <td>${esc(r.updated_at.slice(0, 16))}</td>
              <td><button class="btn danger sm" data-del="${r.id}">Delete</button></td>
            </tr>`
          )
          .join('') || '<tr><td colspan="5">Nothing here yet.</td></tr>'}</tbody></table>`;
      listEl.querySelector('#f-type').value = state.type;
      listEl.querySelector('#f-status').value = state.status;
      listEl.querySelector('#f-type').addEventListener('change', (e) => { state.type = e.target.value; load(); });
      listEl.querySelector('#f-status').addEventListener('change', (e) => { state.status = e.target.value; load(); });
      listEl.querySelector('#f-search').addEventListener('change', (e) => { state.search = e.target.value; load(); });
      listEl.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this item permanently?')) return;
          await capi(`/content/${btn.dataset.del}`, { method: 'DELETE' });
          toast('Deleted.');
          load();
        })
      );
    }
    await load();
  }

  // ---------- editor ----------

  const toLocalDT = (v) => (v ? v.slice(0, 16).replace(' ', 'T') : '');

  async function renderEditor(id) {
    const isNew = id === 'new';
    const item = isNew
      ? { type: 'post', title: '', slug: '', body: '', excerpt: '', cover_image: '', status: 'draft', tags: [], publish_at: null, expire_at: null }
      : await capi(`/content/${id}`);

    const canPublish = isCompanyAdmin();
    // Managers never hold a live 'published' selection — their edits to
    // live content go back through review.
    const effectiveStatus = !canPublish && item.status === 'published' ? 'pending' : item.status;
    const statusOptions = canPublish
      ? `<option value="draft" ${effectiveStatus === 'draft' ? 'selected' : ''}>Draft</option>
         <option value="pending" ${effectiveStatus === 'pending' ? 'selected' : ''}>Pending review</option>
         <option value="published" ${effectiveStatus === 'published' ? 'selected' : ''}>Published</option>`
      : `<option value="draft" ${effectiveStatus === 'draft' ? 'selected' : ''}>Draft</option>
         <option value="pending" ${effectiveStatus === 'pending' ? 'selected' : ''}>Submit for approval</option>`;
    const managerHint = !canPublish
      ? `<p class="portal-hint" style="margin-top:0.3rem">${item.status === 'published' ? 'This item is live — saving sends your changes back for admin approval; the current version stays up meanwhile.' : 'Publishing requires admin approval.'}</p>`
      : '';
    const reviewNote = item.review_note
      ? `<div class="msg error" style="grid-column:1/-1">Changes requested by an admin: ${esc(item.review_note)}</div>`
      : '';

    const page = shell('#/content', `
      <h1>${isNew ? 'New content' : 'Edit content'} <span class="sub" id="autosave-state">${esc(company.name)}</span></h1>
      <form id="editor" class="editor-grid">
        ${reviewNote}
        <div class="card">
          <label>Title</label><input name="title" required value="${esc(item.title)}">
          <label>Body (Markdown)</label><textarea name="body" rows="18">${esc(item.body)}</textarea>
          <select id="insert-img" style="margin-top:0.5rem"><option value="">Insert image from media library…</option></select>
          <label>Excerpt</label><textarea name="excerpt" rows="2">${esc(item.excerpt)}</textarea>
        </div>
        <div class="card">
          <label>Type</label>
          <select name="type" ${isNew ? '' : 'disabled'}>
            <option value="post" ${item.type === 'post' ? 'selected' : ''}>Post</option>
            <option value="page" ${item.type === 'page' ? 'selected' : ''}>Page</option>
          </select>
          <label>Status</label>
          <select name="status">${statusOptions}</select>
          ${managerHint}
          <label>Go live at (UTC — blank: immediately)</label>
          <input type="datetime-local" name="publish_at" value="${toLocalDT(item.publish_at)}">
          <label>Expire at (UTC — blank: never)</label>
          <input type="datetime-local" name="expire_at" value="${toLocalDT(item.expire_at)}">
          <label>Cover image (URL or pick an upload)</label>
          <input name="cover_image" list="media-list" value="${esc(item.cover_image)}" placeholder="/uploads/…">
          <datalist id="media-list"></datalist>
          <img class="cover-preview" id="cover-preview" alt="">
          <label>Slug (blank = from title)</label><input name="slug" value="${esc(item.slug)}">
          <label>Tags (comma-separated)</label><input name="tags" value="${esc(item.tags.map((t) => t.name).join(', '))}">
          <p style="display:flex;gap:0.5rem;margin-top:1.2rem">
            <button class="btn">Save</button>
            <a class="btn secondary" href="#/content">Back</a>
          </p>
        </div>
      </form>
      ${!isNew ? `
      <div class="card" style="margin-top:0.9rem"><b>Discussion</b><div id="comments-host" style="margin-top:0.5rem">Loading…</div></div>
      <div class="card" style="margin-top:0.9rem"><b>Version history</b><div id="history-host" style="margin-top:0.6rem">Loading…</div></div>` : ''}`);

    // Cover preview + media suggestions for both cover picker and image insert.
    const coverInput = page.querySelector('[name=cover_image]');
    const preview = page.querySelector('#cover-preview');
    const updatePreview = () => {
      const v = coverInput.value.trim();
      preview.src = v || '';
      preview.style.display = v ? 'block' : 'none';
    };
    coverInput.addEventListener('input', updatePreview);
    updatePreview();
    capi('/media')
      .then((rows) => {
        const images = rows.filter((m) => m.mime_type.startsWith('image/'));
        page.querySelector('#media-list').innerHTML = images
          .map((m) => `<option value="${esc(m.url)}">${esc(m.original_name)}</option>`)
          .join('');
        page.querySelector('#insert-img').insertAdjacentHTML(
          'beforeend',
          images.map((m) => `<option value="${esc(m.url)}">${esc(m.original_name)}</option>`).join('')
        );
      })
      .catch(() => {});

    // Insert markdown image at the cursor.
    const bodyEl = page.querySelector('textarea[name=body]');
    page.querySelector('#insert-img').addEventListener('change', (e) => {
      const url = e.target.value;
      if (!url) return;
      const start = bodyEl.selectionStart ?? bodyEl.value.length;
      const end = bodyEl.selectionEnd ?? start;
      bodyEl.value = `${bodyEl.value.slice(0, start)}\n![](${url})\n${bodyEl.value.slice(end)}`;
      e.target.value = '';
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
      bodyEl.focus();
    });

    const collect = (f) => ({
      title: f.get('title'),
      body: f.get('body'),
      excerpt: f.get('excerpt'),
      cover_image: f.get('cover_image'),
      status: f.get('status'),
      slug: f.get('slug'),
      publish_at: f.get('publish_at') || '',
      expire_at: f.get('expire_at') || '',
      tags: f.get('tags').split(',').map((t) => t.trim()).filter(Boolean),
    });

    page.querySelector('#editor').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = collect(f);
      if (isNew) body.type = f.get('type');
      try {
        const saved = isNew
          ? await capi('/content', { method: 'POST', body })
          : await capi(`/content/${id}`, { method: 'PUT', body });
        toast('Saved.');
        if (isNew) {
          location.hash = `#/edit/${saved.id}`;
        } else {
          e.target.querySelector('[name=slug]').value = saved.slug;
        }
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Autosave — drafts only, so autosaving can never trigger a review round-trip.
    if (!isNew && item.status === 'draft') {
      const form = page.querySelector('#editor');
      let timer;
      form.addEventListener('input', () => {
        if (form.querySelector('[name=status]').value !== 'draft') return;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            const saved = await capi(`/content/${id}`, { method: 'PUT', body: collect(new FormData(form)) });
            form.querySelector('[name=slug]').value = saved.slug;
            const state = page.querySelector('#autosave-state');
            if (state) state.textContent = `Autosaved ${new Date().toLocaleTimeString()}`;
          } catch {
            // surfaced on manual save
          }
        }, 2500);
      });
    }

    if (!isNew) {
      mountComments(page.querySelector('#comments-host'), id);

      const historyHost = page.querySelector('#history-host');
      async function loadHistory() {
        const versions = await capi(`/content/${id}/versions`);
        historyHost.innerHTML = versions.length
          ? `<table><thead><tr><th>When</th><th>By</th><th>Title</th><th></th></tr></thead>
            <tbody>${versions
              .slice(0, 15)
              .map(
                (v, i) => `<tr>
                  <td>${esc(v.created_at.slice(0, 16))}</td>
                  <td>${esc(v.edited_by || '—')}</td>
                  <td>${esc(v.title)}</td>
                  <td>${i === 0 ? '<span class="path">current</span>' : `<button type="button" class="btn secondary sm" data-restore="${v.id}">Restore</button>`}</td>
                </tr>`
              )
              .join('')}</tbody></table>`
          : '<p class="path">No versions yet.</p>';
        historyHost.querySelectorAll('[data-restore]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            if (!confirm('Restore this version? Your workflow rules still apply to the restored content.')) return;
            try {
              await capi(`/content/${id}/versions/${btn.dataset.restore}/restore`, { method: 'POST' });
              toast('Version restored.');
              render();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
      }
      loadHistory();
    }
  }

  // ---------- comments (shared by editor + review) ----------

  async function mountComments(host, contentId) {
    async function load() {
      const rows = await capi(`/content/${contentId}/comments`);
      host.innerHTML = `
        <div class="comments">${rows
          .map(
            (c) => `<div class="comment"><span class="who">${esc(c.author || 'deleted user')}</span><span class="when">${esc(c.created_at.slice(0, 16))}</span><div>${esc(c.body)}</div></div>`
          )
          .join('') || '<p class="path" style="margin:0.4rem 0">No comments yet — start the discussion.</p>'}</div>
        <form class="toolbar" style="margin-bottom:0">
          <input name="body" placeholder="Write a comment…" required style="flex:1">
          <button class="btn sm">Comment</button>
        </form>`;
      host.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await capi(`/content/${contentId}/comments`, {
            method: 'POST',
            body: { body: new FormData(e.target).get('body') },
          });
          load();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
    await load();
  }

  // ---------- media ----------

  async function renderMedia() {
    const page = shell('#/media', `
      <h1>Media <span class="sub">${esc(company.name)}</span></h1>
      <div class="toolbar"><input type="file" id="file" style="max-width:280px"><button class="btn" id="upload">Upload</button></div>
      <div class="media-grid" id="grid">Loading…</div>`);

    async function load() {
      const rows = await capi('/media');
      page.querySelector('#grid').innerHTML =
        rows
          .map(
            (m) => `<div class="card">
              ${m.mime_type.startsWith('image/') ? `<img src="${esc(m.url)}" alt="">` : '<div style="font-size:1.6rem">📄</div>'}
              <div style="margin-top:0.4rem"><a href="${esc(m.url)}" target="_blank">${esc(m.original_name)}</a></div>
              <div style="color:var(--muted)">${(m.size / 1024).toFixed(1)} KB</div>
              <button class="btn danger sm" data-del="${m.id}" style="margin-top:0.5rem">Delete</button>
            </div>`
          )
          .join('') || '<p style="color:var(--muted)">No files uploaded yet.</p>';
      page.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this file?')) return;
          await capi(`/media/${btn.dataset.del}`, { method: 'DELETE' });
          toast('Deleted.');
          load();
        })
      );
    }
    page.querySelector('#upload').addEventListener('click', async () => {
      const input = page.querySelector('#file');
      if (!input.files[0]) return;
      const fd = new FormData();
      fd.append('file', input.files[0]);
      try {
        await capi('/media', { method: 'POST', body: fd });
        input.value = '';
        toast('Uploaded.');
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    await load();
  }

  // ---------- tags ----------

  async function renderTags() {
    const page = shell('#/tags', `<h1>Tags <span class="sub">${esc(company.name)}</span></h1><div id="list">Loading…</div>`);
    async function load() {
      const rows = await capi('/tags');
      page.querySelector('#list').innerHTML = `
        <table><thead><tr><th>Name</th><th>Slug</th><th>Used by</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.slug)}</td><td>${t.content_count} item(s)</td>
            <td><button class="btn danger sm" data-del="${t.id}">Delete</button></td></tr>`
          )
          .join('') || '<tr><td colspan="4">No tags yet — add them when editing content.</td></tr>'}</tbody></table>`;
      page.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this tag? It will be removed from all content.')) return;
          await capi(`/tags/${btn.dataset.del}`, { method: 'DELETE' });
          toast('Deleted.');
          load();
        })
      );
    }
    await load();
  }

  // ---------- approvals (company admins) ----------

  async function renderApprovals() {
    const page = shell('#/approvals', `<h1>Approvals <span class="sub">${esc(company.name)}</span></h1><div id="list">Loading…</div>`);
    async function load() {
      const rows = await capi('/content?status=pending');
      page.querySelector('#list').innerHTML = rows.length
        ? `<table><thead><tr><th>Title</th><th>Type</th><th>By</th><th>Updated</th><th style="width:1%"></th></tr></thead>
          <tbody>${rows
            .map(
              (r) => `<tr>
                <td><a href="#/edit/${r.id}"><b>${esc(r.title)}</b></a><br><span class="path">${esc(r.excerpt || r.body.slice(0, 90))}</span></td>
                <td>${esc(r.type)}</td>
                <td>${esc(r.author || '—')}</td>
                <td>${esc(r.updated_at.slice(0, 16))}</td>
                <td style="white-space:nowrap">
                  <a class="btn secondary sm" href="#/review/${r.id}">Review</a>
                  <button class="btn sm" data-approve="${r.id}">Approve</button>
                  <button class="btn danger sm" data-reject="${r.id}">Reject</button>
                </td>
              </tr>`
            )
            .join('')}</tbody></table>`
        : '<p style="color:var(--muted)">Nothing waiting for review — all clear.</p>';
      page.querySelectorAll('[data-approve]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            await capi(`/content/${btn.dataset.approve}/approve`, { method: 'POST' });
            toast('Approved — now live.');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      page.querySelectorAll('[data-reject]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const note = prompt('Note for the author (optional):');
          if (note === null) return;
          try {
            await capi(`/content/${btn.dataset.reject}/reject`, { method: 'POST', body: { note } });
            toast('Sent back to draft.');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    }
    await load();
  }

  // ---------- side-by-side review ----------

  /** LCS diff over any token array. */
  function diffOpsArr(A, B) {
    const n = A.length;
    const m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { ops.push({ t: 'same', s: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', s: A[i] }); i++; }
      else { ops.push({ t: 'add', s: B[j] }); j++; }
    }
    while (i < n) ops.push({ t: 'del', s: A[i++] });
    while (j < m) ops.push({ t: 'add', s: B[j++] });
    return ops;
  }

  /** Word-level diff of one line pair. Returns escaped HTML lanes, or null if too big. */
  function diffWords(a, b) {
    const A = String(a).split(/(\s+)/).filter(Boolean);
    const B = String(b).split(/(\s+)/).filter(Boolean);
    if (A.length * B.length > 22500) return null;
    const ops = diffOpsArr(A, B);
    return {
      left: ops
        .filter((o) => o.t !== 'add')
        .map((o) => (o.t === 'same' ? esc(o.s) : `<span class="wdel">${esc(o.s)}</span>`))
        .join(''),
      right: ops
        .filter((o) => o.t !== 'del')
        .map((o) => (o.t === 'same' ? esc(o.s) : `<span class="wadd">${esc(o.s)}</span>`))
        .join(''),
    };
  }

  /** Line diff lanes with word-level highlighting on replaced line pairs. */
  function buildPanes(aText, bText) {
    const A = String(aText).split('\n');
    const B = String(bText).split('\n');
    if (A.length * B.length > 250000) {
      return {
        left: A.map((s) => ({ cls: '', h: esc(s) })),
        right: B.map((s) => ({ cls: '', h: esc(s) })),
      };
    }
    const ops = diffOpsArr(A, B);
    const left = [];
    const right = [];
    let i = 0;
    while (i < ops.length) {
      if (ops[i].t === 'same') {
        left.push({ cls: '', h: esc(ops[i].s) });
        right.push({ cls: '', h: esc(ops[i].s) });
        i++;
        continue;
      }
      const dels = [];
      const adds = [];
      while (i < ops.length && ops[i].t !== 'same') {
        (ops[i].t === 'del' ? dels : adds).push(ops[i].s);
        i++;
      }
      const paired = Math.min(dels.length, adds.length);
      for (let k = 0; k < paired; k++) {
        const w = diffWords(dels[k], adds[k]);
        left.push({ cls: w ? 'rep' : 'del', h: w ? w.left : esc(dels[k]) });
        right.push({ cls: w ? 'rep' : 'add', h: w ? w.right : esc(adds[k]) });
      }
      for (let k = paired; k < dels.length; k++) left.push({ cls: 'del', h: esc(dels[k]) });
      for (let k = paired; k < adds.length; k++) right.push({ cls: 'add', h: esc(adds[k]) });
    }
    return { left, right };
  }

  function diffPane(lines) {
    return `<div class="diff-body">${lines
      .map((l) => `<span class="dl ${l.cls}">${l.h || '&nbsp;'}</span>`)
      .join('')}</div>`;
  }

  function fieldRow(label, value, changed) {
    return `<div class="diff-field"><div class="fl">${label}</div>
      <div class="fv">${changed ? `<span class="chg">${esc(value) || '—'}</span>` : esc(value) || '—'}</div></div>`;
  }

  async function renderReview(id) {
    const item = await capi(`/content/${id}`);
    const live = item.live_version;
    const isPending = item.status === 'pending';
    const page = shell('#/approvals', `
      <h1>Review: ${esc(item.title)}
        <span style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap">
          <span class="seg" id="view-seg" style="margin:0;grid-template-columns:1fr 1fr;width:160px">
            <button type="button" data-v="diff" class="on">Diff</button>
            <button type="button" data-v="preview">Preview</button>
          </span>
          <a class="btn secondary sm" href="#/approvals">Back</a>
          ${isPending ? `<button class="btn sm" id="rv-approve">Approve</button>
          <button class="btn danger sm" id="rv-reject">Reject</button>` : `<span class="pill ${esc(item.status)}">${esc(item.status)}</span>`}
        </span>
      </h1>
      <div id="view-diff" class="review-grid"></div>
      <div id="view-preview" class="review-grid" style="display:none"></div>
      <div class="card" style="margin-top:0.9rem"><b>Discussion</b><div id="comments-host" style="margin-top:0.5rem">Loading…</div></div>`);

    const panes = buildPanes(live ? live.body : '', item.body);
    const leftPane = live
      ? `<div class="card">
          ${fieldRow('Title', live.title, false)}
          ${fieldRow('Excerpt', live.excerpt, false)}
          ${fieldRow('Cover image', live.cover_image, false)}
          <div class="diff-field"><div class="fl">Body</div>${diffPane(panes.left)}</div>
        </div>`
      : `<div class="review-empty">Nothing live yet — this is new content awaiting its first approval.</div>`;
    const rightPane = `<div class="card">
        ${fieldRow('Title', item.title, live && live.title !== item.title)}
        ${fieldRow('Excerpt', item.excerpt, live && live.excerpt !== item.excerpt)}
        ${fieldRow('Cover image', item.cover_image, live && live.cover_image !== item.cover_image)}
        <div class="diff-field"><div class="fl">Body</div>${diffPane(
          live ? panes.right : String(item.body).split('\n').map((s) => ({ cls: 'add', h: esc(s) }))
        )}</div>
      </div>`;
    page.querySelector('#view-diff').innerHTML = `
      <div class="review-pane">
        <h3>Live version ${live ? `<span class="pill published">on site</span>` : ''}</h3>${leftPane}
      </div>
      <div class="review-pane">
        <h3>Proposed by ${esc(item.last_edited_by || item.author || 'unknown')} <span class="pill pending">pending</span></h3>${rightPane}
      </div>`;

    // Rendered-markdown preview of the proposed version.
    page.querySelector('#view-preview').innerHTML = `
      <div class="card md-preview" style="grid-column:1/-1">
        ${item.cover_image ? `<img class="preview-cover" src="${esc(item.cover_image)}" alt="">` : ''}
        <h1>${esc(item.title)}</h1>
        ${item.excerpt ? `<p class="path">${esc(item.excerpt)}</p>` : ''}
        ${item.body_html || ''}
      </div>`;

    page.querySelectorAll('#view-seg button').forEach((b) =>
      b.addEventListener('click', () => {
        page.querySelectorAll('#view-seg button').forEach((x) => x.classList.toggle('on', x === b));
        page.querySelector('#view-diff').style.display = b.dataset.v === 'diff' ? '' : 'none';
        page.querySelector('#view-preview').style.display = b.dataset.v === 'preview' ? '' : 'none';
      })
    );

    if (isPending) {
      page.querySelector('#rv-approve').addEventListener('click', async () => {
        try {
          await capi(`/content/${item.id}/approve`, { method: 'POST' });
          toast('Approved — now live.');
          location.hash = '#/approvals';
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      page.querySelector('#rv-reject').addEventListener('click', async () => {
        const note = prompt('Note for the author (optional):');
        if (note === null) return;
        try {
          await capi(`/content/${item.id}/reject`, { method: 'POST', body: { note } });
          toast('Sent back to draft.');
          location.hash = '#/approvals';
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }

    mountComments(page.querySelector('#comments-host'), item.id);
  }

  // ---------- activity (audit log) ----------

  async function renderActivity() {
    const page = shell('#/activity', `<h1>Activity <span class="sub">${esc(company.name)}</span></h1><div id="list">Loading…</div>`);
    const rows = await api(`/teams/${company.id}/audit`);
    page.querySelector('#list').innerHTML = rows.length
      ? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
              <td>${esc(r.created_at.slice(0, 16))}</td>
              <td>${esc(r.username || '—')}</td>
              <td><code>${esc(r.action)}</code></td>
              <td>${esc(r.target)}</td>
              <td class="path">${esc(r.detail)}</td>
            </tr>`
          )
          .join('')}</tbody></table>`
      : '<p style="color:var(--muted)">No activity yet.</p>';
  }

  // ---------- company (profile, branding, members) ----------

  async function renderCompany() {
    const info = await api(`/teams/${company.id}`);
    const isAdmin = info.my_role === 'admin';
    const page = shell('#/company', `
      <h1>Company <span class="sub">${esc(info.name)}</span></h1>
      ${isAdmin ? `
      <form class="card" id="company-form" style="max-width:520px">
        <b>Profile</b>
        <label>Name</label><input name="name" value="${esc(info.name)}">
        <label>URL slug — site lives at /t/&lt;slug&gt;</label><input name="slug" value="${esc(info.slug)}">
        <label>Custom domain — serve your site at its root (point the domain's DNS at this server first)</label>
        <input name="custom_domain" placeholder="www.yourcompany.com" value="${esc(info.custom_domain || '')}">
        <p><button class="btn">Save</button></p>
      </form>
      <form class="card" id="site-form" style="max-width:520px;margin-top:1.4rem">
        <b>Public site</b>
        <label>Site title</label><input name="site_title" id="ts-title">
        <label>Site description</label><input name="site_description" id="ts-desc">
        <label>Theme</label>
        <select name="theme" id="ts-theme">
          <option value="default">Default (follows visitor light/dark)</option>
          <option value="midnight">Midnight</option>
          <option value="paper">Paper</option>
          <option value="forest">Forest</option>
          <option value="ocean">Ocean</option>
        </select>
        <label>Accent color (hex, e.g. #dc2626 — blank for theme default)</label>
        <input name="accent_color" id="ts-accent" placeholder="#2563eb">
        <label>Custom CSS (applied to your public site only)</label>
        <textarea name="custom_css" id="ts-css" rows="5" placeholder="h1 { letter-spacing: -0.02em; }"></textarea>
        <p><button class="btn">Save</button></p>
      </form>
      <div class="card" style="max-width:520px;margin-top:1.4rem">
        <b>Headless API</b>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0">
          Using your own website frontend? Pull published content as JSON (CORS-open, no auth needed):<br>
          <code>GET /api/public/${esc(info.slug)}/content</code><br>
          <code>GET /api/public/${esc(info.slug)}/content/&lt;slug&gt;</code>
        </p>
      </div>` : ''}
      <div style="margin-top:1.6rem"><b>Members</b>
        ${isAdmin ? `
        <form class="toolbar" id="add-member">
          <input name="username" placeholder="Username of an existing account" required style="max-width:280px">
          <select name="role"><option value="manager">Manager</option><option value="admin">Admin</option></select>
          <button class="btn">Add member</button>
        </form>` : ''}
        <div id="members" style="margin-top:0.8rem">Loading…</div>
      </div>
      ${isAdmin ? `<p style="margin-top:2rem"><button class="btn danger" id="delete-company">Delete company…</button></p>` : ''}`);

    async function loadMembers() {
      const rows = await api(`/teams/${company.id}/members`);
      page.querySelector('#members').innerHTML = `
        <table><thead><tr><th>Username</th><th>Role</th><th>Since</th><th></th></tr></thead>
        <tbody>${rows
          .map((m) => {
            const roleCell = isAdmin
              ? `<select data-role="${m.id}" style="width:auto"><option value="manager" ${m.role === 'manager' ? 'selected' : ''}>Manager</option><option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option></select>`
              : esc(m.role);
            const action =
              m.id === me.id
                ? `<button class="btn secondary sm" data-rm="${m.id}">Leave</button>`
                : isAdmin
                  ? `<button class="btn danger sm" data-rm="${m.id}">Remove</button>`
                  : '';
            return `<tr><td>${esc(m.username)}${m.id === me.id ? ' <span style="color:var(--muted)">(you)</span>' : ''}</td>
              <td>${roleCell}</td><td>${esc(m.created_at.slice(0, 10))}</td><td>${action}</td></tr>`;
          })
          .join('')}</tbody></table>`;
      page.querySelectorAll('[data-role]').forEach((sel) =>
        sel.addEventListener('change', async () => {
          try {
            await api(`/teams/${company.id}/members/${sel.dataset.role}`, { method: 'PUT', body: { role: sel.value } });
            toast('Role updated.');
          } catch (err) {
            toast(err.message, 'error');
          }
          loadMembers();
        })
      );
      page.querySelectorAll('[data-rm]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const leaving = Number(btn.dataset.rm) === me.id;
          if (!confirm(leaving ? 'Leave this company?' : 'Remove this member?')) return;
          try {
            await api(`/teams/${company.id}/members/${btn.dataset.rm}`, { method: 'DELETE' });
            if (leaving) return boot();
            loadMembers();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
    }
    await loadMembers();

    if (isAdmin) {
      const settings = await api(`/teams/${company.id}/settings`);
      page.querySelector('#ts-title').value = settings.site_title || '';
      page.querySelector('#ts-desc').value = settings.site_description || '';
      page.querySelector('#ts-theme').value = settings.theme || 'default';
      page.querySelector('#ts-accent').value = settings.accent_color || '';
      page.querySelector('#ts-css').value = settings.custom_css || '';

      page.querySelector('#company-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          const updated = await api(`/teams/${company.id}`, {
            method: 'PUT',
            body: { name: f.get('name'), slug: f.get('slug'), custom_domain: f.get('custom_domain') },
          });
          Object.assign(company, updated);
          companies = companies.map((c) => (c.id === company.id ? { ...c, ...updated } : c));
          toast('Company saved.');
          render();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      page.querySelector('#site-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await api(`/teams/${company.id}/settings`, {
            method: 'PUT',
            body: {
              site_title: f.get('site_title'),
              site_description: f.get('site_description'),
              theme: f.get('theme'),
              accent_color: f.get('accent_color'),
              custom_css: f.get('custom_css'),
            },
          });
          toast('Site settings saved.');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      page.querySelector('#add-member').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await api(`/teams/${company.id}/members`, {
            method: 'POST',
            body: { username: f.get('username'), role: f.get('role') },
          });
          e.target.reset();
          toast('Member added.');
          loadMembers();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      page.querySelector('#delete-company').addEventListener('click', async () => {
        if (!confirm(`Delete company "${info.name}" and ALL of its content? This cannot be undone.`)) return;
        try {
          await api(`/teams/${company.id}`, { method: 'DELETE' });
          toast('Company deleted.');
          boot();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  }

  // ---------- platform (superadmin) ----------

  async function renderPlatform() {
    const page = shell('#/platform', '<h1>Platform <span class="sub">superadmin</span></h1><div id="body">Loading…</div>');
    const [stats, users, settings] = await Promise.all([
      api('/platform/stats'),
      api('/users'),
      api('/settings'),
    ]);
    const kpi = (n, l) => `<div class="kpi"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    page.querySelector('#body').innerHTML = `
      <div class="kpis">
        ${kpi(stats.companies, 'Companies', true)}${kpi(stats.users, 'Users')}${kpi(stats.content, 'Content items')}${kpi(stats.published, 'Published')}${kpi(stats.custom_domains, 'Custom domains')}
      </div>

      <h2 class="sec">Newest companies</h2>
      <table><thead><tr><th>Company</th><th>Members</th><th>Published</th><th>Created</th></tr></thead>
      <tbody>${stats.recent_companies
        .map(
          (c) => `<tr><td><a href="/t/${esc(c.slug)}" target="_blank"><b>${esc(c.name)}</b></a></td>
          <td>${c.member_count}</td><td>${c.published_count}</td><td>${esc(c.created_at.slice(0, 10))}</td></tr>`
        )
        .join('')}</tbody></table>

      <h2 class="sec">Users</h2>
      <form class="toolbar" id="add-user">
        <input name="username" placeholder="Username" required style="max-width:200px">
        <input name="password" type="password" placeholder="Password (min 8 chars)" required style="max-width:230px">
        <select name="role"><option value="user">User</option><option value="superadmin">Superadmin</option></select>
        <button class="btn">Add user</button>
      </form>
      <div id="user-list"></div>

      <h2 class="sec">Platform settings</h2>
      <form class="card" id="platform-form" style="max-width:520px">
        <label>Platform title</label><input name="site_title" value="${esc(settings.site_title)}">
        <label>Platform description</label><input name="site_description" value="${esc(settings.site_description)}">
        <label style="display:flex;align-items:center;gap:0.5rem;margin-top:1rem;font-size:0.9rem;color:var(--fg)">
          <input type="checkbox" name="allow_registration" style="width:auto" ${settings.allow_registration === 'true' ? 'checked' : ''}>
          Allow anyone to create an account
        </label>
        <p><button class="btn">Save</button></p>
      </form>`;

    function renderUserRows(rows) {
      page.querySelector('#user-list').innerHTML = `
        <table><thead><tr><th>Username</th><th>Role</th><th>Companies</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (u) => `<tr><td>${esc(u.username)}</td>
            <td>${u.role === 'superadmin' ? '<span class="role-chip super">SUPERADMIN</span>' : 'user'}</td>
            <td>${u.team_count}</td><td>${esc(u.created_at.slice(0, 10))}</td>
            <td>${u.id === me.id ? '' : `<button class="btn danger sm" data-del="${u.id}">Delete</button>`}</td></tr>`
          )
          .join('')}</tbody></table>`;
      page.querySelectorAll('#user-list [data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this user account?')) return;
          await api(`/users/${btn.dataset.del}`, { method: 'DELETE' });
          toast('User deleted.');
          renderUserRows(await api('/users'));
        })
      );
    }
    renderUserRows(users);

    page.querySelector('#add-user').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/users', {
          method: 'POST',
          body: { username: f.get('username'), password: f.get('password'), role: f.get('role') },
        });
        e.target.reset();
        toast('User added.');
        renderUserRows(await api('/users'));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    page.querySelector('#platform-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/settings', {
          method: 'PUT',
          body: {
            site_title: f.get('site_title'),
            site_description: f.get('site_description'),
            allow_registration: String(f.get('allow_registration') === 'on'),
          },
        });
        toast('Platform settings saved.');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---------- account ----------

  async function renderAccount() {
    const page = shell('#/account', `
      <h1>Account <span class="sub">${esc(me.username)}</span></h1>
      <form class="card" id="password-form" style="max-width:480px">
        <b>Change my password</b>
        <label>Current password</label><input name="currentPassword" type="password" required autocomplete="current-password">
        <label>New password (min 8 chars)</label><input name="newPassword" type="password" required autocomplete="new-password">
        <p><button class="btn">Update password</button></p>
      </form>`);
    page.querySelector('#password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/auth/password', {
          method: 'POST',
          body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') },
        });
        e.target.reset();
        toast('Password updated.');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  // ---------- command palette ----------

  let paletteOpen = false;

  function openPalette() {
    if (paletteOpen || !me || !company) return;
    paletteOpen = true;
    const overlay = document.createElement('div');
    overlay.id = 'palette-overlay';
    overlay.innerHTML = `
      <div id="palette">
        <input placeholder="Type a command or search content…" autocomplete="off">
        <div class="results"></div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input');
    const results = overlay.querySelector('.results');
    let items = [];
    let sel = 0;
    let searchTimer = null;

    const staticActions = [
      { label: 'Go to Dashboard', k: 'nav', run: () => (location.hash = '#/dashboard') },
      { label: 'Go to Content', k: 'nav', run: () => (location.hash = '#/content') },
      { label: 'Go to Media', k: 'nav', run: () => (location.hash = '#/media') },
      { label: 'Go to Tags', k: 'nav', run: () => (location.hash = '#/tags') },
      { label: 'Go to Company', k: 'nav', run: () => (location.hash = '#/company') },
      ...(isCompanyAdmin()
        ? [
            { label: 'Go to Approvals', k: 'nav', run: () => (location.hash = '#/approvals') },
            { label: 'Go to Activity', k: 'nav', run: () => (location.hash = '#/activity') },
          ]
        : []),
      ...(me.role === 'superadmin' ? [{ label: 'Go to Platform', k: 'nav', run: () => (location.hash = '#/platform') }] : []),
      { label: 'New content', k: 'create', run: () => (location.hash = '#/edit/new') },
      { label: 'Open public site', k: 'open', run: () => window.open(`/t/${company.slug}`, '_blank') },
      ...companies
        .filter((c) => c.id !== company.id)
        .map((c) => ({ label: `Switch to ${c.name}`, k: 'company', run: () => { setActiveCompany(c); render(); } })),
    ];

    function draw() {
      results.innerHTML = items.length
        ? items
            .map(
              (it, i) =>
                `<div class="item ${i === sel ? 'sel' : ''}" data-i="${i}">${esc(it.label)}<span class="k">${esc(it.k)}</span></div>`
            )
            .join('')
        : '<div class="empty">No matches.</div>';
      results.querySelectorAll('.item').forEach((el) =>
        el.addEventListener('click', () => pick(Number(el.dataset.i)))
      );
    }

    function pick(i) {
      const it = items[i];
      close();
      if (it) it.run();
    }

    function update(q) {
      const needle = q.trim().toLowerCase();
      items = staticActions.filter((a) => a.label.toLowerCase().includes(needle));
      sel = 0;
      draw();
      clearTimeout(searchTimer);
      if (needle.length >= 2) {
        searchTimer = setTimeout(async () => {
          try {
            const rows = await capi(`/content?search=${encodeURIComponent(needle)}`);
            items = [
              ...items,
              ...rows.slice(0, 6).map((r) => ({
                label: `Edit: ${r.title}`,
                k: r.type,
                run: () => (location.hash = `#/edit/${r.id}`),
              })),
            ];
            draw();
          } catch {
            /* company access may have changed; ignore */
          }
        }, 180);
      }
    }

    function close() {
      paletteOpen = false;
      overlay.remove();
    }

    input.addEventListener('input', () => update(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
      else if (e.key === 'Escape') close();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    update('');
    input.focus();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
  });

  // ---------- router ----------

  async function render() {
    if (!me) return boot();
    if (!company) return renderCreateCompany();
    const hash = location.hash || '#/dashboard';
    const editMatch = hash.match(/^#\/edit\/(\w+)/);
    try {
      if (editMatch) return await renderEditor(editMatch[1]);
      if (hash.startsWith('#/content')) return await renderContentList();
      if (hash.startsWith('#/media')) return await renderMedia();
      if (hash.startsWith('#/tags')) return await renderTags();
      const reviewMatch = hash.match(/^#\/review\/(\d+)/);
      if (reviewMatch && isCompanyAdmin()) return await renderReview(reviewMatch[1]);
      if (hash.startsWith('#/approvals') && isCompanyAdmin()) return await renderApprovals();
      if (hash.startsWith('#/activity') && isCompanyAdmin()) return await renderActivity();
      if (hash.startsWith('#/company')) return await renderCompany();
      if (hash.startsWith('#/platform') && me.role === 'superadmin') return await renderPlatform();
      if (hash.startsWith('#/account')) return await renderAccount();
      return await renderDashboard();
    } catch (err) {
      if (String(err.message).includes('Authentication')) {
        me = null;
        return renderLogin();
      }
      toast(err.message, 'error');
      const page = document.getElementById('page');
      if (page) page.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    }
  }

  /** Load session + companies, pick the active company, then render. */
  async function boot() {
    try {
      me = me || (await api('/auth/me'));
    } catch {
      return renderLogin();
    }
    companies = await api('/teams');
    if (companies.length === 0) {
      company = null;
      return renderCreateCompany();
    }
    const savedId = Number(localStorage.getItem('cms_active_team'));
    company = companies.find((c) => c.id === savedId) || companies[0];
    setActiveCompany(company);
    render();
  }

  window.addEventListener('hashchange', render);
  boot();
})();
