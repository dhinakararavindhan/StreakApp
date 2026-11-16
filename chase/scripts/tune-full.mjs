import { PLAYABLE } from '../src/data.js'
import { simulateFull, autoAttack } from '../src/sim.js'
import { CONDITIONS } from '../src/rules.js'
import { rng } from '../src/rng.js'
const r = rng(21)
const fits = (p, s) => s + 1 >= p.lo && s + 1 <= p.hi
function randomXI(skill) {
  const xi = Array(11).fill(null), used = new Set()
  for (const s of [...Array(11).keys()].sort(() => r() - 0.5)) {
    let best = null
    for (let k = 0; k < skill; k++) {
      const sq = PLAYABLE[Math.floor(r() * PLAYABLE.length)], c = sq.players.filter((p) => fits(p, s) && !used.has(p.name))
      if (!c.length) continue
      const p = c[Math.floor(r() * c.length)]
      if (!best || p.bat + p.pow + p.bwl > best.bat + best.pow + best.bwl) best = p
    }
    if (!best) best = PLAYABLE.flatMap((q) => q.players).find((p) => fits(p, s) && !used.has(p.name))
    used.add(best.name); xi[s] = best
  }
  return xi
}
const N = Number(process.env.N || 3000)
for (const skill of [1, 3, 8]) for (const first of ['bat', 'bowl']) {
  let w = 0, t = 0, mine = 0, theirs = 0
  for (let i = 0; i < N; i++) {
    const xi = randomXI(skill), cap = xi.reduce((b, p, k) => (p.bat + p.pow > xi[b].bat + xi[b].pow ? k : b), 0)
    const res = simulateFull(xi, autoAttack(xi), { seedStr: 'x' + i, cap, first, cond: CONDITIONS[Math.floor(r() * 5)] })
    if (res.won) w++; if (res.tie) t++; mine += res.myScore; theirs += res.oppScore
  }
  console.log(`skill ${skill} ${first === 'bat' ? 'bat first' : 'bowl first'}: win ${(w / N * 100).toFixed(1)}%  tie ${(t / N * 100).toFixed(1)}%  my avg ${(mine / N).toFixed(0)}  opp avg ${(theirs / N).toFixed(0)}`)
}
