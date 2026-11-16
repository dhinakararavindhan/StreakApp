import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SQUADS, PLAYABLE, isPlayable, BOWL_SLOTS, BOWL_MIN, batTarget, bowlTarget } from './data.js'
import { hashStr, todayKey } from './rng.js'
import { superOpponent, opponentFor, autoAttack } from './sim.js'
import { conditionFor, modifierFor, squadsFor, pickAllowed, tagOf, TAG_LABEL, phaseBonus, orderOK, nativeSlot, isPower, isAnchor, pitchFitBat, pitchFitBowl } from './rules.js'
import { getName, setName, submitScore, fetchWeekly, fetchRecap } from './api.js'
import { liveStreak } from './storage.js'
import { BatCard, BowlCard } from './scorecard.jsx'
import { shareCard } from './card.js'
import { track } from './analytics.js'
import { makeSpins, oversStr, initials, avatarColor } from './util.js'

export const Av = ({ p }) => <span className="av" style={{ background: avatarColor(p) }}>{initials(p.name)}</span>

// ---------- placement sheet: appears at the bottom as soon as a player is tapped ----------
export function PlaceSheet({ player, options, onCancel }) {
  return (
    <div className="sheet" role="dialog" aria-label={`Place ${player.name}`}>
      <div className="sheet-in">
        <div className="sheet-head">
          <Av p={player} />
          <div><b>{player.name}</b><small>{options.length === 1 ? 'Confirm the position' : 'Choose a position'}</small></div>
          <button className="link" onClick={onCancel}>Cancel</button>
        </div>
        <div className="sheet-opts">
          {options.map((o) => (
            <button key={o.key} className={'opt' + (options.length === 1 ? ' only' : '')} onClick={o.onPick}>
              <b>{o.label}</b>{o.hint ? <small className={o.tone || ''}>{o.hint}</small> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- compact draft pieces (keep a whole draft on one screen) ----------
export function BriefPills({ seedStr }) {
  const cond = conditionFor(seedStr), mod = modifierFor(seedStr)
  return <div className="pills"><span>{cond.icon} {cond.name}</span>{mod.id !== 'free' && <span>{mod.icon} {mod.title}</span>}</div>
}
export function Progress({ items, total, text }) {
  return (
    <div className="prog">
      <div className="dots">
        {Array.from({ length: total }, (_, i) => (items[i]
          ? <i key={i} className="d on" style={{ background: avatarColor(items[i]) }}>{initials(items[i].name)[0]}</i>
          : <i key={i} className="d">{i + 1}</i>))}
      </div>
      {text && <span className="ptxt">{text}</span>}
    </div>
  )
}
export function WheelRow({ rolling, ticker, squad, rerolls, canReroll, onReroll, skips, canSkip, onSkip }) {
  return (
    <div className="wheelrow">
      <div className={'wheel' + (rolling ? ' spinning' : '')}>{rolling ? ticker : <>{squad.name} <small>{squad.year}</small></>}</div>
      <button className="ghost reroll" disabled={!canReroll} onClick={onReroll} aria-label="Re-roll wheel">🔄<small>{rerolls}</small></button>
      {onSkip && <button className="ghost reroll" disabled={!canSkip} onClick={onSkip} aria-label="Skip a pick">✂️<small>{skips}</small></button>}
    </div>
  )
}
export function MyList({ summary, children }) {
  return <details className="xi"><summary>{summary}</summary>{children}</details>
}

// ---------- today's pitch + twist ----------
export function Brief({ seedStr, compact }) {
  const cond = conditionFor(seedStr), mod = modifierFor(seedStr)
  return (
    <div className={'brief' + (compact ? ' compact' : '') + (mod.id === 'free' ? ' one' : '')}>
      <div><span className="bi">{cond.icon}</span><div><b>{cond.name}</b>{!compact && <small>{cond.desc}</small>}</div></div>
      {mod.id !== 'free' && <div><span className="bi">{mod.icon}</span><div><b>{mod.title}</b>{!compact && <small>{mod.desc}</small>}</div></div>}
    </div>
  )
}

// mode: 'bat' (batter hints), 'bowl' (bowler hints) or 'both'. cond = the day's pitch.
const ratingChips = (p, cond, mode = 'both') => {
  const isBowler = p.bwl >= BOWL_MIN
  const showBat = mode === 'bat' || mode === 'both', showBowl = (mode === 'bowl' || mode === 'both') && isBowler
  const fb = showBat ? pitchFitBat(cond, p) : 0, fw = showBowl ? pitchFitBowl(cond, p) : 0
  const fit = fb > 0 || fw > 0 ? 1 : fb < 0 || fw < 0 ? -1 : 0
  return (
    <>
      {showBat && isPower(p) && <i className="chip pw">POWER</i>}
      {showBat && isAnchor(p) && <i className="chip an">ANCHOR</i>}
      {showBowl && tagOf(p) && <i className="chip tg">{TAG_LABEL[tagOf(p)]}</i>}
      {fit > 0 && <i className="chip up">suits pitch ↑</i>}
      {fit < 0 && <i className="chip dn">pitch ↓</i>}
    </>
  )
}
export { ratingChips }

// ---------- tactics: batting order swap + captain ----------
export function Tactics({ kind, picks, seedStr, onConfirm, full = false }) {
  const cond = conditionFor(seedStr)
  const [first, setFirst] = useState('bat')
  const [order, setOrder] = useState(picks)
  const [cap, setCap] = useState(-1)
  const [sel, setSel] = useState(null)
  const [msg, setMsg] = useState('')
  const swappable = kind === 'super' ? 3 : picks.length
  const tapRow = (i) => {
    setMsg('')
    if (i >= swappable) return
    if (sel === null) { setSel(i); return }
    if (sel === i) { setSel(null); return }
    const next = order.slice(); [next[sel], next[i]] = [next[i], next[sel]]
    if (kind === 'bat' && !orderOK(next)) { setMsg('Not allowed: at most 2 players may bat out of position, and only one place away from their usual spot.'); setSel(null); return }
    const capName = cap >= 0 ? order[cap] : null
    setOrder(next); setSel(null)
    if (capName) setCap(next.indexOf(capName))
  }
  const label = (i) => (kind === 'bat' ? `#${i + 1}` : kind === 'bowl' ? BOWL_SLOTS[i] : i < 3 ? `Bat ${i + 1}` : 'Bowler')
  const title = full ? 'Match plan: order, captain, who goes first' : kind === 'bat' ? 'Tactics: batting order and captain' : kind === 'bowl' ? 'Tactics: bowling slots and captain' : 'Tactics: pick your captain'
  const go = full ? 'Next: pick your bowlers ▶' : kind === 'bat' ? 'Start the chase' : kind === 'bowl' ? 'Bowl!' : 'Play the Super Over'
  return (
    <main className="tactics">
      <h1>{title}</h1>
      <Brief seedStr={seedStr} compact />
      {full && (
        <div className="tabs first">
          <button className={first === 'bat' ? 'on' : ''} onClick={() => setFirst('bat')}>🏏 Bat first</button>
          <button className={first === 'bowl' ? 'on' : ''} onClick={() => setFirst('bowl')}>🎯 Bowl first</button>
        </div>
      )}
      {full && <p className="hint">{first === 'bat' ? 'Set a score, then defend it with your bowlers.' : 'Restrict them first, then chase their score with your batters.'}</p>}
      <p className="hint">
        {kind === 'bat' && 'Tap two players to swap them. You may move up to 2 players one place out of position.'}
        {kind === 'bowl' && 'Tap two bowlers to swap slots. Specialists get a bonus in their phase: new-ball pace early, spin in the middle, death specialists last.'}
        {kind === 'super' && 'Your captain gets a rating boost. Tap two batters to change their order.'}
      </p>
      <ol className="slots tac">
        {order.map((p, i) => {
          const fit = kind === 'bowl' ? phaseBonus(i, p) : 0
          return (
            <li key={p.id} className={(sel === i ? 'can ' : '') + 'filled'} onClick={() => tapRow(i)}>
              <span className="sn">{kind === 'bat' ? i + 1 : ''}</span>
              <Av p={p} />
              <span className="sl">
                {p.name} <small className="tm">{p.team} {String(p.year).slice(2)}</small>
                <small className="sub2">{label(i)}{kind === 'bat' && !nativeSlot(p, i) ? ' ⚠ out of position' : ''}</small>
                <span className="chips">{ratingChips(p, cond, kind === 'bowl' ? 'bowl' : kind === 'bat' ? 'bat' : i < 3 ? 'bat' : 'bowl')}
                  {kind === 'bowl' && fit > 0 && <i className="chip up">+{fit} fit</i>}{kind === 'bowl' && fit < 0 && <i className="chip dn">{fit} fit</i>}
                </span>
              </span>
              {(kind !== 'super' || i < 3) && (
                <button className={'cap' + (cap === i ? ' on' : '')} onClick={(e) => { e.stopPropagation(); setCap(i) }} aria-label="captain">{cap === i ? '⭐ C' : '☆'}</button>
              )}
            </li>
          )
        })}
      </ol>
      {msg && <p className="warn">{msg}</p>}
      <button className="primary" disabled={cap < 0} onClick={() => onConfirm(order, cap, first)}>{cap < 0 ? 'Pick a captain ⭐' : go}</button>
    </main>
  )
}

// ---------- Super Over ----------
const SO_SLOTS = ['Batter 1', 'Batter 2', 'Batter 3', 'Bowler']
export function SuperDraft({ seedStr, mode, picks, setPicks, initMeta, onMeta, onDone, onExit }) {
  const mod = useMemo(() => modifierFor(seedStr), [seedStr])
  const spins = useMemo(() => makeSpins(hashStr('sspin' + seedStr), squadsFor(mod)), [seedStr, mod])
  const opp = useMemo(() => superOpponent(seedStr), [seedStr])
  const [spinIdx, setSpinIdx] = useState((initMeta && initMeta.spinIdx) || 0)
  const [rerolls, setRerolls] = useState(initMeta ? initMeta.rerolls : 1)
  useEffect(() => { if (onMeta) onMeta({ spinIdx, rerolls }) }, [spinIdx, rerolls])
  const [rolling, setRolling] = useState(true)
  const [ticker, setTicker] = useState('')
  const [sel, setSel] = useState(null)
  const picked = picks.filter(Boolean).length
  const chosen = picks.filter(Boolean)
  const used = new Set(chosen.map((p) => p.name))
  const squad = spins[spinIdx % spins.length]
  const slotOpen = (i) => !picks[i]
  const canUse = (p) => !used.has(p.name) && pickAllowed(mod, p, chosen)
  const batOpen = [0, 1, 2].some(slotOpen), bowlOpen = slotOpen(3)
  // any player can bat; only real bowlers (BWL >= 50) can take the bowler slot
  const eligible = (p) => canUse(p) && (batOpen || (bowlOpen && p.bwl >= BOWL_MIN))
  const hasOption = squad.players.some(eligible)
  useEffect(() => {
    if (picked >= 4) return
    setRolling(true); setSel(null); window.scrollTo(0, 0)
    let n = 0
    const t = setInterval(() => { n++; setTicker(PLAYABLE[Math.floor(Math.random() * PLAYABLE.length)].short + ' ' + (2008 + Math.floor(Math.random() * 17))); if (n > 12) { clearInterval(t); setRolling(false) } }, 70)
    return () => clearInterval(t)
  }, [spinIdx])
  useEffect(() => { if (!rolling && picked < 4 && !hasOption) setSpinIdx((i) => i + 1) }, [rolling, hasOption, picked])
  const slotOK = (i) => slotOpen(i) && sel && (i < 3 || sel.bwl >= BOWL_MIN)
  const place = (i) => { const next = picks.slice(); next[i] = sel; setPicks(next); setSel(null); setSpinIdx((x) => x + 1) }
  return (
    <main className={'draft' + (sel ? ' has-sheet' : '')}>
      <header><button className="link" onClick={onExit}>✕</button><b>Super Over<small className="sub3">{mode === 'daily' ? ' · daily' : ' · practice'}</small></b><span>{picked}/4</span></header>
      <BriefPills seedStr={seedStr} />
      <div className="card opp tight"><small>vs</small><b>{opp.name} {opp.year}</b><span>{opp.bats.map((p) => p.name).join(', ')} · bowler {opp.bowler.name}</span></div>
      <Progress items={picks} total={4} text="3 bat + 1 bowl" />
      {picked < 4 ? (
        <>
          <WheelRow rolling={rolling} ticker={ticker} squad={squad} rerolls={rerolls} canReroll={rerolls > 0 && !sel && !rolling} onReroll={() => { setRerolls(0); setSpinIdx((i) => i + 1) }} />
          {!rolling && (
            <div className="players">
              {squad.players.map((p) => (
                <button key={p.id} disabled={!eligible(p)} className={'player' + (sel === p ? ' sel' : '')} onClick={() => setSel(p)}>
                  <Av p={p} />
                  <span className="pn">{p.name}</span>
                  <span className="meta"><i>B</i>{p.bat} <i>P</i>{p.pow}{p.bwl >= 30 ? <> <i>W</i>{p.bwl}</> : null}</span>
                  <span className="chips">{ratingChips(p, conditionFor(seedStr), 'both')}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : <button className="primary" onClick={() => onDone(picks)}>Next: tactics</button>}
      <MyList summary={`My Super Over side · ${picked}/4`}>
        <ol className="slots">
          {picks.map((p, i) => (
            <li key={i} className={p ? 'filled' : ''}>
              <span className="sn">{i + 1}</span>
              <span className="sl">{p ? <>{p.name} <small className="tm">{p.team} {String(p.year).slice(2)}</small></> : SO_SLOTS[i]}</span>
              {p && <span className="pr"><i>{i < 3 ? 'P' : 'W'}</i>{i < 3 ? p.pow : p.bwl}</span>}
            </li>
          ))}
        </ol>
      </MyList>
      {sel && <PlaceSheet player={sel} onCancel={() => setSel(null)} options={SO_SLOTS.map((l, i) => ({ l, i })).filter(({ i }) => slotOK(i)).map(({ l, i }) => ({ key: i, label: l, hint: i < 3 ? `POW ${sel.pow}` : `BWL ${sel.bwl}`, onPick: () => place(i) }))} />}
    </main>
  )
}

export function SuperInnings({ result, onDone }) {
  const evs = useMemo(() => [...result.mine.events.map((e) => ({ ...e, side: 0 })), ...result.theirs.events.map((e) => ({ ...e, side: 1 }))], [result])
  const [i, setI] = useState(0)
  const [speed, setSpeed] = useState(1)
  const finished = i >= evs.length
  useEffect(() => {
    if (finished) return
    const t = setInterval(() => setI((x) => Math.min(evs.length, x + 1)), 700 / speed)
    return () => clearInterval(t)
  }, [finished, speed, evs.length])
  const shown = evs.slice(0, i)
  const mine = shown.filter((e) => e.side === 0), theirs = shown.filter((e) => e.side === 1)
  const last = (a) => (a.length ? a[a.length - 1] : null)
  const m = last(mine), t = last(theirs)
  const myFinal = result.mine.runs
  return (
    <main className="chase">
      <div className="target">⚡ Super Over · vs {result.opp.name} {result.opp.year}</div>
      <div className="so-board">
        <div className={theirs.length === 0 ? 'on' : ''}><small>You</small><b>{m ? m.score : 0}<em>/{m ? m.wickets : 0}</em></b></div>
        <div className={theirs.length > 0 ? 'on' : ''}><small>Them</small><b>{t ? t.score : 0}<em>/{t ? t.wickets : 0}</em></b></div>
      </div>
      <div className="line">{theirs.length > 0 ? `They need ${Math.max(0, myFinal + 1 - (t ? t.score : 0))} to win` : 'You are batting'}</div>
      <ul className="log">
        {shown.map((e, k) => (
          <li key={k} className={e.wicket ? (e.side === 0 ? 'w' : 'wk') : e.runs >= 4 ? (e.side === 0 ? 's' : 'w') : ''}>
            <b>{e.side === 0 ? 'You' : 'Them'} {e.ball}</b> {e.wicket ? `OUT! ${e.batter} falls to ${e.bowler}.` : e.runs === 6 ? `SIX! ${e.batter} off ${e.bowler}.` : e.runs === 4 ? `FOUR! ${e.batter}.` : `${e.runs} run${e.runs === 1 ? '' : 's'} (${e.batter})`}
          </li>
        ))}
      </ul>
      <div className="row">
        {!finished && <><button className="ghost small" onClick={() => setSpeed((s) => (s === 1 ? 3 : 1))}>Speed ×{speed}</button><button className="ghost small" onClick={() => setI(evs.length)}>Skip</button></>}
        {finished && <button className="primary" onClick={onDone}>See result</button>}
      </div>
    </main>
  )
}

export function SuperResult({ picks, cap, result, mode, stats, seedStr, onHome, onPractice }) {
  const [name, setNameState] = useState(getName())
  const [sub, setSub] = useState(mode === 'daily' ? 'ask' : 'none')
  const [pts, setPts] = useState(null)
  const streak = liveStreak(stats)
  const submit = async () => {
    setName(name.trim()); setSub('sending')
    try { const r = await submitScore('super', name.trim() || 'Anon', seedStr, picks, 1, cap); setPts(r.pts); setSub('done') }
    catch (e) { setSub(e.status === 409 ? 'done' : 'error') }
  }
  const headline = result.won ? '🏆 You win!' : result.tie ? '🤝 Tied' : '💔 You lose'
  const text = `⚡ Chase 300 Super Over ${mode === 'daily' ? seedStr : ''}\n${result.score}/${result.wickets} vs ${result.oppScore} (${result.opp.name} ${result.opp.year}) ${result.won ? '🏆' : ''}\n${picks.map((p) => p.name).join(' · ')}`
  const [copied, setCopied] = useState(false)
  const share = async () => { track('share', { kind: 'super' }); try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); setCopied(true) } } catch {} }
  // daily scores post themselves once the player has a name, so nobody has to find the button
  useEffect(() => { if (mode === 'daily' && getName().trim() && sub === 'ask') submit() }, [])
  return (
    <main className="result has-cta">
      <div className={'big' + (result.won ? ' win' : '')} style={{ fontSize: '3rem' }}>{headline}</div>
      <div className="so-board" style={{ width: '100%' }}>
        <div><small>You</small><b>{result.score}<em>/{result.wickets}</em></b></div>
        <div><small>{result.opp.name} {result.opp.year}</small><b>{result.oppScore}<em>/{result.theirs.wickets}</em></b></div>
      </div>
      <p className="line">{mode === 'daily' ? `🔥 ${streak}-day streak` : 'Practice'}{pts != null ? ` · +${pts} weekly points` : ''}</p>
      {sub === 'ask' && (
        <div className="card submit">
          <b className="subhead">📣 Post your score so your friends can see you</b>
          <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setNameState(e.target.value)} />
          <button className="primary" onClick={submit}>Post to weekly tournament</button>
        </div>
      )}
      {sub === 'sending' && <p className="line">Posting…</p>}
      {sub === 'error' && <p className="warn">Couldn't reach the server. <button className="link" onClick={submit}>Retry</button></p>}
      <div className="hcta"><button className="primary" onClick={onPractice}>⚡ Play another Super Over</button></div>
      <button className="ghost" onClick={share}>{copied ? 'Copied!' : 'Share result'}</button>
      <button className="ghost" onClick={() => shareCard({ mode: 'Super Over', level: 1, score: result.score, wickets: result.wickets, won: result.won, line: `${result.score}/${result.wickets} vs ${result.oppScore}`, names: picks.map((p) => p.name), footer: window.location.host })}>🖼️ Share as image</button>
      <button className="link" onClick={onHome}>Home</button>
    </main>
  )
}

// ---------- weekly tournament ----------
export function Weekly() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => { fetchWeekly(todayKey()).then(setData).catch(() => setErr(true)) }, [])
  return (
    <>
      <p className="hint">Points from every daily game (batting, bowling and Super Over) this week. Resets Monday.</p>
      {data && <p className="line">Week {data.start} → {data.end}</p>}
      {err && <p className="warn">Couldn't load the weekly table.</p>}
      {!data && !err && <p className="line">Loading…</p>}
      {data && data.top.length === 0 && <p className="line">No points yet this week. Play a daily game!</p>}
      {data && (
        <ol className="rows">
          {data.top.map((r) => (
            <li key={r.rank} className={r.you ? 'you' : ''}><span className="rk">{r.rank}</span><span className="nm">{r.name}</span><span className="lv">{r.games} game{r.games === 1 ? '' : 's'}</span><span className="sc">{r.pts} pts</span></li>
          ))}
          {data.me && data.me.rank > 50 && <li className="you"><span className="rk">{data.me.rank}</span><span className="nm">{data.me.name}</span><span className="sc">{data.me.pts} pts</span></li>}
        </ol>
      )}
    </>
  )
}

// ---------- yesterday's best XIs ----------
export function Recap({ onBack }) {
  const day = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 1); return todayKey(d) }, [])
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => { fetchRecap(day).then(setData).catch(() => setErr(true)) }, [day])
  const section = (kind, title) => {
    const rows = data && data[kind]
    if (!rows || rows.length === 0) return null
    return (
      <section key={kind}>
        <h2>{title}</h2>
        {rows.map((r) => (
          <div key={r.rank} className="card recap">
            <div className="rh"><b>#{r.rank} {r.name}</b><span>{kind === 'super' ? `${r.score}/${r.wickets} vs ${r.opp}` : `L${r.level} · ${r.score}/${r.wickets}`}{r.won ? ' 🏆' : ''}</span></div>
            <div className="xi">
              {r.xi.map((p, i) => <span key={i} className={r.cap === i ? 'c' : ''}>{r.cap === i ? '⭐ ' : ''}{p.name} <small>{p.team} {String(p.year).slice(2)}</small></span>)}
            </div>
          </div>
        ))}
      </section>
    )
  }
  const cond = conditionFor(day), mod = modifierFor(day)
  return (
    <main className="stats-screen">
      <header><button className="link" onClick={onBack}>← Back</button><b>Yesterday's best</b><span /></header>
      <p className="hint">{day} · {cond.icon} {cond.name}{mod.id !== 'free' ? ` · ${mod.icon} ${mod.title}` : ''}. See what the top players drafted and borrow ideas.</p>
      {err && <p className="warn">Couldn't load yesterday's recap.</p>}
      {!data && !err && <p className="line">Loading…</p>}
      {data && !data.bat.length && !data.bowl.length && !data.super.length && <p className="line">Nobody posted yesterday yet.</p>}
      {data && section('bat', '🏏 Batting')}
      {data && section('bowl', '🎯 Bowling')}
      {data && section('super', '⚡ Super Over')}
    </main>
  )
}


// ---------- Full match: choose your five bowlers from the XI ----------
export function AttackPicker({ xi, cap, seedStr, first = 'bat', impactP = null, onConfirm }) {
  const cond = conditionFor(seedStr)
  const opp = useMemo(() => opponentFor(seedStr), [seedStr])
  // Impact Player: replaces xi[out] from the 2nd innings. Bat first -> he can bowl in the defence;
  // bowl first -> he bats in the chase (so the attack is picked from the original XI).
  const swapped = (o) => xi.map((q, i) => (i === o ? impactP : q))
  const outOK = (o) => first === 'bat' || orderOK(swapped(o))
  const defOut = () => {
    if (!impactP) return -1
    if (first === 'bat') { const a = autoAttack(xi); const w = xi.map((p, i) => ({ p, i })).filter(({ p }) => !a.includes(p)).sort((x, y) => x.p.bwl - y.p.bwl)[0]; return w && impactP.bwl > w.p.bwl ? w.i : -1 }
    const w = xi.map((p, i) => ({ p, i })).filter(({ i }) => outOK(i)).sort((x, y) => x.p.bat - y.p.bat)[0]
    return w && impactP.bat > w.p.bat ? w.i : -1
  }
  const [out, setOut] = useState(defOut)
  const pool = impactP && out >= 0 && first === 'bat' ? swapped(out) : xi
  const [slots, setSlots] = useState(() => autoAttack(pool))
  const changeOut = (o) => { setOut(o); setSlots(autoAttack(impactP && o >= 0 && first === 'bat' ? swapped(o) : xi)); setSelSlot(null); setSelBench(null) }
  const [selSlot, setSelSlot] = useState(null)
  const [selBench, setSelBench] = useState(null)
  const bench = pool.filter((p) => !slots.includes(p)).sort((a, b) => b.bwl - a.bwl)
  const capPlayer = cap >= 0 ? xi[cap] : null
  const oppBat = Math.round(opp.players.reduce((s, p) => s + p.pow, 0) / opp.players.length)
  const tapSlot = (i) => {
    if (selBench) { const n = slots.slice(); n[i] = selBench; setSlots(n); setSelBench(null); setSelSlot(null); return }
    if (selSlot === null) { setSelSlot(i); return }
    if (selSlot === i) { setSelSlot(null); return }
    const n = slots.slice(); [n[selSlot], n[i]] = [n[i], n[selSlot]]; setSlots(n); setSelSlot(null)
  }
  const tapBench = (p) => {
    if (selSlot !== null) { const n = slots.slice(); n[selSlot] = p; setSlots(n); setSelSlot(null); setSelBench(null); return }
    setSelBench(selBench === p ? null : p)
  }
  const avg = Math.round(slots.reduce((s, p) => s + p.bwl, 0) / 5)
  return (
    <main className="tactics">
      <h1>Pick your five bowlers</h1>
      <Brief seedStr={seedStr} compact />
      <div className="card opp tight"><small>vs</small><b>{opp.name} {opp.year}</b><span>their batting power {oppBat} · your attack {avg}</span></div>
      {impactP && (
        <div className="card impact">
          <b>⚡ Impact player: {impactP.name}</b>
          <small>{first === 'bat' ? `Comes on for the 2nd innings (bowling). B${impactP.bat} W${impactP.bwl}` : `Comes in for the chase in the replaced batter's slot. B${impactP.bat} P${impactP.pow}`}</small>
          <label>Replaces <select value={out} onChange={(e) => changeOut(Number(e.target.value))}>
            <option value={-1}>nobody (don't use)</option>
            {xi.map((p, i) => (outOK(i) ? <option key={p.id} value={i}>{i + 1}. {p.name}</option> : null))}
          </select></label>
        </div>
      )}
      <p className="hint">Four overs each: two with the new ball, two in the middle, one at the death. Tap two slots to swap, or tap a bench player then a slot to bring them in.</p>
      <ol className="slots tac">
        {slots.map((p, i) => {
          const fit = phaseBonus(i, p)
          return (
            <li key={p.id} className={(selSlot === i ? 'can ' : '') + 'filled'} onClick={() => tapSlot(i)}>
              <span className="sn">{i + 1}</span>
              <Av p={p} />
              <span className="sl">
                {capPlayer && capPlayer.name === p.name ? '⭐ ' : ''}{p.name} <small className="tm">{p.team} {String(p.year).slice(2)}</small>
                <small className="sub2">{BOWL_SLOTS[i]} · bowling {p.bwl}</small>
                <span className="chips">{ratingChips(p, cond, 'bowl')}
                  {fit > 0 && <i className="chip up">+{fit} fit</i>}{fit < 0 && <i className="chip dn">{fit} fit</i>}{p.bwl < 40 && <i className="chip dn">part-timer</i>}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      <h2 className="bench-h">Bench</h2>
      <div className="bench">
        {bench.map((p) => (
          <button key={p.id} className={'bp' + (selBench === p ? ' sel' : '')} onClick={() => tapBench(p)}>
            <Av p={p} /><span><b>{p.name}</b><small>bowling {p.bwl}</small></span>
          </button>
        ))}
      </div>
      <button className="primary" onClick={() => onConfirm(slots, impactP ? out : -1)}>Start the match ▶</button>
    </main>
  )
}

// ---------- between the innings ----------
export function InningsBreak({ res, onNext }) {
  const bat1 = res.first === 'bat'
  const i1 = res.inn1
  const target = i1.score + 1
  return (
    <main className="chase">
      <div className="target">Innings break</div>
      <div className="card" style={{ textAlign: 'center' }}>
        <small className="mut">{bat1 ? 'You batted first' : `${res.opp.name} ${res.opp.year} batted first`}</small>
        <div className="big" style={{ fontSize: '3.4rem' }}>{i1.score}<small>/{i1.wickets}</small></div>
        <p className="line">{oversStr(i1.ballsUsed)} overs</p>
      </div>
      <p className="verdict" style={{ textAlign: 'center' }}>{bat1 ? `${res.opp.name} ${res.opp.year} need ${target} to win.` : `You need ${target} to win.`}</p>
      <div className="hcta"><button className="primary" onClick={onNext}>{bat1 ? 'Start bowling ▶' : 'Start the chase ▶'}</button></div>
    </main>
  )
}

// ---------- full match result ----------
export function FullResult({ res, xi, attack, cap, mode, stats, seedStr, onHome, onAgain }) {
  const [name, setNameState] = useState(getName())
  const [sub, setSub] = useState(mode === 'daily' ? 'ask' : 'none')
  const [pts, setPts] = useState(null)
  const [tab, setTab] = useState(res.first === 'bat' ? 'bat' : 'bowl')
  const [copied, setCopied] = useState(false)
  const streak = liveStreak(stats)
  const bat = res.myBatting, bowl = res.myBowling
  const submit = async () => {
    setName(name.trim()); setSub('sending')
    try { const r = await submitScore('full', name.trim() || 'Anon', seedStr, xi, 1, cap, { attack: attack.map((p) => p.id), first: res.first, ...(res.impact ? { impact: { id: res.impact.p.id, out: res.impact.out } } : {}) }); setPts(r.pts); setSub('done') }
    catch (e) { setSub(e.status === 409 ? 'done' : 'error') }
  }
  const headline = res.won ? '🏆 You win!' : res.tie ? '🤝 Match tied' : '💔 You lose'
  const text = `🏟️ Chase 300 full match ${mode === 'daily' ? seedStr : ''}\n${res.text}${res.impact ? `\n⚡ Impact: ${res.impact.p.name}` : ''}\nYou ${bat.score}/${bat.wickets} · ${res.opp.name} ${res.opp.year} ${bowl.score}/${bowl.wickets}\n${xi.map((p) => p.name).join(' · ')}`
  const share = async () => { track('share', { kind: 'full' }); try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); setCopied(true) } } catch {} }
  // daily scores post themselves once the player has a name, so nobody has to find the button
  useEffect(() => { if (mode === 'daily' && getName().trim() && sub === 'ask') submit() }, [])
  return (
    <main className="result has-cta">
      <div className={'big' + (res.won ? ' win' : '')} style={{ fontSize: '2.6rem' }}>{headline}</div>
      <p className="verdict">{res.text}</p>
      {res.impact && <p className="line">⚡ Impact player {res.impact.p.name} replaced {xi[res.impact.out].name} in the 2nd innings</p>}
      <div className="so-board" style={{ width: '100%' }}>
        <div><small>You</small><b>{bat.score}<em>/{bat.wickets}</em></b><small>{oversStr(bat.ballsUsed)} ov</small></div>
        <div><small>{res.opp.name} {res.opp.year}</small><b>{bowl.score}<em>/{bowl.wickets}</em></b><small>{oversStr(bowl.ballsUsed)} ov</small></div>
      </div>
      <p className="line">{mode === 'daily' ? `🔥 ${streak}-day streak` : 'Free play'}{pts != null ? ` · +${pts} weekly points` : ''} · you {res.first === 'bat' ? 'batted' : 'bowled'} first</p>
      <div className="tabs" style={{ width: '100%' }}>
        <button className={tab === 'bat' ? 'on' : ''} onClick={() => setTab('bat')}>🏏 Our batting</button>
        <button className={tab === 'bowl' ? 'on' : ''} onClick={() => setTab('bowl')}>🎯 Our bowling</button>
      </div>
      {tab === 'bat' ? <BatCard result={bat} /> : <BowlCard result={bowl} />}
      {sub === 'ask' && (
        <div className="card submit">
          <b className="subhead">📣 Post your score so your friends can see you</b>
          <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setNameState(e.target.value)} />
          <button className="primary" onClick={submit}>Post to weekly tournament</button>
        </div>
      )}
      {sub === 'sending' && <p className="line">Posting…</p>}
      {sub === 'error' && <p className="warn">Couldn't reach the server. <button className="link" onClick={submit}>Retry</button></p>}
      <button className="ghost" onClick={share}>{copied ? 'Copied!' : 'Share result'}</button>
      <button className="link" onClick={onHome}>Home</button>
      <div className="hcta"><button className="primary" onClick={onAgain}>🏟️ Play another full match</button></div>
    </main>
  )
}
