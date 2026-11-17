// Load test: many virtual players each open the game, draft an XI, "chase" (the same simulation the app runs),
// post the score to the leaderboard and look at the boards. Repeats for several rounds, then deletes the test data.
//   node scripts/loadtest.mjs [BASE_URL] [PLAYERS] [ROUNDS] [CONCURRENCY]
//   env: NAME_OFFSET=400 (names start at the 400th combination; 3,600 exist)  MIX=1 (play batting, bowling, Super Over AND full matches, not just batting)  SPOOF_IP=1 (give every virtual player its own x-forwarded-for, for local servers) CLEANUP=0 (keep the data)
import { PLAYABLE } from '../src/data.js'
import { simulate, simulateBowl, simulateSuper, superOpponent, simulateFull, autoAttack, opponentFor } from '../src/sim.js'
import { batTarget, bowlTarget, BOWL_MIN } from '../src/data.js'
import { conditionFor } from '../src/rules.js'
import { rng, hashStr } from '../src/rng.js'

const BASE = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
const PLAYERS = Number(process.argv[3] || 250), ROUNDS = Number(process.argv[4] || 3), CONC = Number(process.argv[5] || 40)
const NAME_OFFSET = Number(process.env.NAME_OFFSET || 0) // start of the unique-name sequence (use a new offset for each run so names never repeat)
const MIX = process.env.MIX === '1', SPOOF = process.env.SPOOF_IP === '1', CLEANUP = process.env.CLEANUP !== '0'
const day = new Date().toISOString().slice(0, 10)
const lat = {}, codes = {}, problems = []
let seedN = 0
const rnd = () => Math.random()
import { FIRST_NAMES, LAST_NAMES } from '../src/names.js'
const testName = (i) => `${FIRST_NAMES[i % FIRST_NAMES.length]} ${LAST_NAMES[(Math.floor(i / FIRST_NAMES.length) + i) % LAST_NAMES.length]}`.slice(0, 16)
const fits = (p, s) => s + 1 >= p.lo && s + 1 <= p.hi

function draftXI() {
  const used = new Set(), xi = []
  for (let s = 0; s < 11; s++) {
    for (let k = 0; k < 500; k++) {
      const sq = PLAYABLE[Math.floor(rnd() * PLAYABLE.length)], c = sq.players.filter((p) => fits(p, s) && !used.has(p.name))
      if (c.length) { const p = c[Math.floor(rnd() * c.length)]; used.add(p.name); xi.push(p); break }
    }
  }
  return xi
}
const ALLP = PLAYABLE.flatMap((q) => q.players)
function pickBowlers(n, avoid = []) { const used = new Set(avoid.map((p) => p.name)), out = []; while (out.length < n) { const p = ALLP[Math.floor(rnd() * ALLP.length)]; if (p.bwl >= BOWL_MIN && !used.has(p.name)) { used.add(p.name); out.push(p) } } return out }
// one game of the given kind: what the player picked, the body to POST, and the score the app itself would compute
function makeGame(kind, seed, daily) {
  const cap = 0, cond = conditionFor(seed)
  if (kind === 'bowl') { const level = 1 + Math.floor(rnd() * 4), at = pickBowlers(5), r = simulateBowl(at, opponentFor(seed).players, rng(hashStr(seed + 'bowl' + at.map((p) => p.id).join('|'))), bowlTarget(level), { cap, cond }); return { level, ids: at.map((p) => p.id), extra: {}, score: r.score, won: r.won } }
  if (kind === 'super') { const hit = draftXI().slice(0, 3), bw = pickBowlers(1, hit), picks = [...hit, ...bw]; const r = simulateSuper(picks, superOpponent(seed), rng(hashStr(seed + 'super' + picks.map((p) => p.id).join('|'))), { cap, cond }); return { level: 1, ids: picks.map((p) => p.id), extra: {}, score: r.score, won: r.won } }
  if (kind === 'full') { const xi = draftXI(), attack = autoAttack(xi), first = rnd() < 0.5 ? 'bat' : 'bowl', r = simulateFull(xi, attack, { seedStr: seed, cap, first, cond }); return { level: 1, ids: xi.map((p) => p.id), extra: { attack: attack.map((p) => p.id), first }, score: r.myScore, won: r.won } }
  const xi = draftXI(), level = 1 + Math.floor(rnd() * 5), r = simulate(xi, rng(hashStr(seed + xi.map((p) => p.id).join('|'))), batTarget(level), { cap, cond })
  return { level, ids: xi.map((p) => p.id), extra: {}, score: r.score, won: r.won }
}
async function call(name, method, path, body, ip) {
  const t0 = performance.now()
  let status = 0, json = null
  try {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: body ? JSON.stringify(body) : undefined })
    status = r.status; json = await r.json().catch(() => null)
  } catch (e) { status = -1 }
  const ms = performance.now() - t0
  ;(lat[name] ||= []).push(ms); const k = name + ' ' + status; codes[k] = (codes[k] || 0) + 1
  return { status, json, ms }
}
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0 }

async function player(i) {
  const device = `load-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`
  const ip = SPOOF ? `10.${(i >> 8) & 255}.${i & 255}.${1 + (i % 250)}` : null
  const name = testName(i + NAME_OFFSET)
  await call('page /', 'GET', '/', null, ip)
  await call('GET leaderboard', 'GET', `/api/leaderboard?kind=bat&scope=today&day=${day}&device=${device}`, null, ip)
  for (let round = 0; round < ROUNDS; round++) {
    const kinds = MIX ? ['bat', 'bowl', 'super', 'full'] : ['bat']
    const kind = kinds[round % kinds.length], cap = 0
    const daily = round < kinds.length, seed = daily ? day : String(Date.now() + ++seedN)
    const g = makeGame(kind, seed, daily)
    const body = { device, kind, name, day, level: g.level, cap, xi: g.ids, ...g.extra, ...(daily ? {} : { seed }) }
    const r = await call('POST score ' + kind, 'POST', '/api/score', body, ip)
    if (r.status === 200 && r.json.score !== g.score) problems.push(`${kind} score mismatch (${device} r${round}): local ${g.score} vs server ${r.json.score}`)
    if (r.status !== 200) problems.push(`${kind} score post ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`)
    await call('POST match', 'POST', '/api/match', { device, id: Math.random().toString(36).slice(2, 12), kind, mode: daily ? 'daily' : 'practice', seed, level: g.level, cap, ids: g.ids, extra: g.extra }, ip)
    await call('POST event', 'POST', '/api/event', { device, pwa: 0, events: [{ n: 'game_finish', p: { kind, mode: daily ? 'daily' : 'practice', level: g.level, won: g.won ? 1 : 0, score: g.score }, s: 'load' }] }, ip)
    await call('GET leaderboard', 'GET', `/api/leaderboard?kind=bat&scope=today&day=${day}&device=${device}`, null, ip)
  }
  await call('GET winners', 'GET', `/api/hall?device=${device}`, null, ip)
  await call('GET weekly', 'GET', `/api/weekly?day=${day}&device=${device}`, null, ip)
  return { device, ip }
}

console.log(`Load test -> ${BASE} | ${PLAYERS} players x ${ROUNDS} games${MIX ? ' (bat/bowl/super/full mix)' : ''}, ${CONC} at a time${SPOOF ? ', spoofed client IPs' : ''}`)
const t0 = performance.now(), queue = Array.from({ length: PLAYERS }, (_, i) => i), made = []
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { const i = queue.shift(); made.push(await player(i)) } }))
const secs = (performance.now() - t0) / 1000
const total = Object.values(lat).reduce((a, b) => a + b.length, 0)
console.log(`\nDone in ${secs.toFixed(1)}s: ${total} requests (${(total / secs).toFixed(0)}/s), ${PLAYERS * ROUNDS} games posted`)
console.log('endpoint'.padEnd(18), 'count'.padStart(6), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), 'max'.padStart(7))
for (const [k, v] of Object.entries(lat)) console.log(k.padEnd(18), String(v.length).padStart(6), pct(v, 0.5).toFixed(0).padStart(6) + 'ms', pct(v, 0.95).toFixed(0).padStart(5) + 'ms', pct(v, 0.99).toFixed(0).padStart(5) + 'ms', Math.max(...v).toFixed(0).padStart(5) + 'ms')
console.log('status codes:', JSON.stringify(codes))
console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ` + [...new Set(problems)].slice(0, 8).join('\n  ') : 'No problems: every posted score matched the server\'s own re-run.')
const lb = await call('final', 'GET', `/api/leaderboard?kind=bat&scope=today&day=${day}`, null, null)
console.log(`Leaderboard now lists ${lb.json && lb.json.total} players (top: ${lb.json && lb.json.top[0] && lb.json.top[0].name} L${lb.json && lb.json.top[0] && lb.json.top[0].level}).`)
if (CLEANUP) { let n = 0; await Promise.all(Array.from({ length: 20 }, async () => { while (made.length) { const m = made.pop(); const r = await call('cleanup', 'DELETE', '/api/me', { device: m.device }, m.ip); if (r.status === 200) n++ } })); console.log(`Cleaned up ${n}/${PLAYERS} test players (DELETE /api/me).`) }
process.exit(problems.length ? 1 : 0)
