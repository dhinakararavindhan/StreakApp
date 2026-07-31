const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'test-password-123';
// The suite registers a lot of users; keep the registration limiter out of the way.
process.env.RATE_LIMIT_REGISTER = '200';

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
  assert.ok(Array.isArray(body.templates) && body.templates.length >= 40);
  const docs = body.templates.find((t) => t.key === 'docs');
  assert.ok(docs);
  assert.strictEqual(docs.theme, 'terminal');
  assert.ok(docs.pages > 0 && docs.posts > 0);
  assert.ok(body.templates.every((t) => t.category));
  const hotel = body.templates.find((t) => t.key === 'hotel');
  assert.strictEqual(hotel.category, 'Food & Hospitality');
  assert.ok(hotel.types >= 1 && hotel.items >= 2);
  for (const key of ['restaurant', 'barbershop', 'dental', 'vet', 'bookstore', 'church', 'daycare', 'podcast']) {
    assert.ok(body.templates.some((t) => t.key === key), `missing template ${key}`);
  }
  for (const key of ['brewery', 'travel', 'coworking', 'museum', 'yoga', 'foodtruck']) {
    const t = body.templates.find((x) => x.key === key);
    assert.ok(t && t.types >= 1 && t.items >= 2, `${key} should ship a custom type with items`);
  }
  assert.strictEqual(typeof body.ai_available, 'boolean');
});

test('every template in the catalog applies cleanly', async () => {
  const owner = await registerAs('kitchensink', 'sink-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Kitchen Sink Co' } })).json();
  const { templates } = await (await owner('/api/site-templates')).json();
  for (const t of templates) {
    const res = await owner(`/api/teams/${team.id}/apply-template`, { method: 'POST', body: { template: t.key } });
    assert.strictEqual(res.status, 200, `apply ${t.key}`);
    const result = await res.json();
    assert.ok(result.created > 0, `${t.key} created no content`);
  }
  // Every custom-type item kept its validated field values.
  const rows = await (await owner(`/api/teams/${team.id}/content`)).json();
  const typed = rows.filter((r) => !['post', 'page'].includes(r.type));
  assert.ok(typed.length >= 20);
  assert.ok(typed.every((r) => Object.keys(r.fields).length > 0), 'a typed item lost its fields');
  // And the site still renders.
  assert.strictEqual((await fetch(`${base}/t/${team.slug}`)).status, 200);
});

test('business templates install custom types with typed starter content', async () => {
  const owner = await registerAs('hotelowner', 'hotel-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Harbor House' } })).json();
  const res = await owner(`/api/teams/${team.id}/apply-template`, { method: 'POST', body: { template: 'hotel' } });
  assert.strictEqual(res.status, 200);
  const result = await res.json();
  assert.strictEqual(result.types, 1);
  assert.ok(result.created >= 6); // 3 rooms + 2 pages + 1 post

  const types = await (await owner(`/api/teams/${team.id}/content-types`)).json();
  const room = types.find((t) => t.key === 'room');
  assert.ok(room);
  assert.ok(room.schema.some((f) => f.key === 'price_per_night_usd' && f.kind === 'number'));

  // Rooms are live with validated field values, on the site and the API.
  const rooms = await (await fetch(`${base}/api/public/${team.slug}/content?type=room`)).json();
  assert.strictEqual(rooms.length, 3);
  const suite = rooms.find((r) => r.title === 'The Lighthouse Suite');
  assert.strictEqual(suite.fields.price_per_night_usd, 320);
  assert.strictEqual(suite.fields.view, 'Sea');
  const html = await (await fetch(`${base}/t/${team.slug}/${suite.slug}`)).text();
  assert.ok(html.includes('Price per night (USD)') && html.includes('320'));

  // The site nav links a "Rooms" archive listing every live room.
  const home = await (await fetch(`${base}/t/${team.slug}`)).text();
  assert.ok(home.includes(`/t/${team.slug}/c/room`) && home.includes('Rooms'));
  const archive = await (await fetch(`${base}/t/${team.slug}/c/room`)).text();
  assert.ok(archive.includes('The Garden Room') && archive.includes('The Attic Hideaway'));
  assert.ok(archive.includes('View') && archive.includes('Sea'));
  assert.strictEqual((await fetch(`${base}/t/${team.slug}/c/nope`)).status, 404);

  // Re-applying never duplicates the type (content gets -2 slugs instead).
  const again = await (await owner(`/api/teams/${team.id}/apply-template`, { method: 'POST', body: { template: 'hotel' } })).json();
  assert.strictEqual(again.types, 0);
  const typesAfter = await (await owner(`/api/teams/${team.id}/content-types`)).json();
  assert.strictEqual(typesAfter.length, 1);
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

test('site search works on hosted sites and the headless API, with CDN cache headers', async () => {
  const owner = await registerAs('searcher', 'search-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Search Co' } })).json();
  const mk = (body) => owner(`/api/teams/${team.id}/content`, { method: 'POST', body });
  await mk({ type: 'post', title: 'The espresso guide', body: 'Grind fine, tamp level.', status: 'published' });
  await mk({ type: 'page', title: 'About', body: 'We sell espresso machines.', status: 'published' });
  await mk({ type: 'post', title: 'Unrelated news', body: 'Nothing here.', status: 'published' });
  await mk({ type: 'post', title: 'Secret espresso draft', body: 'espresso', status: 'draft' });

  const pageRes = await fetch(`${base}/t/${team.slug}/search?q=espresso`);
  assert.strictEqual(pageRes.status, 200);
  assert.ok((pageRes.headers.get('cache-control') || '').includes('stale-while-revalidate'));
  const html = await pageRes.text();
  assert.ok(html.includes('The espresso guide') && html.includes('About'));
  assert.ok(!html.includes('Secret espresso draft')); // drafts never leak
  assert.ok(!html.includes('Unrelated news'));
  const empty = await (await fetch(`${base}/t/${team.slug}/search?q=zzzznothing`)).text();
  assert.ok(empty.includes('Nothing found'));
  // The nav links the search page.
  const home = await (await fetch(`${base}/t/${team.slug}`)).text();
  assert.ok(home.includes(`/t/${team.slug}/search`));

  const apiRes = await fetch(`${base}/api/public/${team.slug}/content?q=espresso`);
  assert.ok((apiRes.headers.get('cache-control') || '').includes('s-maxage'));
  const results = await apiRes.json();
  assert.strictEqual(results.length, 2);
  assert.ok(results.every((r) => `${r.title}`.includes('espresso') || r.title === 'About'));
});

test('trash: soft delete, restore, admin-only purge, and duplicate', async () => {
  const owner = await loginAs('searcher', 'search-password-1');
  const mgr = await registerAs('trashmgr', 'trash-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Trash Co' } })).json();
  await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'trashmgr', role: 'manager' } });
  const item = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Keep me safe', body: 'Precious content.', status: 'published', tags: ['Careful'] },
    })
  ).json();

  // Duplicate makes a fresh draft with tags and body.
  const copy = await (await owner(`/api/teams/${team.id}/content/${item.id}/duplicate`, { method: 'POST' })).json();
  assert.strictEqual(copy.status, 'draft');
  assert.strictEqual(copy.title, 'Copy of Keep me safe');
  assert.notStrictEqual(copy.slug, item.slug);
  assert.deepStrictEqual(copy.tags.map((t) => t.name), ['Careful']);

  // Delete = trash: off the site and the list, visible in /trash.
  const del = await (await owner(`/api/teams/${team.id}/content/${item.id}`, { method: 'DELETE' })).json();
  assert.strictEqual(del.trashed, true);
  assert.strictEqual((await fetch(`${base}/t/${team.slug}/posts/${item.slug}`)).status, 404);
  const list = await (await owner(`/api/teams/${team.id}/content`)).json();
  assert.ok(!list.some((r) => r.id === item.id));
  assert.strictEqual((await owner(`/api/teams/${team.id}/content/${item.id}`)).status, 404);
  const trash = await (await owner(`/api/teams/${team.id}/content/trash`)).json();
  assert.ok(trash.some((r) => r.id === item.id));

  // Restore brings it back live, exactly as it was.
  await owner(`/api/teams/${team.id}/content/${item.id}/untrash`, { method: 'POST' });
  assert.strictEqual((await fetch(`${base}/t/${team.slug}/posts/${item.slug}`)).status, 200);

  // Purge: managers may trash, only admins may delete forever.
  await mgr(`/api/teams/${team.id}/content/${item.id}`, { method: 'DELETE' });
  assert.strictEqual((await mgr(`/api/teams/${team.id}/content/${item.id}`, { method: 'DELETE' })).status, 403);
  const purge = await (await owner(`/api/teams/${team.id}/content/${item.id}`, { method: 'DELETE' })).json();
  assert.strictEqual(purge.purged, true);
  assert.strictEqual((await (await owner(`/api/teams/${team.id}/content/trash`)).json()).length, 0);

  // Trashed items don't count in dashboard stats.
  const stats = await (await owner(`/api/teams/${team.id}/stats`)).json();
  assert.strictEqual(stats.trash, 0);
  assert.strictEqual(stats.posts, 1); // just the duplicate draft
});

test('time machine: signed-in users can preview the site at a future moment', async () => {
  const owner = await registerAs('timelord', 'time-password-12');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Chrono Co' } })).json();
  const mk = (body) => owner(`/api/teams/${team.id}/content`, { method: 'POST', body });
  await mk({ type: 'post', title: 'Live today', body: 'Here now.', status: 'published' });
  await mk({ type: 'post', title: 'Launch announcement', body: 'Coming soon.', status: 'published', publish_at: '2031-06-01 09:00' });
  await mk({ type: 'post', title: 'Limited offer', body: 'Ends eventually.', status: 'published', expire_at: '2032-01-01 00:00' });

  // Today: the scheduled post is hidden, the offer is up.
  const today = await (await fetch(`${base}/t/${team.slug}`)).text();
  assert.ok(!today.includes('Launch announcement') && today.includes('Limited offer'));

  // Time machine to 2031: the launch is visible, with the preview banner, uncached.
  const preview = await owner(`/t/${team.slug}?preview_at=2031-06-02T10:00`);
  assert.ok((preview.headers.get('cache-control') || '').includes('no-store'));
  const previewHtml = await preview.text();
  assert.ok(previewHtml.includes('Launch announcement'));
  assert.ok(previewHtml.includes('Time machine'));

  // Time machine to 2033: the offer has expired.
  const later = await (await owner(`/t/${team.slug}?preview_at=2033-01-01T00:00`)).text();
  assert.ok(later.includes('Launch announcement') && !later.includes('Limited offer'));

  // Anonymous visitors cannot time travel — the param is ignored.
  const anon = await (await fetch(`${base}/t/${team.slug}?preview_at=2031-06-02T10:00`)).text();
  assert.ok(!anon.includes('Launch announcement') && !anon.includes('Time machine'));
});

test('AI pre-review lands on pending submissions and clears on decision', async () => {
  const savedMock = process.env.NOVA_AI_MOCK;
  process.env.NOVA_AI_MOCK = '1';
  try {
    const owner = await loginAs('timelord', 'time-password-12');
    const mgr = await registerAs('reviewmgr', 'review-password-1');
    const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Review Co' } })).json();
    await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'reviewmgr', role: 'manager' } });

    const item = await (
      await mgr(`/api/teams/${team.id}/content`, {
        method: 'POST',
        body: { type: 'post', title: 'Draft with issues', body: 'TODO finish this section later.', status: 'pending' },
      })
    ).json();

    // The review is fire-and-forget — poll briefly for it to attach.
    let review = null;
    for (let i = 0; i < 20 && !review; i++) {
      await new Promise((r) => setTimeout(r, 25));
      review = (await (await owner(`/api/teams/${team.id}/content/${item.id}`)).json()).ai_review;
    }
    assert.ok(review, 'ai_review never attached');
    assert.strictEqual(review.verdict, 'needs_attention');
    assert.ok(review.notes.some((n) => n.includes('placeholder')));
    assert.ok(review.summary.includes('Draft with issues'));

    // The pending list (approvals queue) carries it too.
    const queue = await (await owner(`/api/teams/${team.id}/content?status=pending`)).json();
    assert.ok(queue.find((r) => r.id === item.id).ai_review);

    // Approving clears the review.
    await owner(`/api/teams/${team.id}/content/${item.id}/approve`, { method: 'POST' });
    const after = await (await owner(`/api/teams/${team.id}/content/${item.id}`)).json();
    assert.strictEqual(after.ai_review, null);
  } finally {
    if (savedMock === undefined) delete process.env.NOVA_AI_MOCK;
    else process.env.NOVA_AI_MOCK = savedMock;
  }
});

test('AI translation creates linked drafts in the translation group', async () => {
  const owner = await loginAs('timelord', 'time-password-12');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Polyglot Co' } })).json();
  const item = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Our story', body: 'It began in a garage.', excerpt: 'How we started.', status: 'published' },
    })
  ).json();

  // Unconfigured: clear 503.
  const savedMock = process.env.NOVA_AI_MOCK;
  const savedKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.NOVA_AI_MOCK;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.strictEqual(
      (await owner(`/api/teams/${team.id}/content/${item.id}/ai-translate`, { method: 'POST', body: { locale: 'es' } })).status,
      503
    );

    process.env.NOVA_AI_MOCK = '1';
    assert.strictEqual(
      (await owner(`/api/teams/${team.id}/content/${item.id}/ai-translate`, { method: 'POST', body: { locale: 'en' } })).status,
      400
    );
    const res = await owner(`/api/teams/${team.id}/content/${item.id}/ai-translate`, { method: 'POST', body: { locale: 'es' } });
    assert.strictEqual(res.status, 201);
    const draft = await res.json();
    assert.strictEqual(draft.status, 'draft');
    assert.strictEqual(draft.locale, 'es');
    assert.strictEqual(draft.translation_of, item.id);
    assert.ok(draft.title.startsWith('[es]'));

    // Linked into the group: the source now lists the Spanish sibling.
    const source = await (await owner(`/api/teams/${team.id}/content/${item.id}`)).json();
    assert.ok(source.translations.some((t) => t.locale === 'es'));

    // One translation per locale, still enforced.
    assert.strictEqual(
      (await owner(`/api/teams/${team.id}/content/${item.id}/ai-translate`, { method: 'POST', body: { locale: 'es' } })).status,
      409
    );
  } finally {
    if (savedMock === undefined) delete process.env.NOVA_AI_MOCK;
    else process.env.NOVA_AI_MOCK = savedMock;
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
  }
});

test('draft preview: members check unpublished changes on the real site', async () => {
  const owner = await registerAs('previewer', 'preview-password-1');
  const outsider = await registerAs('outsider9', 'outside-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Preview Co' } })).json();

  // A never-published draft: invisible publicly, previewable by a member.
  const draft = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Unfinished thoughts', body: 'Still cooking.', status: 'draft' },
    })
  ).json();
  const url = `/t/${team.slug}/posts/${draft.slug}`;
  assert.strictEqual((await fetch(`${base}${url}`)).status, 404);
  assert.strictEqual((await fetch(`${base}${url}?preview=draft`)).status, 404); // anonymous: no leak
  assert.strictEqual((await outsider(`${url}?preview=draft`)).status, 404); // non-member: no leak
  const preview = await owner(`${url}?preview=draft`);
  assert.strictEqual(preview.status, 200);
  assert.ok((preview.headers.get('cache-control') || '').includes('no-store'));
  const html = await preview.text();
  assert.ok(html.includes('Still cooking.') && html.includes('Draft preview'));

  // Pending edits to live content: the public sees the old version, the
  // author's preview shows the new one.
  await owner(`/api/teams/${team.id}/content/${draft.id}`, { method: 'PUT', body: { status: 'published' } });
  await owner(`/api/teams/${team.id}/content/${draft.id}`, {
    method: 'PUT',
    body: { body: 'Fully baked now.', status: 'pending' },
  });
  const publicView = await (await fetch(`${base}${url}`)).text();
  assert.ok(publicView.includes('Still cooking.') && !publicView.includes('Fully baked now.'));
  const memberView = await (await owner(`${url}?preview=draft`)).text();
  assert.ok(memberView.includes('Fully baked now.') && memberView.includes('Draft preview'));

  // Pages work the same way.
  const page = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'page', title: 'Hidden page', body: 'Not yet public.', status: 'draft' },
    })
  ).json();
  assert.strictEqual((await fetch(`${base}/t/${team.slug}/${page.slug}`)).status, 404);
  const pagePreview = await (await owner(`/t/${team.slug}/${page.slug}?preview=draft`)).text();
  assert.ok(pagePreview.includes('Not yet public.'));
});

test('metrics, backup, TLS check, and error webhook (production ops)', async () => {
  // Prometheus metrics: superadmin session or METRICS_TOKEN bearer.
  assert.strictEqual((await fetch(`${base}/api/metrics`)).status, 401);
  const metricsRes = await admin('/api/metrics');
  assert.strictEqual(metricsRes.status, 200);
  const body = await metricsRes.text();
  assert.ok(body.includes('nova_requests_total{route="api"') && body.includes('nova_uptime_seconds'));
  process.env.METRICS_TOKEN = 'scrape-me-123';
  try {
    const viaToken = await fetch(`${base}/api/metrics`, { headers: { Authorization: 'Bearer scrape-me-123' } });
    assert.strictEqual(viaToken.status, 200);
  } finally {
    delete process.env.METRICS_TOKEN;
  }

  // Platform backup: a real SQLite snapshot, superadmin-only.
  assert.strictEqual((await alice('/api/platform/backup')).status, 403);
  const backup = await admin('/api/platform/backup');
  assert.strictEqual(backup.status, 200);
  const bytes = Buffer.from(await backup.arrayBuffer());
  assert.ok(bytes.subarray(0, 15).toString() === 'SQLite format 3');
  assert.ok(bytes.length > 4096);

  // Caddy on-demand TLS gate: only domains we actually serve get certs.
  const team = await (await alice('/api/teams', { method: 'POST', body: { name: 'TLS Co' } })).json();
  await alice(`/api/teams/${team.id}`, { method: 'PUT', body: { custom_domain: 'www.tls-co.example' } });
  assert.strictEqual((await fetch(`${base}/api/tls-check?domain=www.tls-co.example`)).status, 200);
  assert.strictEqual((await fetch(`${base}/api/tls-check?domain=evil.example`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/tls-check`)).status, 400);

  // Error webhook: reports fire to NOVA_ERROR_WEBHOOK.
  const { reportError } = require('../src/observability');
  const received = [];
  const receiver = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push(JSON.parse(raw));
      res.end('ok');
    });
  });
  await new Promise((resolve) => receiver.listen(0, resolve));
  process.env.NOVA_ERROR_WEBHOOK = `http://127.0.0.1:${receiver.address().port}/errors`;
  try {
    reportError(new Error('synthetic failure'), { method: 'GET', originalUrl: '/boom' });
    for (let i = 0; i < 40 && !received.length; i++) await new Promise((r) => setTimeout(r, 25));
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].message, 'synthetic failure');
    assert.strictEqual(received[0].path, '/boom');
    assert.strictEqual(received[0].source, 'nova-cms');
  } finally {
    delete process.env.NOVA_ERROR_WEBHOOK;
    receiver.close();
  }
});

test('blocks format renders and contact forms deliver to the inbox', async () => {
  const owner = await registerAs('blockowner', 'block-password-1');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Blocks Co' } })).json();
  const blocks = [
    { t: 'h', level: 2, md: 'Say **hello**' },
    { t: 'p', md: 'We would love to hear from you.' },
    { t: 'list', ordered: false, items: ['Fast replies', 'Real humans'] },
    { t: 'button', label: 'Book a call', href: '/book' },
    { t: 'hr' },
    { t: 'form' },
  ];
  const item = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'page', title: 'Contact', body: JSON.stringify(blocks), format: 'blocks', status: 'published' },
    })
  ).json();

  const html = await (await fetch(`${base}/t/${team.slug}/${item.slug}`)).text();
  assert.ok(html.includes('<h2>Say <strong>hello</strong></h2>'));
  assert.ok(html.includes('<li>Fast replies</li>'));
  assert.ok(html.includes('class="btn-block"') && html.includes('Book a call'));
  assert.ok(html.includes('class="contact-form"') && html.includes(`/api/public/${team.slug}/forms`));

  // Browser-style form post → stored, thank-you page returned.
  const submit = await fetch(`${base}/api/public/${team.slug}/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=Ada&email=ada%40example.com&message=Do+you+ship+worldwide%3F&website=',
  });
  assert.strictEqual(submit.status, 201);
  assert.ok((await submit.text()).includes('Thank you'));

  // Honeypot and validation.
  const bot = await fetch(`${base}/api/public/${team.slug}/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'name=Bot&email=bot%40spam.com&message=buy+now&website=http%3A%2F%2Fspam',
  });
  assert.strictEqual(bot.status, 200); // pretend success, store nothing
  assert.strictEqual(
    (await fetch(`${base}/api/public/${team.slug}/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: 'X', email: 'not-an-email', message: 'hi' }),
    })).status,
    400
  );

  // The inbox: admin-only, one real message, deletable, counted in stats.
  const mgr = await registerAs('blockmgr', 'block-password-2');
  await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'blockmgr', role: 'manager' } });
  assert.strictEqual((await mgr(`/api/teams/${team.id}/forms`)).status, 403);
  const inbox = await (await owner(`/api/teams/${team.id}/forms`)).json();
  assert.strictEqual(inbox.length, 1);
  assert.strictEqual(inbox[0].name, 'Ada');
  assert.strictEqual(inbox[0].message, 'Do you ship worldwide?');
  assert.strictEqual((await (await owner(`/api/teams/${team.id}/stats`)).json()).inbox, 1);
  await owner(`/api/teams/${team.id}/forms/${inbox[0].id}`, { method: 'DELETE' });
  assert.strictEqual((await (await owner(`/api/teams/${team.id}/forms`)).json()).length, 0);
});

test('image uploads generate webp variants', async () => {
  const sharp = require('sharp');
  const png = await sharp({
    create: { width: 1600, height: 900, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();

  const owner = await loginAs('blockowner', 'block-password-1');
  const team = (await (await owner('/api/teams')).json()).find((t) => t.name === 'Blocks Co');
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'blockowner', password: 'block-password-1' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'hero.png');
  const uploaded = await fetch(`${base}/api/teams/${team.id}/media`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: fd,
  });
  assert.strictEqual(uploaded.status, 201);
  const media = await uploaded.json();
  assert.ok(media.variants.md && media.variants.md.endsWith('@md.webp'));
  assert.ok(media.variants.sm && media.variants.sm.endsWith('@sm.webp'));

  // The variants are real, servable webp files — and smaller than the original.
  const md = await fetch(`${base}${media.variants.md}`);
  assert.strictEqual(md.status, 200);
  const mdBytes = Buffer.from(await md.arrayBuffer());
  assert.strictEqual(mdBytes.subarray(0, 4).toString(), 'RIFF');
  assert.ok(mdBytes.length < png.length);
  const listed = await (await owner(`/api/teams/${team.id}/media`)).json();
  assert.ok(listed.find((m) => m.id === media.id).variants.sm);
});

test('custom nav menu overrides the automatic navigation', async () => {
  const owner = await loginAs('blockowner', 'block-password-1');
  const team = (await (await owner('/api/teams')).json()).find((t) => t.name === 'Blocks Co');
  await owner(`/api/teams/${team.id}/content`, {
    method: 'POST',
    body: { type: 'page', title: 'Zebra Page', body: 'Auto-nav bait.', status: 'published' },
  });
  await owner(`/api/teams/${team.id}/settings`, {
    method: 'PUT',
    body: { nav_links: 'Menu | /menu\nBook a table | https://book.example.com' },
  });
  const custom = await (await fetch(`${base}/t/${team.slug}`)).text();
  assert.ok(custom.includes(`href="/t/${team.slug}/menu"`) && custom.includes('Book a table'));
  assert.ok(custom.includes('https://book.example.com'));
  assert.ok(!custom.includes('Zebra Page')); // custom menu replaces auto pages

  await owner(`/api/teams/${team.id}/settings`, { method: 'PUT', body: { nav_links: '' } });
  const auto = await (await fetch(`${base}/t/${team.slug}`)).text();
  assert.ok(auto.includes('Zebra Page')); // automatic nav returns
});

test('editorial calendar ICS feed and the content radar', async () => {
  const owner = await registerAs('calowner', 'cal-password-12');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Calendar Co' } })).json();
  await owner(`/api/teams/${team.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Launch day', body: 'Soon.', status: 'published', publish_at: '2031-03-01 09:00' },
  });
  await owner(`/api/teams/${team.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Old faithful', body: 'Live.', status: 'published' },
  });

  // Member session gets the feed; anonymous does not.
  assert.strictEqual((await fetch(`${base}/api/teams/${team.id}/calendar.ics`)).status, 401);
  const ics = await owner(`/api/teams/${team.id}/calendar.ics`);
  assert.strictEqual(ics.status, 200);
  assert.ok((ics.headers.get('content-type') || '').includes('text/calendar'));
  const text = await ics.text();
  assert.ok(text.includes('BEGIN:VCALENDAR') && text.includes('🚀 Goes live: Launch day'));
  assert.ok(text.includes('DTSTART:20310301T090000Z'));
  assert.ok(text.includes('✅ Published: Old faithful'));

  // A read API key works for calendar apps; another company's key does not.
  const key = await (await owner(`/api/teams/${team.id}/api-keys`, { method: 'POST', body: { name: 'cal', scope: 'read' } })).json();
  assert.strictEqual((await fetch(`${base}/api/teams/${team.id}/calendar.ics?key=${key.token}`)).status, 200);
  const other = await (await owner('/api/teams', { method: 'POST', body: { name: 'Other Cal Co' } })).json();
  assert.strictEqual((await fetch(`${base}/api/teams/${other.id}/calendar.ics?key=${key.token}`)).status, 401);

  // Radar: age an item directly, then see it flagged in stats.
  const { getDb } = require('../src/db');
  getDb()
    .prepare("UPDATE content SET updated_at = datetime('now', '-200 days') WHERE team_id = ? AND title = 'Old faithful'")
    .run(team.id);
  await owner(`/api/teams/${team.id}/content`, {
    method: 'POST',
    body: { type: 'post', title: 'Fading offer', body: 'Hurry.', status: 'published', expire_at: '2031-01-01 00:00' },
  });
  getDb()
    .prepare("UPDATE content SET expire_at = datetime('now', '+3 days') WHERE team_id = ? AND title = 'Fading offer'")
    .run(team.id);
  const stats = await (await owner(`/api/teams/${team.id}/stats`)).json();
  assert.ok(stats.radar.stale.some((r) => r.title === 'Old faithful'));
  assert.ok(stats.radar.expiring.some((r) => r.title === 'Fading offer'));
  assert.strictEqual(stats.radar.idle_drafts.length, 0);
});

test('notifications: submissions, decisions, and comments reach the right people', async () => {
  const boss = await registerAs('notifboss', 'notif-password-1');
  const writer = await registerAs('notifwriter', 'notif-password-2');
  const team = await (await boss('/api/teams', { method: 'POST', body: { name: 'Notify Co' } })).json();
  await boss(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'notifwriter', role: 'manager' } });

  // Writer submits → the admin is notified (not the writer).
  const item = await (
    await writer(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Big scoop', body: 'Exclusive.', status: 'pending' },
    })
  ).json();
  let bossFeed = await (await boss('/api/auth/notifications')).json();
  assert.strictEqual(bossFeed.unread, 1);
  assert.ok(bossFeed.notifications[0].text.includes('notifwriter submitted “Big scoop”'));
  assert.strictEqual((await (await writer('/api/auth/notifications')).json()).unread, 0);

  // Admin rejects with a note → the writer hears about it, note included.
  await boss(`/api/teams/${team.id}/content/${item.id}/reject`, { method: 'POST', body: { note: 'Needs a source' } });
  const writerFeed = await (await writer('/api/auth/notifications')).json();
  assert.strictEqual(writerFeed.unread, 1);
  assert.ok(writerFeed.notifications[0].text.includes('sent back to draft'));
  assert.ok(writerFeed.notifications[0].text.includes('Needs a source'));

  // Resubmit + approve → writer notified again; comment → author notified.
  await writer(`/api/teams/${team.id}/content/${item.id}`, { method: 'PUT', body: { status: 'pending' } });
  await boss(`/api/teams/${team.id}/content/${item.id}/approve`, { method: 'POST' });
  await boss(`/api/teams/${team.id}/content/${item.id}/comments`, { method: 'POST', body: { body: 'Great work' } });
  const finalFeed = await (await writer('/api/auth/notifications')).json();
  assert.ok(finalFeed.notifications.some((n) => n.text.includes('approved and is now live')));
  assert.ok(finalFeed.notifications.some((n) => n.kind === 'comment' && n.text.includes('commented on')));

  // Mark-all-read clears the badge.
  await writer('/api/auth/notifications/read', { method: 'POST' });
  assert.strictEqual((await (await writer('/api/auth/notifications')).json()).unread, 0);
  assert.strictEqual((await fetch(`${base}/api/auth/notifications`)).status, 401);
});

test('shareable preview links work for outsiders, expire, and resist tampering', async () => {
  const owner = await loginAs('notifboss', 'notif-password-1');
  const team = (await (await owner('/api/teams')).json()).find((t) => t.name === 'Notify Co');
  const draft = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Embargoed launch', body: 'Top secret until Friday.', status: 'draft' },
    })
  ).json();

  const link = await (await owner(`/api/teams/${team.id}/content/${draft.id}/share-link`, { method: 'POST', body: { days: 7 } })).json();
  assert.ok(link.url.startsWith('/share/'));

  // A total outsider (no cookies at all) can open it.
  const shared = await fetch(`${base}${link.url}`);
  assert.strictEqual(shared.status, 200);
  assert.ok((shared.headers.get('cache-control') || '').includes('no-store'));
  assert.strictEqual(shared.headers.get('x-robots-tag'), 'noindex');
  const html = await shared.text();
  assert.ok(html.includes('Top secret until Friday.') && html.includes('Shared preview'));

  // Tampered and expired tokens fail; the plain URL stays 404 for outsiders.
  const tampered = link.url.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  assert.strictEqual((await fetch(`${base}${tampered}`)).status, 404);
  const { signShareToken, verifyShareToken } = require('../src/auth');
  const expired = signShareToken(draft.id, 1).split('.');
  expired[1] = String(Date.now() - 1000);
  assert.strictEqual(verifyShareToken(expired.join('.')), null);
  assert.strictEqual((await fetch(`${base}/t/${team.slug}/posts/${draft.slug}`)).status, 404);
});

test('reference fields link content items, validated and draft-safe', async () => {
  const owner = await registerAs('refowner', 'ref-password-123');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Relations Co' } })).json();

  // Agents, and Properties that reference an Agent.
  await owner(`/api/teams/${team.id}/content-types`, {
    method: 'POST',
    body: { name: 'Agent', name_plural: 'Agents', schema: [{ label: 'Phone', kind: 'text' }] },
  });
  const created = await (
    await owner(`/api/teams/${team.id}/content-types`, {
      method: 'POST',
      body: {
        name: 'Property',
        name_plural: 'Properties',
        schema: [
          { label: 'Price (USD)', kind: 'number' },
          { label: 'Listing agent', kind: 'reference', ref_type: 'agent' },
        ],
      },
    })
  ).json();
  assert.deepStrictEqual(created.schema[1], { key: 'listing_agent', label: 'Listing agent', kind: 'reference', ref_type: 'agent' });

  const agent = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'agent', title: 'Rosa Marchetti', body: 'Twenty years on this high street.', status: 'published', fields: { phone: '555-0100' } },
    })
  ).json();
  const post = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Not an agent', body: 'x', status: 'published' },
    })
  ).json();

  // Wrong-type and cross-company references are rejected.
  const wrongType = await owner(`/api/teams/${team.id}/content`, {
    method: 'POST',
    body: { type: 'property', title: 'Bad ref', fields: { listing_agent: post.id } },
  });
  assert.strictEqual(wrongType.status, 400);
  assert.ok((await wrongType.json()).error.includes('"agent"'));

  const property = await (
    await owner(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: {
        type: 'property',
        title: 'The Glasshouse',
        body: 'Light everywhere.',
        status: 'published',
        fields: { price_usd: 425000, listing_agent: agent.id },
      },
    })
  ).json();
  assert.strictEqual(property.fields.listing_agent, agent.id);

  // Admin single GET expands the reference; public article links it.
  const single = await (await owner(`/api/teams/${team.id}/content/${property.id}`)).json();
  assert.strictEqual(single.references.listing_agent.title, 'Rosa Marchetti');
  const html = await (await fetch(`${base}/t/${team.slug}/${property.slug}`)).text();
  assert.ok(html.includes('Rosa Marchetti') && html.includes(`/t/${team.slug}/${agent.slug}`));
  const headless = await (await fetch(`${base}/api/public/${team.slug}/content/${property.slug}`)).json();
  assert.strictEqual(headless.references.listing_agent.slug, agent.slug);

  // Unpublish the agent → the public reference disappears everywhere.
  await owner(`/api/teams/${team.id}/content/${agent.id}`, { method: 'PUT', body: { status: 'draft' } });
  const hidden = await (await fetch(`${base}/t/${team.slug}/${property.slug}`)).text();
  assert.ok(!hidden.includes('Rosa Marchetti'));
  const headless2 = await (await fetch(`${base}/api/public/${team.slug}/content/${property.slug}`)).json();
  assert.strictEqual(headless2.references, undefined);
});

test('two-factor authentication: setup, login challenge, disable', async () => {
  const { currentCode } = require('../src/totp');
  await registerAs('twofa-user', 'twofa-password-1');
  const client2 = await loginAs('twofa-user', 'twofa-password-1');

  // Setup + verify with a real code turns 2FA on.
  const setup = await (await client2('/api/auth/2fa/setup', { method: 'POST' })).json();
  assert.ok(setup.secret && setup.otpauth.startsWith('otpauth://totp/'));
  assert.strictEqual(
    (await client2('/api/auth/2fa/verify', { method: 'POST', body: { code: '000000' } })).status,
    400
  );
  assert.strictEqual(
    (await client2('/api/auth/2fa/verify', { method: 'POST', body: { code: currentCode(setup.secret) } })).status,
    200
  );
  assert.strictEqual((await (await client2('/api/auth/me')).json()).totp_enabled, true);

  // Password alone no longer signs in; password + current code does.
  const half = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'twofa-user', password: 'twofa-password-1' }),
  });
  assert.strictEqual(half.status, 200);
  assert.strictEqual((await half.json()).twofa_required, true);
  assert.strictEqual(half.headers.get('set-cookie'), null); // no session yet
  const badCode = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'twofa-user', password: 'twofa-password-1', code: '123456' }),
  });
  assert.strictEqual(badCode.status, 401);
  const full = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'twofa-user', password: 'twofa-password-1', code: currentCode(setup.secret) }),
  });
  assert.strictEqual(full.status, 200);
  assert.ok(full.headers.get('set-cookie'));

  // Disabling needs a current code too.
  assert.strictEqual(
    (await client2('/api/auth/2fa/disable', { method: 'POST', body: { code: '999999' } })).status,
    400
  );
  await client2('/api/auth/2fa/disable', { method: 'POST', body: { code: currentCode(setup.secret) } });
  assert.strictEqual((await (await client2('/api/auth/me')).json()).totp_enabled, false);
});

test('OpenAPI spec, docs page, and the official JS SDK end to end', async () => {
  // The spec and reference are served and coherent.
  const spec = await (await fetch(`${base}/api/openapi.json`)).json();
  assert.strictEqual(spec.openapi, '3.1.0');
  assert.ok(spec.paths['/api/teams/{teamId}/content']);
  assert.ok(spec.paths['/api/public/{company}/content']);
  assert.ok(spec.components.schemas.Content.properties.status.enum.includes('pending'));
  const docs = await (await fetch(`${base}/api/docs`)).text();
  assert.ok(docs.includes('Nova CMS API') && docs.includes('/api/teams/{teamId}/content'));
  const sdkSource = await (await fetch(`${base}/sdk/nova-sdk.js`)).text();
  assert.ok(sdkSource.includes('class NovaClient'));

  // Dogfood the SDK against this very server, authenticated by API keys.
  const { NovaClient, NovaError } = require('../sdk/nova-sdk');
  const owner = await registerAs('sdkowner', 'sdk-password-123');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'SDK Co' } })).json();
  const writeKey = await (await owner(`/api/teams/${team.id}/api-keys`, { method: 'POST', body: { name: 'sdk-w', scope: 'write' } })).json();
  const readKey = await (await owner(`/api/teams/${team.id}/api-keys`, { method: 'POST', body: { name: 'sdk-r', scope: 'read' } })).json();

  const writer = new NovaClient({ baseUrl: base, apiKey: writeKey.token });
  const created = await writer.team(team.id).content.create({
    title: 'Shipped via SDK',
    body: 'Hello from the client library.',
    status: 'pending',
    tags: ['SDK'],
  });
  assert.strictEqual(created.status, 'pending'); // write keys go through approval

  // Write keys cannot publish; the SDK surfaces the API's error faithfully.
  await assert.rejects(
    () => writer.team(team.id).content.approve(created.id),
    (err) => err instanceof NovaError && err.status === 403
  );

  const reader = new NovaClient({ baseUrl: base, apiKey: readKey.token });
  const drafts = await reader.team(team.id).content.list({ status: 'pending' });
  assert.ok(drafts.some((r) => r.id === created.id));

  // Approve via session, then read it from the public site API — no key at all.
  await owner(`/api/teams/${team.id}/content/${created.id}/approve`, { method: 'POST' });
  const anon = new NovaClient({ baseUrl: base });
  const posts = await anon.site(team.slug).posts();
  assert.strictEqual(posts.length, 1);
  const article = await anon.site(team.slug).get(created.slug);
  assert.ok(article.body_html.includes('Hello from the client library.'));
  const found = await anon.site(team.slug).search('client library');
  assert.strictEqual(found.length, 1);
  assert.ok((await anon.health()).ok);
});

test('plans & entitlements: limits enforce, upgrades unlock, self-hosted stays unlimited', async () => {
  const owner = await registerAs('planowner', 'plan-password-12');
  const team = await (await owner('/api/teams', { method: 'POST', body: { name: 'Plan Co' } })).json();

  // Self-hosted default: pro / unlimited — the OSS experience has no walls.
  const proPlan = await (await owner(`/api/teams/${team.id}/plan`)).json();
  assert.strictEqual(proPlan.plan, 'pro');
  assert.strictEqual(proPlan.limits.content, -1);

  // Platform operator downgrades the company to free (the Stripe hook point).
  assert.strictEqual(
    (await owner(`/api/platform/teams/${team.id}/plan`, { method: 'PUT', body: { plan: 'free' } })).status,
    403
  ); // company admins cannot set their own plan
  await admin(`/api/platform/teams/${team.id}/plan`, { method: 'PUT', body: { plan: 'free' } });
  const freePlan = await (await owner(`/api/teams/${team.id}/plan`)).json();
  assert.strictEqual(freePlan.plan, 'free');
  assert.strictEqual(freePlan.limits.content, 25);

  // Gated features answer 402 with an upgrade message.
  const domain = await owner(`/api/teams/${team.id}`, { method: 'PUT', body: { custom_domain: 'www.planco.example' } });
  assert.strictEqual(domain.status, 402);
  process.env.NOVA_AI_MOCK = '1';
  try {
    const ai = await owner(`/api/teams/${team.id}/ai-build`, { method: 'POST', body: { prompt: 'A tiny bakery somewhere' } });
    assert.strictEqual(ai.status, 402);
    assert.ok((await ai.json()).error.includes('upgrade'));
  } finally {
    delete process.env.NOVA_AI_MOCK;
  }

  // The content cap bites at 25 — and duplicate counts too.
  for (let i = 1; i <= 25; i++) {
    const r = await owner(`/api/teams/${team.id}/content`, { method: 'POST', body: { title: `Item ${i}` } });
    assert.strictEqual(r.status, 201, `item ${i}`);
  }
  const over = await owner(`/api/teams/${team.id}/content`, { method: 'POST', body: { title: 'Item 26' } });
  assert.strictEqual(over.status, 402);
  assert.ok((await over.json()).error.includes('25'));
  const list = await (await owner(`/api/teams/${team.id}/content`)).json();
  assert.strictEqual(
    (await owner(`/api/teams/${team.id}/content/${list[0].id}/duplicate`, { method: 'POST' })).status,
    402
  );

  // Member cap: free allows 3 total.
  await registerAs('planm1', 'plan-password-m1');
  await registerAs('planm2', 'plan-password-m2');
  await registerAs('planm3', 'plan-password-m3');
  await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'planm1' } });
  await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'planm2' } });
  assert.strictEqual(
    (await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'planm3' } })).status,
    402
  );

  // Upgrading lifts every wall.
  await admin(`/api/platform/teams/${team.id}/plan`, { method: 'PUT', body: { plan: 'pro' } });
  assert.strictEqual((await owner(`/api/teams/${team.id}/content`, { method: 'POST', body: { title: 'Item 26' } })).status, 201);
  assert.strictEqual(
    (await owner(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'planm3' } })).status,
    201
  );
  const usage = await (await owner(`/api/teams/${team.id}/plan`)).json();
  assert.strictEqual(usage.usage.content, 26);
  assert.strictEqual(usage.usage.members, 4);
});

test('the in-app tutorial is served for the Help page', async () => {
  const res = await fetch(`${base}/api/help.md`);
  assert.strictEqual(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').includes('markdown'));
  const text = await res.text();
  assert.ok(text.includes('# Nova CMS — The Complete Walkthrough'));
  assert.ok(text.includes('Chapter 6') && text.includes('approval workflow'));
});

test('password reset: forgot → emailed link → reset, tokens single-use', async () => {
  // A local HTTP receiver stands in for the email service (NOVA_EMAIL_WEBHOOK).
  const emails = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      emails.push(JSON.parse(body));
      res.end('ok');
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  const savedHook = process.env.NOVA_EMAIL_WEBHOOK;
  process.env.NOVA_EMAIL_WEBHOOK = `http://127.0.0.1:${receiver.address().port}/send`;
  try {
    // Registration accepts an optional recovery email (case-normalized)…
    let res = await client()('/api/auth/register', {
      method: 'POST',
      body: { username: 'resetme', password: 'first-password-1', email: 'ResetMe@Example.com' },
    });
    assert.strictEqual(res.status, 201);
    // …and no second account can claim it.
    res = await client()('/api/auth/register', {
      method: 'POST',
      body: { username: 'resetme2', password: 'other-password-1', email: 'resetme@example.com' },
    });
    assert.strictEqual(res.status, 409);

    // Unknown email → identical generic answer, no account enumeration.
    res = await client()('/api/auth/forgot', { method: 'POST', body: { email: 'nobody@example.com' } });
    assert.strictEqual(res.status, 200);
    assert.ok((await res.json()).message.includes('If that email'));

    res = await client()('/api/auth/forgot', { method: 'POST', body: { email: 'resetme@example.com' } });
    assert.strictEqual(res.status, 200);
    for (let i = 0; i < 40 && emails.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(emails.length, 1);
    assert.strictEqual(emails[0].to, 'resetme@example.com');
    const token = emails[0].text.match(/#\/reset\/([A-Za-z0-9._-]+)/)[1];

    // Weak passwords rejected; a real one completes the reset.
    res = await client()('/api/auth/reset', { method: 'POST', body: { token, password: 'short' } });
    assert.strictEqual(res.status, 400);
    res = await client()('/api/auth/reset', { method: 'POST', body: { token, password: 'brand-new-pass-9' } });
    assert.strictEqual(res.status, 200);

    // Old password dead, new one live, token spent.
    res = await client()('/api/auth/login', {
      method: 'POST',
      body: { username: 'resetme', password: 'first-password-1' },
    });
    assert.strictEqual(res.status, 401);
    await loginAs('resetme', 'brand-new-pass-9');
    res = await client()('/api/auth/reset', { method: 'POST', body: { token, password: 'try-again-pass-9' } });
    assert.strictEqual(res.status, 400);

    // Garbage tokens never pass.
    res = await client()('/api/auth/reset', { method: 'POST', body: { token: '1.99999999999999.forged', password: 'long-enough-pw-1' } });
    assert.strictEqual(res.status, 400);
  } finally {
    if (savedHook === undefined) delete process.env.NOVA_EMAIL_WEBHOOK;
    else process.env.NOVA_EMAIL_WEBHOOK = savedHook;
    receiver.close();
  }
});

test('recovery email management + email copies of notifications', async () => {
  const emails = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      emails.push(JSON.parse(body));
      res.end('ok');
    });
  });
  await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
  const savedHook = process.env.NOVA_EMAIL_WEBHOOK;
  process.env.NOVA_EMAIL_WEBHOOK = `http://127.0.0.1:${receiver.address().port}/send`;
  try {
    const boss = await registerAs('mailboss', 'mail-password-1');
    // Bad addresses rejected; a good one lands on /me.
    assert.strictEqual(
      (await boss('/api/auth/email', { method: 'POST', body: { email: 'not-an-email' } })).status,
      400
    );
    assert.strictEqual(
      (await boss('/api/auth/email', { method: 'POST', body: { email: 'boss@example.com' } })).status,
      200
    );
    assert.strictEqual((await (await boss('/api/auth/me')).json()).email, 'boss@example.com');
    // Another account cannot take it.
    const writer = await registerAs('mailwriter', 'mail-password-2');
    assert.strictEqual(
      (await writer('/api/auth/email', { method: 'POST', body: { email: 'boss@example.com' } })).status,
      409
    );

    // A submission notifies the admin in-app AND by email.
    const team = await (await boss('/api/teams', { method: 'POST', body: { name: 'Mailer Co' } })).json();
    await boss(`/api/teams/${team.id}/members`, { method: 'POST', body: { username: 'mailwriter', role: 'manager' } });
    await writer(`/api/teams/${team.id}/content`, {
      method: 'POST',
      body: { type: 'post', title: 'Inbox story', body: 'Read all about it.', status: 'pending' },
    });
    for (let i = 0; i < 40 && emails.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(emails.length, 1);
    assert.strictEqual(emails[0].to, 'boss@example.com');
    assert.ok(emails[0].subject.includes('submitted “Inbox story”'));
    assert.ok(emails[0].text.includes('Mailer Co'));

    // Blank save clears the address.
    assert.strictEqual((await boss('/api/auth/email', { method: 'POST', body: { email: '' } })).status, 200);
    assert.strictEqual((await (await boss('/api/auth/me')).json()).email, null);
  } finally {
    if (savedHook === undefined) delete process.env.NOVA_EMAIL_WEBHOOK;
    else process.env.NOVA_EMAIL_WEBHOOK = savedHook;
    receiver.close();
  }
});

test('the SMTP transport speaks to a real (fake) SMTP server', async () => {
  const net = require('node:net');
  const commands = [];
  const body = [];
  const smtp = net.createServer((sock) => {
    let raw = '';
    let inData = false;
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      raw += chunk.toString();
      let idx;
      while ((idx = raw.indexOf('\r\n')) !== -1) {
        const line = raw.slice(0, idx);
        raw = raw.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 accepted\r\n');
          } else body.push(line);
          continue;
        }
        commands.push(line);
        const cmd = line.split(' ')[0].toUpperCase();
        if (cmd === 'EHLO') sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (cmd === 'DATA') { inData = true; sock.write('354 go ahead\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const { sendEmail } = require('../src/mailer');
  const savedUrl = process.env.SMTP_URL;
  process.env.SMTP_URL = `smtp://box:secret@127.0.0.1:${smtp.address().port}`;
  try {
    const ok = await sendEmail({
      to: 'dev@example.com',
      subject: 'Hello from Nova',
      text: 'Line one.\n.a line starting with a dot',
    });
    assert.strictEqual(ok, true);
  } finally {
    if (savedUrl === undefined) delete process.env.SMTP_URL;
    else process.env.SMTP_URL = savedUrl;
    smtp.close();
  }
  const message = body.join('\n');
  assert.ok(commands.some((c) => c.startsWith('MAIL FROM:<')));
  assert.ok(commands.includes('RCPT TO:<dev@example.com>'));
  assert.ok(commands.includes('AUTH LOGIN'));
  assert.ok(message.includes('Subject: Hello from Nova'));
  assert.ok(message.includes('To: <dev@example.com>'));
  assert.ok(message.includes('..a line starting with a dot')); // RFC 5321 dot-stuffing
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
