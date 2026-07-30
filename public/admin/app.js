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

  /** Strip anything executable from rendered markdown before it touches the
      admin DOM — content and comments are authored by teammates, but the
      admin session must never be scriptable from content. */
  function sanitizeHtml(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    t.content.querySelectorAll('script,iframe,object,embed,style,link,meta,form').forEach((el) => el.remove());
    t.content.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => {
        const name = a.name.toLowerCase();
        const value = String(a.value).trim().toLowerCase();
        if (name.startsWith('on') || (['href', 'src', 'xlink:href', 'action'].includes(name) && value.startsWith('javascript:'))) {
          el.removeAttribute(a.name);
        }
      });
    });
    return t.innerHTML;
  }

  const md = (text) => (window.marked ? sanitizeHtml(window.marked.parse(String(text ?? ''))) : esc(text));
  const mdInline = (text) => (window.marked ? sanitizeHtml(window.marked.parseInline(String(text ?? ''))) : esc(text));

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

  // ---------- starter picker (Company page + new-company setup) ----------

  function starterPickerHtml() {
    return `
      <input id="tpl-filter" placeholder="Search templates — hotel, restaurant, salon…" style="margin-bottom:0.5rem">
      <div class="tpl-grid" id="tpl-grid">Loading…</div>
      <div class="ai-build" id="ai-build">
        <b style="font-size:0.85rem">✦ AI site builder</b>
        <p style="color:var(--muted);font-size:0.82rem;margin:0.2rem 0 0.5rem">
          Describe your company in a sentence — Claude picks the theme, typography, and layout,
          and writes your starter pages and posts.
        </p>
        <textarea id="ai-prompt" rows="2" placeholder="A tiny bakery in Lisbon famous for cinnamon rolls and slow mornings"></textarea>
        <p style="margin:0.5rem 0 0"><button type="button" class="btn" id="ai-go">Build my site</button>
        <span id="ai-status" style="color:var(--muted);font-size:0.8rem;margin-left:0.5rem"></span></p>
      </div>`;
  }

  function mountStarterPicker(page, { confirmApply = true, onApplied } = {}) {
    const galleryColors = Object.fromEntries(
      THEME_GALLERY.map(([key, , bg, fg, accent]) => [key, { bg, fg, accent }])
    );
    api('/site-templates').then(({ templates, ai_available }) => {
      const tplRow = (t) => {
        const c = galleryColors[t.theme] || galleryColors.default;
        const pieces = t.pages + t.posts + (t.items || 0);
        const meta = `${pieces} starter item${pieces === 1 ? '' : 's'}${
          t.types ? ` · ${t.types} custom type${t.types === 1 ? '' : 's'}` : ''
        }`;
        return `<div class="tpl">
          <div class="tpl-swatch" style="background:${c.bg};color:${c.fg}">
            <span class="dot" style="background:${t.accent_color || c.accent}"></span>Aa</div>
          <div class="tpl-info"><b>${esc(t.name)}</b><span>${esc(t.description)}</span>
            <span class="tpl-meta">${meta}</span></div>
          <button type="button" class="btn secondary sm" data-tpl="${t.key}">Apply</button>
        </div>`;
      };
      const renderTplGrid = (query = '') => {
        const q = query.trim().toLowerCase();
        const shown = q
          ? templates.filter((t) => `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q))
          : templates;
        const categories = [...new Set(shown.map((t) => t.category))];
        page.querySelector('#tpl-grid').innerHTML = categories.length
          ? categories
              .map(
                (cat) =>
                  `<div class="tpl-cat">${esc(cat)}</div>` +
                  shown.filter((t) => t.category === cat).map(tplRow).join('')
              )
              .join('')
          : '<p class="path" style="margin:0.4rem 0">No templates match — try the AI builder below.</p>';
        bindApply();
      };
      page.querySelector('#tpl-filter').addEventListener('input', (e) => renderTplGrid(e.target.value));
      const bindApply = () => page.querySelectorAll('[data-tpl]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (confirmApply && !confirm('Apply this starter kit? It updates your site theme, publishes its starter content, and may add custom content types. Existing content is untouched.')) return;
          btn.disabled = true;
          try {
            const r = await api(`/teams/${company.id}/apply-template`, {
              method: 'POST',
              body: { template: btn.dataset.tpl },
            });
            toast(`Starter kit applied — ${r.created} items published${r.types ? `, ${r.types} content type${r.types === 1 ? '' : 's'} added` : ''}.`);
            if (onApplied) onApplied(r);
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        })
      );
      renderTplGrid();
      const aiStatus = page.querySelector('#ai-status');
      const aiGo = page.querySelector('#ai-go');
      if (!ai_available) {
        aiGo.disabled = true;
        aiStatus.textContent = 'Set ANTHROPIC_API_KEY on the server to enable.';
      }
      aiGo.addEventListener('click', async () => {
        const prompt = page.querySelector('#ai-prompt').value.trim();
        if (prompt.length < 8) return toast('Describe your company in a sentence or two.', 'error');
        aiGo.disabled = true;
        aiStatus.textContent = 'Claude is designing your site — this takes a minute…';
        try {
          const r = await api(`/teams/${company.id}/ai-build`, { method: 'POST', body: { prompt } });
          toast(`Site built: ${r.pages} pages + ${r.posts} posts, "${r.theme}" theme.`);
          if (onApplied) onApplied(r);
        } catch (err) {
          aiGo.disabled = false;
          aiStatus.textContent = '';
          toast(err.message, 'error');
        }
      });
    });
  }

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

  const THEME_GALLERY = [
    ['default', 'Auto', '#ffffff', '#1a1a1a', '#2563eb'],
    ['paper', 'Paper', '#faf7f0', '#292420', '#b45309'],
    ['forest', 'Forest', '#f6faf7', '#14281d', '#166534'],
    ['ocean', 'Ocean', '#f4f8fb', '#0f2537', '#0e7490'],
    ['mint', 'Mint', '#f1faf6', '#11312a', '#0d9488'],
    ['lavender', 'Lavender', '#faf8ff', '#26203a', '#7c3aed'],
    ['midnight', 'Midnight', '#0f1115', '#e5e7eb', '#60a5fa'],
    ['slate', 'Slate', '#1e293b', '#e2e8f0', '#38bdf8'],
    ['noir', 'Noir', '#000000', '#f5f5f5', '#f43f5e'],
    ['sunset', 'Sunset', '#1d1210', '#f6e9e1', '#fb923c'],
    ['terminal', 'Terminal', '#0a0f0a', '#c9f5c9', '#22c55e'],
  ];

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
        location.hash = '#/setup';
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
          location.hash = '#/setup';
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

  // ---------- new-company setup (choose a starting point) ----------

  async function renderSetup() {
    const page = shell('#/company', `
      <h1>Set up ${esc(company.name)} <span class="sub">choose a starting point</span></h1>
      <div class="setup-cols">
        <div class="card" style="max-width:560px">
          <b>Start from a business template</b>
          <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">
            Pick your kind of business and get a themed site with real starter content —
            live in one click, editable forever. Or describe your company and let AI design it.
          </p>
          ${starterPickerHtml()}
        </div>
        <div>
          <div class="card" style="max-width:320px">
            <b>Or start blank</b>
            <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">
              An empty site with your company name on it. You can apply a template
              any time later from the Company page.
            </p>
            <a class="btn secondary sm" href="#/dashboard">Start blank →</a>
          </div>
        </div>
      </div>`);
    mountStarterPicker(page, {
      confirmApply: false,
      onApplied: () => {
        location.hash = '#/dashboard';
        render();
      },
    });
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
    const state = { type: '', status: '', search: '', view: '' };
    const cTypes = await capi('/content-types').catch(() => []);

    async function load() {
      if (state.view === 'trash') return loadTrash();
      const q = new URLSearchParams(Object.entries(state).filter(([k, v]) => v && k !== 'view'));
      const rows = await capi(`/content?${q}`);
      listEl.innerHTML = `
        <div class="toolbar">
          <select id="f-type"><option value="">All types</option><option value="post">Posts</option><option value="page">Pages</option>${cTypes.map((t) => `<option value="${esc(t.key)}">${esc(t.name_plural)}</option>`).join('')}</select>
          <select id="f-status"><option value="">All statuses</option><option value="draft">Draft</option><option value="pending">Pending</option><option value="published">Published</option></select>
          <input id="f-search" placeholder="Search…" value="${esc(state.search)}">
          <button class="btn secondary sm" id="view-trash" style="margin-left:auto">Trash</button>
        </div>
        <table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
              <td><a href="#/edit/${r.id}"><b>${esc(r.title)}</b></a><br><span class="path">/${esc(r.slug)}</span> <span class="path" style="text-transform:uppercase">· ${esc(r.locale || 'en')}${r.format && r.format !== 'markdown' ? ` · ${esc(r.format)}` : ''}</span></td>
              <td>${esc(r.type)}</td>
              <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td>
              <td>${esc(r.updated_at.slice(0, 16))}</td>
              <td style="white-space:nowrap"><button class="btn secondary sm" data-dup="${r.id}" title="Duplicate as draft">⧉</button>
              <button class="btn danger sm" data-del="${r.id}">Delete</button></td>
            </tr>`
          )
          .join('') || '<tr><td colspan="5">Nothing here yet.</td></tr>'}</tbody></table>`;
      listEl.querySelector('#f-type').value = state.type;
      listEl.querySelector('#f-status').value = state.status;
      listEl.querySelector('#f-type').addEventListener('change', (e) => { state.type = e.target.value; load(); });
      listEl.querySelector('#f-status').addEventListener('change', (e) => { state.status = e.target.value; load(); });
      listEl.querySelector('#f-search').addEventListener('change', (e) => { state.search = e.target.value; load(); });
      listEl.querySelector('#view-trash').addEventListener('click', () => { state.view = 'trash'; load(); });
      listEl.querySelectorAll('[data-dup]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            const copy = await capi(`/content/${btn.dataset.dup}/duplicate`, { method: 'POST' });
            toast('Duplicated as a draft.');
            location.hash = `#/edit/${copy.id}`;
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      listEl.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Move this item to the trash? It leaves the public site immediately; you can restore it later.')) return;
          await capi(`/content/${btn.dataset.del}`, { method: 'DELETE' });
          toast('Moved to trash.');
          load();
        })
      );
    }

    async function loadTrash() {
      const rows = await capi('/content/trash');
      listEl.innerHTML = `
        <div class="toolbar">
          <button class="btn secondary sm" id="back-content">← Back to content</button>
          <span class="path">Items in the trash are off the site. Restore brings them back exactly as they were; permanent deletion is admin-only.</span>
        </div>
        <table><thead><tr><th>Title</th><th>Type</th><th>Deleted</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
              <td><b>${esc(r.title)}</b><br><span class="path">/${esc(r.slug)}</span></td>
              <td>${esc(r.type)}</td>
              <td>${esc((r.deleted_at || '').slice(0, 16))}</td>
              <td style="white-space:nowrap"><button class="btn secondary sm" data-restore="${r.id}">Restore</button>
              ${isCompanyAdmin() ? `<button class="btn danger sm" data-purge="${r.id}">Delete forever</button>` : ''}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="4">The trash is empty.</td></tr>'}</tbody></table>`;
      listEl.querySelector('#back-content').addEventListener('click', () => { state.view = ''; load(); });
      listEl.querySelectorAll('[data-restore]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          try {
            await capi(`/content/${btn.dataset.restore}/untrash`, { method: 'POST' });
            toast('Restored.');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        })
      );
      listEl.querySelectorAll('[data-purge]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete forever? This cannot be undone.')) return;
          try {
            await capi(`/content/${btn.dataset.purge}`, { method: 'DELETE' });
            toast('Deleted permanently.');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
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
      ? { type: 'post', title: '', slug: '', body: '', format: 'markdown', excerpt: '', cover_image: '', status: 'draft', tags: [], fields: {}, publish_at: null, expire_at: null, locale: 'en' }
      : await capi(`/content/${id}`);
    const cTypes = await capi('/content-types').catch(() => []);

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
          <label style="display:flex;justify-content:space-between;align-items:center;gap:0.6rem"><span id="body-label">Body (Markdown)</span>
            <span class="seg" id="body-view" style="margin:0;grid-template-columns:1fr 1fr;width:150px">
              <button type="button" data-v="write" class="on">Write</button>
              <button type="button" data-v="preview">Preview</button>
            </span>
          </label>
          <div class="md-toolbar" id="md-toolbar">
            <button type="button" data-md="bold" title="Bold"><b>B</b></button>
            <button type="button" data-md="italic" title="Italic"><i>I</i></button>
            <button type="button" data-md="h2" title="Heading">H</button>
            <button type="button" data-md="link" title="Link">🔗</button>
            <button type="button" data-md="list" title="List">•—</button>
            <button type="button" data-md="quote" title="Quote">❝</button>
            <button type="button" data-md="code" title="Code">&lt;/&gt;</button>
          </div>
          <textarea name="body" rows="18">${esc(item.body)}</textarea>
          <div id="body-preview" class="diff-body md-preview" style="display:none;min-height:200px"></div>
          <select id="insert-img" style="margin-top:0.5rem"><option value="">Insert image from media library…</option></select>
          <label>Excerpt (inline Markdown supported)</label><textarea name="excerpt" rows="2">${esc(item.excerpt)}</textarea>
        </div>
        <div class="card">
          <label>Type</label>
          <select name="type" id="type-select" ${isNew ? '' : 'disabled'}>
            <option value="post" ${item.type === 'post' ? 'selected' : ''}>Post</option>
            <option value="page" ${item.type === 'page' ? 'selected' : ''}>Page</option>
            ${cTypes.map((t) => `<option value="${esc(t.key)}" ${item.type === t.key ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
          <div id="cf-host"></div>
          <label>Body format</label>
          <select name="format" id="fmt-select">
            <option value="markdown" ${item.format === 'markdown' ? 'selected' : ''}>Markdown</option>
            <option value="text" ${item.format === 'text' ? 'selected' : ''}>Plain text</option>
            <option value="html" ${item.format === 'html' ? 'selected' : ''}>HTML</option>
            <option value="image" ${item.format === 'image' ? 'selected' : ''}>Image</option>
            <option value="embed" ${item.format === 'embed' ? 'selected' : ''}>Embed (YouTube / Vimeo)</option>
          </select>
          <label>Status</label>
          <select name="status">${statusOptions}</select>
          ${managerHint}
          <label>Language (BCP-47-ish, e.g. en, es, pt-br)</label>
          <input name="locale" list="locale-list" value="${esc(item.locale || 'en')}">
          <datalist id="locale-list">
            <option value="en">English</option><option value="es">Spanish</option>
            <option value="fr">French</option><option value="de">German</option>
            <option value="pt-br">Portuguese (BR)</option><option value="hi">Hindi</option>
            <option value="zh">Chinese</option><option value="ja">Japanese</option>
            <option value="ar">Arabic</option><option value="ru">Russian</option>
            <option value="ta">Tamil</option>
          </datalist>
          <label>Go live at (UTC — blank: immediately)</label>
          <input type="datetime-local" name="publish_at" value="${toLocalDT(item.publish_at)}">
          <label>Expire at (UTC — blank: never)</label>
          <input type="datetime-local" name="expire_at" value="${toLocalDT(item.expire_at)}">
          <p style="margin:0.3rem 0 0"><button type="button" class="btn secondary sm" id="time-machine" title="Open the public site as it will appear at the scheduled moment — scheduled content shown, expired content hidden">⏱ Time machine</button></p>
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
      <div class="card" style="margin-top:0.9rem"><b>Translations</b><div id="trans-host" style="margin-top:0.6rem">Loading…</div></div>
      <div class="card" style="margin-top:0.9rem"><b>Discussion</b><div id="comments-host" style="margin-top:0.5rem">Loading…</div></div>
      <div class="card" style="margin-top:0.9rem"><b>Version history</b><div id="history-host" style="margin-top:0.6rem">Loading…</div></div>` : ''}`);

    // Time machine: open the public site as of the scheduled moment (or now).
    page.querySelector('#time-machine').addEventListener('click', () => {
      const at = page.querySelector('[name=publish_at]').value || new Date().toISOString().slice(0, 16);
      window.open(`/t/${company.slug}?preview_at=${encodeURIComponent(at)}`, '_blank');
    });

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

    const bodyEl = page.querySelector('textarea[name=body]');
    const fmtSelect = page.querySelector('#fmt-select');
    const currentFormat = () => fmtSelect.value;

    // Render any body format for the live preview (always sanitized).
    const clientRenderBody = (fmt, body) => {
      if (fmt === 'text') {
        return String(body || '')
          .split(/\n{2,}/)
          .filter((par) => par.trim() !== '')
          .map((par) => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`)
          .join('');
      }
      if (fmt === 'html') return sanitizeHtml(body);
      if (fmt === 'image') {
        return body ? `<figure class="body-image" style="margin:0"><img src="${esc(String(body).trim())}" style="max-width:100%;border-radius:8px"></figure>` : '';
      }
      if (fmt === 'embed') {
        return body ? `<p class="path">▶ Embedded media (renders as a player on the public site):<br><a href="${esc(String(body).trim())}" target="_blank">${esc(String(body).trim())}</a></p>` : '';
      }
      return md(body);
    };

    // Adapt the editing surface to the chosen format.
    const FORMAT_UI = {
      markdown: { label: 'Body (Markdown)', toolbar: true, rows: 18, mono: true, insert: 'Insert image from media library…', ph: '' },
      text: { label: 'Body (plain text)', toolbar: false, rows: 18, mono: false, insert: null, ph: 'Plain text — blank lines start new paragraphs.' },
      html: { label: 'Body (raw HTML — rendered as-is on your site)', toolbar: false, rows: 18, mono: true, insert: null, ph: '<section>…</section>' },
      image: { label: 'Image URL (excerpt becomes the caption)', toolbar: false, rows: 3, mono: true, insert: 'Use image from media library…', ph: '/uploads/… or https://…' },
      embed: { label: 'Video URL (YouTube or Vimeo)', toolbar: false, rows: 3, mono: true, insert: null, ph: 'https://www.youtube.com/watch?v=…' },
    };
    const applyFormatUI = () => {
      const ui = FORMAT_UI[currentFormat()] || FORMAT_UI.markdown;
      page.querySelector('#body-label').textContent = ui.label;
      page.querySelector('#md-toolbar').style.display = ui.toolbar ? '' : 'none';
      bodyEl.rows = ui.rows;
      bodyEl.placeholder = ui.ph;
      bodyEl.style.fontFamily = ui.mono ? '' : "'Geist Sans', system-ui, sans-serif";
      const insertSel = page.querySelector('#insert-img');
      insertSel.style.display = ui.insert ? '' : 'none';
      if (ui.insert) insertSel.options[0].textContent = ui.insert;
      if (previewEl.style.display !== 'none') renderBodyPreview();
    };
    fmtSelect.addEventListener('change', applyFormatUI);

    // Media picker: inserts markdown at the cursor, or fills the URL for image bodies.
    page.querySelector('#insert-img').addEventListener('change', (e) => {
      const url = e.target.value;
      if (!url) return;
      if (currentFormat() === 'image') {
        bodyEl.value = url;
      } else {
        const start = bodyEl.selectionStart ?? bodyEl.value.length;
        const end = bodyEl.selectionEnd ?? start;
        bodyEl.value = `${bodyEl.value.slice(0, start)}\n![](${url})\n${bodyEl.value.slice(end)}`;
      }
      e.target.value = '';
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
      bodyEl.focus();
    });

    // Markdown toolbar: wrap the selection or prefix the line.
    const wrapSel = (before, after = before, placeholder = 'text') => {
      const start = bodyEl.selectionStart ?? 0;
      const end = bodyEl.selectionEnd ?? start;
      const sel = bodyEl.value.slice(start, end) || placeholder;
      bodyEl.value = bodyEl.value.slice(0, start) + before + sel + after + bodyEl.value.slice(end);
      bodyEl.focus();
      bodyEl.selectionStart = start + before.length;
      bodyEl.selectionEnd = start + before.length + sel.length;
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const prefixLine = (prefix) => {
      const start = bodyEl.selectionStart ?? 0;
      const lineStart = bodyEl.value.lastIndexOf('\n', start - 1) + 1;
      bodyEl.value = bodyEl.value.slice(0, lineStart) + prefix + bodyEl.value.slice(lineStart);
      bodyEl.focus();
      bodyEl.selectionStart = bodyEl.selectionEnd = start + prefix.length;
      bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const MD_ACTIONS = {
      bold: () => wrapSel('**'),
      italic: () => wrapSel('*'),
      h2: () => prefixLine('## '),
      link: () => wrapSel('[', '](https://)', 'link text'),
      list: () => prefixLine('- '),
      quote: () => prefixLine('> '),
      code: () => wrapSel('`'),
    };
    page.querySelectorAll('#md-toolbar [data-md]').forEach((btn) =>
      btn.addEventListener('click', () => MD_ACTIONS[btn.dataset.md]())
    );

    // Live Write/Preview toggle for the body.
    const previewEl = page.querySelector('#body-preview');
    const toolbarEl = page.querySelector('#md-toolbar');
    const renderBodyPreview = () => (previewEl.innerHTML = clientRenderBody(currentFormat(), bodyEl.value) || '<p class="path">Nothing to preview yet.</p>');
    page.querySelectorAll('#body-view button').forEach((b) =>
      b.addEventListener('click', () => {
        page.querySelectorAll('#body-view button').forEach((x) => x.classList.toggle('on', x === b));
        const preview = b.dataset.v === 'preview';
        bodyEl.style.display = preview ? 'none' : '';
        toolbarEl.style.display = preview ? 'none' : '';
        previewEl.style.display = preview ? '' : 'none';
        if (preview) renderBodyPreview();
      })
    );
    bodyEl.addEventListener('input', () => {
      if (previewEl.style.display !== 'none') renderBodyPreview();
    });
    applyFormatUI();

    // Custom-type fields: inputs generated from the type's schema.
    const cfHost = page.querySelector('#cf-host');
    const typeSelect = page.querySelector('#type-select');
    const renderCustomFields = () => {
      const ct = cTypes.find((t) => t.key === typeSelect.value);
      const values = item.fields || {};
      cfHost.innerHTML = !ct || !ct.schema.length
        ? ''
        : ct.schema
            .map((f) => {
              const v = values[f.key] !== undefined ? String(values[f.key]) : '';
              if (f.kind === 'longtext') {
                return `<label>${esc(f.label)}</label><textarea data-cf="${esc(f.key)}" rows="3">${esc(v)}</textarea>`;
              }
              if (f.kind === 'select') {
                return `<label>${esc(f.label)}</label><select data-cf="${esc(f.key)}"><option value="">—</option>${f.options
                  .map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o)}</option>`)
                  .join('')}</select>`;
              }
              const inputType = f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text';
              return `<label>${esc(f.label)}${f.kind === 'url' ? ' (URL)' : ''}</label>
                <input type="${inputType}" data-cf="${esc(f.key)}" value="${esc(v)}"${f.kind === 'number' ? ' step="any"' : ''}>`;
            })
            .join('');
    };
    renderCustomFields();
    typeSelect.addEventListener('change', renderCustomFields);

    const collect = (f) => ({
      title: f.get('title'),
      body: f.get('body'),
      excerpt: f.get('excerpt'),
      cover_image: f.get('cover_image'),
      format: f.get('format'),
      status: f.get('status'),
      slug: f.get('slug'),
      locale: f.get('locale') || 'en',
      publish_at: f.get('publish_at') || '',
      expire_at: f.get('expire_at') || '',
      tags: f.get('tags').split(',').map((t) => t.trim()).filter(Boolean),
      ...(page.querySelector('[data-cf]')
        ? {
            fields: Object.fromEntries(
              [...page.querySelectorAll('[data-cf]')].map((el) => [el.dataset.cf, el.value])
            ),
          }
        : {}),
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
      const transHost = page.querySelector('#trans-host');
      const siblings = item.translations || [];
      transHost.innerHTML = `
        ${siblings.length
          ? `<table><thead><tr><th>Locale</th><th>Title</th><th>Status</th></tr></thead>
            <tbody>${siblings
              .map(
                (t) => `<tr><td><span class="pill pending">${esc(t.locale.toUpperCase())}</span></td>
                <td><a href="#/edit/${t.id}"><b>${esc(t.title)}</b></a></td>
                <td><span class="pill ${esc(t.status)}">${esc(t.status)}</span></td></tr>`
              )
              .join('')}</tbody></table>`
          : '<p class="path">No translations yet.</p>'}
        <form class="toolbar" style="margin-bottom:0" id="add-translation">
          <input name="locale" list="locale-list" placeholder="Locale, e.g. es" required style="max-width:140px">
          <button class="btn secondary sm">Create translation draft</button>
          <button type="button" class="btn sm" id="ai-translate" title="Claude translates title, body, and excerpt into a linked draft">✦ Translate with AI</button>
        </form>`;
      transHost.querySelector('#add-translation').addEventListener('submit', async (e) => {
        e.preventDefault();
        const loc = new FormData(e.target).get('locale');
        try {
          const created = await capi('/content', {
            method: 'POST',
            body: {
              type: item.type,
              title: item.title,
              body: item.body,
              excerpt: item.excerpt,
              cover_image: item.cover_image,
              locale: loc,
              translation_of: item.id,
              tags: item.tags.map((t) => t.name),
            },
          });
          toast(`Translation draft created (${loc}).`);
          location.hash = `#/edit/${created.id}`;
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      transHost.querySelector('#ai-translate').addEventListener('click', async (e) => {
        const loc = transHost.querySelector('[name=locale]').value.trim();
        if (!loc) return toast('Enter a target locale first (e.g. es).', 'error');
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = '✦ Translating…';
        try {
          const created = await capi(`/content/${id}/ai-translate`, { method: 'POST', body: { locale: loc } });
          toast(`Translated into "${loc}" — review the draft before submitting.`);
          location.hash = `#/edit/${created.id}`;
        } catch (err) {
          btn.disabled = false;
          btn.textContent = '✦ Translate with AI';
          toast(err.message, 'error');
        }
      });

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
            (c) => `<div class="comment"><span class="who">${esc(c.author || 'deleted user')}</span><span class="when">${esc(c.created_at.slice(0, 16))}</span><div class="md-c">${md(c.body)}</div></div>`
          )
          .join('') || '<p class="path" style="margin:0.4rem 0">No comments yet — start the discussion.</p>'}</div>
        <form class="toolbar" style="margin-bottom:0">
          <input name="body" placeholder="Write a comment… (Markdown supported)" required style="flex:1">
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
                <td><a href="#/edit/${r.id}"><b>${esc(r.title)}</b></a><br><span class="path">${esc(r.excerpt || r.body.slice(0, 90))}</span>
                ${r.ai_review ? `<br><span class="ai-line ${r.ai_review.verdict === 'needs_attention' ? 'warn' : ''}">✦ ${esc(r.ai_review.summary)}${r.ai_review.verdict === 'needs_attention' ? ` — ${r.ai_review.notes.length} note${r.ai_review.notes.length === 1 ? '' : 's'}` : ''}</span>` : ''}</td>
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
      ${item.ai_review ? `
      <div class="card ai-review ${item.ai_review.verdict === 'needs_attention' ? 'warn' : ''}" style="margin-bottom:0.9rem">
        <b>✦ Nova AI pre-review
          <span class="pill ${item.ai_review.verdict === 'needs_attention' ? 'pending' : 'published'}" style="margin-left:0.4rem">${item.ai_review.verdict === 'needs_attention' ? 'needs attention' : 'looks good'}</span>
        </b>
        <p style="margin:0.35rem 0 0;font-size:0.85rem">${esc(item.ai_review.summary)}</p>
        ${item.ai_review.notes && item.ai_review.notes.length
          ? `<ul style="margin:0.4rem 0 0;padding-left:1.1rem;font-size:0.82rem;color:var(--muted)">${item.ai_review.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
          : ''}
        <p class="path" style="margin:0.45rem 0 0">AI assistance for the reviewer — the decision is yours.</p>
      </div>` : ''}
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
        ${sanitizeHtml(item.body_html || '')}
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
      <div class="card" id="starter-card" style="max-width:520px;margin-top:1.4rem">
        <b>Start your site</b>
        <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">
          Apply a starter kit — theme, typography, layout, and real starter pages and posts,
          published instantly. Your existing content is never touched.
        </p>
        ${starterPickerHtml()}
      </div>
      <form class="card" id="site-form" style="max-width:520px;margin-top:1.4rem">
        <b>Public site</b>
        <label>Site title</label><input name="site_title" id="ts-title">
        <label>Site description</label><input name="site_description" id="ts-desc">
        <label>Theme</label>
        <input type="hidden" name="theme" id="ts-theme" value="default">
        <div class="theme-grid" id="theme-grid">
          ${THEME_GALLERY.map(
            ([key, name, bg, fg, accent]) => `
            <button type="button" class="swatch" data-theme="${key}" style="background:${bg};color:${fg}" title="${name}">
              <span class="dot" style="background:${accent}"></span>
              <span class="tn">${name}</span>
            </button>`
          ).join('')}
        </div>
        <label>Headings typeface</label>
        <select name="heading_font" id="ts-hfont">
          <option value="sans">Sans (Geist)</option>
          <option value="serif">Serif (editorial)</option>
          <option value="mono">Monospace (technical)</option>
        </select>
        <label>Home layout</label>
        <select name="layout" id="ts-layout">
          <option value="cards">Card grid</option>
          <option value="list">List</option>
        </select>
        <label>Accent color (hex, e.g. #dc2626 — blank for theme default)</label>
        <input name="accent_color" id="ts-accent" placeholder="#2563eb">
        <label>Custom CSS (applied to your public site only)</label>
        <textarea name="custom_css" id="ts-css" rows="5" placeholder="h1 { letter-spacing: -0.02em; }"></textarea>
        <label>Default language (site home + feeds; other locales get /t/&lt;slug&gt;/&lt;locale&gt;)</label>
        <input name="default_locale" id="ts-locale" placeholder="en">
        <p><button class="btn">Save</button></p>
      </form>
      <div class="card" style="max-width:520px;margin-top:1.4rem">
        <b>Headless API</b>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0">
          Using your own website frontend? Pull published content as JSON (CORS-open, no auth needed):<br>
          <code>GET /api/public/${esc(info.slug)}/content</code><br>
          <code>GET /api/public/${esc(info.slug)}/content/&lt;slug&gt;</code>
        </p>
      </div>
      <div class="card" style="max-width:520px;margin-top:1.4rem">
        <b>Webhooks</b>
        <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">
          POST notifications on <code>content.published</code>, <code>content.updated</code>,
          <code>content.unpublished</code>, <code>content.deleted</code> — signed with
          <code>X-Nova-Signature</code> (HMAC-SHA256).
        </p>
        <form class="toolbar" id="add-webhook" style="margin-top:0">
          <input name="url" placeholder="https://example.com/hooks/nova" required style="flex:1;min-width:200px">
          <input name="events" placeholder="* or event list" style="max-width:140px">
          <button class="btn sm">Add</button>
        </form>
        <div id="webhook-list"></div>
      </div>
      <div class="card" style="max-width:520px;margin-top:1.4rem">
        <b>API keys</b>
        <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">
          Bearer tokens for scripts and CI. <b>read</b> keys can GET everything (drafts included);
          <b>write</b> keys act as a manager — their writes go through approval.
        </p>
        <form class="toolbar" id="add-key" style="margin-top:0">
          <input name="name" placeholder="Key name, e.g. ci-deploy" required style="flex:1;min-width:160px">
          <select name="scope" style="width:auto"><option value="read">read</option><option value="write">write</option></select>
          <button class="btn sm">Create</button>
        </form>
        <div id="key-list"></div>
      </div>
      <div class="card" style="max-width:520px;margin-top:1.4rem">
        <b>Content types</b>
        <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">
          Posts and pages are built in. Define your own — Jobs, Recipes, Properties — with
          structured fields that show in the editor, on your site, and in the API.
        </p>
        <div id="ctype-list"></div>
        <form id="add-ctype" style="margin-top:0.6rem">
          <div class="toolbar" style="margin:0 0 0.4rem">
            <input name="name" placeholder="Type name, e.g. Job" required style="flex:1;min-width:120px">
            <input name="name_plural" placeholder="Plural (Jobs)" style="max-width:130px">
          </div>
          <div id="ctype-fields"></div>
          <p style="margin:0.5rem 0 0;display:flex;gap:0.5rem">
            <button type="button" class="btn secondary sm" id="ctype-addfield">+ Field</button>
            <button class="btn sm">Create type</button>
          </p>
        </form>
      </div>
      <div class="card" style="max-width:520px;margin-top:1.4rem">
        <b>Import</b>
        <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">
          Bring your content with you: WordPress exports (<code>.xml</code>), Markdown files with
          front matter (<code>.md</code>), or a Nova export (<code>.json</code>). Published items go
          live immediately; everything else lands as drafts.
        </p>
        <form class="toolbar" id="import-form" style="margin-top:0">
          <input type="file" name="files" multiple accept=".xml,.json,.md,.markdown,.txt" required style="flex:1;min-width:200px">
          <button class="btn sm">Import</button>
        </form>
        <div id="import-result" style="color:var(--muted);font-size:0.8rem;margin-top:0.4rem"></div>
      </div>
      <div class="card" style="max-width:520px;margin-top:1.4rem">
        <b>Export</b>
        <p style="color:var(--muted);font-size:0.82rem;margin:0.3rem 0 0.6rem">Everything — content, settings, members, media metadata — as one JSON file. No lock-in.</p>
        <a class="btn secondary sm" href="/api/teams/${info.id}/export" target="_blank">Download company export</a>
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
      page.querySelector('#ts-hfont').value = settings.heading_font || 'sans';
      page.querySelector('#ts-layout').value = settings.layout || 'cards';
      const markSwatch = () => {
        const current = page.querySelector('#ts-theme').value;
        page.querySelectorAll('#theme-grid .swatch').forEach((b) =>
          b.classList.toggle('sel', b.dataset.theme === current)
        );
      };
      page.querySelectorAll('#theme-grid .swatch').forEach((b) =>
        b.addEventListener('click', () => {
          page.querySelector('#ts-theme').value = b.dataset.theme;
          markSwatch();
        })
      );
      markSwatch();
      page.querySelector('#ts-accent').value = settings.accent_color || '';
      page.querySelector('#ts-css').value = settings.custom_css || '';
      page.querySelector('#ts-locale').value = settings.default_locale || 'en';

      // Starter kits + AI site builder (shared with the new-company setup flow)
      mountStarterPicker(page, { onApplied: () => render() });

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
              heading_font: f.get('heading_font'),
              layout: f.get('layout'),
              default_locale: (f.get('default_locale') || 'en').toLowerCase(),
            },
          });
          toast('Site settings saved.');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      async function loadWebhooks() {
        const rows = await api(`/teams/${company.id}/webhooks`);
        page.querySelector('#webhook-list').innerHTML = rows.length
          ? `<table><thead><tr><th>URL</th><th>Events</th><th>Last</th><th></th></tr></thead>
            <tbody>${rows
              .map(
                (w) => `<tr><td style="word-break:break-all">${esc(w.url)}</td><td>${esc(w.events)}</td>
                <td>${esc(w.last_status || '—')}</td>
                <td><button class="btn danger sm" data-del-hook="${w.id}">Delete</button></td></tr>`
              )
              .join('')}</tbody></table>`
          : '';
        page.querySelectorAll('[data-del-hook]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            await api(`/teams/${company.id}/webhooks/${btn.dataset.delHook}`, { method: 'DELETE' });
            loadWebhooks();
          })
        );
      }
      page.querySelector('#add-webhook').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          const created = await api(`/teams/${company.id}/webhooks`, {
            method: 'POST',
            body: { url: f.get('url'), events: f.get('events') || '*' },
          });
          e.target.reset();
          prompt('Webhook created. Signing secret (shown once — save it now):', created.secret);
          loadWebhooks();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      loadWebhooks();

      async function loadKeys() {
        const rows = await api(`/teams/${company.id}/api-keys`);
        page.querySelector('#key-list').innerHTML = rows.length
          ? `<table><thead><tr><th>Name</th><th>Prefix</th><th>Scope</th><th>Last used</th><th></th></tr></thead>
            <tbody>${rows
              .map(
                (k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${esc(k.scope)}</td>
                <td>${esc((k.last_used_at || '—').slice(0, 16))}</td>
                <td><button class="btn danger sm" data-del-key="${k.id}">Revoke</button></td></tr>`
              )
              .join('')}</tbody></table>`
          : '';
        page.querySelectorAll('[data-del-key]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            if (!confirm('Revoke this API key? Anything using it stops working immediately.')) return;
            await api(`/teams/${company.id}/api-keys/${btn.dataset.delKey}`, { method: 'DELETE' });
            loadKeys();
          })
        );
      }
      page.querySelector('#add-key').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          const created = await api(`/teams/${company.id}/api-keys`, {
            method: 'POST',
            body: { name: f.get('name'), scope: f.get('scope') },
          });
          e.target.reset();
          prompt('API key created (shown once — save it now):', created.token);
          loadKeys();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      loadKeys();

      // Content types: list, delete, and a small field-schema builder.
      const KIND_OPTIONS = ['text', 'longtext', 'number', 'date', 'url', 'select'];
      async function loadCTypes() {
        const rows = await api(`/teams/${company.id}/content-types`);
        page.querySelector('#ctype-list').innerHTML = rows.length
          ? `<table><thead><tr><th>Type</th><th>Key</th><th>Fields</th><th></th></tr></thead>
            <tbody>${rows
              .map(
                (t) => `<tr><td><b>${esc(t.name)}</b></td><td><code>${esc(t.key)}</code></td>
                <td>${t.schema.map((f) => `${esc(f.label)} <span class="path">(${esc(f.kind)})</span>`).join(', ') || '—'}</td>
                <td><button class="btn danger sm" data-del-ctype="${t.id}">Delete</button></td></tr>`
              )
              .join('')}</tbody></table>`
          : '';
        page.querySelectorAll('[data-del-ctype]').forEach((btn) =>
          btn.addEventListener('click', async () => {
            if (!confirm('Delete this content type? Only possible while no content uses it.')) return;
            try {
              await api(`/teams/${company.id}/content-types/${btn.dataset.delCtype}`, { method: 'DELETE' });
              loadCTypes();
            } catch (err) {
              toast(err.message, 'error');
            }
          })
        );
      }
      const fieldsHost = page.querySelector('#ctype-fields');
      const addFieldRow = () => {
        const row = document.createElement('div');
        row.className = 'toolbar cf-row';
        row.style.margin = '0 0 0.4rem';
        row.innerHTML = `
          <input placeholder="Field label, e.g. Location" class="cf-label" style="flex:1;min-width:120px">
          <select class="cf-kind" style="width:auto">${KIND_OPTIONS.map((k) => `<option>${k}</option>`).join('')}</select>
          <input placeholder="Options, comma-separated" class="cf-options" style="display:none;max-width:170px">
          <button type="button" class="btn danger sm cf-rm">×</button>`;
        row.querySelector('.cf-kind').addEventListener('change', (e) => {
          row.querySelector('.cf-options').style.display = e.target.value === 'select' ? '' : 'none';
        });
        row.querySelector('.cf-rm').addEventListener('click', () => row.remove());
        fieldsHost.appendChild(row);
      };
      page.querySelector('#ctype-addfield').addEventListener('click', addFieldRow);
      addFieldRow();
      page.querySelector('#add-ctype').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const schema = [...fieldsHost.querySelectorAll('.cf-row')]
          .map((row) => ({
            label: row.querySelector('.cf-label').value.trim(),
            kind: row.querySelector('.cf-kind').value,
            options: row.querySelector('.cf-options').value,
          }))
          .filter((field) => field.label);
        try {
          await api(`/teams/${company.id}/content-types`, {
            method: 'POST',
            body: { name: f.get('name'), name_plural: f.get('name_plural'), schema },
          });
          e.target.reset();
          fieldsHost.innerHTML = '';
          addFieldRow();
          toast('Content type created.');
          loadCTypes();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      loadCTypes();

      // Import: WordPress WXR, Markdown files, or a Nova export.
      page.querySelector('#import-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = e.target.querySelector('[name=files]');
        if (!input.files.length) return;
        const fd = new FormData();
        for (const file of input.files) fd.append('files', file);
        const resultEl = page.querySelector('#import-result');
        resultEl.textContent = 'Importing…';
        try {
          const r = await api(`/teams/${company.id}/import`, { method: 'POST', body: fd });
          resultEl.innerHTML = `Imported <b>${r.imported}</b> item(s)${r.types_created ? ` and ${r.types_created} content type(s)` : ''}.${
            r.notes.length ? `<br>${r.notes.map(esc).join('<br>')}` : ''
          }`;
          input.value = '';
          toast(`Imported ${r.imported} item(s).`);
          loadCTypes();
        } catch (err) {
          resultEl.textContent = '';
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
      if (hash.startsWith('#/setup')) return await renderSetup();
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
