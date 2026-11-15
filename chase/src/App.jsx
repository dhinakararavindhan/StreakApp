import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SQUADS, SLOT_LABELS, TARGET, BALLS } from './data.js'
import { hashStr, rng, todayKey } from './rng.js'
import { simulate, teamRatings, verdict } from './sim.js'
import { load, liveStreak, recordDaily, recordPractice } from './storage.js'
import { submitScore, fetchBoard, getName, setName, pushSupported, pushEnabled, enablePush, disablePush } from './api.js'

const fits = (p, s) => s + 1 >= p.lo && s + 1 <= p.hi
const oversStr = (b) => `${Math.floor(b / 6)}.${b % 6}`

// Deterministic list of squads for a draft: 11 spins + spare spins for the re-roll.
function makeSpins(seed) {
  const r = rng(seed)
  return Array.from({ length: 40 }, () => SQUADS[Math.floor(r() * SQUADS.length)])
}

export default function App() {
  const [screen, setScreen] = useState('home')
  const [mode, setMode] = useState('daily')
  const [seedStr, setSeedStr] = useState('')
  const [xi, setXi] = useState(Array(11).fill(null))
  const [result, setResult] = useState(null)
  const [stats, setStats] = useState(load())

  const start = (m) => {
    const key = m === 'daily' ? todayKey() : String(Date.now())
    setMode(m); setSeedStr(key); setXi(Array(11).fill(null)); setResult(null); setScreen('draft')
  }
  const finish = (finalXi) => {
    const rand = rng(hashStr(seedStr + finalXi.map((p) => p.id).join('|')))
    const res = simulate(finalXi, rand, TARGET)
    setXi(finalXi); setResult(res); setScreen('chase')
  }
  const done = () => {
    setStats(mode === 'daily' ? recordDaily(result.score, result.won) : recordPractice(result.score, result.won))
    setScreen('result')
  }

  return (
    <div className="app">
      {screen === 'home' && <Home stats={stats} onStart={start} onBoard={() => setScreen('board')} />}
      {screen === 'board' && <Board onBack={() => setScreen('home')} />}
      {screen === 'draft' && <Draft key={seedStr} seedStr={seedStr} mode={mode} xi={xi} setXi={setXi} onDone={finish} onExit={() => setScreen('home')} />}
      {screen === 'chase' && <Chase xi={xi} result={result} onDone={done} />}
      {screen === 'result' && <Result xi={xi} result={result} mode={mode} stats={stats} seedStr={seedStr} onHome={() => setScreen('home')} onPractice={() => start('practice')} onBoard={() => setScreen('board')} />}
    </div>
  )
}

function Home({ stats, onStart, onBoard }) {
  const today = todayKey()
  const played = stats.history[today]
  const streak = liveStreak(stats)
  return (
    <main className="home">
      <div className="logo">300</div>
      <h1>Chase 300</h1>
      <p className="sub">Draft an XI from legendary squads. Chase 300 in 50 overs. A new wheel every day.</p>
      <div className="stats">
        <div><b>🔥 {streak}</b><span>day streak</span></div>
        <div><b>{stats.best || '–'}</b><span>best score</span></div>
        <div><b>{stats.wins}</b><span>300s</span></div>
      </div>
      {played ? (
        <div className="card">Today's chase: <b>{played.score}</b>{played.won ? ' 🏆' : ''}<br /><small>Come back tomorrow to keep your streak.</small></div>
      ) : (
        <button className="primary" onClick={() => onStart('daily')}>Play today's draft</button>
      )}
      <button className="ghost" onClick={() => onStart('practice')}>Practice (random wheel)</button>
      <button className="ghost" onClick={onBoard}>🏆 Leaderboard</button>
      <Reminders />
      <p className="fine">Fan-made, free and unofficial. Ratings are approximate. Not affiliated with or endorsed by any league, board, team or player. Team and player names are used for identification only.</p>
    </main>
  )
}

function Draft({ seedStr, mode, xi, setXi, onDone, onExit }) {
  const spins = useMemo(() => makeSpins(hashStr('spin' + seedStr)), [seedStr])
  const [spinIdx, setSpinIdx] = useState(0)
  const [rerolls, setRerolls] = useState(1)
  const [rolling, setRolling] = useState(true)
  const [ticker, setTicker] = useState('')
  const [sel, setSel] = useState(null)
  const picked = xi.filter(Boolean).length
  const usedNames = new Set(xi.filter(Boolean).map((p) => p.name)) // same real player can't be picked twice
  const squad = spins[spinIdx]
  const freeSlots = xi.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0)
  const eligible = (p) => !usedNames.has(p.name) && freeSlots.some((s) => fits(p, s))
  const hasOption = squad.players.some(eligible)

  // wheel animation whenever the spin changes
  useEffect(() => {
    if (picked >= 11) return
    setRolling(true); setSel(null); window.scrollTo(0, 0)
    let n = 0
    const t = setInterval(() => {
      n++
      setTicker(SQUADS[Math.floor(Math.random() * SQUADS.length)].short + ' ' + (2008 + Math.floor(Math.random() * 17)))
      if (n > 12) { clearInterval(t); setRolling(false) }
    }, 70)
    return () => clearInterval(t)
  }, [spinIdx])

  // skip squads where nobody fits an open slot
  useEffect(() => {
    if (!rolling && picked < 11 && !hasOption) setSpinIdx((i) => i + 1)
  }, [rolling, hasOption, picked])

  const place = (slot) => {
    const next = xi.slice(); next[slot] = sel
    setXi(next); setSel(null); setSpinIdx((i) => i + 1)
  }
  const reroll = () => { setRerolls(0); setSpinIdx((i) => i + 1) }
  const r = teamRatings(xi)

  return (
    <main className="draft">
      <header>
        <button className="link" onClick={onExit}>✕</button>
        <b>{mode === 'daily' ? 'Daily draft' : 'Practice'}</b>
        <span>{picked}/11</span>
      </header>

      <div className="ratings">
        <Meter label="BAT" v={r.bat} /><Meter label="POW" v={r.pow} /><Meter label="BWL" v={r.bwl} />
      </div>

      {picked < 11 ? (
        <>
          <div className={'wheel' + (rolling ? ' spinning' : '')}>
            {rolling ? ticker : <>{squad.name} <small>{squad.year}</small></>}
          </div>
          {!rolling && (
            <>
              <div className="players">
                {squad.players.map((p) => {
                  const ok = eligible(p)
                  return (
                    <button key={p.name} disabled={!ok} className={'player' + (sel === p ? ' sel' : '')} onClick={() => setSel(p)}>
                      <span className="pn">{p.name}{p.k ? ' 🧤' : ''}</span>
                      <span className="pp">{p.lo === p.hi ? `#${p.lo}` : `#${p.lo}–${p.hi}`}</span>
                      <span className="pr"><i>B</i>{p.bat} <i>P</i>{p.pow} <i>W</i>{p.bwl}</span>
                    </button>
                  )
                })}
              </div>
              <p className="hint">{sel ? `Place ${sel.name} in a highlighted slot` : 'Pick a player — no undos.'}</p>
              <button className="ghost small" disabled={rerolls === 0 || !!sel} onClick={reroll}>Re-roll wheel ({rerolls})</button>
            </>
          )}
        </>
      ) : (
        <button className="primary" onClick={() => onDone(xi)}>Start the chase</button>
      )}

      <ol className="slots">
        {xi.map((p, i) => {
          const can = sel && !p && fits(sel, i)
          return (
            <li key={i} className={(can ? 'can ' : '') + (p ? 'filled' : '')} onClick={() => can && place(i)}>
              <span className="sn">{i + 1}</span>
              <span className="sl">{p ? <>{p.name} <small className="tm">{p.team} {String(p.year).slice(2)}</small></> : SLOT_LABELS[i]}</span>
              {p && <span className="pr"><i>B</i>{p.bat} <i>P</i>{p.pow} <i>W</i>{p.bwl}</span>}
            </li>
          )
        })}
      </ol>
      {picked > 0 && !r.hasKeeper && <p className="warn">No keeper in your XI yet — small penalty if you don't pick one 🧤</p>}
    </main>
  )
}

function Meter({ label, v }) {
  const tier = v >= 95 ? 'Legendary' : v >= 90 ? 'Elite' : v >= 85 ? 'Strong' : v >= 80 ? 'Solid' : ''
  return (
    <div className="meter">
      <div className="mh"><span>{label}</span><b>{Math.round(v)}</b></div>
      <div className="bar"><div style={{ width: `${Math.min(100, v)}%` }} /></div>
      <small>{tier || ' '}</small>
    </div>
  )
}

function Chase({ xi, result, onDone }) {
  const [i, setI] = useState(0)
  const [speed, setSpeed] = useState(1)
  const logRef = useRef(null)
  const ev = result.events
  const shown = ev.slice(0, i)
  const cur = shown[shown.length - 1]
  const finished = i >= ev.length

  useEffect(() => {
    if (finished) return
    const t = setInterval(() => setI((x) => Math.min(ev.length, x + speed)), 80)
    return () => clearInterval(t)
  }, [finished, speed, ev.length])
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, [i])

  const score = cur ? cur.score : 0
  const wk = cur ? cur.wickets : 0
  const balls = cur ? cur.ball : 0
  const rrr = balls < BALLS ? ((TARGET - score) / ((BALLS - balls) / 6)).toFixed(1) : '–'
  const notable = shown.filter((e) => e.wicket || e.runs >= 4).slice(-30)

  return (
    <main className="chase">
      <div className="target">Target {TARGET}</div>
      <div className="big">{score}<small>/{wk}</small></div>
      <div className="line">{oversStr(balls)} ov · Req {rrr}/ov · {Math.max(0, TARGET - score)} to win</div>
      <div className="bar big"><div style={{ width: `${Math.min(100, (score / TARGET) * 100)}%` }} /></div>
      <ul className="log" ref={logRef}>
        {notable.map((e) => (
          <li key={e.ball} className={e.wicket ? 'w' : e.runs === 6 ? 's' : 'f'}>
            <b>{oversStr(e.ball - 1)}</b> {e.wicket ? `OUT! ${e.batter} departs.` : e.runs === 6 ? `SIX! ${e.batter} launches it.` : `FOUR! ${e.batter} finds the gap.`}
          </li>
        ))}
      </ul>
      <div className="row">
        {!finished && <>
          <button className="ghost small" onClick={() => setSpeed((s) => (s === 1 ? 4 : s === 4 ? 12 : 1))}>Speed ×{speed}</button>
          <button className="ghost small" onClick={() => setI(ev.length)}>Skip</button>
        </>}
        {finished && <button className="primary" onClick={onDone}>See result</button>}
      </div>
    </main>
  )
}

function Result({ xi, result, mode, stats, seedStr, onHome, onPractice, onBoard }) {
  const [copied, setCopied] = useState(false)
  const [name, setNameState] = useState(getName())
  const [sub, setSub] = useState(mode === 'daily' ? 'ask' : 'none') // ask | sending | done | error
  const [rank, setRank] = useState(null)
  const submit = async () => {
    setName(name.trim()); setSub('sending')
    try {
      const r = await submitScore(name.trim() || 'Anon', seedStr, xi)
      setRank(r.me); setSub('done')
    } catch (e) { setSub(e.status === 409 ? 'done' : 'error') }
  }
  const streak = liveStreak(stats)
  const text = [
    `Chase 300 ${mode === 'daily' ? seedStr : '(practice)'}`,
    `${result.score}/${result.wickets} in ${oversStr(result.ballsUsed)} ov ${result.won ? '🏆' : ''}`,
    xi.map((p) => p.name).join(' · '),
    mode === 'daily' ? `🔥 ${streak}-day streak` : '',
  ].filter(Boolean).join('\n')
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ text })
      else { await navigator.clipboard.writeText(text); setCopied(true) }
    } catch {}
  }
  return (
    <main className="result">
      <div className={'big' + (result.won ? ' win' : '')}>{result.score}<small>/{result.wickets}</small></div>
      <p className="verdict">{verdict(result, TARGET)}</p>
      <p className="line">{oversStr(result.ballsUsed)} overs{mode === 'daily' ? ` · 🔥 ${streak}-day streak` : ''}</p>
      <table className="card-table">
        <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
        <tbody>
          {result.card.map((c, i) => (
            <tr key={i} className={c.balls === 0 ? 'dnb' : ''}>
              <td>{c.name}{c.balls > 0 && !c.out ? '*' : ''}</td><td>{c.balls ? c.runs : '–'}</td><td>{c.balls || ''}</td><td>{c.balls ? c.fours : ''}</td><td>{c.balls ? c.sixes : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sub === 'ask' && (
        <div className="card submit">
          <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setNameState(e.target.value)} />
          <button className="primary" onClick={submit}>Post to leaderboard</button>
        </div>
      )}
      {sub === 'sending' && <p className="line">Posting…</p>}
      {sub === 'error' && <p className="warn">Couldn't reach the leaderboard. <button className="link" onClick={submit}>Retry</button></p>}
      {sub === 'done' && (
        <button className="ghost" onClick={onBoard}>{rank ? `🏆 You're #${rank.rank} today — view leaderboard` : '🏆 View leaderboard'}</button>
      )}
      <button className="primary" onClick={share}>{copied ? 'Copied!' : 'Share result'}</button>
      <button className="ghost" onClick={onPractice}>Practice again</button>
      <button className="link" onClick={onHome}>Home</button>
    </main>
  )
}

function Board({ onBack }) {
  const [scope, setScope] = useState('today')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    setData(null); setErr(false)
    fetchBoard(scope, todayKey()).then(setData).catch(() => setErr(true))
  }, [scope])
  return (
    <main className="board">
      <header><button className="link" onClick={onBack}>← Back</button><b>Leaderboard</b><span /></header>
      <div className="tabs">
        {['today', 'all'].map((t) => <button key={t} className={scope === t ? 'on' : ''} onClick={() => setScope(t)}>{t === 'today' ? 'Today' : 'All-time'}</button>)}
      </div>
      {err && <p className="warn">Couldn't load the leaderboard.</p>}
      {!data && !err && <p className="line">Loading…</p>}
      {data && data.top.length === 0 && <p className="line">No scores yet. Be the first!</p>}
      {data && (
        <ol className="rows">
          {data.top.map((r) => (
            <li key={r.rank} className={r.you ? 'you' : ''}>
              <span className="rk">{r.rank}</span><span className="nm">{r.name}{r.won ? ' 🏆' : ''}</span>
              <span className="sc">{r.score}/{r.wickets}</span>
            </li>
          ))}
          {data.me && data.me.rank > 50 && <li className="you"><span className="rk">{data.me.rank}</span><span className="nm">{data.me.name}</span><span className="sc">{data.me.score}/{data.me.wickets}</span></li>}
        </ol>
      )}
    </main>
  )
}

function Reminders() {
  const [on, setOn] = useState(false)
  const [msg, setMsg] = useState('')
  const [ok] = useState(pushSupported())
  useEffect(() => { if (ok) pushEnabled().then(setOn).catch(() => {}) }, [ok])
  if (!ok) return null
  const toggle = async () => {
    setMsg('')
    try { if (on) { await disablePush(); setOn(false) } else { await enablePush(); setOn(true) } }
    catch (e) { setMsg(e.message) }
  }
  return (
    <>
      <button className="ghost" onClick={toggle}>{on ? '🔔 Streak reminders on' : '🔕 Remind me before my streak ends'}</button>
      {msg && <p className="warn">{msg}</p>}
    </>
  )
}
