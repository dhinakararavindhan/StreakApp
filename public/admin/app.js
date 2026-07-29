/* CMS admin panel — a small hash-routed SPA over the REST API. */
(() => {
  const app = document.getElementById('app');
  let me = null;

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

  function flash(el, text, kind = 'ok') {
    el.innerHTML = `<div class="msg ${kind}">${esc(text)}</div>`;
    if (kind === 'ok') setTimeout(() => (el.innerHTML = ''), 2500);
  }

  // ---------- login ----------

  function renderLogin() {
    app.innerHTML = `
      <div class="login-wrap"><form class="login-box" id="login-form">
        <h1>CMS Admin</h1>
        <div id="login-msg"></div>
        <label>Username</label><input name="username" required autofocus>
        <label>Password</label><input name="password" type="password" required>
        <p><button class="btn" style="width:100%">Sign in</button></p>
      </form></div>`;
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        me = await api('/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } });
        location.hash = '#/content';
        render();
      } catch (err) {
        flash(document.getElementById('login-msg'), err.message, 'error');
      }
    });
  }

  // ---------- shell ----------

  const NAV = [
    ['#/content', 'Content'],
    ['#/media', 'Media'],
    ['#/tags', 'Tags'],
    ['#/users', 'Users', 'admin'],
    ['#/settings', 'Settings'],
  ];

  function shell(active, inner) {
    const links = NAV.filter(([, , role]) => !role || me.role === role)
      .map(([href, label]) => `<a class="navlink ${active === href ? 'active' : ''}" href="${href}">${label}</a>`)
      .join('');
    app.innerHTML = `
      <div class="shell">
        <div class="sidebar">
          <div class="brand">CMS</div>
          ${links}
          <div class="spacer"></div>
          <div class="who">Signed in as <b>${esc(me.username)}</b> (${esc(me.role)})</div>
          <a class="navlink" href="/" target="_blank">View site ↗</a>
          <a class="navlink" href="#" id="logout">Sign out</a>
        </div>
        <div class="content" id="page">${inner}</div>
      </div>`;
    document.getElementById('logout').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/auth/logout', { method: 'POST' });
      me = null;
      render();
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
      const rows = await api(`/content?${q}`);
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
          await api(`/content/${btn.dataset.del}`, { method: 'DELETE' });
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
      : await api(`/content/${id}`);

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
          ? await api('/content', { method: 'POST', body })
          : await api(`/content/${id}`, { method: 'PUT', body });
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
      const rows = await api('/media');
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
          await api(`/media/${btn.dataset.del}`, { method: 'DELETE' });
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
        await api('/media', { method: 'POST', body: fd });
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
      const rows = await api('/tags');
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
          await api(`/tags/${btn.dataset.del}`, { method: 'DELETE' });
          load();
        })
      );
    }
    await load();
  }

  // ---------- users ----------

  async function renderUsers() {
    const page = shell('#/users', `
      <h1>Users</h1>
      <div id="msg"></div>
      <form class="toolbar" id="add-user">
        <input name="username" placeholder="Username" required>
        <input name="password" type="password" placeholder="Password (min 8 chars)" required>
        <select name="role"><option value="editor">Editor</option><option value="admin">Admin</option></select>
        <button class="btn">Add user</button>
      </form>
      <div id="list">Loading…</div>`);

    async function load() {
      const rows = await api('/users');
      page.querySelector('#list').innerHTML = `
        <table><thead><tr><th>Username</th><th>Role</th><th>Created</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(u.created_at.slice(0, 10))}</td>
            <td>${u.id === me.id ? '' : `<button class="btn danger" data-del="${u.id}" style="padding:0.25rem 0.6rem">Delete</button>`}</td></tr>`
          )
          .join('')}</tbody></table>`;
      page.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this user?')) return;
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

  // ---------- settings ----------

  async function renderSettings() {
    const s = await api('/settings');
    const page = shell('#/settings', `
      <h1>Settings</h1>
      <div id="msg"></div>
      <form class="card" id="settings-form" style="max-width:480px">
        <label>Site title</label><input name="site_title" value="${esc(s.site_title)}" ${me.role !== 'admin' ? 'disabled' : ''}>
        <label>Site description</label><input name="site_description" value="${esc(s.site_description)}" ${me.role !== 'admin' ? 'disabled' : ''}>
        ${me.role === 'admin' ? '<p><button class="btn">Save</button></p>' : '<p style="color:var(--muted)">Only admins can change site settings.</p>'}
      </form>
      <form class="card" id="password-form" style="max-width:480px;margin-top:1.5rem">
        <b>Change my password</b>
        <label>Current password</label><input name="currentPassword" type="password" required>
        <label>New password (min 8 chars)</label><input name="newPassword" type="password" required>
        <p><button class="btn">Update password</button></p>
      </form>`);

    page.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        await api('/settings', {
          method: 'PUT',
          body: { site_title: f.get('site_title'), site_description: f.get('site_description') },
        });
        flash(page.querySelector('#msg'), 'Settings saved.');
      } catch (err) {
        flash(page.querySelector('#msg'), err.message, 'error');
      }
    });
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
    if (!me) {
      try {
        me = await api('/auth/me');
      } catch {
        return renderLogin();
      }
    }
    const hash = location.hash || '#/content';
    const editMatch = hash.match(/^#\/edit\/(\w+)/);
    try {
      if (editMatch) return await renderEditor(editMatch[1]);
      if (hash.startsWith('#/media')) return await renderMedia();
      if (hash.startsWith('#/tags')) return await renderTags();
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

  window.addEventListener('hashchange', render);
  render();
})();
