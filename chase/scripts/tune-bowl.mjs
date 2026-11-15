import { SQUADS, BOWL_MIN, bowlTarget } from '../src/data.js'
import { simulateBowl, opponentFor } from '../src/sim.js'
import { CONDITIONS } from '../src/rules.js'
import { rng } from '../src/rng.js'
const r = rng(7)
const pool = SQUADS.flatMap((s) => s.players).filter((p) => p.bwl >= BOWL_MIN)
function attack(skill) {
  const a = [], used = new Set()
  while (a.length < 5) {
    let best = null
    for (let k = 0; k < skill; k++) { const p = pool[Math.floor(r() * pool.length)]; if (used.has(p.name)) continue; if (!best || p.bwl > best.bwl) best = p }
    if (best) { used.add(best.name); a.push(best) }
  }
  return a
}
for (const skill of [1, 4, 8]) {
  const sc = []
  for (let i = 0; i < 6000; i++) sc.push(simulateBowl(attack(skill), opponentFor('x' + i).players, r, undefined, { cap: 0, cond: CONDITIONS[Math.floor(r() * CONDITIONS.length)] }).score)
  sc.sort((a, b) => a - b)
  const wins = (t) => (sc.filter((x) => x < t).length / sc.length * 100).toFixed(2)
  console.log(`skill ${skill}: med ${sc[Math.floor(sc.length / 2)]} | win% by level:`, Array.from({ length: 10 }, (_, i) => `L${i + 1}(<${bowlTarget(i + 1)}) ${wins(bowlTarget(i + 1))}`).join('  '))
}
