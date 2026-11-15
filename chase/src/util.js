import { SQUADS } from './data.js'
import { rng } from './rng.js'

export const fits = (p, s) => s + 1 >= p.lo && s + 1 <= p.hi
export const oversStr = (b) => `${Math.floor(b / 6)}.${b % 6}`

// Deterministic list of squads for a draft (the day's twist decides which squads can spin up).
export function makeSpins(seed, pool = SQUADS) {
  const r = rng(seed)
  return Array.from({ length: 80 }, () => pool[Math.floor(r() * pool.length)])
}
