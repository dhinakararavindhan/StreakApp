/* Seed the platform with realistic demo companies and content.
   Run against a live server:  node scripts/seed-demo.js [baseUrl]
   Idempotent-ish: re-running creates -2 suffixed slugs rather than failing. */

const BASE = process.argv[2] || 'http://localhost:3000';

const COMPANIES = [
  {
    admin: { username: 'northwind-admin', password: 'northwind-pass-1' },
    manager: { username: 'northwind-barista', password: 'barista-pass-12' },
    name: 'Northwind Coffee',
    settings: {
      site_title: 'Northwind Coffee',
      site_description: 'Small-batch roasts, shipped weekly.',
      theme: 'midnight',
      accent_color: '#f59e0b',
      custom_css: 'h1, h2 { font-family: Georgia, serif; }',
    },
    content: [
      { type: 'post', title: 'Introducing our Winter Roast', tags: ['Roasts', 'Seasonal'], excerpt: 'Dark chocolate and orange peel, from Huila and Sidamo.', body: '# A darker season, a darker roast\n\nOur **Winter Roast** blends beans from Huila and Sidamo for notes of dark chocolate and orange peel.\n\n- Roast level: dark\n- Tasting notes: chocolate, orange, molasses\n- Available: December through February\n\nOrder before Friday for weekend delivery.' },
      { type: 'post', title: 'How we source our beans', tags: ['Sourcing'], excerpt: 'Direct trade with six farms across three countries.', body: 'We work directly with **six farms** across three countries, paying 2.4x fair-trade minimums.\n\n> Great coffee starts long before the roaster.\n\nEvery lot is cupped twice before it ships.' },
      { type: 'post', title: 'Brew guide: the perfect pour-over', tags: ['Guides'], excerpt: 'Water at 94°C, a 1:16 ratio, and patience.', body: '## What you need\n\n- 22g coffee, medium-fine\n- 350g water at 94°C\n- A gooseneck kettle\n\n## Method\n\n1. Bloom with 60g for 35 seconds\n2. Pour in slow spirals to 350g\n3. Total brew time: 3:00–3:30' },
      { type: 'page', title: 'About', body: 'Northwind Coffee has roasted in small batches since 2019. We believe great coffee is a supply chain you can name end to end.' },
      { type: 'page', title: 'Wholesale', body: 'We supply cafés and offices across the region. Write to wholesale@northwind.example for our current price list.' },
    ],
  },
  {
    admin: { username: 'orbital-admin', password: 'orbital-pass-12' },
    manager: { username: 'orbital-writer', password: 'writer-pass-123' },
    name: 'Orbital Labs',
    settings: {
      site_title: 'Orbital Labs',
      site_description: 'Notes from the frontier of small satellites.',
      theme: 'ocean',
      accent_color: '#0ea5e9',
      custom_css: '',
    },
    content: [
      { type: 'post', title: 'Flight report: OL-7 first light', tags: ['Missions'], excerpt: 'Our seventh cubesat returned its first images this week.', body: '# First light\n\nOL-7 downlinked its first full imaging pass on Tuesday. Ground resolution beat spec by 8%.\n\n```\npass 042 — elev 71° — 412 MB — 0 dropped frames\n```\n\nCalibration continues through the month.' },
      { type: 'post', title: 'Why we open-sourced our flight computer', tags: ['Engineering', 'Open Source'], excerpt: 'The bus is not the moat. The constellation is.', body: 'Today we published the full schematics and firmware for our OBC-3 flight computer.\n\n- 3 years of flight heritage\n- Radiation-tolerant by design, not by parts\n- MIT licensed\n\nThe bus is not the moat. The constellation is.' },
      { type: 'post', title: 'Hiring: thermal engineer', tags: ['Hiring'], excerpt: 'Help our spacecraft keep their cool.', body: 'We are hiring a **thermal engineer** to own modeling and test for the OL-8 series. Remote-friendly, quarterly launches, real hardware.' },
      { type: 'page', title: 'About', body: 'Orbital Labs builds and operates a constellation of Earth-observation cubesats.' },
    ],
  },
  {
    admin: { username: 'fern-admin', password: 'fern-pass-1234' },
    manager: null,
    name: 'Fern & Field',
    settings: {
      site_title: 'Fern & Field',
      site_description: 'Seasonal recipes from a very small farm.',
      theme: 'forest',
      accent_color: '',
      custom_css: '',
    },
    content: [
      { type: 'post', title: 'What to do with too much zucchini', tags: ['Recipes', 'Summer'], excerpt: 'Fritters, breads, and the case for simply grilling it.', body: '# The August problem\n\nEvery garden has one. Here are three answers:\n\n1. **Fritters** — grate, salt, squeeze, fry\n2. **Zucchini bread** — the freezer is your friend\n3. **Grill it** — thick planks, olive oil, flaky salt' },
      { type: 'post', title: 'Planting garlic before the frost', tags: ['Growing', 'Autumn'], excerpt: 'The one crop that rewards procrastinators — planted now, ready in July.', body: 'Break the bulbs the morning you plant. Two knuckles deep, pointy side up, six inches apart. Mulch heavily and forget about them until spring.' },
      { type: 'page', title: 'The Farm', body: 'Fern & Field is a half-acre market garden. We sell at the Saturday market and through a 20-family CSA.' },
    ],
  },
];

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

async function auth(user) {
  let r = await req('/api/auth/register', { method: 'POST', body: user });
  if (r.status === 409) r = await req('/api/auth/login', { method: 'POST', body: user });
  if (!r.cookie) throw new Error(`auth failed for ${user.username}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.cookie;
}

async function seedCompany(spec) {
  const cookie = await auth(spec.admin);
  const team = await req('/api/teams', { method: 'POST', body: { name: spec.name }, cookie });
  if (team.status !== 201) throw new Error(`create company ${spec.name}: ${team.status}`);
  const id = team.data.id;

  await req(`/api/teams/${id}/settings`, { method: 'PUT', body: spec.settings, cookie });

  if (spec.manager) {
    await auth(spec.manager); // ensure the account exists
    await req(`/api/teams/${id}/members`, {
      method: 'POST',
      body: { username: spec.manager.username, role: 'manager' },
      cookie,
    });
  }

  for (const item of spec.content) {
    const r = await req(`/api/teams/${id}/content`, {
      method: 'POST',
      body: { ...item, status: 'published' },
      cookie,
    });
    if (r.status !== 201) throw new Error(`content "${item.title}": ${r.status} ${JSON.stringify(r.data)}`);
  }
  console.log(`✔ ${spec.name} — ${spec.content.length} items, slug=${team.data.slug}`);
}

(async () => {
  for (const spec of COMPANIES) await seedCompany(spec);
  console.log('Demo platform seeded.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
