import { PLAYABLE, BOWL_MIN } from '../src/data.js'
import { simulateSuper, superOpponent } from '../src/sim.js'
import { CONDITIONS } from '../src/rules.js'
import { rng } from '../src/rng.js'
const r = rng(11)
const all = PLAYABLE.flatMap((s) => s.players)
const bats = all.filter((p) => p.pow >= 60), bowlers = all.filter((p) => p.bwl >= BOWL_MIN)
const best = (pool, k, key) => { let b = null; for (let i = 0; i < k; i++) { const p = pool[Math.floor(r() * pool.length)]; if (!b || key(p) > key(b)) b = p } return b }
for (const skill of [1, 3, 8]) {
  let w = 0, t = 0, mine = [], theirs = []
  const N = 20000
  for (let i = 0; i < N; i++) {
    const picks = [best(bats, skill, (p) => p.pow + p.bat), best(bats, skill, (p) => p.pow + p.bat), best(bats, skill, (p) => p.pow + p.bat), best(bowlers, skill, (p) => p.bwl)]
    const res = simulateSuper(picks, superOpponent('d' + (i % 400)), r, { cap: 0, cond: CONDITIONS[Math.floor(r() * 5)] })
    if (res.won) w++; if (res.tie) t++; mine.push(res.score); theirs.push(res.oppScore)
  }
  const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
  console.log(`skill ${skill}: win ${(w / N * 100).toFixed(1)}%  tie ${(t / N * 100).toFixed(1)}%  my avg ${avg(mine)}  their avg ${avg(theirs)}`)
}
