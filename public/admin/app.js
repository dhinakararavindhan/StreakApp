/* CMS admin panel — a small hash-routed SPA over the REST API.
   Multi-team: users pick an active team; content, media, tags, and
   team settings are all scoped to it. */
(() => {
  const app = document.getElementById('app');
  let me = null;
  let teams = [];
  let team = null; // active team

  const esc = (s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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

  const tapi = (path, options) => api(`/teams/${team.id}${path}`, options);

  function flash(el, text, kind = 'ok') {
    el.innerHTML = `<div class="msg ${kind}">${esc(text)}</div>`;
    if (kind === 'ok') setTimeout(() => (el.innerHTML = ''), 2500);
  }

  // ---------- login / register ----------

  function renderLogin(mode = 'login') {
    const isLogin = mode === 'login';
    app.innerHTML = `
      <div class="login-wrap"><form class="login-box" id="login-form">
        <h1>${isLogin ? 'Sign in' : 'Create account'}</h1>
        <div id="login-msg"></div>
        <label>Username</label><input name="username" required autofocus>
        <label>Password${isLogin ? '' : ' (min 8 chars)'}</label><input name="password" type="password" required>
        <p><button class="btn" style="width:100%">${isLogin ? 'Sign in' : 'Create account'}</button></p>
        <p style="text-align:center;font-size:0.85rem">
          ${isLogin
            ? 'New here? <a href="#" id="switch">Create an account</a>'
            : 'Already registered? <a href="#" id="switch">Sign in</a>'}
        </p>
      </form></div>`;
    document.getElementById('switch').addEventListener('click', (e) => {
      e.preventDefault();
      renderLogin(isLogin ? 'register' : 'login');
    });
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        me = await api(isLogin ? '/auth/login' : '/auth/register', {
          method: 'POST',
          body: { username: f.get('username'), password: f.get('password') },
        });
        location.hash = '#/content';
        boot();
      } catch (err) {
        flash(document.getElementById('login-msg'), err.message, 'error');
      }
    });
  }

  // ---------- first-run: create a team ----------

  function renderCreateTeam() {
    app.innerHTML = `
      <div class="login-wrap"><form class="login-box" id="team-form">
        <h1>Create your team</h1>
        <p style="color:var(--muted);font-size:0.9rem">Teams keep their own content, media, members, and public site.</p>
        <div id="team-msg"></div>
        <label>Team name</label><input name="name" required autofocus placeholder="e.g. Marketing">
        <p><button class="btn" style="width:100%">Create team</button></p>
        <p style="text-align:center;font-size:0.85rem"><a href="#" id="logout">Sign out</a></p>
      </form></div>`;
    document.getElementById('logout').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/auth/logout', { method: 'POST' });
      me = null;
      renderLogin();
    });
    document.getElementById('team-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const created = await api('/teams', { method: 'POST', body: { name: f.get('name') } });
        teams.push(created);
        setActiveTeam(created);
        render();
      } catch (err) {
        flash(document.getElementById('team-msg'), err.message, 'error');
      }
    });
  }

  function setActiveTeam(t) {
    team = t;
    localStorage.setItem('cms_active_team', String(t.id));
  }

  // ---------- shell ----------

  const NAV = [
    ['#/content', 'Content'],
    ['#/media', 'Media'],
    ['#/tags', 'Tags'],
    ['#/team', 'Team'],
    ['#/users', 'Users', 'admin'],
    ['#/settings', 'Settings'],
  ];

  function shell(active, inner) {
    const links = NAV.filter(([, , role]) => !role || me.role === role)
      .map(([href, label]) => `<a class="navlink ${active === href ? 'active' : ''}" href="${href}">${label}</a>`)
      .join('');
    const teamOptions = teams
      .map((t) => `<option value="${t.id}" ${team && t.id === team.id ? 'selected' : ''}>${esc(t.name)}</option>`)
      .join('');
    app.innerHTML = `
      <div class="shell">
        <div class="sidebar">
          <div class="brand">CMS</div>
          <select id="team-switch" title="Active team">${teamOptions}</select>
          <a class="navlink" href="#" id="new-team" style="font-size:0.8rem;color:var(--muted)">+ New team</a>
          ${links}
          <div class="spacer"></div>
          <div class="who">Signed in as <b>${esc(me.username)}</b>${me.role === 'admin' ? ' (platform admin)' : ''}</div>
          <a class="navlink" href="/t/${esc(team.slug)}" target="_blank">View site ↗</a>
          <a class="navlink" href="#" id="logout">Sign out</a>
        </div>
        <div class="content" id="page">${inner}</div>
      </div>`;
    document.getElementById('team-switch').addEventListener('change', (e) => {
      const next = teams.find((t) => t.id === Number(e.target.value));
      if (next) {
        setActiveTeam(next);
        render();
      }
    });
    document.getElementById('new-team').addEventListener('click', (e) => {
      e.preventDefault();
      const name = prompt('Team name:');
      if (!name) return;
      api('/teams', { method: 'POST', body: { name } })
        .then((created) => {
          teams.push(created);
          setActiveTeam(created);
          render();
        })
        .catch((err) => alert(err.message));
    });
    document.getElementById('logout').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/auth/logout', { method: 'POST' });
      me = null;
      team = null;
      renderLogin();
    });
    return document.getElementById('page');
  }

  // ---------- content list ----------

  async function renderContentList() {
    const page = shell('#/content', '<h1>Content <a class="btn" href="#/edit/new">+ New</a></h1><div id="list">Loading…</div>');
    const listEl = page.querySelector('#list');
    const state = { type: '', status: '', search: '' };

    async function load() {
      const q = new URLSearchParams(Object.entries(state).filter(([, v]) => v));
      const rows = await tapi(`/content?${q}`);
      listEl.innerHTML = `
        <div class="toolbar">
          <select id="f-type"><option value="">All types</option><option value="post">Posts</option><option value="page">Pages</option></select>
          <select id="f-status"><option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option></select>
          <input id="f-search" placeholder="Search…" value="${esc(state.search)}">
        </div>
        <table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (r) => `<tr>
              <td><a href="#/edit/${r.id}"><b>${esc(r.title)}</b></a><br><span style="color:var(--muted);font-size:0.8rem">/${esc(r.slug)}</span></td>
              <td>${esc(r.type)}</td>
              <td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td>
              <td>${esc(r.updated_at.slice(0, 16))}</td>
              <td><button class="btn danger" data-del="${r.id}" style="padding:0.25rem 0.6rem">Delete</button></td>
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
          await tapi(`/content/${btn.dataset.del}`, { method: 'DELETE' });
          load();
        })
      );
    }
    await load();
  }

  // ---------- editor ----------

  async function renderEditor(id) {
    const isNew = id === 'new';
    const item = isNew
      ? { type: 'post', title: '', slug: '', body: '', excerpt: '', status: 'draft', tags: [] }
      : await tapi(`/content/${id}`);

    const page = shell('#/content', `
      <h1>${isNew ? 'New content' : 'Edit content'}</h1>
      <div id="msg"></div>
      <form id="editor" class="editor-grid">
        <div class="card">
          <label>Title</label><input name="title" required value="${esc(item.title)}">
          <label>Body (Markdown)</label><textarea name="body" rows="18">${esc(item.body)}</textarea>
          <label>Excerpt</label><textarea name="excerpt" rows="2">${esc(item.excerpt)}</textarea>
        </div>
        <div class="card">
          <label>Type</label>
          <select name="type" ${isNew ? '' : 'disabled'}>
            <option value="post" ${item.type === 'post' ? 'selected' : ''}>Post</option>
            <option value="page" ${item.type === 'page' ? 'selected' : ''}>Page</option>
          </select>
          <label>Status</label>
          <select name="status">
            <option value="draft" ${item.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="published" ${item.status === 'published' ? 'selected' : ''}>Published</option>
          </select>
          <label>Slug (blank = from title)</label><input name="slug" value="${esc(item.slug)}">
          <label>Tags (comma-separated)</label><input name="tags" value="${esc(item.tags.map((t) => t.name).join(', '))}">
          <p style="display:flex;gap:0.5rem">
            <button class="btn">Save</button>
            <a class="btn secondary" href="#/content">Back</a>
          </p>
        </div>
      </form>`);

    page.querySelector('#editor').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = {
        title: f.get('title'),
        body: f.get('body'),
        excerpt: f.get('excerpt'),
        status: f.get('status'),
        slug: f.get('slug'),
        tags: f.get('tags').split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (isNew) body.type = f.get('type');
      try {
        const saved = isNew
          ? await tapi('/content', { method: 'POST', body })
          : await tapi(`/content/${id}`, { method: 'PUT', body });
        if (isNew) {
          location.hash = `#/edit/${saved.id}`;
        } else {
          flash(page.querySelector('#msg'), 'Saved.');
          e.target.querySelector('[name=slug]').value = saved.slug;
        }
      } catch (err) {
        flash(page.querySelector('#msg'), err.message, 'error');
      }
    });
  }

  // ---------- media ----------

  async function renderMedia() {
    const page = shell('#/media', `
      <h1>Media</h1>
      <div id="msg"></div>
      <div class="toolbar"><input type="file" id="file"><button class="btn" id="upload">Upload</button></div>
      <div class="media-grid" id="grid">Loading…</div>`);

    async function load() {
      const rows = await tapi('/media');
      page.querySelector('#grid').innerHTML =
        rows
          .map(
            (m) => `<div class="card">
              ${m.mime_type.startsWith('image/') ? `<img src="${esc(m.url)}" alt="">` : '📄'}
              <div><a href="${esc(m.url)}" target="_blank">${esc(m.original_name)}</a></div>
              <div style="color:var(--muted)">${(m.size / 1024).toFixed(1)} KB</div>
              <button class="btn danger" data-del="${m.id}" style="padding:0.2rem 0.5rem;margin-top:0.4rem">Delete</button>
            </div>`
          )
          .join('') || '<p>No files uploaded yet.</p>';
      page.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this file?')) return;
          await tapi(`/media/${btn.dataset.del}`, { method: 'DELETE' });
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
        await tapi('/media', { method: 'POST', body: fd });
        input.value = '';
        flash(page.querySelector('#msg'), 'Uploaded.');
        load();
      } catch (err) {
        flash(page.querySelector('#msg'), err.message, 'error');
      }
    });
    await load();
  }

  // ---------- tags ----------

  async function renderTags() {
    const page = shell('#/tags', '<h1>Tags</h1><div id="list">Loading…</div>');
    async function load() {
      const rows = await tapi('/tags');
      page.querySelector('#list').innerHTML = `
        <table><thead><tr><th>Name</th><th>Slug</th><th>Used by</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.slug)}</td><td>${t.content_count} item(s)</td>
            <td><button class="btn danger" data-del="${t.id}" style="padding:0.25rem 0.6rem">Delete</button></td></tr>`
          )
          .join('') || '<tr><td colspan="4">No tags yet — add them when editing content.</td></tr>'}</tbody></table>`;
      page.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this tag? It will be removed from all content.')) return;
          await tapi(`/tags/${btn.dataset.del}`, { method: 'DELETE' });
          load();
        })
      );
    }
    await load();
  }

  // ---------- team (members + team settings) ----------

  async function renderTeam() {
    const info = await api(`/teams/${team.id}`);
    const isOwner = info.my_role === 'owner';
    const page = shell('#/team', `
      <h1>Team: ${esc(info.name)}</h1>
      <div id="msg"></div>
      ${isOwner ? `
      <form class="card" id="team-form" style="max-width:480px">
        <b>Team profile</b>
        <label>Name</label><input name="name" value="${esc(info.name)}">
        <label>URL slug — site lives at /t/&lt;slug&gt;</label><input name="slug" value="${esc(info.slug)}">
        <label>Custom domain — serve your site at its root (point the domain's DNS at this server first)</label>
        <input name="custom_domain" placeholder="www.yourcompany.com" value="${esc(info.custom_domain || '')}">
        <p><button class="btn">Save</button></p>
      </form>
      <form class="card" id="site-form" style="max-width:480px;margin-top:1.5rem">
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
      <div class="card" style="max-width:480px;margin-top:1.5rem">
        <b>Headless API</b>
        <p style="color:var(--muted);font-size:0.85rem;margin-bottom:0">
          Using your own website frontend? Pull published content as JSON (CORS-open, no auth needed):<br>
          <code>GET /api/public/${esc(info.slug)}/content</code><br>
          <code>GET /api/public/${esc(info.slug)}/content/&lt;slug&gt;</code>
        </p>
      </div>` : ''}
      <div style="margin-top:1.5rem"><b>Members</b>
        ${isOwner ? `
        <form class="toolbar" id="add-member">
          <input name="username" placeholder="Username of an existing account" required>
          <select name="role"><option value="editor">Editor</option><option value="owner">Owner</option></select>
          <button class="btn">Add member</button>
        </form>` : ''}
        <div id="members">Loading…</div>
      </div>
      ${isOwner ? `<p style="margin-top:2rem"><button class="btn danger" id="delete-team">Delete team…</button></p>` : ''}`);

    const msg = page.querySelector('#msg');

    async function loadMembers() {
      const rows = await api(`/teams/${team.id}/members`);
      page.querySelector('#members').innerHTML = `
        <table><thead><tr><th>Username</th><th>Role</th><th>Since</th><th></th></tr></thead>
        <tbody>${rows
          .map((m) => {
            const roleCell = isOwner
              ? `<select data-role="${m.id}"><option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Editor</option><option value="owner" ${m.role === 'owner' ? 'selected' : ''}>Owner</option></select>`
              : esc(m.role);
            const action =
              m.id === me.id
                ? `<button class="btn secondary" data-rm="${m.id}" style="padding:0.25rem 0.6rem">Leave</button>`
                : isOwner
                  ? `<button class="btn danger" data-rm="${m.id}" style="padding:0.25rem 0.6rem">Remove</button>`
                  : '';
            return `<tr><td>${esc(m.username)}${m.id === me.id ? ' <span style="color:var(--muted)">(you)</span>' : ''}</td>
              <td>${roleCell}</td><td>${esc(m.created_at.slice(0, 10))}</td><td>${action}</td></tr>`;
          })
          .join('')}</tbody></table>`;
      page.querySelectorAll('[data-role]').forEach((sel) =>
        sel.addEventListener('change', async () => {
          try {
            await api(`/teams/${team.id}/members/${sel.dataset.role}`, { method: 'PUT', body: { role: sel.value } });
            flash(msg, 'Role updated.');
          } catch (err) {
            flash(msg, err.message, 'error');
          }
          loadMembers();
        })
      );
      page.querySelectorAll('[data-rm]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const leaving = Number(btn.dataset.rm) === me.id;
          if (!confirm(leaving ? 'Leave this team?' : 'Remove this member?')) return;
          try {
            await api(`/teams/${team.id}/members/${btn.dataset.rm}`, { method: 'DELETE' });
            if (leaving) return boot();
            loadMembers();
          } catch (err) {
            flash(msg, err.message, 'error');
          }
        })
      );
    }
    await loadMembers();

    if (isOwner) {
      const settings = await api(`/teams/${team.id}/settings`);
      page.querySelector('#ts-title').value = settings.site_title || '';
      page.querySelector('#ts-desc').value = settings.site_description || '';
      page.querySelector('#ts-theme').value = settings.theme || 'default';
      page.querySelector('#ts-accent').value = settings.accent_color || '';
      page.querySelector('#ts-css').value = settings.custom_css || '';

      page.querySelector('#team-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          const updated = await api(`/teams/${team.id}`, {
            method: 'PUT',
            body: { name: f.get('name'), slug: f.get('slug'), custom_domain: f.get('custom_domain') },
          });
          Object.assign(team, updated);
          teams = teams.map((t) => (t.id === team.id ? { ...t, ...updated } : t));
          flash(msg, 'Team saved.');
          render();
        } catch (err) {
          flash(msg, err.message, 'error');
        }
      });
      page.querySelector('#site-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await api(`/teams/${team.id}/settings`, {
            method: 'PUT',
            body: {
              site_title: f.get('site_title'),
              site_description: f.get('site_description'),
              theme: f.get('theme'),
              accent_color: f.get('accent_color'),
              custom_css: f.get('custom_css'),
            },
          });
          flash(msg, 'Site settings saved.');
        } catch (err) {
          flash(msg, err.message, 'error');
        }
      });
      page.querySelector('#add-member').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await api(`/teams/${team.id}/members`, {
            method: 'POST',
            body: { username: f.get('username'), role: f.get('role') },
          });
          e.target.reset();
          flash(msg, 'Member added.');
          loadMembers();
        } catch (err) {
          flash(msg, err.message, 'error');
        }
      });
      page.querySelector('#delete-team').addEventListener('click', async () => {
        if (!confirm(`Delete team "${info.name}" and ALL of its content? This cannot be undone.`)) return;
        try {
          await api(`/teams/${team.id}`, { method: 'DELETE' });
          boot();
        } catch (err) {
          flash(msg, err.message, 'error');
        }
      });
    }
  }

  // ---------- users (platform admin) ----------

  async function renderUsers() {
    const page = shell('#/users', `
      <h1>Users <span style="font-size:0.8rem;color:var(--muted)">platform-wide</span></h1>
      <div id="msg"></div>
      <form class="toolbar" id="add-user">
        <input name="username" placeholder="Username" required>
        <input name="password" type="password" placeholder="Password (min 8 chars)" required>
        <select name="role"><option value="user">User</option><option value="admin">Platform admin</option></select>
        <button class="btn">Add user</button>
      </form>
      <div id="list">Loading…</div>`);

    async function load() {
      const rows = await api('/users');
      page.querySelector('#list').innerHTML = `
        <table><thead><tr><th>Username</th><th>Role</th><th>Teams</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.team_count}</td><td>${esc(u.created_at.slice(0, 10))}</td>
            <td>${u.id === me.id ? '' : `<button class="btn danger" data-del="${u.id}" style="padding:0.25rem 0.6rem">Delete</button>`}</td></tr>`
          )
          .join('')}</tbody></table>`;
      page.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this user account?')) return;
          await api(`/users/${btn.dataset.del}`, { method: 'DELETE' });
          load();
        })
      );
    }
    page.querySelector('#add-user').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/users', {
          method: 'POST',
          body: { username: f.get('username'), password: f.get('password'), role: f.get('role') },
        });
        e.target.reset();
        flash(page.querySelector('#msg'), 'User added.');
        load();
      } catch (err) {
        flash(page.querySelector('#msg'), err.message, 'error');
      }
    });
    await load();
  }

  // ---------- settings (my account + platform) ----------

  async function renderSettings() {
    const isAdmin = me.role === 'admin';
    const s = isAdmin ? await api('/settings') : null;
    const page = shell('#/settings', `
      <h1>Settings</h1>
      <div id="msg"></div>
      ${isAdmin ? `
      <form class="card" id="platform-form" style="max-width:480px">
        <b>Platform</b>
        <label>Platform title</label><input name="site_title" value="${esc(s.site_title)}">
        <label>Platform description</label><input name="site_description" value="${esc(s.site_description)}">
        <label style="display:flex;align-items:center;gap:0.5rem;margin-top:1rem">
          <input type="checkbox" name="allow_registration" style="width:auto" ${s.allow_registration === 'true' ? 'checked' : ''}>
          Allow anyone to create an account
        </label>
        <p><button class="btn">Save</button></p>
      </form>` : ''}
      <form class="card" id="password-form" style="max-width:480px;${isAdmin ? 'margin-top:1.5rem' : ''}">
        <b>Change my password</b>
        <label>Current password</label><input name="currentPassword" type="password" required>
        <label>New password (min 8 chars)</label><input name="newPassword" type="password" required>
        <p><button class="btn">Update password</button></p>
      </form>`);

    if (isAdmin) {
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
          flash(page.querySelector('#msg'), 'Platform settings saved.');
        } catch (err) {
          flash(page.querySelector('#msg'), err.message, 'error');
        }
      });
    }
    page.querySelector('#password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/auth/password', {
          method: 'POST',
          body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') },
        });
        e.target.reset();
        flash(page.querySelector('#msg'), 'Password updated.');
      } catch (err) {
        flash(page.querySelector('#msg'), err.message, 'error');
      }
    });
  }

  // ---------- router ----------

  async function render() {
    if (!me) return boot();
    if (!team) return renderCreateTeam();
    const hash = location.hash || '#/content';
    const editMatch = hash.match(/^#\/edit\/(\w+)/);
    try {
      if (editMatch) return await renderEditor(editMatch[1]);
      if (hash.startsWith('#/media')) return await renderMedia();
      if (hash.startsWith('#/tags')) return await renderTags();
      if (hash.startsWith('#/team')) return await renderTeam();
      if (hash.startsWith('#/users')) return await renderUsers();
      if (hash.startsWith('#/settings')) return await renderSettings();
      return await renderContentList();
    } catch (err) {
      if (String(err.message).includes('Authentication')) {
        me = null;
        return renderLogin();
      }
      app.innerHTML = `<div class="content"><div class="msg error">${esc(err.message)}</div></div>`;
    }
  }

  /** Load session + teams, pick the active team, then render. */
  async function boot() {
    try {
      me = me || (await api('/auth/me'));
    } catch {
      return renderLogin();
    }
    teams = await api('/teams');
    if (teams.length === 0) {
      team = null;
      return renderCreateTeam();
    }
    const savedId = Number(localStorage.getItem('cms_active_team'));
    team = teams.find((t) => t.id === savedId) || teams[0];
    setActiveTeam(team);
    render();
  }

  window.addEventListener('hashchange', render);
  boot();
})();
