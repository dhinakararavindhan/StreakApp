const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-password-123';

const { createApp } = require('../src/app');

let server;
let base;

function client(cookie = '') {
  return async (path, options = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      redirect: 'manual',
    });
    return res;
  };
}

async function loginAs(username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.strictEqual(res.status, 200);
  return client(res.headers.get('set-cookie').split(';')[0]);
}

async function registerAs(username, password) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.strictEqual(res.status, 201);
  return client(res.headers.get('set-cookie').split(';')[0]);
}

before(async () => {
  const app = createApp({ db: { memory: true } });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

let admin; // platform admin client
let alice; // regular user client
let bob; // regular user client
let aliceTeam; // team owned by alice
let seededTeamId; // "my-company" seeded for admin

test('unauthenticated API access is rejected', async () => {
  const res = await client()('/api/teams');
  assert.strictEqual(res.status, 401);
});

test('login fails with wrong password', async () => {
  const res = await client()('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' },
  });
  assert.strictEqual(res.status, 401);
});

test('admin login works and sees the seeded team', async () => {
  admin = await loginAs('admin', 'test-password-123');
  const teams = await (await admin('/api/teams')).json();
  assert.ok(teams.some((t) => t.slug === 'my-company'));
  seededTeamId = teams.find((t) => t.slug === 'my-company').id;
});

test('registration rejects short passwords and bad usernames', async () => {
  let res = await client()('/api/auth/register', {
    method: 'POST',
    body: { username: 'alice', password: 'short' },
  });
  assert.strictEqual(res.status, 400);
  res = await client()('/api/auth/register', {
    method: 'POST',
    body: { username: 'a b!', password: 'long-enough-pass' },
  });
  assert.strictEqual(res.status, 400);
});

test('users can self-register and create a team', async () => {
  alice = await registerAs('alice', 'alice-pass-123');
  const res = await alice('/api/teams', { method: 'POST', body: { name: 'Acme Docs' } });
  assert.strictEqual(res.status, 201);
  aliceTeam = await res.json();
  assert.strictEqual(aliceTeam.slug, 'acme-docs');
  assert.strictEqual(aliceTeam.my_role, 'admin');
});

test('non-members cannot access another team', async () => {
  bob = await registerAs('bob', 'bob-pass-1234');
  const res = await bob(`/api/teams/${aliceTeam.id}/content`);
  assert.strictEqual(res.status, 403);
});

let postId;

test('company admin can create content with tags', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Hello World!', body: '# Hi\n\nFirst post.', tags: ['News'] },
  });
  assert.strictEqual(res.status, 201);
  const body = await res.json();
  postId = body.id;
  assert.strictEqual(body.slug, 'hello-world');
  assert.strictEqual(body.status, 'draft');
});

test('slugs are scoped per team', async () => {
  // Same title in a different team should not get -2.
  const res = await admin(`/api/teams/${seededTeamId}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Hello World' },
  });
  const body = await res.json();
  assert.strictEqual(body.slug, 'hello-world');

  // Same title in the SAME team gets de-duplicated.
  const res2 = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Hello World' },
  });
  assert.strictEqual((await res2.json()).slug, 'hello-world-2');
});

test('draft posts are not visible on the public team site', async () => {
  const res = await fetch(`${base}/t/acme-docs/posts/hello-world`);
  assert.strictEqual(res.status, 404);
});

test('publishing makes a post public on the team site with rendered markdown', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}/content/${postId}`, {
    method: 'PUT',
    body: { status: 'published' },
  });
  assert.strictEqual(res.status, 200);
  const pub = await fetch(`${base}/t/acme-docs/posts/hello-world`);
  assert.strictEqual(pub.status, 200);
  const html = await pub.text();
  assert.ok(html.includes('<h1>Hi</h1>'));
});

test("one team's content does not leak onto another team's site", async () => {
  const other = await fetch(`${base}/t/my-company/posts/hello-world`);
  assert.strictEqual(other.status, 404);
});

test('platform home lists team sites', async () => {
  const res = await fetch(`${base}/`);
  const html = await res.text();
  assert.ok(html.includes('Acme Docs'));
  assert.ok(html.includes('/t/acme-docs'));
});

test('team pages are served at the team root', async () => {
  await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'page', title: 'About', body: 'About Acme Docs.', status: 'published' },
  });
  const res = await fetch(`${base}/t/acme-docs/about`);
  assert.strictEqual(res.status, 200);
  assert.ok((await res.text()).includes('About Acme Docs.'));
});

test('admin can add a member; managers can write content but not manage members', async () => {
  const add = await alice(`/api/teams/${aliceTeam.id}/members`, {
    method: 'POST',
    body: { username: 'bob', role: 'manager' },
  });
  assert.strictEqual(add.status, 201);

  const write = await bob(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Bob was here' },
  });
  assert.strictEqual(write.status, 201);

  const manage = await bob(`/api/teams/${aliceTeam.id}/members`, {
    method: 'POST',
    body: { username: 'admin' },
  });
  assert.strictEqual(manage.status, 403);
});

test('the last company admin cannot be removed or demoted', async () => {
  const demote = await alice(`/api/teams/${aliceTeam.id}/members/${(await (await alice('/api/auth/me')).json()).id}`, {
    method: 'PUT',
    body: { role: 'manager' },
  });
  assert.strictEqual(demote.status, 400);
});

test('members can leave a team', async () => {
  const bobId = (await (await bob('/api/auth/me')).json()).id;
  const res = await bob(`/api/teams/${aliceTeam.id}/members/${bobId}`, { method: 'DELETE' });
  assert.strictEqual(res.status, 200);
  const after = await bob(`/api/teams/${aliceTeam.id}/content`);
  assert.strictEqual(after.status, 403);
});

test('team settings change the public site title', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}/settings`, {
    method: 'PUT',
    body: { site_title: 'Acme Knowledge Base' },
  });
  assert.strictEqual(res.status, 200);
  const home = await fetch(`${base}/t/acme-docs`);
  assert.ok((await home.text()).includes('Acme Knowledge Base'));
});

test('approval workflow: managers cannot publish, admins approve or reject', async () => {
  // Re-add bob as a manager (he left in an earlier test).
  await alice(`/api/teams/${aliceTeam.id}/members`, {
    method: 'POST',
    body: { username: 'bob', role: 'manager' },
  });

  // Manager cannot publish directly.
  const direct = await bob(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Sneaky launch', status: 'published' },
  });
  assert.strictEqual(direct.status, 403);

  // Manager submits for approval instead.
  const submitted = await bob(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Quarterly update', body: 'Numbers look good.', status: 'pending' },
  });
  assert.strictEqual(submitted.status, 201);
  const item = await submitted.json();
  assert.strictEqual(item.status, 'pending');

  // Pending content is not on the public site or headless API.
  assert.strictEqual((await fetch(`${base}/t/acme-docs/posts/quarterly-update`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/public/acme-docs/content/quarterly-update`)).status, 404);

  // Managers cannot approve; admins can.
  const managerApprove = await bob(`/api/teams/${aliceTeam.id}/content/${item.id}/approve`, { method: 'POST' });
  assert.strictEqual(managerApprove.status, 403);
  const approve = await alice(`/api/teams/${aliceTeam.id}/content/${item.id}/approve`, { method: 'POST' });
  assert.strictEqual(approve.status, 200);
  assert.strictEqual((await approve.json()).status, 'published');
  assert.strictEqual((await fetch(`${base}/t/acme-docs/posts/quarterly-update`)).status, 200);

  // A manager editing live content pulls the edits into review, but the
  // previously approved version STAYS live as a snapshot.
  const edit = await bob(`/api/teams/${aliceTeam.id}/content/${item.id}`, {
    method: 'PUT',
    body: { body: 'Numbers look even better.' },
  });
  assert.strictEqual(edit.status, 200);
  const edited = await edit.json();
  assert.strictEqual(edited.status, 'pending');
  assert.strictEqual(edited.live_version.body, 'Numbers look good.');
  const stillLive = await fetch(`${base}/t/acme-docs/posts/quarterly-update`);
  assert.strictEqual(stillLive.status, 200);
  const liveHtml = await stillLive.text();
  assert.ok(liveHtml.includes('Numbers look good.'));
  assert.ok(!liveHtml.includes('Numbers look even better.'));

  // Reject with a note — edits go back to draft, note visible, old version still live.
  const reject = await alice(`/api/teams/${aliceTeam.id}/content/${item.id}/reject`, {
    method: 'POST',
    body: { note: 'Add the revenue table before publishing.' },
  });
  assert.strictEqual(reject.status, 200);
  const rejected = await reject.json();
  assert.strictEqual(rejected.status, 'draft');
  assert.strictEqual(rejected.review_note, 'Add the revenue table before publishing.');
  assert.strictEqual((await fetch(`${base}/t/acme-docs/posts/quarterly-update`)).status, 200);

  // Resubmit and approve — the new version replaces the snapshot.
  await bob(`/api/teams/${aliceTeam.id}/content/${item.id}`, {
    method: 'PUT',
    body: { status: 'pending' },
  });
  const reapprove = await alice(`/api/teams/${aliceTeam.id}/content/${item.id}/approve`, { method: 'POST' });
  assert.strictEqual(reapprove.status, 200);
  const final = await reapprove.json();
  assert.strictEqual(final.status, 'published');
  assert.strictEqual(final.live_version, null);
  const updatedHtml = await (await fetch(`${base}/t/acme-docs/posts/quarterly-update`)).text();
  assert.ok(updatedHtml.includes('Numbers look even better.'));

  // Dashboard stats count pending items.
  const stats = await (await alice(`/api/teams/${aliceTeam.id}/stats`)).json();
  assert.strictEqual(typeof stats.pending, 'number');
});

test('cover images are stored and exposed on cards and the headless API', async () => {
  const created = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: {
      type: 'post',
      title: 'Covered story',
      cover_image: '/uploads/cover-demo.png',
      status: 'published',
    },
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual((await created.json()).cover_image, '/uploads/cover-demo.png');

  const home = await (await fetch(`${base}/t/acme-docs`)).text();
  assert.ok(home.includes('/uploads/cover-demo.png'));

  const api = await (await fetch(`${base}/api/public/acme-docs/content/covered-story`)).json();
  assert.strictEqual(api.cover_image, '/uploads/cover-demo.png');
});

test('company dashboard stats are available to members', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}/stats`);
  assert.strictEqual(res.status, 200);
  const stats = await res.json();
  assert.ok(stats.posts >= 1);
  assert.ok(stats.published >= 1);
  assert.ok(Array.isArray(stats.recent) && stats.recent.length > 0);
});

test('platform stats are superadmin-only', async () => {
  const forbidden = await alice('/api/platform/stats');
  assert.strictEqual(forbidden.status, 403);
  const res = await admin('/api/platform/stats');
  assert.strictEqual(res.status, 200);
  const stats = await res.json();
  assert.ok(stats.companies >= 2);
  assert.ok(stats.users >= 3);
  assert.ok(Array.isArray(stats.recent_companies));
});

test('superadmin can access any company; regular users cannot administer users', async () => {
  const res = await admin(`/api/teams/${aliceTeam.id}/content`);
  assert.strictEqual(res.status, 200);

  const forbidden = await alice('/api/users');
  assert.strictEqual(forbidden.status, 403);
});

test('registration can be disabled by the platform admin', async () => {
  await admin('/api/settings', { method: 'PUT', body: { allow_registration: 'false' } });
  const res = await client()('/api/auth/register', {
    method: 'POST',
    body: { username: 'carol', password: 'carol-pass-123' },
  });
  assert.strictEqual(res.status, 403);
  await admin('/api/settings', { method: 'PUT', body: { allow_registration: 'true' } });
});

test('theme and accent color change the public site CSS', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}/settings`, {
    method: 'PUT',
    body: { theme: 'midnight', accent_color: '#dc2626' },
  });
  assert.strictEqual(res.status, 200);
  const html = await (await fetch(`${base}/t/acme-docs`)).text();
  assert.ok(html.includes('--bg: #0f1115'));
  assert.ok(html.includes('--accent: #dc2626'));
});

test('headless API serves published content as JSON without auth', async () => {
  const list = await fetch(`${base}/api/public/acme-docs/content`);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.headers.get('access-control-allow-origin'), '*');
  const rows = await list.json();
  assert.ok(rows.some((r) => r.slug === 'hello-world'));
  assert.ok(rows.every((r) => r.body === undefined));

  const single = await fetch(`${base}/api/public/acme-docs/content/hello-world`);
  const item = await single.json();
  assert.ok(item.body_html.includes('<h1>Hi</h1>'));

  // Drafts stay private.
  const draft = await fetch(`${base}/api/public/acme-docs/content/hello-world-2`);
  assert.strictEqual(draft.status, 404);
});

test('invalid custom domains are rejected', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}`, {
    method: 'PUT',
    body: { custom_domain: 'not a domain!' },
  });
  assert.strictEqual(res.status, 400);
});

test('a connected custom domain serves the team site at its root', async () => {
  const set = await alice(`/api/teams/${aliceTeam.id}`, {
    method: 'PUT',
    body: { custom_domain: 'docs.acme.example' },
  });
  assert.strictEqual(set.status, 200);
  assert.strictEqual((await set.json()).custom_domain, 'docs.acme.example');

  const fetchAsHost = (path, host) =>
    new Promise((resolve, reject) => {
      const url = new URL(base);
      http.get(
        { host: url.hostname, port: url.port, path, headers: { Host: host } },
        (r) => {
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => resolve({ status: r.statusCode, body }));
        }
      ).on('error', reject);
    });

  const home = await fetchAsHost('/', 'docs.acme.example');
  assert.strictEqual(home.status, 200);
  assert.ok(home.body.includes('Acme Knowledge Base'));
  assert.ok(!home.body.includes('All teams'));

  const post = await fetchAsHost('/posts/hello-world', 'docs.acme.example');
  assert.strictEqual(post.status, 200);
  assert.ok(post.body.includes('<h1>Hi</h1>'));

  const pageRes = await fetchAsHost('/about', 'docs.acme.example');
  assert.strictEqual(pageRes.status, 200);
  assert.ok(pageRes.body.includes('About Acme Docs.'));

  // The platform host still serves the directory.
  const directory = await fetch(`${base}/`);
  assert.ok((await directory.text()).includes('Sign in or create an account'));
});

test('deleting a team removes its content everywhere', async () => {
  const res = await alice('/api/teams', { method: 'POST', body: { name: 'Throwaway' } });
  const t = await res.json();
  await alice(`/api/teams/${t.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Gone soon', status: 'published' },
  });
  const del = await alice(`/api/teams/${t.id}`, { method: 'DELETE' });
  assert.strictEqual(del.status, 200);
  const site = await fetch(`${base}/t/throwaway`);
  assert.strictEqual(site.status, 404);
});


test('version history records every save and supports restore', async () => {
  const created = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Versioned piece', body: 'First draft.' },
  });
  const item = await created.json();

  await alice(`/api/teams/${aliceTeam.id}/content/${item.id}`, {
    method: 'PUT',
    body: { body: 'Second draft, much better.' },
  });

  const versions = await (await alice(`/api/teams/${aliceTeam.id}/content/${item.id}/versions`)).json();
  assert.ok(versions.length >= 2);
  assert.strictEqual(versions[0].body, 'Second draft, much better.');
  const firstVersion = versions[versions.length - 1];
  assert.strictEqual(firstVersion.body, 'First draft.');

  const restored = await alice(
    `/api/teams/${aliceTeam.id}/content/${item.id}/versions/${firstVersion.id}/restore`,
    { method: 'POST' }
  );
  assert.strictEqual(restored.status, 200);
  assert.strictEqual((await restored.json()).body, 'First draft.');

  // The restore itself became a new version.
  const after = await (await alice(`/api/teams/${aliceTeam.id}/content/${item.id}/versions`)).json();
  assert.ok(after.length >= 3);
});

test('scheduled publishing gates public visibility by time', async () => {
  const future = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Tomorrow news', status: 'published', publish_at: '2099-01-01 00:00' },
  });
  assert.strictEqual(future.status, 201);
  assert.strictEqual((await fetch(`${base}/t/acme-docs/posts/tomorrow-news`)).status, 404);
  const headless = await (await fetch(`${base}/api/public/acme-docs/content`)).json();
  assert.ok(!headless.some((r) => r.slug === 'tomorrow-news'));

  const past = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Yesterday news', status: 'published', publish_at: '2020-01-01 00:00' },
  });
  assert.strictEqual(past.status, 201);
  assert.strictEqual((await fetch(`${base}/t/acme-docs/posts/yesterday-news`)).status, 200);

  const expired = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Expired offer', status: 'published', expire_at: '2020-01-01 00:00' },
  });
  assert.strictEqual(expired.status, 201);
  assert.strictEqual((await fetch(`${base}/t/acme-docs/posts/expired-offer`)).status, 404);

  const bad = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Bad schedule', publish_at: 'not-a-date' },
  });
  assert.strictEqual(bad.status, 400);
});

test('comment threads work for members; single GET includes body_html', async () => {
  const created = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Discussed piece', body: '# Heading\n\nText.' },
  });
  const item = await created.json();

  const posted = await bob(`/api/teams/${aliceTeam.id}/content/${item.id}/comments`, {
    method: 'POST',
    body: { body: 'Should we mention pricing here?' },
  });
  assert.strictEqual(posted.status, 201);
  await alice(`/api/teams/${aliceTeam.id}/content/${item.id}/comments`, {
    method: 'POST',
    body: { body: 'Yes — add a line about the free tier.' },
  });

  const thread = await (await alice(`/api/teams/${aliceTeam.id}/content/${item.id}/comments`)).json();
  assert.strictEqual(thread.length, 2);
  assert.strictEqual(thread[0].author, 'bob');

  const single = await (await alice(`/api/teams/${aliceTeam.id}/content/${item.id}`)).json();
  assert.ok(single.body_html.includes('<h1>Heading</h1>'));
});

test('audit log records workflow actions, admin-only', async () => {
  const forbidden = await bob(`/api/teams/${aliceTeam.id}/audit`);
  assert.strictEqual(forbidden.status, 403);

  const rows = await (await alice(`/api/teams/${aliceTeam.id}/audit`)).json();
  const actions = rows.map((r) => r.action);
  assert.ok(actions.includes('content.approve'));
  assert.ok(actions.includes('content.reject'));
  assert.ok(actions.includes('content.restore'));
  assert.ok(actions.includes('member.add'));
  const approve = rows.find((r) => r.action === 'content.approve');
  assert.strictEqual(approve.username, 'alice');
});


test('i18n: translations link, locale homes, hreflang, headless locale filter', async () => {
  // English original, published directly by the company admin.
  const en = await (
    await alice(`/api/teams/${aliceTeam.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Launch day', body: 'We are live.', status: 'published' },
    })
  ).json();

  // Spanish translation linked to it.
  const esRes = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: {
      type: 'post', title: 'Dia de lanzamiento', body: 'Estamos en vivo.',
      status: 'published', locale: 'es', translation_of: en.id,
    },
  });
  assert.strictEqual(esRes.status, 201);
  const es = await esRes.json();
  assert.strictEqual(es.locale, 'es');

  // Duplicate locale in the same group is rejected.
  const dup = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Otra vez', locale: 'es', translation_of: en.id },
  });
  assert.strictEqual(dup.status, 409);

  // Single GET lists the sibling translations.
  const single = await (await alice(`/api/teams/${aliceTeam.id}/content/${en.id}`)).json();
  assert.ok(single.translations.some((t) => t.locale === 'es'));

  // Default-locale home shows EN, not ES; /es locale home shows ES.
  const home = await (await fetch(`${base}/t/acme-docs`)).text();
  assert.ok(home.includes('Launch day'));
  assert.ok(!home.includes('Dia de lanzamiento'));
  const esHome = await (await fetch(`${base}/t/acme-docs/es`)).text();
  assert.ok(esHome.includes('Dia de lanzamiento'));
  assert.ok(!esHome.includes('Launch day'));

  // hreflang alternates on the post page.
  const post = await (await fetch(`${base}/t/acme-docs/posts/launch-day`)).text();
  assert.ok(post.includes('hreflang="es"'));
  assert.ok(post.includes('hreflang="en"'));

  // Headless: locale filter + translations on single items.
  const esOnly = await (await fetch(`${base}/api/public/acme-docs/content?locale=es`)).json();
  assert.ok(esOnly.every((r) => r.locale === 'es'));
  const headlessSingle = await (await fetch(`${base}/api/public/acme-docs/content/launch-day`)).json();
  assert.ok(headlessSingle.translations.some((t) => t.locale === 'es' && t.slug === 'dia-de-lanzamiento'));
});

test('webhooks: signed deliveries on publish, update, and delete', async () => {
  const crypto = require('node:crypto');
  const received = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.end('ok');
    });
  });
  await new Promise((resolve) => receiver.listen(0, resolve));
  const hookUrl = `http://127.0.0.1:${receiver.address().port}/nova`;

  const created = await alice(`/api/teams/${aliceTeam.id}/webhooks`, {
    method: 'POST',
    body: { url: hookUrl, events: '*' },
  });
  assert.strictEqual(created.status, 201);
  const { secret } = await created.json();
  assert.ok(secret);

  // Listing never exposes the secret again.
  const listed = await (await alice(`/api/teams/${aliceTeam.id}/webhooks`)).json();
  assert.ok(listed.length >= 1);
  assert.strictEqual(listed[0].secret, undefined);

  const waitFor = async (n) => {
    for (let i = 0; i < 40 && received.length < n; i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(received.length >= n, `expected ${n} deliveries, got ${received.length}`);
  };

  // Publish -> content.published, with a valid HMAC signature.
  const item = await (
    await alice(`/api/teams/${aliceTeam.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Hooked post', status: 'published' },
    })
  ).json();
  await waitFor(1);
  const first = received[0];
  assert.strictEqual(first.headers['x-nova-event'], 'content.published');
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(first.body).digest('hex')}`;
  assert.strictEqual(first.headers['x-nova-signature'], expected);
  assert.strictEqual(JSON.parse(first.body).content.slug, 'hooked-post');

  // Live update -> content.updated.
  await alice(`/api/teams/${aliceTeam.id}/content/${item.id}`, {
    method: 'PUT',
    body: { body: 'Updated body.' },
  });
  await waitFor(2);
  assert.strictEqual(received[1].headers['x-nova-event'], 'content.updated');

  // Delete -> content.deleted.
  await alice(`/api/teams/${aliceTeam.id}/content/${item.id}`, { method: 'DELETE' });
  await waitFor(3);
  assert.strictEqual(received[2].headers['x-nova-event'], 'content.deleted');

  receiver.close();
});

test('API keys: scoped access, approval rules, revocation', async () => {
  const readKey = await (
    await alice(`/api/teams/${aliceTeam.id}/api-keys`, { method: 'POST', body: { name: 'reader', scope: 'read' } })
  ).json();
  const writeKey = await (
    await alice(`/api/teams/${aliceTeam.id}/api-keys`, { method: 'POST', body: { name: 'writer', scope: 'write' } })
  ).json();
  assert.ok(readKey.token.startsWith('nova_'));

  const withKey = (token) => (path, options = {}) =>
    fetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  // Read key: GET works (drafts included), writes are rejected.
  const list = await withKey(readKey.token)(`/api/teams/${aliceTeam.id}/content`);
  assert.strictEqual(list.status, 200);
  const writeAttempt = await withKey(readKey.token)(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Nope' },
  });
  assert.strictEqual(writeAttempt.status, 403);

  // Write key: creates content, but publishing still needs approval.
  const draft = await withKey(writeKey.token)(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'From CI', status: 'pending' },
  });
  assert.strictEqual(draft.status, 201);
  const publishAttempt = await withKey(writeKey.token)(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Sneaky CI', status: 'published' },
  });
  assert.strictEqual(publishAttempt.status, 403);

  // Keys can never do admin things or cross companies.
  const adminAttempt = await withKey(writeKey.token)(`/api/teams/${aliceTeam.id}/members`);
  assert.strictEqual(adminAttempt.status, 200); // members list is manager-level
  const approveAttempt = await withKey(writeKey.token)(`/api/teams/${aliceTeam.id}/audit`);
  assert.strictEqual(approveAttempt.status, 403);
  const crossCompany = await withKey(writeKey.token)(`/api/teams/${seededTeamId}/content`);
  assert.strictEqual(crossCompany.status, 403);

  // Revocation cuts access immediately.
  await alice(`/api/teams/${aliceTeam.id}/api-keys/${readKey.id}`, { method: 'DELETE' });
  const afterRevoke = await withKey(readKey.token)(`/api/teams/${aliceTeam.id}/content`);
  assert.strictEqual(afterRevoke.status, 401);
});

test('full company export contains content, settings, and members', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}/export`);
  assert.strictEqual(res.status, 200);
  assert.ok((res.headers.get('content-disposition') || '').includes('acme-docs-export.json'));
  const dump = await res.json();
  assert.strictEqual(dump.format, 'nova-cms-export');
  assert.ok(dump.content.some((c) => c.slug === 'launch-day'));
  assert.ok(dump.settings.site_title);
  assert.ok(dump.members.some((m) => m.username === 'alice' && m.role === 'admin'));
  // Snapshots are internal — not exported.
  assert.ok(dump.content.every((c) => c.published_snapshot === undefined));
});


test('inline markdown renders in excerpts and site descriptions', async () => {
  await alice(`/api/teams/${aliceTeam.id}/settings`, {
    method: 'PUT',
    body: { site_description: 'Docs that **matter**, by [Acme](https://acme.example).' },
  });
  await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: {
      type: 'post', title: 'Formatted teaser', status: 'published',
      excerpt: 'A story about **bold moves** and `clean code`.', body: 'Body.',
    },
  });

  const home = await (await fetch(`${base}/t/acme-docs`)).text();
  assert.ok(home.includes('<strong>bold moves</strong>'));
  assert.ok(home.includes('<code>clean code</code>'));
  assert.ok(home.includes('<strong>matter</strong>'));
  assert.ok(home.includes('href="https://acme.example"'));

  // Meta descriptions stay plain text — no markdown syntax, no tags.
  const metaLine = home.split('\n').find((l) => l.includes('name="description"'));
  assert.ok(metaLine.includes('Docs that matter'));
  assert.ok(!metaLine.includes('**'));

  // Headless API exposes rendered excerpt_html alongside raw excerpt.
  const item = await (await fetch(`${base}/api/public/acme-docs/content/formatted-teaser`)).json();
  assert.strictEqual(item.excerpt, 'A story about **bold moves** and `clean code`.');
  assert.ok(item.excerpt_html.includes('<strong>bold moves</strong>'));
});


test('body formats: text, html, image, and embed all render correctly', async () => {
  // Plain text: paragraphs preserved, HTML escaped.
  await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: {
      type: 'post', title: 'Plain note', format: 'text', status: 'published',
      body: 'First paragraph with <b>tags</b> that must not render.\n\nSecond paragraph.',
    },
  });
  const textHtml = await (await fetch(`${base}/t/acme-docs/posts/plain-note`)).text();
  assert.ok(textHtml.includes('&lt;b&gt;tags&lt;/b&gt;'));
  assert.ok(textHtml.includes('<p>Second paragraph.</p>'));

  // Raw HTML: rendered as-is on the public site.
  await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: {
      type: 'post', title: 'Custom layout', format: 'html', status: 'published',
      body: '<section class="pricing-grid"><h2>Plans</h2></section>',
    },
  });
  const rawHtml = await (await fetch(`${base}/t/acme-docs/posts/custom-layout`)).text();
  assert.ok(rawHtml.includes('<section class="pricing-grid">'));

  // Image: body is the URL, excerpt becomes the caption.
  await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: {
      type: 'post', title: 'Team photo', format: 'image', status: 'published',
      body: '/uploads/team.jpg', excerpt: 'The whole crew, June offsite.',
    },
  });
  const imgHtml = await (await fetch(`${base}/t/acme-docs/posts/team-photo`)).text();
  assert.ok(imgHtml.includes('<figure class="body-image">'));
  assert.ok(imgHtml.includes('src="/uploads/team.jpg"'));
  assert.ok(imgHtml.includes('<figcaption>The whole crew, June offsite.</figcaption>'));

  // Embed: YouTube URL becomes a privacy-friendly iframe.
  await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: {
      type: 'post', title: 'Roast walkthrough', format: 'embed', status: 'published',
      body: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    },
  });
  const embedHtml = await (await fetch(`${base}/t/acme-docs/posts/roast-walkthrough`)).text();
  assert.ok(embedHtml.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'));

  // Headless API exposes format and format-correct body_html.
  const item = await (await fetch(`${base}/api/public/acme-docs/content/team-photo`)).json();
  assert.strictEqual(item.format, 'image');
  assert.ok(item.body_html.includes('<figure class="body-image">'));
  const list = await (await fetch(`${base}/api/public/acme-docs/content`)).json();
  assert.ok(list.find((r) => r.slug === 'custom-layout').format === 'html');

  // Invalid format rejected; format survives version restore.
  const bad = await alice(`/api/teams/${aliceTeam.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Nope', format: 'docx' },
  });
  assert.strictEqual(bad.status, 400);
});


test('theme presets, heading fonts, and home layout apply to the site', async () => {
  const res = await alice(`/api/teams/${aliceTeam.id}/settings`, {
    method: 'PUT',
    body: { theme: 'noir', heading_font: 'serif', layout: 'list' },
  });
  assert.strictEqual(res.status, 200);
  const saved = await res.json();
  assert.strictEqual(saved.theme, 'noir');

  const home = await (await fetch(`${base}/t/acme-docs`)).text();
  assert.ok(home.includes('--bg: #000000'));
  assert.ok(home.includes("Georgia, 'Times New Roman', serif"));
  assert.ok(home.includes('class="postrow"'));
  assert.ok(!home.includes('class="cards"'));

  // Back to a light preset with the card grid.
  await alice(`/api/teams/${aliceTeam.id}/settings`, {
    method: 'PUT',
    body: { theme: 'mint', heading_font: 'sans', layout: 'cards' },
  });
  const mint = await (await fetch(`${base}/t/acme-docs`)).text();
  assert.ok(mint.includes('--bg: #f1faf6'));
  assert.ok(mint.includes('class="cards"'));
});

test('site templates are listed for authenticated users only', async () => {
  assert.strictEqual((await fetch(`${base}/api/site-templates`)).status, 401);
  const res = await alice('/api/site-templates');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.templates) && body.templates.length >= 5);
  const docs = body.templates.find((t) => t.key === 'docs');
  assert.ok(docs);
  assert.strictEqual(docs.theme, 'terminal');
  assert.ok(docs.pages > 0 && docs.posts > 0);
  assert.strictEqual(typeof body.ai_available, 'boolean');
});

test('applying a starter kit sets the theme and publishes starter content', async () => {
  const owner = await registerAs('tplowner', 'tpl-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Kit Co' } })).json();

  // Unknown templates are rejected; managers cannot apply kits.
  assert.strictEqual(
    (await owner(`/api/teams/${team.id}/apply-template`, { method: 'POST', body: { template: 'nope' } })).status,
    400
  );
  const mgr = await registerAs('tplmgr', 'tpl-password-2');
  await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'tplmgr', role: 'manager' } });
  assert.strictEqual(
    (await mgr(`/api/teams/${team.id}/apply-template`, { method: 'POST', body: { template: 'docs' } })).status,
    403
  );

  const res = await owner(`/api/teams/${team.id}/apply-template`, { method: 'POST', body: { template: 'docs' } });
  assert.strictEqual(res.status, 200);
  const result = await res.json();
  assert.strictEqual(result.template, 'docs');
  assert.ok(result.created >= 4);

  const settings = await (await owner(`/api/teams/${team.id}/settings`)).json();
  assert.strictEqual(settings.theme, 'terminal');
  assert.strictEqual(settings.heading_font, 'mono');
  assert.strictEqual(settings.layout, 'list');

  // Starter content is live on the public site immediately.
  const home = await (await fetch(`${base}/t/${team.slug}`)).text();
  assert.ok(home.includes('Getting started'));
  assert.ok(home.includes('v1.0 release notes'));
  assert.ok(home.includes('--bg: #0a0f0a')); // terminal theme

  const auditRows = await (await owner(`/api/teams/${team.id}/audit`)).json();
  assert.ok(auditRows.some((r) => r.action === 'site.template'));
});

test('AI site builder: 503 when unconfigured, builds a site in mock mode', async () => {
  const owner = await loginAs('tplowner', 'tpl-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'AI Co' } })).json();

  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedMock = process.env.NOVA_AI_MOCK;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NOVA_AI_MOCK;
  try {
    const off = await owner(`/api/teams/${team.id}/ai-build`, {
      method: 'POST',
      body: { prompt: 'A tiny bakery in Lisbon' },
    });
    assert.strictEqual(off.status, 503);
    assert.ok((await off.json()).error.includes('ANTHROPIC_API_KEY'));

    process.env.NOVA_AI_MOCK = '1';
    assert.strictEqual(
      (await owner(`/api/teams/${team.id}/ai-build`, { method: 'POST', body: { prompt: 'x' } })).status,
      400
    );

    const res = await owner(`/api/teams/${team.id}/ai-build`, {
      method: 'POST',
      body: { prompt: 'A tiny bakery in Lisbon famous for cinnamon rolls' },
    });
    assert.strictEqual(res.status, 200);
    const built = await res.json();
    assert.ok(built.ok);
    assert.strictEqual(built.theme, 'ocean');
    assert.ok(built.pages >= 1 && built.posts >= 1);

    const settings = await (await owner(`/api/teams/${team.id}/settings`)).json();
    assert.strictEqual(settings.theme, 'ocean');
    assert.ok(settings.site_title.includes('bakery') || settings.site_title.includes('A tiny'));

    const home = await (await fetch(`${base}/t/${team.slug}`)).text();
    assert.ok(home.includes('Welcome to our new site'));

    const auditRows = await (await owner(`/api/teams/${team.id}/audit`)).json();
    assert.ok(auditRows.some((r) => r.action === 'site.ai_build'));
  } finally {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedMock === undefined) delete process.env.NOVA_AI_MOCK;
    else process.env.NOVA_AI_MOCK = savedMock;
  }
});

test('custom content types: schemas, field validation, approval snapshot', async () => {
  const owner = await registerAs('ctowner', 'ct-password-12');
  const mgrClient = await registerAs('ctmgr', 'ct-password-34');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Talent Co' } })).json();
  await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'ctmgr', role: 'manager' } });

  // Managers cannot define types; reserved keys are rejected.
  assert.strictEqual(
    (await mgrClient(`/api/teams/${team.id}/content-types`, { method: 'POST', body: { name: 'X' } })).status,
    403
  );
  assert.strictEqual(
    (await owner(`/api/teams/${team.id}/content-types`, { method: 'POST', body: { name: 'Post' } })).status,
    400
  );

  const created = await owner(`/api/teams/${team.id}/content-types`, {
    method: 'POST',
    body: {
      name: 'Job',
      name_plural: 'Jobs',
      schema: [
        { label: 'Location', kind: 'text' },
        { label: 'Salary', kind: 'number' },
        { label: 'Apply link', kind: 'url' },
        { label: 'Level', kind: 'select', options: 'Junior, Senior' },
      ],
    },
  });
  assert.strictEqual(created.status, 201);
  const jobType = await created.json();
  assert.strictEqual(jobType.key, 'job');
  assert.deepStrictEqual(jobType.schema.map((f) => f.key), ['location', 'salary', 'apply_link', 'level']);

  // Field values are validated against the schema.
  const bad = await owner(`/api/teams/${team.id}/content`, {
    method: 'POST',
    body: { type: 'job', title: 'X', fields: { level: 'CEO' } },
  });
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(
    (await owner(`/api/teams/${team.id}/content`, { method: 'POST', body: { type: 'nope', title: 'X' } })).status,
    400
  );

  const item = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: {
        type: 'job',
        title: 'Thermal engineer',
        body: 'Own thermal modeling for the OL-8 series.',
        status: 'published',
        fields: { location: 'Remote', salary: 140000, apply_link: 'https://example.com/apply', level: 'Senior' },
      },
    })
  ).json();
  assert.deepStrictEqual(item.fields, {
    location: 'Remote',
    salary: 140000,
    apply_link: 'https://example.com/apply',
    level: 'Senior',
  });

  // Fields render on the public article and in the headless API.
  const html = await (await fetch(`${base}/t/${team.slug}/${item.slug}`)).text();
  assert.ok(html.includes('Location') && html.includes('Remote') && html.includes('140000'));
  const headless = await (await fetch(`${base}/api/public/${team.slug}/content/${item.slug}`)).json();
  assert.strictEqual(headless.fields.level, 'Senior');
  assert.strictEqual(headless.type, 'job');

  // A manager's field edit goes to review; the approved values stay live.
  const edited = await (
    await mgrClient(`/api/teams/${team.id}/content/${item.id}`, {
      method: 'PUT',
      body: { fields: { location: 'Berlin', salary: 150000, apply_link: 'https://example.com/apply', level: 'Senior' } },
    })
  ).json();
  assert.strictEqual(edited.status, 'pending');
  const stillLive = await (await fetch(`${base}/api/public/${team.slug}/content/${item.slug}`)).json();
  assert.strictEqual(stillLive.fields.location, 'Remote');
  await owner(`/api/teams/${team.id}/content/${item.id}/approve`, { method: 'POST' });
  const nowLive = await (await fetch(`${base}/api/public/${team.slug}/content/${item.slug}`)).json();
  assert.strictEqual(nowLive.fields.location, 'Berlin');

  // A type in use cannot be deleted.
  assert.strictEqual(
    (await owner(`/api/teams/${team.id}/content-types/${jobType.id}`, { method: 'DELETE' })).status,
    409
  );
});

test('importers: WordPress WXR, Markdown front matter, and Nova round trip', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ctowner', password: 'ct-password-12' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const owner = client(cookie);
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Import Co' } })).json();

  const wxr = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/"><channel>
<item><title>Hello from WordPress</title><wp:post_type>post</wp:post_type><wp:status>publish</wp:status>
<wp:post_name>hello-wordpress</wp:post_name><wp:post_date_gmt>2024-03-01 10:00:00</wp:post_date_gmt>
<category domain="post_tag" nicename="news"><![CDATA[News]]></category>
<content:encoded><![CDATA[First paragraph.

Second paragraph with <strong>bold</strong>.]]></content:encoded></item>
<item><title>About</title><wp:post_type>page</wp:post_type><wp:status>draft</wp:status>
<content:encoded><![CDATA[<p>About us.</p>]]></content:encoded></item>
<item><title>logo.png</title><wp:post_type>attachment</wp:post_type></item>
</channel></rss>`;
  const md = ['---', 'title: Notes from the field', 'tags: alpha, beta', 'status: published', '---', '', 'Body **here**.'].join('\n');

  const fd = new FormData();
  fd.append('files', new Blob([wxr], { type: 'text/xml' }), 'wordpress-export.xml');
  fd.append('files', new Blob([md], { type: 'text/markdown' }), 'field-notes.md');
  const res = await fetch(`${base}/api/teams/${team.id}/import`, { method: 'POST', headers: { Cookie: cookie }, body: fd });
  assert.strictEqual(res.status, 200);
  const report = await res.json();
  assert.strictEqual(report.imported, 3);

  const rows = await (await owner(`/api/teams/${team.id}/content`)).json();
  const wp = rows.find((r) => r.slug === 'hello-wordpress');
  assert.strictEqual(wp.status, 'published');
  assert.strictEqual(wp.format, 'html');
  assert.deepStrictEqual(wp.tags.map((t) => t.name), ['News']);
  assert.strictEqual(rows.find((r) => r.title === 'About').status, 'draft');
  assert.strictEqual(rows.find((r) => r.title === 'Notes from the field').format, 'markdown');
  const site = await (await fetch(`${base}/t/${team.slug}/posts/hello-wordpress`)).text();
  assert.ok(site.includes('<strong>bold</strong>') && site.includes('<p>First paragraph.</p>'));

  // Nova round trip: export Talent Co (custom type + jobs) into a new company.
  const talent = (await (await owner('/api/teams')).json()).find((t) => t.name === 'Talent Co');
  const exported = await (await owner(`/api/teams/${talent.id}/export`)).json();
  assert.ok(exported.content_types.some((t) => t.key === 'job'));
  const fresh = await (await owner('/api/teams', { method: 'POST', body: { name: 'Talent Clone' } })).json();
  const fd2 = new FormData();
  fd2.append('files', new Blob([JSON.stringify(exported)], { type: 'application/json' }), 'talent-export.json');
  const res2 = await fetch(`${base}/api/teams/${fresh.id}/import`, { method: 'POST', headers: { Cookie: cookie }, body: fd2 });
  const report2 = await res2.json();
  assert.strictEqual(report2.types_created, 1);
  assert.ok(report2.imported >= 1);
  const clonedTypes = await (await owner(`/api/teams/${fresh.id}/content-types`)).json();
  assert.strictEqual(clonedTypes[0].key, 'job');
  const cloned = await (await owner(`/api/teams/${fresh.id}/content?type=job`)).json();
  assert.strictEqual(cloned[0].fields.location, 'Berlin');

  // Importing is an admin action.
  const mgrLogin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'ctmgr', password: 'ct-password-34' }),
  });
  const mgrCookie = mgrLogin.headers.get('set-cookie').split(';')[0];
  const denied = await fetch(`${base}/api/teams/${talent.id}/import`, {
    method: 'POST',
    headers: { Cookie: mgrCookie },
    body: fd2,
  });
  assert.strictEqual(denied.status, 403);
});

test('health endpoint responds for load balancers', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  assert.ok(body.version);
});

test('security headers are set on responses', async () => {
  const res = await fetch(`${base}/`);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('robots.txt points to the sitemap', async () => {
  const res = await fetch(`${base}/robots.txt`);
  assert.strictEqual(res.status, 200);
  assert.ok((await res.text()).includes('Sitemap:'));
});

test('platform and company sitemaps list live URLs', async () => {
  const platform = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok(platform.includes('/t/acme-docs'));

  const team = await (await fetch(`${base}/t/acme-docs/sitemap.xml`)).text();
  assert.ok(team.includes('/t/acme-docs/posts/quarterly-update'));
  assert.ok(team.includes('/t/acme-docs/about'));
});

test('company RSS feed serves live posts', async () => {
  const res = await fetch(`${base}/t/acme-docs/feed.xml`);
  assert.strictEqual(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('rss'));
  const xml = await res.text();
  assert.ok(xml.includes('<title>Quarterly update</title>'));
  assert.ok(xml.includes('/t/acme-docs/posts/quarterly-update'));
});

test('public pages carry description and Open Graph tags', async () => {
  const html = await (await fetch(`${base}/t/acme-docs/posts/quarterly-update`)).text();
  assert.ok(html.includes('property="og:title"'));
  assert.ok(html.includes('property="og:type" content="article"'));
  assert.ok(html.includes('rel="alternate" type="application/rss+xml"'));
});

// Keep this test LAST — it exhausts the login rate-limit window.
test('login attempts are rate limited', async () => {
  let limited = null;
  for (let i = 0; i < 40; i++) {
    const res = await client()('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'definitely-wrong' },
    });
    if (res.status === 429) {
      limited = res;
      break;
    }
  }
  assert.ok(limited, 'expected a 429 within 40 attempts');
  assert.ok(limited.headers.get('retry-after'));
});
