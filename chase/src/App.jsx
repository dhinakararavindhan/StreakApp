import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SQUADS, SLOT_LABELS, TARGET, BALLS, BOWL_SLOTS, BOWL_LEVELS, bowlTarget, BOWL_MIN, BAT_LEVELS, batTarget } from './data.js'
import { hashStr, rng, todayKey } from './rng.js'
import { simulate, teamRatings, verdict, simulateBowl, simulateSuper, superOpponent, opponentFor, bowlRatings, bowlVerdict } from './sim.js'
import { load, liveStreak, recordDaily, recordPractice, recordVs, histKey, seenIntro, markIntroSeen, BADGES } from './storage.js'
import { shareCard } from './card.js'
import { fits, oversStr, makeSpins, getTheme, applyTheme } from './util.js'
import { conditionFor, modifierFor, squadsFor, pickAllowed, tagOf, TAG_LABEL, phaseBonus } from './rules.js'
import { Brief, Tactics, SuperDraft, SuperInnings, SuperResult, Weekly, Recap, ratingChips, Av } from './extras.jsx'
import { getVs, submitVs, submitScore, fetchBoard, getName, setName, pushSupported, pushEnabled, enablePush, disablePush } from './api.js'

export default function App() {
  const [screen, setScreen] = useState(() => (seenIntro() ? 'home' : 'howto'))
  const [kind, setKind] = useState('bat') // 'bat' | 'bowl' | 'super'
  const [level, setLevel] = useState(1) // level being played (batting / bowling)
  const [mode, setMode] = useState('daily')
  const [seedStr, setSeedStr] = useState('')
  const [xi, setXi] = useState(Array(11).fill(null))
  const [attack, setAttack] = useState(Array(5).fill(null))
  const [soPicks, setSoPicks] = useState(Array(4).fill(null))
  const [cap, setCap] = useState(-1)
  const [result, setResult] = useState(null)
  const [stats, setStats] = useState(load())
  const [vsInfo, setVsInfo] = useState(null)

  // open a friend's challenge link (?vs=CODE)
  useEffect(() => {
    const c = (new URLSearchParams(window.location.search).get('vs') || '').toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(c)) return
    getVs(c).then((info) => setVsInfo(info)).catch(() => setVsInfo({ code: c, missing: true })).finally(() => setScreen('vs'))
  }, [])
  const leaveVs = () => { try { window.history.replaceState(null, '', '/') } catch {}; setScreen('home') }
  const newCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('')

  const start = (m, k = 'bat', lv = 1, code) => {
    const key = m === 'daily' ? todayKey() : m === 'vs' ? 'vs-' + (code || newCode()) : String(Date.now())
    setLevel(lv); setKind(k); setMode(m); setSeedStr(key); setCap(-1)
    setXi(Array(11).fill(null)); setAttack(Array(5).fill(null)); setSoPicks(Array(4).fill(null)); setResult(null); setScreen('draft')
  }
  // draft finished -> tactics screen (captain, order)
  const toTactics = (picks) => {
    if (kind === 'bat') setXi(picks); else if (kind === 'bowl') setAttack(picks); else setSoPicks(picks)
    setScreen('tactics')
  }
  // tactics confirmed -> run the simulation (the server re-runs the exact same thing)
  const confirmTactics = (order, capIdx) => {
    const cond = conditionFor(seedStr)
    setCap(capIdx)
    if (kind === 'bat') {
      const rand = rng(hashStr(seedStr + order.map((p) => p.id).join('|')))
      setXi(order); setResult(simulate(order, rand, batTarget(level), { cap: capIdx, cond }))
    } else if (kind === 'bowl') {
      const rand = rng(hashStr(seedStr + 'bowl' + order.map((p) => p.id).join('|')))
      setAttack(order); setResult(simulateBowl(order, opponentFor(seedStr).players, rand, bowlTarget(level), { cap: capIdx, cond }))
    } else {
      const rand = rng(hashStr(seedStr + 'super' + order.map((p) => p.id).join('|')))
      setSoPicks(order); setResult(simulateSuper(order, superOpponent(seedStr), rand, { cap: capIdx, cond }))
    }
    setScreen('chase')
  }
  const done = () => {
    if (mode === 'vs') { setStats(recordVs()); setScreen('result'); return }
    const lv = kind === 'super' ? 1 : level
    setStats(mode === 'daily' ? recordDaily(kind, result.score, result.won, lv) : recordPractice(kind, result.score, result.won, lv))
    setScreen('result')
  }
  const home = () => setScreen('home')
  const picks = kind === 'bat' ? xi : kind === 'bowl' ? attack : soPicks
  const navOn = ['home', 'board', 'stats', 'recap'].includes(screen)

  return (
    <div className={'app' + (navOn ? ' has-nav' : '')}>
      {screen === 'home' && <Home stats={stats} onStart={start} onBoard={() => setScreen('board')} onStats={() => setScreen('stats')} onHelp={() => setScreen('howto')} onRecap={() => setScreen('recap')} />}
      {screen === 'howto' && <HowTo onClose={() => { markIntroSeen(); setScreen('home') }} />}
      {screen === 'stats' && <Stats stats={stats} onBack={home} />}
      {screen === 'recap' && <Recap onBack={home} />}
      {screen === 'vs' && <VsIntro info={vsInfo} onPlay={() => start('vs', vsInfo.kind, vsInfo.level, vsInfo.code)} onHome={leaveVs} />}
      {screen === 'board' && <Board onBack={home} initialKind={kind === 'super' ? 'bat' : kind} />}
      {screen === 'draft' && kind === 'bat' && <Draft key={seedStr} level={level} seedStr={seedStr} mode={mode} xi={xi} setXi={setXi} onDone={toTactics} onExit={home} />}
      {screen === 'draft' && kind === 'bowl' && <BowlDraft key={seedStr} level={level} seedStr={seedStr} mode={mode} attack={attack} setAttack={setAttack} onDone={toTactics} onExit={home} />}
      {screen === 'draft' && kind === 'super' && <SuperDraft key={seedStr} seedStr={seedStr} mode={mode} picks={soPicks} setPicks={setSoPicks} onDone={toTactics} onExit={home} />}
      {screen === 'tactics' && <Tactics key={seedStr + kind} kind={kind} picks={picks} seedStr={seedStr} onConfirm={confirmTactics} />}
      {screen === 'chase' && kind === 'bat' && <Chase xi={xi} result={result} onDone={done} />}
      {screen === 'chase' && kind === 'bowl' && <BowlInnings result={result} onDone={done} />}
      {screen === 'chase' && kind === 'super' && <SuperInnings result={result} onDone={done} />}
      {screen === 'result' && kind === 'bat' && <Result level={level} cap={cap} xi={xi} result={result} mode={mode} stats={stats} seedStr={seedStr} onHome={home} onPractice={() => start('practice', 'bat', level)} onBoard={() => setScreen('board')} />}
      {screen === 'result' && kind === 'bowl' && <BowlResult level={level} cap={cap} attack={attack} result={result} mode={mode} stats={stats} seedStr={seedStr} onHome={home} onPractice={() => start('practice', 'bowl', level)} onBoard={() => setScreen('board')} />}
      {navOn && (
        <div className="nav"><nav>
          {[['home', '🏠', 'Home'], ['board', '🏆', 'Boards'], ['stats', '📊', 'Stats'], ['recap', '📰', 'Recap']].map(([s, i, l]) => (
            <button key={s} className={screen === s ? 'on' : ''} onClick={() => setScreen(s)}><span>{i}</span>{l}</button>
          ))}
        </nav></div>
      )}
      {screen === 'result' && kind === 'super' && <SuperResult picks={soPicks} cap={cap} result={result} mode={mode} stats={stats} seedStr={seedStr} onHome={home} onPractice={() => start('practice', 'super')} />}
    </div>
  )
}

function Home({ stats, onStart, onBoard, onStats, onHelp, onRecap }) {
  const today = todayKey()
  const streak = liveStreak(stats)
  const batDone = stats.history[histKey('bat', today)]
  const bowlDone = stats.history[histKey('bowl', today)]
  const superDone = stats.history[histKey('super', today)]
  const opp = opponentFor(today)
  const unlocked = stats.bowlLevel || 1
  const [theme, setTheme] = useState(getTheme())
  const flip = () => { const t = theme === 'dark' ? 'light' : 'dark'; applyTheme(t); setTheme(t) }
  const batUnlocked = stats.batLevel || 1
  const [lv, setLv] = useState(unlocked)
  const [bl, setBl] = useState(batUnlocked)
  return (
    <main className="home">
      <div className="topbar"><button className="theme" onClick={flip} aria-label="Toggle theme">{theme === 'dark' ? '☀️' : '🌙'}</button></div>
      <div className="logo">300</div>
      <h1>Chase 300</h1>
      <p className="sub">Draft from iconic franchise T20 seasons. A new wheel every day.</p>
      <div className="stats">
        <div><b>🔥 {streak}</b><span>day streak</span></div>
        <div><b>🧊 {stats.freezes || 0}</b><span>streak freezes</span></div>
        <div><b>{stats.best || '–'}</b><span>best chase</span></div>
      </div>
      {stats.freezeUsedOn === today && <p className="line">🧊 A streak freeze saved your streak today.</p>}
      <div className="card" style={{ width: '100%', textAlign: 'left' }}>
        <b>Today's conditions</b>
        <Brief seedStr={today} />
      </div>

      <section className="mode">
        <h2>🏏 Batting challenge</h2>
        <p>Draft an XI and chase <b>{batTarget(bl)}</b> in 20 overs.</p>
        <LevelPicker levels={BAT_LEVELS} unlocked={batUnlocked} cleared={stats.batCleared || 0} value={bl} onChange={setBl} text={`Level ${bl} · chase ${batTarget(bl)}`} />
        {batDone ? <div className="done">Today: <b>{batDone.score}</b>{batDone.won ? ' 🏆' : ''}</div>
          : <button className="primary" onClick={() => onStart('daily', 'bat', bl)}>Play today's chase</button>}
        <button className="link" onClick={() => onStart('practice', 'bat', bl)}>Practice</button>
      </section>

      <section className="mode">
        <h2>🎯 Bowling challenge</h2>
        <p>Draft 5 bowlers and hold <b>{opp.name} {opp.year}</b> under <b>{bowlTarget(lv)}</b>.</p>
        <LevelPicker levels={BOWL_LEVELS} unlocked={unlocked} cleared={stats.bowlCleared || 0} value={lv} onChange={setLv} text={`Level ${lv} · under ${bowlTarget(lv)} runs`} />
        {bowlDone ? <div className="done">Today: <b>{bowlDone.score}</b>{bowlDone.won ? ' 🏆' : ''}</div>
          : <button className="primary" onClick={() => onStart('daily', 'bowl', lv)}>Play today's defence</button>}
        <button className="link" onClick={() => onStart('practice', 'bowl', lv)}>Practice</button>
      </section>

      <section className="mode">
        <h2>⚔️ Challenge a friend</h2>
        <p>Same wheel, same opponent. Play, then send your link. Whoever scores better wins.</p>
        <div className="row">
          <button className="ghost" onClick={() => onStart('vs', 'bat', bl)}>🏏 Batting (L{bl})</button>
          <button className="ghost" onClick={() => onStart('vs', 'bowl', lv)}>🎯 Bowling (L{lv})</button>
        </div>
      </section>

      <section className="mode">
        <h2>⚡ Super Over</h2>
        <p>Draft 3 hitters and 1 bowler. Bat one over, then defend it. Fast, and the pitch matters.</p>
        {superDone ? <div className="done">Today: <b>{superDone.score}</b>{superDone.won ? ' 🏆' : ''}</div>
          : <button className="primary" onClick={() => onStart('daily', 'super')}>Play today's Super Over</button>}
        <button className="link" onClick={() => onStart('practice', 'super')}>Practice</button>
      </section>

      <button className="link" onClick={onHelp}>❓ How to play</button>
      <Reminders />
      <p className="fine">Fan-made, free and unofficial. Ratings are approximate. Not affiliated with or endorsed by any league, board, team or player. Team and player names are used for identification only. <a href="/privacy.html">Privacy</a></p>
    </main>
  )
}

function LevelPicker({ levels, unlocked, cleared, value, onChange, text }) {
  return (
    <>
      <div className="levels" style={{ gridTemplateColumns: `repeat(${levels > 10 ? 7 : levels}, 1fr)` }}>
        {Array.from({ length: levels }, (_, i) => i + 1).map((n) => (
          <button key={n} disabled={n > unlocked} className={(n === value ? 'on ' : '') + (n <= cleared ? 'cleared' : '')} onClick={() => onChange(n)}>
            {n <= cleared ? '✓' : n > unlocked ? '🔒' : n}
          </button>
        ))}
      </div>
      <small className="lvl">{text}{value === unlocked && unlocked > cleared ? ' · win to unlock the next' : ''}</small>
    </>
  )
}

function Draft({ level, seedStr, mode, xi, setXi, onDone, onExit }) {
  const mod = useMemo(() => modifierFor(seedStr), [seedStr])
  const spins = useMemo(() => makeSpins(hashStr('spin' + seedStr), squadsFor(mod)), [seedStr, mod])
  const [spinIdx, setSpinIdx] = useState(0)
  const [rerolls, setRerolls] = useState(1)
  const [rolling, setRolling] = useState(true)
  const [ticker, setTicker] = useState('')
  const [sel, setSel] = useState(null)
  const picked = xi.filter(Boolean).length
  const usedNames = new Set(xi.filter(Boolean).map((p) => p.name)) // same real player can't be picked twice
  const squad = spins[spinIdx % spins.length]
  const freeSlots = xi.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0)
  const chosen = xi.filter(Boolean)
  const eligible = (p) => !usedNames.has(p.name) && freeSlots.some((s) => fits(p, s)) && pickAllowed(mod, p, chosen)
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
        <b>{mode === 'daily' ? 'Daily draft' : mode === 'vs' ? 'Challenge' : 'Practice'} · L{level}</b>
        <span>{picked}/11</span>
      </header>

      <p className="hint">Level {level}: chase <b>{batTarget(level)}</b> in 20 overs</p>
      <Brief seedStr={seedStr} compact />
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
                      <Av p={p} />
                      <span className="pn">{p.name}{p.k ? ' 🧤' : ''}</span>
                      <span className="pp">{p.lo === p.hi ? `#${p.lo}` : `#${p.lo}–${p.hi}`}</span>
                      <span className="pr"><i>B</i>{p.bat} <i>P</i>{p.pow} <i>W</i>{p.bwl}</span>
                      <span className="chips">{ratingChips(p, conditionFor(seedStr), 'bat')}</span>
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
        <button className="primary" onClick={() => onDone(xi)}>Next: tactics</button>
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
  const rrr = balls < BALLS ? ((result.target - score) / ((BALLS - balls) / 6)).toFixed(1) : '–'
  const notable = shown.filter((e) => e.wicket || e.runs >= 4).slice(-30)

  return (
    <main className="chase">
      <div className="target">Target {result.target}</div>
      <div className="big">{score}<small>/{wk}</small></div>
      <div className="line">{oversStr(balls)} ov · Req {rrr}/ov · {Math.max(0, result.target - score)} to win</div>
      <div className="bar big"><div style={{ width: `${Math.min(100, (score / result.target) * 100)}%` }} /></div>
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

function Result({ level, cap, xi, result, mode, stats, seedStr, onHome, onPractice, onBoard }) {
  const [copied, setCopied] = useState(false)
  const [name, setNameState] = useState(getName())
  const [sub, setSub] = useState(mode === 'daily' ? 'ask' : 'none') // ask | sending | done | error
  const [rank, setRank] = useState(null)
  const submit = async () => {
    setName(name.trim()); setSub('sending')
    try {
      const r = await submitScore('bat', name.trim() || 'Anon', seedStr, xi, level, cap)
      setRank(r.me); setSub('done')
    } catch (e) { setSub(e.status === 409 ? 'done' : 'error') }
  }
  const streak = liveStreak(stats)
  const text = [
    `Chase 300 ${mode === 'daily' ? seedStr : '(practice)'}`,
    `L${level} (${result.target}): ${result.score}/${result.wickets} in ${oversStr(result.ballsUsed)} ov ${result.won ? '🏆' : ''}`,
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
      <p className="verdict">{verdict(result)}</p>
      {result.won && <p className="unlock">{level >= BAT_LEVELS ? `🏆 All ${BAT_LEVELS} levels cleared!` : `🔓 Level ${level} cleared — level ${level + 1} unlocked (chase ${batTarget(level + 1)})`}</p>}
      <p className="line">Level {level} · {oversStr(result.ballsUsed)} overs{mode === 'daily' ? ` · 🔥 ${streak}-day streak` : ''}</p>
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
      {mode === 'vs' && <VsPanel kind="bat" seedStr={seedStr} level={level} cap={cap} picks={xi} />}
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
      <button className="ghost" onClick={() => shareCard({ mode: 'Batting', level, score: result.score, wickets: result.wickets, won: result.won, line: verdict(result), names: xi.map((p) => p.name), footer: window.location.host })}>🖼️ Share as image</button>
      <button className="ghost" onClick={onPractice}>Practice again</button>
      <button className="link" onClick={onHome}>Home</button>
    </main>
  )
}

function Board({ onBack, initialKind = 'bat' }) {
  const [kind, setKind] = useState(initialKind)
  const [scope, setScope] = useState('today')
  const [data, setData] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    setData(null); setErr(false)
    if (kind === 'week') return
    fetchBoard(kind, scope, todayKey()).then(setData).catch(() => setErr(true))
  }, [kind, scope])
  return (
    <main className="board">
      <header><button className="link" onClick={onBack}>← Back</button><b>Leaderboards</b><span /></header>
      <div className="tabs">
        {[['bat', '🏏 Batting'], ['bowl', '🎯 Bowling'], ['week', '🗓️ Weekly']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {kind === 'week' && <Weekly />}
      {kind !== 'week' && <div className="tabs">
        {['today', 'all'].map((t) => <button key={t} className={scope === t ? 'on' : ''} onClick={() => setScope(t)}>{t === 'today' ? 'Today' : 'All-time'}</button>)}
      </div>}
      {kind !== 'week' && <p className="hint">{kind === 'bat' ? 'Ranked by level, then runs. Higher level is harder.' : 'Fewest runs conceded wins.'}</p>}
      {kind !== 'week' && err && <p className="warn">Couldn't load the leaderboard.</p>}
      {kind !== 'week' && !data && !err && <p className="line">Loading…</p>}
      {kind !== 'week' && data && data.top.length === 0 && <p className="line">No scores yet. Be the first!</p>}
      {kind !== 'week' && data && (
        <ol className="rows">
          {data.top.map((r) => (
            <li key={r.rank} className={r.you ? 'you' : ''}>
              <span className="rk">{r.rank}</span><span className="nm">{r.name}{r.won ? ' 🏆' : ''}</span>
              {kind === 'bat' && <span className="lv">L{r.level}</span>}
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

function BowlDraft({ level, seedStr, mode, attack, setAttack, onDone, onExit }) {
  const mod = useMemo(() => modifierFor(seedStr), [seedStr])
  const spins = useMemo(() => makeSpins(hashStr('bspin' + seedStr), squadsFor(mod)), [seedStr, mod])
  const opp = useMemo(() => opponentFor(seedStr), [seedStr])
  const [spinIdx, setSpinIdx] = useState(0)
  const [rerolls, setRerolls] = useState(1)
  const [rolling, setRolling] = useState(true)
  const [ticker, setTicker] = useState('')
  const [sel, setSel] = useState(null)
  const picked = attack.filter(Boolean).length
  const used = new Set(attack.filter(Boolean).map((p) => p.name))
  const squad = spins[spinIdx % spins.length]
  const chosen = attack.filter(Boolean)
  const eligible = (p) => p.bwl >= BOWL_MIN && !used.has(p.name) && pickAllowed(mod, p, chosen)
  const hasOption = squad.players.some(eligible)

  useEffect(() => {
    if (picked >= 5) return
    setRolling(true); setSel(null); window.scrollTo(0, 0)
    let n = 0
    const t = setInterval(() => {
      n++
      setTicker(SQUADS[Math.floor(Math.random() * SQUADS.length)].short + ' ' + (2008 + Math.floor(Math.random() * 17)))
      if (n > 12) { clearInterval(t); setRolling(false) }
    }, 70)
    return () => clearInterval(t)
  }, [spinIdx])
  useEffect(() => { if (!rolling && picked < 5 && !hasOption) setSpinIdx((i) => i + 1) }, [rolling, hasOption, picked])

  const place = (slot) => {
    const next = attack.slice(); next[slot] = sel
    setAttack(next); setSel(null); setSpinIdx((i) => i + 1)
  }
  const r = bowlRatings(attack)
  const oppPow = Math.round(opp.players.reduce((s, p) => s + p.pow, 0) / opp.players.length)

  return (
    <main className="draft">
      <header>
        <button className="link" onClick={onExit}>✕</button>
        <b>{mode === 'daily' ? 'Daily bowling' : mode === 'vs' ? 'Challenge · bowling' : 'Practice bowling'} · L{level}</b>
        <span>{picked}/5</span>
      </header>
      <div className="card opp">
        <small>Opponent</small>
        <b>{opp.name} {opp.year}</b>
        <span>Batting power {oppPow} · Level {level}: hold them under {bowlTarget(level)}</span>
      </div>
      <Brief seedStr={seedStr} compact />
      <div className="ratings"><Meter label="ATTACK" v={r.bwl} /></div>

      {picked < 5 ? (
        <>
          <div className={'wheel' + (rolling ? ' spinning' : '')}>
            {rolling ? ticker : <>{squad.name} <small>{squad.year}</small></>}
          </div>
          {!rolling && (
            <>
              <div className="players">
                {squad.players.filter((p) => p.bwl >= BOWL_MIN).map((p) => {
                  const ok = eligible(p)
                  return (
                    <button key={p.name} disabled={!ok} className={'player' + (sel === p ? ' sel' : '')} onClick={() => setSel(p)}>
                      <Av p={p} />
                      <span className="pn">{p.name}</span>
                      <span className="pr"><i>W</i>{p.bwl} <i>B</i>{p.bat}</span>
                      <span className="chips">{ratingChips(p, conditionFor(seedStr), 'bowl')}</span>
                    </button>
                  )
                })}
              </div>
              <p className="hint">{sel ? `Pick a slot for ${sel.name}` : 'Pick a bowler — no undos.'}</p>
              <button className="ghost small" disabled={rerolls === 0 || !!sel} onClick={() => { setRerolls(0); setSpinIdx((i) => i + 1) }}>Re-roll wheel ({rerolls})</button>
            </>
          )}
        </>
      ) : (
        <button className="primary" onClick={() => onDone(attack)}>Next: tactics</button>
      )}

      <ol className="slots">
        {attack.map((p, i) => {
          const can = sel && !p
          return (
            <li key={i} className={(can ? 'can ' : '') + (p ? 'filled' : '')} onClick={() => can && place(i)}>
              <span className="sn">{i + 1}</span>
              <span className="sl">{p ? <>{p.name} <small className="tm">{p.team} {String(p.year).slice(2)}</small></> : BOWL_SLOTS[i]}{!p && sel && phaseBonus(i, sel) !== 0 ? <small className="tm"> {phaseBonus(i, sel) > 0 ? `+${phaseBonus(i, sel)} fit` : `${phaseBonus(i, sel)} fit`}</small> : null}</span>
              {p && <span className="pr"><i>W</i>{p.bwl}</span>}
            </li>
          )
        })}
      </ol>
    </main>
  )
}

function BowlInnings({ result, onDone }) {
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
  const balls = cur ? cur.ball : 0
  const log = shown.filter((e) => e.wicket || e.runs >= 4).slice(-30)
  return (
    <main className="chase">
      <div className="target">{result.opp.name} {result.opp.year} batting · hold under {result.target}</div>
      <div className={'big' + (score >= result.target ? ' over' : '')}>{score}<small>/{cur ? cur.wickets : 0}</small></div>
      <div className="line">{oversStr(balls)} ov{cur ? ` · ${cur.bowler} bowling` : ''}</div>
      <div className="bar big"><div style={{ width: `${Math.min(100, (score / result.target) * 100)}%`, background: score >= result.target ? 'var(--red)' : undefined }} /></div>
      <ul className="log" ref={logRef}>
        {log.map((e) => (
          <li key={e.ball} className={e.wicket ? 'wk' : e.runs === 6 ? 'w' : 'w'}>
            <b>{oversStr(e.ball - 1)}</b> {e.wicket ? `WICKET! ${e.bowler} gets ${e.batter}.` : e.runs === 6 ? `SIX off ${e.bowler}.` : `FOUR off ${e.bowler}.`}
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

function BowlResult({ level, cap, attack, result, mode, stats, seedStr, onHome, onPractice, onBoard }) {
  const [copied, setCopied] = useState(false)
  const [name, setNameState] = useState(getName())
  const [sub, setSub] = useState(mode === 'daily' ? 'ask' : 'none')
  const [rank, setRank] = useState(null)
  const streak = liveStreak(stats)
  const submit = async () => {
    setName(name.trim()); setSub('sending')
    try { const r = await submitScore('bowl', name.trim() || 'Anon', seedStr, attack, level, cap); setRank(r.me); setSub('done') }
    catch (e) { setSub(e.status === 409 ? 'done' : 'error') }
  }
  const text = [
    `Chase 300 · Bowling ${mode === 'daily' ? seedStr : '(practice)'}`,
    `L${level} (<${result.target}) vs ${result.opp.name} ${result.opp.year}: ${result.score}/${result.wickets} in ${oversStr(result.ballsUsed)} ov ${result.won ? '🏆' : ''}`,
    attack.map((p) => p.name).join(' · '),
    mode === 'daily' ? `🔥 ${streak}-day streak` : '',
  ].filter(Boolean).join('\n')
  const share = async () => {
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); setCopied(true) } } catch {}
  }
  return (
    <main className="result">
      <div className={'big' + (result.won ? ' win' : '')}>{result.score}<small>/{result.wickets}</small></div>
      <p className="verdict">{bowlVerdict(result)}</p>
      {result.won && <p className="unlock">{level >= BOWL_LEVELS ? '🏆 All 10 levels cleared!' : `🔓 Level ${level} cleared — level ${level + 1} unlocked (under ${bowlTarget(level + 1)})`}</p>}
      <p className="line">Level {level} · {result.opp.name} {result.opp.year} · {oversStr(result.ballsUsed)} overs{mode === 'daily' ? ` · 🔥 ${streak}-day streak` : ''}</p>
      <table className="card-table">
        <thead><tr><th>Bowler</th><th>O</th><th>R</th><th>W</th></tr></thead>
        <tbody>
          {result.figs.map((f, i) => (
            <tr key={i}><td>{f.name}</td><td>{oversStr(f.balls)}</td><td>{f.runs}</td><td>{f.wkts}</td></tr>
          ))}
        </tbody>
      </table>
      {mode === 'vs' && <VsPanel kind="bowl" seedStr={seedStr} level={level} cap={cap} picks={attack} />}
      {sub === 'ask' && (
        <div className="card submit">
          <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setNameState(e.target.value)} />
          <button className="primary" onClick={submit}>Post to leaderboard</button>
        </div>
      )}
      {sub === 'sending' && <p className="line">Posting…</p>}
      {sub === 'error' && <p className="warn">Couldn't reach the leaderboard. <button className="link" onClick={submit}>Retry</button></p>}
      {sub === 'done' && <button className="ghost" onClick={onBoard}>{rank ? `🏆 You're #${rank.rank} today — view leaderboard` : '🏆 View leaderboard'}</button>}
      <button className="primary" onClick={share}>{copied ? 'Copied!' : 'Share result'}</button>
      <button className="ghost" onClick={() => shareCard({ mode: 'Bowling', level, score: result.score, wickets: result.wickets, won: result.won, line: bowlVerdict(result), names: attack.map((p) => p.name), footer: window.location.host })}>🖼️ Share as image</button>
      <button className="ghost" onClick={onPractice}>Practice again</button>
      <button className="link" onClick={onHome}>Home</button>
    </main>
  )
}

function VsIntro({ info, onPlay, onHome }) {
  if (!info) return <main className="home"><p className="line">Loading challenge…</p></main>
  if (info.missing) {
    return (
      <main className="home">
        <h1>Challenge not found</h1>
        <p className="sub">This link may have expired (challenges last 14 days).</p>
        <button className="primary" onClick={onHome}>Home</button>
      </main>
    )
  }
  const bowl = info.kind === 'bowl'
  const me = info.entries.find((e) => e.you)
  return (
    <main className="home">
      <div className="logo">⚔️</div>
      <h1>You've been challenged</h1>
      <p className="sub">{bowl
        ? <>Draft 5 bowlers and hold <b>{opponentFor('vs-' + info.code).name} {opponentFor('vs-' + info.code).year}</b> under <b>{info.target}</b>.</>
        : <>Draft an XI and chase <b>{info.target}</b> in 20 overs.</>} Same wheel as your friend.</p>
      <Brief seedStr={'vs-' + info.code} />
      <VsTable entries={info.entries} bowl={bowl} />
      {me ? <p className="line">You've already played this challenge.</p> : <button className="primary" onClick={onPlay}>Accept the challenge</button>}
      <button className="link" onClick={onHome}>Home</button>
    </main>
  )
}

function VsTable({ entries, bowl }) {
  return (
    <ol className="rows" style={{ width: '100%' }}>
      {entries.map((r) => (
        <li key={r.rank} className={r.you ? 'you' : ''}>
          <span className="rk">{r.rank}</span><span className="nm">{r.name}{r.won ? ' 🏆' : ''}</span>
          <span className="sc">{r.score}/{r.wickets}</span>
        </li>
      ))}
    </ol>
  )
}

function VsPanel({ kind, seedStr, level, cap, picks }) {
  const code = seedStr.slice(3)
  const [name, setNameState] = useState(getName())
  const [phase, setPhase] = useState('ask') // ask | sending | done | error
  const [data, setData] = useState(null)
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/?vs=${code}`
  const submit = async () => {
    setName(name.trim()); setPhase('sending')
    try { setData(await submitVs(code, kind, name.trim() || 'Anon', picks, level, cap)); setPhase('done') }
    catch (e) { setPhase(e.status === 409 ? 'done' : 'error'); if (e.status === 409) getVs(code).then(setData).catch(() => {}) }
  }
  const share = async () => {
    const text = `⚔️ I challenge you on Chase 300 (${kind === 'bowl' ? 'bowling' : 'batting'}, level ${level}). Beat my score:`
    try { if (navigator.share) await navigator.share({ text, url: link }); else { await navigator.clipboard.writeText(`${text} ${link}`); setCopied(true) } } catch {}
  }
  return (
    <div className="card submit">
      <b>⚔️ Friend challenge</b>
      {phase === 'ask' && <>
        <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setNameState(e.target.value)} />
        <button className="primary" onClick={submit}>Submit to challenge</button>
      </>}
      {phase === 'sending' && <p className="line">Submitting…</p>}
      {phase === 'error' && <p className="warn">Couldn't reach the server. <button className="link" onClick={submit}>Retry</button></p>}
      {phase === 'done' && data && <>
        <VsTable entries={data.entries} bowl={kind === 'bowl'} />
        <button className="primary" onClick={share}>{copied ? 'Link copied!' : 'Send challenge link'}</button>
        <small className="lvl">Anyone with the link plays the same wheel{kind === 'bowl' ? ' and opponent' : ''}.</small>
      </>}
    </div>
  )
}

function HowTo({ onClose }) {
  const steps = [
    ['🎡', 'Spin the wheel', 'Every spin shows a famous franchise T20 squad from leagues around the world.'],
    ['🧢', 'Draft your side', 'Pick one player per spin, no undos. In batting, each player must bat where he actually batted. You get one re-roll.'],
    ['🏏', 'Batting challenge', 'Draft an XI and chase the target in 20 overs. Level 1 is 200. Level 13 is 320: almost impossible.'],
    ['🎯', 'Bowling challenge', 'Draft 5 bowlers and hold the opposition under the target. Level 1 is under 60, level 10 is under 15.'],
    ['⬆️', 'Climb the levels', 'Win a level to unlock the next. A new wheel every day, and playing daily builds your streak 🔥.'],
    ['🌦️', 'Read the conditions', 'Every day has a pitch (spinning, green, flat, dew, slow) and a draft twist. Pick players who suit them.'],
    ['⭐', 'Tactics', 'Choose a captain for a rating boost. Swap batting order a little, and put bowlers in the phase they suit.'],
    ['⚡', 'Super Over', 'Draft 3 hitters and a bowler, bat one over, then defend it. Quick, and every pick matters.'],
    ['🧊', 'Streak freeze', 'Win a daily game to earn a freeze that saves your streak if you miss a day.'],
    ['⚔️', 'Challenge a friend', 'Play, then send your link. They get the same wheel. Higher score wins.'],
  ]
  return (
    <main className="howto">
      <h1>How to play</h1>
      <ol>
        {steps.map(([icon, title, text]) => (
          <li key={title}><span className="ic">{icon}</span><div><b>{title}</b><p>{text}</p></div></li>
        ))}
      </ol>
      <p className="fine">Ratings are fan estimates, and some line-ups may not be exact.</p>
      <button className="primary" onClick={onClose}>Let's play</button>
    </main>
  )
}

function Stats({ stats, onBack }) {
  const today = new Date()
  const key = (d) => todayKey(d)
  const played = (k) => stats.history[k] || stats.history['bowl:' + k]
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (27 - i))
    const k = key(d)
    const hit = [stats.history[k], stats.history['bowl:' + k], stats.history['super:' + k]].filter(Boolean)
    return { k, n: d.getDate(), played: hit.length > 0, won: hit.some((h) => h.won), today: i === 27 }
  })
  const recent = Object.entries(stats.history)
    .map(([k, v]) => ({ kind: k.startsWith('bowl:') ? 'bowl' : k.startsWith('super:') ? 'super' : 'bat', day: k.replace(/^(bowl|super):/, ''), ...v }))
    .sort((x, y) => (y.day + y.kind).localeCompare(x.day + x.kind)).slice(0, 8)
  const earned = BADGES.filter((b) => b.test(stats))
  return (
    <main className="stats-screen">
      <header><button className="link" onClick={onBack}>← Back</button><b>Stats &amp; badges</b><span /></header>
      <div className="stats">
        <div><b>🔥 {liveStreak(stats)}</b><span>current streak</span></div>
        <div><b>{Math.max(stats.bestStreak || 0, liveStreak(stats))}</b><span>best streak</span></div>
        <div><b>🧊 {stats.freezes || 0}</b><span>streak freezes</span></div>
      </div>
      <div className="stats">
        <div><b>{stats.wins}</b><span>levels won</span></div>
        <div><b>{stats.batCleared || 0}/{BAT_LEVELS}</b><span>batting cleared</span></div>
        <div><b>{stats.bowlCleared || 0}/{BOWL_LEVELS}</b><span>bowling cleared</span></div>
      </div>
      <h2>Last 28 days</h2>
      <div className="cal">
        {days.map((d) => <span key={d.k} className={(d.played ? (d.won ? 'won ' : 'on ') : '') + (d.today ? 'today' : '')} title={d.k}>{d.n}</span>)}
      </div>
      <h2>Badges <small>{earned.length}/{BADGES.length}</small></h2>
      <div className="badges">
        {BADGES.map((b) => {
          const ok = b.test(stats)
          return <div key={b.id} className={'badge' + (ok ? ' got' : '')}><span>{ok ? b.icon : '🔒'}</span><b>{b.name}</b><small>{b.desc}</small></div>
        })}
      </div>
      <h2>Recent daily games</h2>
      {recent.length === 0 && <p className="line">Nothing yet. Play today's challenge!</p>}
      <ul className="recent">
        {recent.map((r) => (
          <li key={r.day + r.kind}><span>{r.day}</span><span>{r.kind === 'bowl' ? '🎯' : r.kind === 'super' ? '⚡' : '🏏'}{r.kind === 'super' ? '' : ` L${r.level || 1}`}</span><b>{r.score}{r.won ? ' 🏆' : ''}</b></li>
        ))}
      </ul>
    </main>
  )
}
