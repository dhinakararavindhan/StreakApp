// Shared by the app and the server: daily pitch conditions, daily draft twists,
// bowler tags (new ball / spin / death), captain bonuses and weekly points.
import { SQUADS, PLAYABLE, DRAFT_TWISTS, BOWL_MIN } from './data.js'
import { hashStr } from './rng.js'

// ---------- bowler tags ----------
const SPIN = new Set(['Narine', 'Rashid Khan', 'Zampa', 'Chahal', 'Ashwin', 'Jadeja', 'Axar', 'Kuldeep', 'Tahir', 'Harbhajan', 'Warne', 'Muralitharan',
  'Shadab', 'Imad', 'Ajmal', 'Bishnoi', 'Varun C.', 'Mujeeb', 'Shamsi', 'S. Harmer', 'A. Rashid', 'Vettori', 'Santner', 'Sodhi', 'Noor Ahmad',
  'Chawla', 'R. Chahar', 'Markande', 'A. Hosein', 'Boyce', 'A. Agar', "O'Keefe", 'L. Pope', 'Z. Gohar', 'P. Ojha', 'Permaul', 'N. Miller', 'Karn Sharma',
  'H. Brar', 'Krunal', 'W. Sundar', 'F. Ahmed', 'Beer', 'Hogg', 'Z. Khan', 'K. Pierre', 'B. Fortuin', 'L. Dawson', 'Moeen Ali', 'Shakib', 'M. Swepson',
  'Nabi', 'Bipul Sharma', 'U. Mir', 'S. Patel', 'Hafeez', 'Hooda', 'D. Hooda', 'Raina', 'Theekshana', 'Shahbaz', 'Short'])
const DEATH = new Set(['Bumrah', 'Malinga', 'Bravo', 'Starc', 'Arshdeep', 'Rauf', 'Natarajan', 'Harshal', 'Pathirana', 'Mustafizur', 'Coulter-Nile',
  'M. Johnson', 'Siraj', 'Shaheen', 'Nortje', 'Hasnain', 'Y. Dayal', 'Mohit Sharma', 'B. Thampi', 'S. Kaul', 'Mills', 'Sandeep Sharma', 'D. Sams',
  'G. Atkinson', 'Mohsin Khan', 'Cottrell', 'Shami', 'Naveen-ul-Haq', 'H. Rana', 'A. Joseph', 'Deshpande', 'Wiese'])
const NEWBALL = new Set(['Boult', 'Bhuvneshwar', 'Southee', 'Hazlewood', 'Naseem', 'M. Amir', 'D. Chahar', 'Steyn', 'M. Morkel', 'B. Lee', 'Behrendorff',
  'Topley', 'Ferguson', 'Avesh Khan', 'Chameera', 'M. Wood', 'Unadkat', 'U. Yadav', 'Umesh Yadav', 'V. Aaron', 'Nehra', 'J. Holder', 'Jansen', 'B. Carse',
  'Baartman', 'Ngidi', 'D. Olivier', 'G. Coetzee', 'McCoy', 'J. Taylor', 'Cummins', 'Milne', 'Munaf', 'RP Singh', 'Sreesanth', 'Balaji', 'Bollinger',
  'Trivedi', 'M. Sami', 'Rumman', 'J. Khan', 'I. Khan', 'S. Irshad', 'A. Iqbal', 'S. Muqeem', 'Shinwari', 'M. Ilyas', 'Junaid', 'Gul', 'E. Bosch',
  'Dupavillon', 'A. Phillip', 'Ali Khan', 'Laughlin', 'Stanlake', 'Neser', 'J. Richardson', 'A. Tye', 'L. Morris', 'Meredith', 'N. Ellis', 'McClenaghan',
  'K. Richardson', 'J. Lalor', 'J. Bird', 'Dwarshuis', 'S. Abbott', 'Dahani', 'Hatzoglou', 'M. de Lange', 'M. Carter', 'T. Curran', 'S. Curran', 'D. Chahar',
  'S. Thakur', 'Hasan', 'Sandhu', 'Gurinder Sandhu', 'Rabada', 'P. Krishna', 'V. Arora', 'Ishant', 'B. Sran', 'W. Riaz', 'A. Yamin', 'S. Tanvir', 'Emrit', 'D. Hussain', 'Steketee', 'Doggett', 'Wood', 'L. Williams', 'M. Pretorius', 'Parnell', 'Kulasekara', 'Vaas'])
export const tagOf = (p) => (SPIN.has(p.name) ? 'spin' : DEATH.has(p.name) ? 'death' : NEWBALL.has(p.name) ? 'new' : '')
export const TAG_LABEL = { spin: '🌀 Spin', death: '💥 Death', new: '🆕 New ball' }

// Bowling slots: 0,1 = new ball; 2,3 = middle overs; 4 = death overs.
export const phaseBonus = (slot, p) => {
  const t = tagOf(p)
  const want = slot <= 1 ? 'new' : slot <= 3 ? 'spin' : 'death'
  if (!t) return 0
  return t === want ? 8 : t === 'spin' || want === 'spin' ? -4 : -2
}

// ---------- batter archetypes ----------
export const isPower = (p) => p.pow >= 90
export const isAnchor = (p) => p.bat >= 72 && p.pow < 90

// ---------- daily pitch / weather conditions ----------
export const CONDITIONS = [
  { id: 'flat', icon: '🛣️', name: 'Flat deck', desc: 'A road. Power hitters feast, bowlers struggle.' },
  { id: 'spin', icon: '🌀', name: 'Spinning track', desc: 'Spinners shine. Big hitters struggle, anchors survive.' },
  { id: 'green', icon: '🌿', name: 'Green seamer', desc: 'Pace bowlers shine. Anchors with a high BAT rating thrive.' },
  { id: 'dew', icon: '💧', name: 'Heavy dew', desc: 'Slippery ball. Everyone bats better, bowlers lose grip.' },
  { id: 'slow', icon: '🐢', name: 'Slow & low', desc: 'Hard to hit. Big hitters lose out, anchors and spinners win.' },
]
export const conditionFor = (seedStr) => CONDITIONS[hashStr('cond' + seedStr) % CONDITIONS.length]

// batter adjustment: returns { pow (multiplier), bat (added) }
export function batAdjust(cond, p) {
  if (!cond) return { pow: 1, bat: 0 }
  switch (cond.id) {
    case 'flat': return { pow: 1.06, bat: 0 }
    case 'spin': return { pow: isAnchor(p) ? 1 : 0.92, bat: p.bat < 60 ? -8 : 0 }
    case 'green': return { pow: 0.95, bat: p.bat >= 72 ? 4 : 0 }
    case 'dew': return { pow: 1.04, bat: 0 }
    case 'slow': return { pow: isPower(p) ? 0.9 : 0.97, bat: isAnchor(p) ? 4 : 0 }
    default: return { pow: 1, bat: 0 }
  }
}
// bowler adjustment: added to the bowling rating
export function bowlAdjust(cond, p) {
  if (!cond) return 0
  const spin = tagOf(p) === 'spin'
  switch (cond.id) {
    case 'flat': return -5
    case 'spin': return spin ? 8 : -4
    case 'green': return spin ? -6 : 8
    case 'dew': return -6
    case 'slow': return spin ? 4 : 0
    default: return 0
  }
}

// who the day's pitch really favours (+1) or hurts (-1): drives the hint chips shown while drafting
export function pitchFitBat(cond, p) {
  if (!cond) return 0
  switch (cond.id) {
    case 'flat': return isPower(p) ? 1 : 0
    case 'spin': return isAnchor(p) ? 1 : isPower(p) || p.bat < 60 ? -1 : 0
    case 'green': return p.bat >= 72 ? 1 : isPower(p) ? -1 : 0
    case 'slow': return isAnchor(p) ? 1 : isPower(p) ? -1 : 0
    default: return 0 // dew lifts everyone equally
  }
}
export function pitchFitBowl(cond, p) {
  const a = bowlAdjust(cond, p)
  return a >= 6 ? 1 : a <= -4 && cond && cond.id !== 'dew' && cond.id !== 'flat' ? -1 : 0
}

// ---------- daily draft twists ----------
const star = (p) => p.pow >= 96 || p.bat >= 88 || p.bwl >= 95
export const MODIFIERS = [
  { id: 'free', icon: '🎲', title: 'Free draft', desc: 'No twist today. Pick anyone.', squadOK: () => true, playerOK: () => true },
  { id: 'in', icon: '🇮🇳', title: 'Indian cities', desc: 'Only squads from Indian cities spin up.', squadOK: (s) => s.region === 'IN', playerOK: () => true },
  { id: 'au', icon: '🦘', title: 'Australian summer', desc: 'Only Australian city squads spin up.', squadOK: (s) => s.region === 'AU', playerOK: () => true },
  { id: 'pk', icon: '🌙', title: 'Pakistan nights', desc: 'Only Pakistani city squads spin up.', squadOK: (s) => s.region === 'PK', playerOK: () => true },
  { id: 'world', icon: '🌍', title: 'Rest of the world', desc: 'No Indian squads today.', squadOK: (s) => s.region !== 'IN', playerOK: () => true },
  { id: 'classic', icon: '📼', title: 'Classic era', desc: 'Only squads from 2016 or earlier.', squadOK: (s) => s.year <= 2016, playerOK: () => true },
  { id: 'modern', icon: '⚡', title: 'Modern era', desc: 'Only squads from 2020 or later.', squadOK: (s) => s.year >= 2020, playerOK: () => true },
  { id: 'underdog', icon: '🐶', title: 'Underdog day', desc: 'No superstars: players rated POW 96+, BAT 88+ or BWL 95+ are banned.', squadOK: () => true, playerOK: (p) => !star(p) },
  { id: 'duo', icon: '🤝', title: 'Franchise duo', desc: 'At most two players from the same franchise in your side.', squadOK: () => true, playerOK: (p, picks) => picks.filter((q) => q && q.team === p.team).length < 2 },
  { id: 'city', icon: '🏙️', title: 'One per city', desc: 'No two players from the same city in your side.', squadOK: () => true, playerOK: (p, picks) => !picks.some((q) => q && q.team === p.team) },
]
// a twist is only used if it can actually be played with the squads that are switched on
const cities = new Set(PLAYABLE.map((s) => s.short)).size
const USABLE = MODIFIERS.filter((m) => (DRAFT_TWISTS || m.id === 'free') && PLAYABLE.some(m.squadOK) && (m.id !== 'city' || cities >= 11) && (m.id !== 'in' || PLAYABLE.some((s) => s.region !== 'IN')))
export const modifierFor = (seedStr) => USABLE[hashStr('mod' + seedStr) % USABLE.length]
export const squadsFor = (mod) => PLAYABLE.filter(mod.squadOK)
const sqById = new Map(SQUADS.map((s) => [s.id, s]))
// is a pick (player) allowed given the day's twist and earlier picks?
export const pickAllowed = (mod, p, picks) => mod.squadOK(sqById.get(p.sid)) && mod.playerOK(p, picks)

// ---------- captain ----------
export const CAPTAIN = { batPow: 1.05, batBat: 4, bowl: 5 }

// ---------- tactics: batting order tweaks ----------
export const nativeSlot = (p, i) => i + 1 >= p.lo && i + 1 <= p.hi
export const nearSlot = (p, i) => i + 1 >= p.lo - 1 && i + 1 <= p.hi + 1
// at most 2 players may sit outside their natural range, each within one place of it
export function orderOK(xi) {
  let off = 0
  for (let i = 0; i < xi.length; i++) {
    if (nativeSlot(xi[i], i)) continue
    if (!nearSlot(xi[i], i)) return false
    off++
  }
  return off <= 2
}

// ---------- weekly points ----------
export function dailyPoints(kind, level, res) {
  if (kind === 'super') return res.won ? 100 : res.tie ? 50 : 20
  if (kind === 'full') return res.won ? 120 : res.tie ? 60 : 25
  if (kind === 'bowl') {
    return (res.won ? 100 : Math.max(0, Math.min(99, Math.round((100 * res.target) / Math.max(res.score, 1))))) + level * 5 + (res.won ? 40 : 0)
  }
  return Math.min(100, Math.round((100 * res.score) / res.target)) + level * 5 + (res.won ? 40 : 0)
}
export const mondayOf = (dayStr) => {
  const d = new Date(dayStr + 'T00:00:00Z')
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}
export const BOWL_OK = (p) => p.bwl >= BOWL_MIN
