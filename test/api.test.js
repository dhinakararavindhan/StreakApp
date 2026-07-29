const { test, before, after } = require('node:test');
const assert = require('node:assert');

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
let seededTeamId; // "my-team" seeded for admin

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
  assert.ok(teams.some((t) => t.slug === 'my-team'));
  seededTeamId = teams.find((t) => t.slug === 'my-team').id;
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
  assert.strictEqual(aliceTeam.my_role, 'owner');
});

test('non-members cannot access another team', async () => {
  bob = await registerAs('bob', 'bob-pass-1234');
  const res = await bob(`/api/teams/${aliceTeam.id}/content`);
  assert.strictEqual(res.status, 403);
});

let postId;

test('team owner can create content with tags', async () => {
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
  const other = await fetch(`${base}/t/my-team/posts/hello-world`);
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

test('owner can add a member; editors can write content but not manage members', async () => {
  const add = await alice(`/api/teams/${aliceTeam.id}/members`, {
    method: 'POST',
    body: { username: 'bob', role: 'editor' },
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

test('the last owner cannot be removed or demoted', async () => {
  const demote = await alice(`/api/teams/${aliceTeam.id}/members/${(await (await alice('/api/auth/me')).json()).id}`, {
    method: 'PUT',
    body: { role: 'editor' },
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

test('platform admin can access any team; regular users cannot administer users', async () => {
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
