import { SQUADS, BOWL_MIN } from '../src/data.js'
import { tagOf } from '../src/rules.js'
const all = SQUADS.flatMap((s) => s.players.map((p) => ({ ...p, sq: `${s.name} ${s.year}` })))
const issues = []
const add = (t, m) => issues.push(`${t}: ${m}`)

for (const s of SQUADS) {
  const ps = s.players
  const keepers = ps.filter((p) => p.k)
  if (keepers.length !== 1) add('keeper', `${s.name} ${s.year} has ${keepers.length} keepers (${keepers.map((p) => p.name).join(', ')})`)
  const bowlers = ps.filter((p) => p.bwl >= 70)
  if (bowlers.length < 4) add('bowling depth', `${s.name} ${s.year} has only ${bowlers.length} real bowlers (BWL>=70)`)
  const avgPow = ps.reduce((a, p) => a + p.pow, 0) / 11
  if (avgPow > 82) add('very strong batting', `${s.name} ${s.year} avg POW ${avgPow.toFixed(0)}`)
  for (const p of ps) {
    if (p.lo > p.hi) add('range', `${p.name} lo>hi`)
    if (p.bat > 94 || p.pow > 100 || p.bwl > 98) add('rating cap', `${p.name} ${s.year}: ${p.bat}/${p.pow}/${p.bwl}`)
    if (p.pow < 60 && p.lo <= 4) add('opener/top-order with POW<60', `${p.name} (${s.name} ${s.year}) POW ${p.pow} at #${p.lo}-${p.hi}`)
    if (p.bat < 40 && p.lo <= 5 && p.pow < 90) add('weak top/mid batter', `${p.name} (${s.name} ${s.year}) ${p.bat}/${p.pow} at #${p.lo}-${p.hi}`)
    if (p.bwl >= 85 && p.lo <= 4) add('elite bowler batting high', `${p.name} (${s.name} ${s.year}) BWL ${p.bwl} at #${p.lo}`)
    if (p.hi >= 9 && p.bat >= 40) add('tail batter too good', `${p.name} (${s.name} ${s.year}) BAT ${p.bat} at #${p.lo}-${p.hi}`)
  }
}
// same player across seasons
const by = new Map()
for (const p of all) { const a = by.get(p.name) || []; a.push(p); by.set(p.name, a) }
for (const [name, list] of by) {
  if (list.length < 2) continue
  for (const k of ['bat', 'pow', 'bwl']) {
    const vals = list.map((p) => p[k]); const spread = Math.max(...vals) - Math.min(...vals)
    if (spread >= 20) add('cross-season spread', `${name}: ${k} ranges ${Math.min(...vals)}-${Math.max(...vals)} (${list.map((p) => `${p.sq}:${p[k]}`).join(', ')})`)
  }
}
// bowler tags
const untagged = [...new Set(all.filter((p) => p.bwl >= 70 && !tagOf(p)).map((p) => `${p.name}(${p.bwl})`))]
if (untagged.length) add('untagged strong bowlers', untagged.join(', '))
// tag sanity: tagged but low bwl
const lowTag = [...new Set(all.filter((p) => p.bwl < BOWL_MIN && tagOf(p)).map((p) => p.name))]
// name collisions that could be two people
const surname = new Map()
for (const p of all) { const k = p.name.split(' ').pop(); const a = surname.get(k) || new Set(); a.add(p.name); surname.set(k, a) }
for (const [k, set] of surname) if (set.size > 1 && [...set].some((n) => n === k)) add('possible name clash', `"${k}" vs ${[...set].filter((n) => n !== k).join(', ')}`)

console.log(`${SQUADS.length} squads, ${all.length} player entries, ${by.size} distinct names`)
console.log(`issues: ${issues.length}`)
const groups = {}
for (const i of issues) { const t = i.split(':')[0]; (groups[t] ||= []).push(i.slice(t.length + 2)) }
for (const [t, list] of Object.entries(groups)) { console.log(`\n[${t}] (${list.length})`); list.slice(0, 40).forEach((l) => console.log('  -', l)) }

// ---- same person under two different name strings (would let one player be drafted twice) ----
{
  const toks = (n) => n.replace(/\./g, '').split(' ')
  const names = [...by.keys()]
  const byLast = new Map()
  for (const n of names) { const t = toks(n); const last = t[t.length - 1].toLowerCase(); const first = t.length > 1 ? t[0].toLowerCase() : ''; (byLast.get(last) || byLast.set(last, []).get(last)).push({ n, first }) }
  const pairs = []
  for (const [, list] of byLast) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]
    const maybeSame = a.first === '' || b.first === '' || (a.first[0] === b.first[0] && (a.first.length === 1 || b.first.length === 1 || a.first === b.first))
    if (maybeSame) pairs.push(`${a.n}  <->  ${b.n}`)
  }
  console.log(`\n[possible same person, two spellings] (${pairs.length})`); pairs.forEach((p) => console.log('  -', p))
}
