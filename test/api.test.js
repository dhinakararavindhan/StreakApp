const { test, before, after } = require('node:test');
const assert = require('node:assert');

process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-password-123';

const { createApp } = require('../src/app');

let server;
let base;
let cookie = '';

function req(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...options.headers,
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
}

before(async () => {
  const app = createApp({ db: { memory: true } });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('unauthenticated API access is rejected', async () => {
  const res = await req('/api/content');
  assert.strictEqual(res.status, 401);
});

test('login fails with wrong password', async () => {
  const res = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' },
  });
  assert.strictEqual(res.status, 401);
});

test('login succeeds and sets auth cookie', async () => {
  const res = await req('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'test-password-123' },
  });
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie && setCookie.includes('cms_token='));
  cookie = setCookie.split(';')[0];
  const body = await res.json();
  assert.strictEqual(body.username, 'admin');
  assert.strictEqual(body.role, 'admin');
});

let postId;

test('create a draft post with tags', async () => {
  const res = await req('/api/content', {
    method: 'POST',
    body: { type: 'post', title: 'Hello World!', body: '# Hi\n\nFirst post.', tags: ['News', 'Intro'] },
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  postId = body.id;
  assert.strictEqual(body.slug, 'hello-world');
  assert.strictEqual(body.status, 'draft');
  assert.deepStrictEqual(body.tags.map((t) => t.name).sort(), ['Intro', 'News']);
});

test('slugs are de-duplicated', async () => {
  const res = await req('/api/content', {
    method: 'POST',
    body: { type: 'post', title: 'Hello World' },
  });
  const body = await res.json();
  assert.strictEqual(body.slug, 'hello-world-2');
});

test('draft posts are not visible on the public site', async () => {
  const res = await fetch(`${base}/posts/hello-world`);
  assert.strictEqual(res.status, 404);
});

test('publishing a post makes it public with rendered markdown', async () => {
  const res = await req(`/api/content/${postId}`, {
    method: 'PUT',
    body: { status: 'published' },
  });
  assert.strictEqual(res.status, 200);
  const pub = await fetch(`${base}/posts/hello-world`);
  assert.strictEqual(pub.status, 200);
  const html = await pub.text();
  assert.ok(html.includes('<h1>Hi</h1>'));
});

test('published post appears on the home page', async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  assert.ok(html.includes('Hello World!'));
});

test('pages are served at root-level slugs', async () => {
  await req('/api/content', {
    method: 'POST',
    body: { type: 'page', title: 'About', body: 'About this site.', status: 'published' },
  });
  const res = await fetch(`${base}/about`);
  assert.strictEqual(res.status, 200);
  assert.ok((await res.text()).includes('About this site.'));
});

test('content can be filtered by status', async () => {
  const res = await req('/api/content?status=draft');
  const rows = await res.json();
  assert.ok(rows.every((r) => r.status === 'draft'));
  assert.ok(rows.some((r) => r.slug === 'hello-world-2'));
});

test('deleting content removes it', async () => {
  const res = await req(`/api/content/${postId}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);
  const gone = await fetch(`${base}/posts/hello-world`);
  assert.strictEqual(gone.status, 404);
});

test('admin can create and list users; editors cannot', async () => {
  const created = await req('/api/users', {
    method: 'POST',
    body: { username: 'writer', password: 'writer-pass-123', role: 'editor' },
  });
  assert.strictEqual(created.status, 201);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'writer', password: 'writer-pass-123' }),
  });
  assert.strictEqual(login.status, 200);
  const editorCookie = login.headers.get('set-cookie').split(';')[0];

  const forbidden = await fetch(`${base}/api/users`, { headers: { Cookie: editorCookie } });
  assert.strictEqual(forbidden.status, 403);
});

test('settings update changes the public site title', async () => {
  const res = await req('/api/settings', {
    method: 'PUT',
    body: { site_title: 'Test Site Title' },
  });
  assert.strictEqual(res.status, 200);
  const home = await fetch(`${base}/`);
  assert.ok((await home.text()).includes('Test Site Title'));
});
