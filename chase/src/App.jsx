import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SQUADS, PLAYABLE, isPlayable, SLOT_LABELS, TARGET, BALLS, BOWL_SLOTS, BOWL_LEVELS, bowlTarget, BOWL_MIN, BAT_LEVELS, batTarget, OPEN_TARGET } from './data.js'
import { hashStr, rng, todayKey } from './rng.js'
import { simulate, teamRatings, verdict, simulateBowl, simulateSuper, superOpponent, opponentFor, bowlRatings, bowlVerdict, simulateFull, autoAttack } from './sim.js'
import { load, liveStreak, recordDaily, recordPractice, recordVs, histKey, seenIntro, markIntroSeen, BADGES } from './storage.js'
import { shareCard } from './card.js'
import Privacy from './privacy.jsx'
import Backup from './backup.jsx'
import { MatchHistory, MatchView } from './history.jsx'
import { addMatch, loadMatches, compactEvents, loadResume, saveResume, clearResume } from './matches.js'
import { autoBackup, getCode } from './cloud.js'
import { track, analyticsOn, isMinor, getProfile, nudgeDismissed, dismissNudge } from './analytics.js'
import { BatCard, BowlCard } from './scorecard.jsx'
import { fits, oversStr, makeSpins, getTheme, applyTheme } from './util.js'
import { conditionFor, modifierFor, squadsFor, pickAllowed, tagOf, TAG_LABEL, phaseBonus } from './rules.js'
import { Brief, Tactics, SuperDraft, SuperInnings, SuperResult, Weekly, Recap, ratingChips, Av, PlaceSheet, BriefPills, Progress, WheelRow, MyList, AttackPicker, InningsBreak, FullResult } from './extras.jsx'
import { fetchHall, reportMatch, getVs, submitVs, submitScore, fetchBoard, getName, setName, pushSupported, pushEnabled, enablePush, disablePush } from './api.js'

const BYID = new Map(SQUADS.flatMap((s) => s.players.map((p) => [p.id, p])))

// an unfinished match saved on this device (so closing the app doesn't lose it)
function readResume() {
  const r = loadResume()
  if (!r || r.v !== 1 || !['draft', 'tactics', 'attack', 'chase'].includes(r.screen) || !['bat', 'bowl', 'super', 'full'].includes(r.kind)) return null
  if (r.mode === 'daily' && r.seedStr !== todayKey()) { clearResume(); return null } // yesterday's daily is gone
  const ids = [...(r.xi || []), ...(r.attack || []), ...(r.so || []), ...(r.fa || []), r.ip].filter(Boolean)
  if (!ids.every((id) => BYID.has(id) && isPlayable(BYID.get(id)))) { clearResume(); return null } // also drops saves with squads that are switched off
  return r
}

// run a match exactly as the server will (same seed, same inputs)
const impactPref = () => { try { return localStorage.getItem('chase300.impact') === '1' } catch { return false } }
const setImpactPref = (v) => { try { localStorage.setItem('chase300.impact', v ? '1' : '0') } catch {} }

function simulateFor({ kind, order, capIdx, seedStr, level, vs, attack, first, impact }) {
  const cond = conditionFor(seedStr)
  if (kind === 'bat') return simulate(order, rng(hashStr(seedStr + order.map((p) => p.id).join('|'))), vs ? vs.target : batTarget(level), { cap: capIdx, cond })
  if (kind === 'full') { const res = simulateFull(order, attack, { seedStr, cap: capIdx, first, cond, impact }); return { ...res, score: res.myScore, wickets: res.myBatting.wickets, ballsUsed: res.myBatting.ballsUsed, target: 0 } }
  if (kind === 'bowl') return { ...simulateBowl(order, opponentFor(seedStr).players, rng(hashStr(seedStr + 'bowl' + order.map((p) => p.id).join('|'))), vs ? vs.target : bowlTarget(level), { cap: capIdx, cond }), opp: opponentFor(seedStr) }
  return simulateSuper(order, superOpponent(seedStr), rng(hashStr(seedStr + 'super' + order.map((p) => p.id).join('|'))), { cap: capIdx, cond })
}

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
  const [vs, setVs] = useState(null) // head-to-head: { role: 'first'|'follower', target, firstScore, creator }
  const [saved, setSaved] = useState(readResume)   // unfinished match on this device
  const [draftMeta, setDraftMeta] = useState(null) // wheel position while drafting
  const [initMeta, setInitMeta] = useState(null)   // wheel position to resume from
  const [viewMatch, setViewMatch] = useState(null)
  const [first, setFirst] = useState('bat')        // full match: bat or bowl first
  const [fullAttack, setFullAttack] = useState([]) // full match: the five bowlers
  const [fullRes, setFullRes] = useState(null)
  const [stage, setStage] = useState('inn1')        // full match: inn1 | break | inn2
  const [impactOn, setImpactOn] = useState(false)    // full match: draft a 12th Impact Player
  const [impactP, setImpactP] = useState(null)       // the drafted Impact Player
  const [impactOut, setImpactOut] = useState(-1)     // XI slot he replaces from the 2nd innings (-1 = not used)

  // keep the match in progress saved after every pick / step
  useEffect(() => {
    if (!['draft', 'tactics', 'attack', 'chase'].includes(screen)) return
    const ids = (arr) => arr.map((p) => (p ? p.id : null))
    saveResume({ v: 1, t: Date.now(), screen, kind, mode, seedStr, level, vs, xi: ids(xi), attack: ids(attack), so: ids(soPicks), fa: ids(fullAttack), first, stage, cap, meta: draftMeta, io: impactOn, ip: impactP ? impactP.id : null, iout: impactOut })
  }, [screen, kind, mode, seedStr, level, vs, xi, attack, soPicks, fullAttack, first, stage, cap, draftMeta, impactOn, impactP, impactOut])

  // anonymous usage stats (off for opt-outs and under-18s)
  useEffect(() => {
    let first = 0
    try { if (!localStorage.getItem('chase300.visited')) { first = 1; localStorage.setItem('chase300.visited', '1') } } catch {}
    track('session_start', { first, theme: getTheme() })
    const onInstall = () => track('install')
    window.addEventListener('appinstalled', onInstall)
    return () => window.removeEventListener('appinstalled', onInstall)
  }, [])

  // open a friend's challenge link (?vs=CODE)
  useEffect(() => {
    const c = (new URLSearchParams(window.location.search).get('vs') || '').toUpperCase()
    if (!/^[A-Z0-9]{6}$/.test(c)) return
    getVs(c).then((info) => setVsInfo(info)).catch(() => setVsInfo({ code: c, missing: true })).finally(() => setScreen('vs'))
  }, [])
  const leaveVs = () => { try { window.history.replaceState(null, '', '/') } catch {}; setScreen('home') }
  const newCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('')

  const start = (m, k = 'bat', lv = 1, code, info) => {
    const imp = k === 'full' && impactPref()
    const key = m === 'daily' ? todayKey() : m === 'vs' ? 'vs-' + (code || newCode()) : String(Date.now())
    track('game_start', { kind: k, mode: m, level: k === 'super' || k === 'full' || m === 'vs' ? 0 : lv, ...(imp ? { impact: 1 } : {}) })
    setVs(m === 'vs' ? (code ? { role: 'follower', target: info.target, firstScore: info.firstScore, creator: info.creator } : { role: 'first', target: OPEN_TARGET }) : null)
    setSaved(null); setDraftMeta(null); setInitMeta(null); setFirst('bat'); setFullAttack([]); setFullRes(null); setStage('inn1'); setImpactOn(imp); setImpactP(null); setImpactOut(-1)
    setLevel(lv); setKind(k); setMode(m); setSeedStr(key); setCap(-1)
    setXi(Array(11).fill(null)); setAttack(Array(5).fill(null)); setSoPicks(Array(4).fill(null)); setResult(null); setScreen('draft')
  }
  // draft finished -> tactics screen (captain, order)
  const toTactics = (picks) => {
    if (kind === 'bat') setXi(picks); else if (kind === 'bowl') setAttack(picks); else setSoPicks(picks)
    setScreen('tactics')
  }
  // tactics confirmed -> run the simulation (the server re-runs the exact same thing)
  const confirmTactics = (order, capIdx, firstPick) => {
    setCap(capIdx)
    if (kind === 'full') { setXi(order); setFirst(firstPick || 'bat'); setFullAttack(autoAttack(order)); setScreen('attack'); return }
    if (kind === 'bat') setXi(order); else if (kind === 'bowl') setAttack(order); else setSoPicks(order)
    setResult(simulateFor({ kind, order, capIdx, seedStr, level, vs }))
    setScreen('chase')
  }
  // full match: bowlers chosen -> play the whole match
  const confirmAttack = (attackPicks, out = -1) => {
    setFullAttack(attackPicks); setImpactOut(out)
    const sim = simulateFor({ kind: 'full', order: xi, capIdx: cap, seedStr, level: 1, vs: null, attack: attackPicks, first, impact: impactP && out >= 0 ? { p: impactP, out } : null })
    setFullRes(sim); setResult(sim)
    setStage('inn1'); setScreen('chase')
  }
  // pick up an unfinished match
  const continueMatch = () => {
    const r = saved; if (!r) return
    const mk = (ids) => (ids || []).map((id) => (id ? BYID.get(id) || null : null))
    const xi2 = mk(r.xi), at2 = mk(r.attack), so2 = mk(r.so)
    setKind(r.kind); setMode(r.mode); setSeedStr(r.seedStr); setLevel(r.level); setVs(r.vs || null); setCap(r.cap ?? -1)
    const fa2 = mk(r.fa); setFirst(r.first || 'bat'); setFullAttack(fa2); setStage(r.stage || 'inn1'); setFullRes(null)
    setImpactOn(!!r.io); setImpactP(r.ip ? BYID.get(r.ip) || null : null); setImpactOut(r.iout ?? -1)
    setXi(xi2.length ? xi2 : Array(11).fill(null)); setAttack(at2.length ? at2 : Array(5).fill(null)); setSoPicks(so2.length ? so2 : Array(4).fill(null))
    setInitMeta(r.meta || null); setDraftMeta(r.meta || null)
    if (r.screen === 'chase') {
      const order = r.kind === 'bat' || r.kind === 'full' ? xi2 : r.kind === 'bowl' ? at2 : so2
      const sim = simulateFor({ kind: r.kind, order, capIdx: r.cap, seedStr: r.seedStr, level: r.level, vs: r.vs || null, attack: fa2, first: r.first || 'bat', impact: r.ip && (r.iout ?? -1) >= 0 ? { p: BYID.get(r.ip), out: r.iout } : null })
      if (r.kind === 'full') { setFullRes(sim); setResult(sim) } else setResult(sim)
      setScreen('chase')
    }
    else { setResult(null); setScreen(r.screen) }
    track('game_start', { kind: r.kind, mode: r.mode, level: r.kind === 'super' || r.mode === 'vs' ? 0 : r.level, resumed: 1 })
  }
  const discardMatch = () => { clearResume(); setSaved(null) }
  // save the finished match (full scorecard) on this device, and in the cloud backup if it is on
  const recordMatch = () => {
    const list = kind === 'bat' || kind === 'full' ? xi : kind === 'bowl' ? attack : soPicks
    const mid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    // the anonymous match database (the server re-runs the match to verify it)
    reportMatch({ id: mid, kind, mode, seed: seedStr, level: kind === 'super' || kind === 'full' ? 1 : level, cap, ids: list.map((p) => p.id), ...(mode === 'vs' && kind !== 'super' && kind !== 'full' && result.target ? { target: result.target } : {}),
      extra: kind === 'full' ? { attack: fullAttack.map((p) => p.id), first, ...((fullRes || result).impact ? { impact: { id: (fullRes || result).impact.p.id, out: (fullRes || result).impact.out } } : {}) } : {} })
    const open = result.target >= OPEN_TARGET
    if (kind === 'full') {
      const res = fullRes || result
      addMatch({
        id: mid, t: Date.now(), day: todayKey(), kind: 'full', mode, level: 0, target: 0,
        first, score: res.myScore, oppScore: res.oppScore, wickets: res.myBatting.wickets, won: !!res.won, tie: !!res.tie, text: res.text, balls: res.myBatting.ballsUsed,
        cap: cap >= 0 && xi[cap] ? xi[cap].name : null, picks: (res.batXi || xi).map((p) => ({ n: p.name, t: p.team, y: p.year })), impact: res.impact ? { n: res.impact.p.name, out: xi[res.impact.out].name } : null, attackPicks: fullAttack.map((p) => ({ n: p.name, t: p.team, y: p.year })),
        opp: { n: res.opp.name, y: res.opp.year }, evBat: compactEvents('bat', res.myBatting.events), evBowl: compactEvents('bowl', res.myBowling.events),
      })
      clearResume(); setSaved(null); autoBackup(); return
    }
    addMatch({
      id: mid, t: Date.now(), day: todayKey(), kind, mode,
      level: kind === 'super' || mode === 'vs' ? 0 : level, target: open ? 0 : result.target || 0, vs: mode === 'vs' && vs ? vs.role : null,
      score: result.score, wickets: result.wickets, won: !!result.won, tie: !!result.tie, balls: result.ballsUsed,
      cap: cap >= 0 && list[cap] ? list[cap].name : null, picks: list.map((p) => ({ n: p.name, t: p.team, y: p.year })),
      opp: kind === 'bowl' && result.opp ? { n: result.opp.name, y: result.opp.year } : kind === 'super' && result.opp ? { n: result.opp.name, y: result.opp.year, s: result.oppScore } : null,
      ev: compactEvents(kind, result.events || []),
    })
    clearResume(); setSaved(null); autoBackup()
  }
  const done = () => {
    if (mode === 'vs') { track('game_finish', { kind, mode, level: 0, won: result.won ? 1 : 0, score: result.score }); setStats(recordVs()); recordMatch(); setScreen('result'); return }
    const lv = kind === 'super' || kind === 'full' ? 1 : level
    const extra = { wickets: result.wickets, balls: result.ballsUsed, ...(kind === 'super' || kind === 'full' ? { oppScore: result.oppScore } : {}), ...(kind === 'full' ? { text: result.text } : {}) }
    track('game_finish', { kind, mode, level: kind === 'super' || kind === 'full' ? 0 : level, won: result.won ? 1 : 0, score: result.score })
    if (result.won && kind !== 'super' && kind !== 'full') track('level_cleared', { kind, level })
    setStats(mode === 'daily' ? recordDaily(kind, result.score, result.won, lv, undefined, extra) : recordPractice(kind, result.score, result.won, lv))
    recordMatch()
    setScreen('result')
  }
  const home = () => { setSaved(readResume()); setScreen('home') }
  const abandon = () => { track('draft_abandon', { kind, picks: (kind === 'bat' || kind === 'full' ? xi : kind === 'bowl' ? attack : soPicks).filter(Boolean).length }); setSaved(readResume()); setScreen('home') }
  const picks = kind === 'bat' || kind === 'full' ? xi : kind === 'bowl' ? attack : soPicks
  const navOn = ['home', 'board', 'stats', 'recap'].includes(screen)

  return (
    <div className={'app' + (navOn ? ' has-nav' : '')}>
      {screen === 'home' && <Home stats={stats} saved={saved} onContinue={continueMatch} onDiscard={discardMatch} onBackup={() => setScreen('backup')} onStart={start} onBoard={() => setScreen('board')} onStats={() => setScreen('stats')} onHelp={() => { track('howto_open'); setScreen('howto') }} onPrivacy={() => setScreen('privacy')} onRecap={() => setScreen('recap')} />}
      {screen === 'privacy' && <Privacy onBack={home} />}
      {screen === 'backup' && <Backup onBack={home} onRestored={() => { setStats(load()); setSaved(readResume()) }} />}
      {screen === 'match' && viewMatch && <MatchView m={viewMatch} onBack={() => setScreen('stats')} />}
      {screen === 'howto' && <HowTo onClose={() => { markIntroSeen(); setScreen('home') }} />}
      {screen === 'stats' && <Stats stats={stats} onBack={home} onOpenMatch={(m) => { setViewMatch(m); setScreen('match') }} onBackup={() => setScreen('backup')} />}
      {screen === 'recap' && <Recap onBack={home} />}
      {screen === 'vs' && <VsIntro info={vsInfo} onPlay={() => start('vs', vsInfo.kind, 1, vsInfo.code, vsInfo)} onHome={leaveVs} />}
      {screen === 'board' && <Board onBack={home} initialKind={kind === 'super' ? 'bat' : kind} />}
      {screen === 'draft' && (kind === 'bat' || kind === 'full') && <Draft key={seedStr} full={kind === 'full'} impactOn={kind === 'full' && impactOn} impactP={impactP} setImpactP={setImpactP} vs={vs} level={level} seedStr={seedStr} mode={mode} xi={xi} setXi={setXi} initMeta={initMeta} onMeta={setDraftMeta} onDone={toTactics} onExit={abandon} />}
      {screen === 'draft' && kind === 'bowl' && <BowlDraft key={seedStr} vs={vs} level={level} seedStr={seedStr} mode={mode} attack={attack} setAttack={setAttack} initMeta={initMeta} onMeta={setDraftMeta} onDone={toTactics} onExit={abandon} />}
      {screen === 'draft' && kind === 'super' && <SuperDraft key={seedStr} seedStr={seedStr} mode={mode} picks={soPicks} setPicks={setSoPicks} initMeta={initMeta} onMeta={setDraftMeta} onDone={toTactics} onExit={abandon} />}
      {screen === 'tactics' && <Tactics key={seedStr + kind} kind={kind === 'full' ? 'bat' : kind} full={kind === 'full'} picks={picks} seedStr={seedStr} onConfirm={confirmTactics} />}
      {screen === 'attack' && kind === 'full' && <AttackPicker key={seedStr + 'atk'} xi={xi} cap={cap} seedStr={seedStr} first={first} impactP={impactOn ? impactP : null} onConfirm={confirmAttack} />}
      {screen === 'chase' && kind === 'full' && fullRes && (
        stage === 'inn1' ? (first === 'bat' ? <Chase xi={xi} result={fullRes.inn1} onDone={() => setStage('break')} openLabel="Your innings: set a target" doneLabel="Innings break" /> : <BowlInnings result={fullRes.inn1} onDone={() => setStage('break')} doneLabel="Innings break" />)
          : stage === 'break' ? <InningsBreak res={fullRes} onNext={() => setStage('inn2')} />
            : (first === 'bat' ? <BowlInnings result={fullRes.inn2} chasing onDone={done} /> : <Chase xi={xi} result={fullRes.inn2} onDone={done} />)
      )}
      {screen === 'chase' && kind === 'bat' && <Chase xi={xi} result={result} onDone={done} />}
      {screen === 'chase' && kind === 'bowl' && <BowlInnings result={result} onDone={done} />}
      {screen === 'chase' && kind === 'super' && <SuperInnings result={result} onDone={done} />}
      {screen === 'result' && kind === 'full' && fullRes && <FullResult res={fullRes} xi={xi} attack={fullAttack} cap={cap} mode={mode} stats={stats} seedStr={seedStr} onHome={home} onAgain={() => start('practice', 'full')} />}
      {screen === 'result' && kind === 'bat' && <Result vs={vs} level={level} cap={cap} xi={xi} result={result} mode={mode} stats={stats} seedStr={seedStr} onHome={home} onPractice={() => start('practice', 'bat', level)} onNext={() => start('practice', 'bat', Math.min(BAT_LEVELS, level + 1))} onBoard={() => setScreen('board')} />}
      {screen === 'result' && kind === 'bowl' && <BowlResult vs={vs} level={level} cap={cap} attack={attack} result={result} mode={mode} stats={stats} seedStr={seedStr} onHome={home} onPractice={() => start('practice', 'bowl', level)} onNext={() => start('practice', 'bowl', Math.min(BOWL_LEVELS, level + 1))} onBoard={() => setScreen('board')} />}
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

// message after a finished level: only a win opens the next one
function unlockMsg({ won, level, levels, frontier, nextText, gap, kind }) {
  if (won) {
    if (level >= levels) return `🏆 All ${levels} levels cleared!`
    return frontier === level + 1 ? `✅ Level ${level} cleared · level ${level + 1} is open (${nextText})` : `✅ Level ${level} cleared`
  }
  if (frontier === level) return `🔒 Level ${level} not beaten: ${gap}. Beat it to open level ${level + 1}.`
  return null
}

// what the 'today' card says after the daily game: which level, the score, and how many overs it took
function doneText(kind, d) {
  const w = d.wickets != null ? `/${d.wickets}` : ''
  const ov = d.balls ? ` · ${oversStr(d.balls)} ov` : ''
  if (kind === 'full') return d.text ? `${d.text} (${d.score}${w} v ${d.oppScore})` : `${d.score}`
  if (kind === 'super') return `${d.score}${w}${d.oppScore != null ? ` v ${d.oppScore}` : ''}`
  return `L${d.level || 1} · ${d.score}${w}${ov}`
}

function resumeLabel(r) {
  const kindName = { bat: 'Batting', bowl: 'Bowling', super: 'Super Over', full: 'Full match' }[r.kind]
  const mode = r.mode === 'daily' ? 'today' : r.mode === 'vs' ? 'challenge' : 'free play'
  const lvl = r.kind !== 'super' && r.kind !== 'full' && r.mode !== 'vs' ? ` · level ${r.level}` : ''
  const arr = r.kind === 'bat' || r.kind === 'full' ? r.xi : r.kind === 'bowl' ? r.attack : r.so
  const total = (arr || []).length, picked = (arr || []).filter(Boolean).length
  const step = r.screen === 'draft' ? `${picked}/${total} picked` : r.screen === 'tactics' ? 'team ready, set tactics' : r.screen === 'attack' ? 'choose your bowlers' : r.kind === 'full' ? (r.stage === 'break' ? 'innings break' : r.stage === 'inn2' ? '2nd innings' : '1st innings') : 'innings in progress'
  return `${kindName} ${mode}${lvl} · ${step}`
}

function Home({ stats, saved, onContinue, onDiscard, onBackup, onStart, onBoard, onStats, onHelp, onRecap, onPrivacy }) {
  const [imp, setImp] = useState(impactPref)
  const today = todayKey()
  const streak = liveStreak(stats)
  const batDone = stats.history[histKey('bat', today)]
  const bowlDone = stats.history[histKey('bowl', today)]
  const superDone = stats.history[histKey('super', today)]
  const opp = opponentFor(today)
  const unlocked = stats.bowlLevel || 1
  const [theme, setTheme] = useState(getTheme())
  const flip = () => { const t = theme === 'dark' ? 'light' : 'dark'; applyTheme(t); setTheme(t); track('theme_toggle', { to: t }) }
  const batUnlocked = stats.batLevel || 1
  const [lv, setLv] = useState(unlocked)
  const [bl, setBl] = useState(batUnlocked)
  const [bnudge, setBnudge] = useState(() => { try { return loadMatches().length >= 2 && !getCode() && localStorage.getItem('chase300.bnudge') !== '1' } catch { return false } })
  const [nudge, setNudge] = useState(() => stats.played >= 1 && !nudgeDismissed() && !getProfile() && !isMinor())
  const fullDone = stats.history[histKey('full', today)]
  const Done = ({ d, kind }) => <div className="done"><b>Today</b> {doneText(kind, d)}{d.won ? ' 🏆' : ''}</div>
  return (
    <main className="home compact">
      {saved && (
        <div className="resume">
          <div className="rtxt">
            <b>▶ Continue your match</b>
            <small>{resumeLabel(saved)}</small>
          </div>
          <div className="rbtn"><button className="primary" onClick={onContinue}>Continue</button><button className="link" onClick={onDiscard}>Discard</button></div>
        </div>
      )}
      <div className="hbar">
        <div className="brand"><span className="logo sm">300</span><div><h1>Chase 300</h1><small>Daily franchise T20 draft</small></div></div>
        <button className="theme" onClick={flip} aria-label="Toggle theme">{theme === 'dark' ? '☀️' : '🌙'}</button>
      </div>
      <div className="stats">
        <div><b>🔥 {streak}</b><span>streak</span></div>
        <div><b>🧊 {stats.freezes || 0}</b><span>freezes</span></div>
        <div><b>{stats.best || '–'}</b><span>best chase</span></div>
      </div>
      {stats.freezeUsedOn === today && <p className="line">🧊 A streak freeze saved your streak today.</p>}
      <BriefPills seedStr={today} />
      {bnudge && (
        <div className="nudge">
          <span>☁️ Save your progress so a new phone never wipes it</span>
          <div><button className="link" onClick={onBackup}>Set up</button><button className="link" onClick={() => { try { localStorage.setItem('chase300.bnudge', '1') } catch {} setBnudge(false) }}>Later</button></div>
        </div>
      )}
      {!bnudge && nudge && (
        <div className="nudge">
          <span>👋 Help shape Chase 300: tell us a little about you <small>(optional)</small></span>
          <div><button className="link" onClick={onPrivacy}>Add</button><button className="link" onClick={() => { dismissNudge(); setNudge(false) }}>Not now</button></div>
        </div>
      )}

      <div className="mgrid">
        <section className="mode sm wide">
          <h2>🏟️ Full match</h2>
          <p>Bat and bowl a whole T20 with one XI. Win the match.</p>
          {fullDone && <Done d={fullDone} kind="full" />}
          <label className="optrow"><input type="checkbox" checked={imp} onChange={(e) => { setImp(e.target.checked); setImpactPref(e.target.checked) }} /> ⚡ Impact player <small>a 12th pick who subs in for the 2nd innings</small></label>
          <div className="wide-row">
            <button className="primary" onClick={() => onStart(fullDone ? 'practice' : 'daily', 'full')}>{fullDone ? 'Play another' : 'Play today'}</button>
            {!fullDone && <button className="link" onClick={() => onStart('practice', 'full')}>Free play</button>}
          </div>
        </section>

        <section className="mode sm">
          <h2>🏏 Batting</h2>
          <Stepper levels={BAT_LEVELS} unlocked={batUnlocked} cleared={stats.batCleared || 0} value={bl} onChange={setBl} text={`chase ${batTarget(bl)}`} />
          {batDone && <Done d={batDone} kind="bat" />}
          <button className="primary" onClick={() => onStart(batDone ? 'practice' : 'daily', 'bat', bl)}>{batDone ? `Play level ${bl}` : 'Play today'}</button>
          {!batDone && <button className="link" onClick={() => onStart('practice', 'bat', bl)}>Free play</button>}
        </section>

        <section className="mode sm">
          <h2>🎯 Bowling</h2>
          <Stepper levels={BOWL_LEVELS} unlocked={unlocked} cleared={stats.bowlCleared || 0} value={lv} onChange={setLv} text={`under ${bowlTarget(lv)}`} />
          {bowlDone && <Done d={bowlDone} kind="bowl" />}
          <button className="primary" onClick={() => onStart(bowlDone ? 'practice' : 'daily', 'bowl', lv)}>{bowlDone ? `Play level ${lv}` : 'Play today'}</button>
          {!bowlDone && <button className="link" onClick={() => onStart('practice', 'bowl', lv)}>Free play</button>}
        </section>

        <section className="mode sm">
          <h2>⚡ Super Over</h2>
          <p>3 hitters + 1 bowler. Bat one over, then defend it.</p>
          {superDone && <Done d={superDone} kind="super" />}
          <button className="primary" onClick={() => onStart(superDone ? 'practice' : 'daily', 'super')}>{superDone ? 'Play another' : 'Play today'}</button>
          {!superDone && <button className="link" onClick={() => onStart('practice', 'super')}>Free play</button>}
        </section>

        <section className="mode sm">
          <h2>⚔️ Vs a friend</h2>
          <p>You set a score. They must beat it.</p>
          <div className="duo">
            <button className="ghost small" onClick={() => onStart('vs', 'bat')}>🏏 Bat</button>
            <button className="ghost small" onClick={() => onStart('vs', 'bowl')}>🎯 Bowl</button>
          </div>
        </section>
      </div>

      <div className="hfoot">
        <button className="link" onClick={onHelp}>❓ How to play</button>
        <Reminders />
        <button className="link" onClick={onBackup}>☁️ Save progress</button>
        <button className="link" onClick={onPrivacy}>🔒 Privacy &amp; data</button>
      </div>
      <p className="fine">Fan-made, free and unofficial. Ratings are approximate. Not affiliated with or endorsed by any league, board, team or player. Names are used for identification only. <a href="/privacy.html">Privacy</a></p>
    </main>
  )
}

// compact level control: ‹ Level 3 · chase 220 ›  (the next level opens once you beat the current one)
function Stepper({ levels, unlocked, cleared, value, onChange, text }) {
  const atFrontier = value >= unlocked && unlocked < levels
  return (
    <>
      <div className="step">
        <button disabled={value <= 1} onClick={() => onChange(value - 1)} aria-label="Easier level">‹</button>
        <div className="stepv"><b>Level {value}{value <= cleared ? ' ✓' : ''}</b><small>{text}</small></div>
        <button disabled={value >= unlocked} onClick={() => onChange(value + 1)} aria-label="Harder level">›</button>
      </div>
      {atFrontier && <small className="stephint">Beat level {value} to unlock {value + 1}</small>}
    </>
  )
}

function Draft({ full = false, impactOn = false, impactP = null, setImpactP = () => {}, vs, level, seedStr, mode, xi, setXi, initMeta, onMeta, onDone, onExit }) {
  const mod = useMemo(() => modifierFor(seedStr), [seedStr])
  const spins = useMemo(() => makeSpins(hashStr('spin' + seedStr), squadsFor(mod)), [seedStr, mod])
  const [spinIdx, setSpinIdx] = useState((initMeta && initMeta.spinIdx) || 0)
  const [rerolls, setRerolls] = useState(initMeta ? initMeta.rerolls : 1)
  const [skips, setSkips] = useState(initMeta && initMeta.skips !== undefined ? initMeta.skips : 1)       // one "skip a pick" per draft
  const [skipped, setSkipped] = useState((initMeta && initMeta.skipped) || [])                          // skipped players can't come back
  const [releasing, setReleasing] = useState(false)
  useEffect(() => { if (onMeta) onMeta({ spinIdx, rerolls, skips, skipped }) }, [spinIdx, rerolls, skips, skipped])
  const [rolling, setRolling] = useState(true)
  const [ticker, setTicker] = useState('')
  const [sel, setSel] = useState(null)
  const picked = xi.filter(Boolean).length
  const usedNames = new Set(xi.filter(Boolean).map((p) => p.name)) // same real player can't be picked twice
  const squad = spins[spinIdx % spins.length]
  const freeSlots = xi.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0)
  const chosen = xi.filter(Boolean)
  const impactPhase = picked >= 11 && impactOn && !impactP
  const eligible = (p) => !usedNames.has(p.name) && !skipped.includes(p.name) && pickAllowed(mod, p, chosen)
    && (impactPhase ? true : freeSlots.some((s) => fits(p, s)))
  const hasOption = squad.players.some(eligible)
  const allDone = picked >= 11 && (!impactOn || impactP)

  // wheel animation whenever the spin changes
  useEffect(() => {
    if (allDone) return
    setRolling(true); setSel(null); window.scrollTo(0, 0)
    let n = 0
    const t = setInterval(() => {
      n++
      setTicker(PLAYABLE[Math.floor(Math.random() * PLAYABLE.length)].short + ' ' + (2008 + Math.floor(Math.random() * 17)))
      if (n > 12) { clearInterval(t); setRolling(false) }
    }, 70)
    return () => clearInterval(t)
  }, [spinIdx])

  // skip squads where nobody fits an open slot
  useEffect(() => {
    if (!rolling && !allDone && !hasOption) setSpinIdx((i) => i + 1)
  }, [rolling, hasOption, picked, allDone])

  const place = (slot) => {
    const next = xi.slice(); next[slot] = sel
    setXi(next); setSel(null); setSpinIdx((i) => i + 1)
  }
  const reroll = () => { setRerolls(0); setSpinIdx((i) => i + 1) }
  const skipPick = (i) => { const n = xi.slice(); setSkipped([...skipped, n[i].name]); n[i] = null; setXi(n); setSkips(0); setReleasing(false); setSpinIdx((x) => x + 1) }
  const takeImpact = () => { setImpactP(sel); setSel(null) }
  const r = teamRatings(xi)

  return (
    <main className={'draft' + (sel ? ' has-sheet' : '')}>
      <header>
        <button className="link" onClick={onExit}>✕</button>
        <b>{full ? 'Full match' : vs ? (vs.role === 'first' ? 'Set the score' : `Chase ${vs.target}`) : `Chase ${batTarget(level)}`}<small className="sub3">{full ? (mode === 'daily' ? ' · daily' : ' · free play') : mode === 'daily' ? ` · daily L${level}` : mode === 'vs' ? ' · challenge' : ` · practice L${level}`}</small></b>
        <span>{picked}/11</span>
      </header>
      <BriefPills seedStr={seedStr} />
      {full && (() => { const o = opponentFor(seedStr); const top = [...o.players].sort((x, y) => y.bwl - x.bwl).slice(0, 5); return <div className="card opp tight"><small>vs</small><b>{o.name} {o.year}</b><span>their attack {Math.round(top.reduce((s, p) => s + p.bwl, 0) / 5)} · their batting {Math.round(o.players.reduce((s, p) => s + p.pow, 0) / o.players.length)}</span></div> })()}
      <Progress items={xi} total={11} text={full ? `B${Math.round(r.bat)} P${Math.round(r.pow)} · ${xi.filter((p) => p && p.bwl >= 50).length}/5 bowlers` : `B${Math.round(r.bat)} P${Math.round(r.pow)} W${Math.round(r.bwl)}`} />

      {impactOn && picked >= 11 && !impactP && <p className="hint tight">⚡ Last pick: your Impact player. Anyone, any role. He subs in for the 2nd innings.</p>}
      {impactOn && impactP && <p className="hint tight">⚡ Impact player: <b>{impactP.name}</b> (B{impactP.bat} P{impactP.pow} W{impactP.bwl})</p>}
      {!allDone ? (
        <>
          <WheelRow rolling={rolling} ticker={ticker} squad={squad} rerolls={rerolls} canReroll={rerolls > 0 && !sel && !rolling} onReroll={reroll} skips={skips} canSkip={skips > 0 && picked > 0 && !sel && !rolling && !impactPhase} onSkip={() => setReleasing(true)} />
          {releasing && (
            <div className="skipbox">
              <b>Skip a pick</b><small>Tap the player you want to drop. He won't come back, and you get a fresh wheel spin.</small>
              <div className="players">
                {xi.map((p, i) => p && (
                  <button key={p.name} className="player" onClick={() => skipPick(i)}><Av p={p} /><span className="pn">{p.name}</span><span className="meta">#{i + 1} · <i>B</i>{p.bat} <i>P</i>{p.pow}</span></button>
                ))}
              </div>
              <button className="link" onClick={() => setReleasing(false)}>Cancel</button>
            </div>
          )}
          {!rolling && !releasing && (
            <div className="players">
              {squad.players.map((p) => {
                const ok = eligible(p)
                return (
                  <button key={p.name} disabled={!ok} className={'player' + (sel === p ? ' sel' : '')} onClick={() => setSel(p)}>
                    <Av p={p} />
                    <span className="pn">{p.name}{p.k ? ' 🧤' : ''}</span>
                    <span className="meta">{p.lo === p.hi ? `#${p.lo}` : `#${p.lo}–${p.hi}`} · <i>B</i>{p.bat} <i>P</i>{p.pow}{p.bwl >= 30 ? <> <i>W</i>{p.bwl}</> : null}</span>
                    <span className="chips">{ratingChips(p, conditionFor(seedStr), 'bat')}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <button className="primary" onClick={() => onDone(xi)}>Next: tactics</button>
      )}

      {picked > 0 && !r.hasKeeper && <p className="warn">No keeper yet: small penalty without one 🧤</p>}
      <MyList summary={`My XI · ${picked}/11`}>
        <ol className="slots">
          {xi.map((p, i) => (
            <li key={i} className={p ? 'filled' : ''}>
              <span className="sn">{i + 1}</span>
              <span className="sl">{p ? <>{p.name} <small className="tm">{p.team} {String(p.year).slice(2)}</small></> : SLOT_LABELS[i]}</span>
              {p && <span className="pr"><i>B</i>{p.bat} <i>P</i>{p.pow} <i>W</i>{p.bwl}</span>}
            </li>
          ))}
        </ol>
      </MyList>
      {sel && <PlaceSheet player={sel} onCancel={() => setSel(null)} options={impactPhase ? [{ key: 'imp', label: '⚡ Impact player', onPick: takeImpact }] : freeSlots.filter((s) => fits(sel, s)).map((s) => ({ key: s, label: `#${s + 1} ${SLOT_LABELS[s]}`, onPick: () => place(s) }))} />}
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

function Chase({ xi, result, onDone, openLabel = 'Setting the score for your friend', doneLabel = 'See result' }) {
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
  const open = result.target >= OPEN_TARGET

  return (
    <main className="chase">
      <div className="target">{open ? openLabel : `Target ${result.target}`}</div>
      <div className="big">{score}<small>/{wk}</small></div>
      <div className="line">{oversStr(balls)} ov · {open ? `Run rate ${balls ? (score / (balls / 6)).toFixed(1) : '0.0'}` : `Req ${rrr}/ov · ${Math.max(0, result.target - score)} to win`}</div>
      <div className="bar big"><div style={{ width: `${open ? (balls / BALLS) * 100 : Math.min(100, (score / result.target) * 100)}%` }} /></div>
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
        {finished && <button className="primary" onClick={onDone}>{doneLabel}</button>}
      </div>
    </main>
  )
}

function Result({ vs, level, cap, xi, result, mode, stats, seedStr, onHome, onPractice, onNext, onBoard }) {
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
    `${mode === 'vs' ? 'Challenge' : `L${level} (${result.target})`}: ${result.score}/${result.wickets} in ${oversStr(result.ballsUsed)} ov ${mode !== 'vs' && result.won ? '🏆' : ''}`,
    xi.map((p) => p.name).join(' · '),
    mode === 'daily' ? `🔥 ${streak}-day streak` : '',
  ].filter(Boolean).join('\n')
  const share = async () => {
    track('share', { kind: 'result' })
    try {
      if (navigator.share) await navigator.share({ text })
      else { await navigator.clipboard.writeText(text); setCopied(true) }
    } catch {}
  }
  return (
    <main className={'result' + (mode !== 'vs' ? ' has-cta' : '')}>
      <div className={'big' + (result.won ? ' win' : '')}>{result.score}<small>/{result.wickets}</small></div>
      {mode === 'vs' && vs ? <VsSummary vs={vs} result={result} kind="bat" /> : <p className="verdict">{verdict(result)}</p>}
      {mode !== 'vs' && (() => { const m = unlockMsg({ won: result.won, level, levels: BAT_LEVELS, frontier: stats.batLevel, nextText: `chase ${batTarget(level + 1)}`, gap: `${Math.max(0, result.target - result.score)} runs short of ${result.target}` }); return m ? <p className={'unlock' + (result.won ? '' : ' lose')}>{m}</p> : null })()}
      <p className="line">{mode === 'vs' ? '' : `Level ${level} · `}{oversStr(result.ballsUsed)} overs{mode === 'daily' ? ` · 🔥 ${streak}-day streak` : ''}</p>
      <BatCard result={result} />
      {mode === 'vs' && <VsPanel kind="bat" seedStr={seedStr} vs={vs} result={result} cap={cap} picks={xi} />}
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
      {mode !== 'vs' && <div className="hcta"><button className="primary" onClick={result.won ? onNext : onPractice}>{result.won && level < BAT_LEVELS ? `Next level ▶ Level ${level + 1} (chase ${batTarget(level + 1)})` : result.won ? `Play level ${level} again` : `Try level ${level} again (chase ${batTarget(level)})`}</button></div>}
      <button className={mode === 'vs' ? 'primary' : 'ghost'} onClick={share}>{copied ? 'Copied!' : 'Share result'}</button>
      <button className="ghost" onClick={() => shareCard({ mode: mode === 'vs' ? 'Challenge · Batting' : 'Batting', level: mode === 'vs' ? null : level, score: result.score, wickets: result.wickets, won: result.won, line: verdict(result), names: xi.map((p) => p.name), footer: window.location.host })}>🖼️ Share as image</button>
      {(mode === 'vs' || (result.won && level < BAT_LEVELS)) && <button className="ghost" onClick={onPractice}>{mode === 'vs' ? 'Play a practice game' : `Play level ${level} again`}</button>}
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
    if (kind === 'hall') { fetchHall().then(setData).catch(() => setErr(true)); return }
    fetchBoard(kind, scope, todayKey()).then(setData).catch(() => setErr(true))
  }, [kind, scope])
  return (
    <main className="board">
      <header><button className="link" onClick={onBack}>← Back</button><b>Leaderboards</b><span /></header>
      <div className="tabs">
        {[['bat', '🏏 Batting'], ['bowl', '🎯 Bowling'], ['hall', '🏆 Winners'], ['week', '🗓️ Weekly']].map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}
      </div>
      {kind === 'week' && <Weekly />}
      {kind === 'hall' && (
        <>
          <p className="hint">Everyone who has posted a score and won. Ranked by wins, then levels cleared.</p>
          {err && <p className="warn">Couldn't load the winners.</p>}
          {!data && !err && <p className="line">Loading…</p>}
          {data && data.top.length === 0 && <p className="line">No winners yet. Win a daily game and post your score to be first!</p>}
          {data && data.top.length > 0 && (
            <ol className="rows hall">
              {data.top.map((r) => (
                <li key={r.rank} className={r.you ? 'you' : ''}>
                  <span className="rk">{r.rank}</span>
                  <span className="nm">{r.name}<small>{[r.batLvl ? `🏏 L${r.batLvl}` : '', r.bowlLvl ? `🎯 L${r.bowlLvl}` : '', r.full ? `🏟️ ${r.full}` : '', r.sup ? `⚡ ${r.sup}` : ''].filter(Boolean).join(' · ')}</small></span>
                  <span className="wn">{r.wins} 🏆<small>of {r.games}</small></span>
                </li>
              ))}
              {data.me && data.me.rank > 100 && <li className="you"><span className="rk">{data.me.rank}</span><span className="nm">{data.me.name}</span><span className="wn">{data.me.wins} 🏆</span></li>}
            </ol>
          )}
        </>
      )}
      {kind !== 'week' && kind !== 'hall' && <div className="tabs">
        {['today', 'all'].map((t) => <button key={t} className={scope === t ? 'on' : ''} onClick={() => setScope(t)}>{t === 'today' ? 'Today' : 'All-time'}</button>)}
      </div>}
      {kind !== 'week' && kind !== 'hall' && <p className="hint">{kind === 'bat' ? 'Ranked by level, then runs. Higher level is harder.' : 'Fewest runs conceded wins.'}</p>}
      {kind !== 'week' && kind !== 'hall' && err && <p className="warn">Couldn't load the leaderboard.</p>}
      {kind !== 'week' && kind !== 'hall' && !data && !err && <p className="line">Loading…</p>}
      {kind !== 'week' && kind !== 'hall' && data && data.top.length === 0 && <p className="line">No scores yet. Be the first!</p>}
      {kind !== 'week' && kind !== 'hall' && data && (
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
    try { if (on) { await disablePush(); setOn(false); track('push_off') } else { await enablePush(); setOn(true); track('push_on') } }
    catch (e) { setMsg(e.message) }
  }
  return (
    <>
      <button className="link" onClick={toggle}>{on ? '🔔 Reminders on' : '🔕 Remind me'}</button>
      {msg && <p className="warn" style={{ flexBasis: '100%', textAlign: 'center' }}>{msg}</p>}
    </>
  )
}

function BowlDraft({ vs, level, seedStr, mode, attack, setAttack, initMeta, onMeta, onDone, onExit }) {
  const mod = useMemo(() => modifierFor(seedStr), [seedStr])
  const spins = useMemo(() => makeSpins(hashStr('bspin' + seedStr), squadsFor(mod)), [seedStr, mod])
  const opp = useMemo(() => opponentFor(seedStr), [seedStr])
  const [spinIdx, setSpinIdx] = useState((initMeta && initMeta.spinIdx) || 0)
  const [rerolls, setRerolls] = useState(initMeta ? initMeta.rerolls : 1)
  const [skips, setSkips] = useState(initMeta && initMeta.skips !== undefined ? initMeta.skips : 1)
  const [skipped, setSkipped] = useState((initMeta && initMeta.skipped) || [])
  const [releasing, setReleasing] = useState(false)
  useEffect(() => { if (onMeta) onMeta({ spinIdx, rerolls, skips, skipped }) }, [spinIdx, rerolls, skips, skipped])
  const [rolling, setRolling] = useState(true)
  const [ticker, setTicker] = useState('')
  const [sel, setSel] = useState(null)
  const picked = attack.filter(Boolean).length
  const used = new Set(attack.filter(Boolean).map((p) => p.name))
  const squad = spins[spinIdx % spins.length]
  const chosen = attack.filter(Boolean)
  const eligible = (p) => p.bwl >= BOWL_MIN && !used.has(p.name) && !skipped.includes(p.name) && pickAllowed(mod, p, chosen)
  const hasOption = squad.players.some(eligible)

  useEffect(() => {
    if (picked >= 5) return
    setRolling(true); setSel(null); window.scrollTo(0, 0)
    let n = 0
    const t = setInterval(() => {
      n++
      setTicker(PLAYABLE[Math.floor(Math.random() * PLAYABLE.length)].short + ' ' + (2008 + Math.floor(Math.random() * 17)))
      if (n > 12) { clearInterval(t); setRolling(false) }
    }, 70)
    return () => clearInterval(t)
  }, [spinIdx])
  useEffect(() => { if (!rolling && picked < 5 && !hasOption) setSpinIdx((i) => i + 1) }, [rolling, hasOption, picked])

  const place = (slot) => {
    const next = attack.slice(); next[slot] = sel
    setAttack(next); setSel(null); setSpinIdx((i) => i + 1)
  }
  const skipPick = (i) => { const n = attack.slice(); setSkipped([...skipped, n[i].name]); n[i] = null; setAttack(n); setSkips(0); setReleasing(false); setSpinIdx((x) => x + 1) }
  const r = bowlRatings(attack)
  const oppPow = Math.round(opp.players.reduce((s, p) => s + p.pow, 0) / opp.players.length)

  return (
    <main className={'draft' + (sel ? ' has-sheet' : '')}>
      <header>
        <button className="link" onClick={onExit}>✕</button>
        <b>{vs ? (vs.role === 'first' ? 'Set the score' : `Under ${vs.target}`) : `Under ${bowlTarget(level)}`}<small className="sub3">{mode === 'daily' ? ` · daily L${level}` : mode === 'vs' ? ' · challenge' : ` · practice L${level}`}</small></b>
        <span>{picked}/5</span>
      </header>
      <BriefPills seedStr={seedStr} />
      <div className="card opp tight"><small>vs</small><b>{opp.name} {opp.year}</b><span>Power {oppPow}</span></div>
      <Progress items={attack} total={5} text={`Attack ${Math.round(r.bwl)}`} />

      {picked < 5 ? (
        <>
          <WheelRow rolling={rolling} ticker={ticker} squad={squad} rerolls={rerolls} canReroll={rerolls > 0 && !sel && !rolling} onReroll={() => { setRerolls(0); setSpinIdx((i) => i + 1) }} skips={skips} canSkip={skips > 0 && picked > 0 && !sel && !rolling} onSkip={() => setReleasing(true)} />
          {releasing && (
            <div className="skipbox">
              <b>Skip a pick</b><small>Tap the bowler you want to drop. He won't come back, and you get a fresh wheel spin.</small>
              <div className="players">
                {attack.map((p, i) => p && (
                  <button key={p.name} className="player" onClick={() => skipPick(i)}><Av p={p} /><span className="pn">{p.name}</span><span className="meta">slot {i + 1} · <i>W</i>{p.bwl}</span></button>
                ))}
              </div>
              <button className="link" onClick={() => setReleasing(false)}>Cancel</button>
            </div>
          )}
          {!rolling && !releasing && (
            <div className="players">
              {squad.players.filter((p) => p.bwl >= BOWL_MIN).map((p) => {
                const ok = eligible(p)
                return (
                  <button key={p.name} disabled={!ok} className={'player' + (sel === p ? ' sel' : '')} onClick={() => setSel(p)}>
                    <Av p={p} />
                    <span className="pn">{p.name}</span>
                    <span className="meta"><i>W</i>{p.bwl} <i>B</i>{p.bat}</span>
                    <span className="chips">{ratingChips(p, conditionFor(seedStr), 'bowl')}</span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <button className="primary" onClick={() => onDone(attack)}>Next: tactics</button>
      )}

      <MyList summary={`My attack · ${picked}/5`}>
        <ol className="slots">
          {attack.map((p, i) => (
            <li key={i} className={p ? 'filled' : ''}>
              <span className="sn">{i + 1}</span>
              <span className="sl">{p ? <>{p.name} <small className="tm">{p.team} {String(p.year).slice(2)}</small></> : BOWL_SLOTS[i]}</span>
              {p && <span className="pr"><i>W</i>{p.bwl}</span>}
            </li>
          ))}
        </ol>
      </MyList>
      {sel && <PlaceSheet player={sel} onCancel={() => setSel(null)} options={attack.map((p, i) => ({ p, i })).filter(({ p }) => !p).map(({ i }) => { const f = phaseBonus(i, sel); return { key: i, label: BOWL_SLOTS[i], hint: f > 0 ? `+${f} fit` : f < 0 ? `${f} fit` : '', tone: f > 0 ? 'up' : f < 0 ? 'dn' : '', onPick: () => place(i) } })} />}
    </main>
  )
}

function BowlInnings({ result, onDone, chasing = false, doneLabel = 'See result' }) {
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
  const open = result.target >= OPEN_TARGET
  return (
    <main className="chase">
      <div className="target">{result.opp.name} {result.opp.year} {chasing ? `chasing ${result.target}` : `batting · ${open ? 'setting the score' : `hold under ${result.target}`}`}</div>
      <div className={'big' + (!open && score >= result.target ? ' over' : '')}>{score}<small>/{cur ? cur.wickets : 0}</small></div>
      <div className="line">{oversStr(balls)} ov{cur ? ` · ${cur.bowler} bowling` : ''}</div>
      <div className="bar big"><div style={{ width: `${open ? Math.min(100, (balls / 120) * 100) : Math.min(100, (score / result.target) * 100)}%`, background: !open && score >= result.target ? 'var(--red)' : undefined }} /></div>
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
        {finished && <button className="primary" onClick={onDone}>{doneLabel}</button>}
      </div>
    </main>
  )
}

function BowlResult({ vs, level, cap, attack, result, mode, stats, seedStr, onHome, onPractice, onNext, onBoard }) {
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
    `${mode === 'vs' ? 'Challenge' : `L${level} (<${result.target})`} vs ${result.opp.name} ${result.opp.year}: ${result.score}/${result.wickets} in ${oversStr(result.ballsUsed)} ov ${mode !== 'vs' && result.won ? '🏆' : ''}`,
    attack.map((p) => p.name).join(' · '),
    mode === 'daily' ? `🔥 ${streak}-day streak` : '',
  ].filter(Boolean).join('\n')
  const share = async () => {
    track('share', { kind: 'result' })
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); setCopied(true) } } catch {}
  }
  return (
    <main className={'result' + (mode !== 'vs' ? ' has-cta' : '')}>
      <div className={'big' + (result.won ? ' win' : '')}>{result.score}<small>/{result.wickets}</small></div>
      {mode === 'vs' && vs ? <VsSummary vs={vs} result={result} kind="bowl" /> : <p className="verdict">{bowlVerdict(result)}</p>}
      {mode !== 'vs' && (() => { const m = unlockMsg({ won: result.won, level, levels: BOWL_LEVELS, frontier: stats.bowlLevel, nextText: `under ${bowlTarget(level + 1)}`, gap: `${Math.max(0, result.score - result.target + 1)} runs too many (limit ${result.target - 1})` }); return m ? <p className="unlock lose">{m}</p> : null })()}
      <p className="line">{mode === 'vs' ? '' : `Level ${level} · `}{result.opp.name} {result.opp.year} · {oversStr(result.ballsUsed)} overs{mode === 'daily' ? ` · 🔥 ${streak}-day streak` : ''}</p>
      <BowlCard result={result} />
      {mode === 'vs' && <VsPanel kind="bowl" seedStr={seedStr} vs={vs} result={result} cap={cap} picks={attack} />}
      {sub === 'ask' && (
        <div className="card submit">
          <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setNameState(e.target.value)} />
          <button className="primary" onClick={submit}>Post to leaderboard</button>
        </div>
      )}
      {sub === 'sending' && <p className="line">Posting…</p>}
      {sub === 'error' && <p className="warn">Couldn't reach the leaderboard. <button className="link" onClick={submit}>Retry</button></p>}
      {sub === 'done' && <button className="ghost" onClick={onBoard}>{rank ? `🏆 You're #${rank.rank} today — view leaderboard` : '🏆 View leaderboard'}</button>}
      {mode !== 'vs' && <div className="hcta"><button className="primary" onClick={result.won ? onNext : onPractice}>{result.won && level < BOWL_LEVELS ? `Next level ▶ Level ${level + 1} (under ${bowlTarget(level + 1)})` : result.won ? `Play level ${level} again` : `Try level ${level} again (under ${bowlTarget(level)})`}</button></div>}
      <button className={mode === 'vs' ? 'primary' : 'ghost'} onClick={share}>{copied ? 'Copied!' : 'Share result'}</button>
      <button className="ghost" onClick={() => shareCard({ mode: mode === 'vs' ? 'Challenge · Bowling' : 'Bowling', level: mode === 'vs' ? null : level, score: result.score, wickets: result.wickets, won: result.won, line: bowlVerdict(result), names: attack.map((p) => p.name), footer: window.location.host })}>🖼️ Share as image</button>
      {(mode === 'vs' || (result.won && level < BOWL_LEVELS)) && <button className="ghost" onClick={onPractice}>{mode === 'vs' ? 'Play a practice game' : `Play level ${level} again`}</button>}
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
  const opp = opponentFor('vs-' + info.code)
  return (
    <main className="home">
      <div className="logo">⚔️</div>
      <h1>{info.creator} challenged you</h1>
      <div className="vs-target card">
        {bowl ? (
          <>
            <small>{info.creator} conceded</small>
            <b>{info.firstScore}</b>
            <span>against {opp.name} {opp.year}. Concede fewer to win.</span>
          </>
        ) : (
          <>
            <small>{info.creator} scored {info.firstScore}. Your target:</small>
            <b>{info.target}</b>
            <span>in 20 overs. Same wheel as {info.creator}.</span>
          </>
        )}
      </div>
      <Brief seedStr={'vs-' + info.code} />
      <VsTable entries={info.entries} />
      {me ? <p className="line">You've already played this challenge.</p> : <button className="primary" onClick={onPlay}>Accept the challenge</button>}
      <button className="link" onClick={onHome}>Home</button>
    </main>
  )
}

const OUTCOME = { set: ['🎯', 'Set the score'], beat: ['✅', 'Beat it'], tie: ['🤝', 'Tied'], lost: ['❌', 'Fell short'] }
function VsTable({ entries }) {
  return (
    <ol className="rows" style={{ width: '100%' }}>
      {entries.map((r) => {
        const [icon, label] = OUTCOME[r.outcome] || ['', '']
        return (
          <li key={r.rank} className={r.you ? 'you' : ''}>
            <span className="rk">{icon || r.rank}</span>
            <span className="nm">{r.name}<small className="lv" style={{ display: 'block' }}>{label}</small></span>
            <span className="sc">{r.score}/{r.wickets}</span>
          </li>
        )
      })}
    </ol>
  )
}

// the result message: you set a score (player 1) or you chased one (player 2+)
function VsSummary({ vs, result, kind }) {
  const bowl = kind === 'bowl'
  if (vs.role === 'first') {
    return (
      <div className="vs-banner set">
        <b>You set the score: {result.score}</b>
        <span>{bowl ? `Your friend must concede fewer than ${result.score} runs.` : `Your friend must chase ${result.score + 1}.`}</span>
      </div>
    )
  }
  const beat = bowl ? result.score < vs.firstScore : result.score >= vs.target
  const tie = result.score === vs.firstScore
  const who = vs.creator || 'player 1'
  if (beat) return <div className="vs-banner win"><b>🏆 You win!</b><span>{bowl ? `You conceded ${result.score} to ${who}'s ${vs.firstScore}.` : `${result.score} beats ${who}'s ${vs.firstScore}.`}</span></div>
  if (tie) return <div className="vs-banner tie"><b>🤝 Tied</b><span>You matched {who}'s {vs.firstScore}.</span></div>
  const gap = bowl ? result.score - vs.firstScore : vs.firstScore - result.score
  return <div className="vs-banner lose"><b>{bowl ? '💔 Too many runs' : '💔 Fell short'}</b><span>{bowl ? `You conceded ${result.score}, ${gap} more than ${who}.` : `${result.score} is ${gap} short of ${who}'s ${vs.firstScore}.`}</span></div>
}

function VsPanel({ kind, seedStr, vs, result, cap, picks }) {
  const code = seedStr.slice(3)
  const first = vs && vs.role === 'first'
  const [name, setNameState] = useState(getName())
  const [phase, setPhase] = useState('ask') // ask | sending | done | error
  const [data, setData] = useState(null)
  const [copied, setCopied] = useState(false)
  const link = `${window.location.origin}/?vs=${code}`
  const submit = async () => {
    setName(name.trim()); setPhase('sending')
    try { setData(await submitVs(code, kind, name.trim() || 'Anon', picks, 1, cap)); track(first ? 'vs_create' : 'vs_join', { kind }); setPhase('done') }
    catch (e) { setPhase(e.status === 409 ? 'done' : 'error'); if (e.status === 409) getVs(code).then(setData).catch(() => {}) }
  }
  const share = async () => {
    track('share', { kind: 'result' })
    const text = kind === 'bowl'
      ? `⚔️ I conceded ${result.score} in Chase 300 bowling. Can you concede fewer?`
      : `⚔️ I scored ${result.score} in Chase 300. Can you chase ${result.score + 1}?`
    try { if (navigator.share) await navigator.share({ text, url: link }); else { await navigator.clipboard.writeText(`${text} ${link}`); setCopied(true) } } catch {}
  }
  return (
    <div className="card submit">
      <b>⚔️ {first ? 'Send your challenge' : 'Friend challenge'}</b>
      {phase === 'ask' && <>
        <input value={name} maxLength={16} placeholder="Your name" onChange={(e) => setNameState(e.target.value)} />
        <button className="primary" onClick={submit}>{first ? 'Lock in my score' : 'Submit my result'}</button>
      </>}
      {phase === 'sending' && <p className="line">Submitting…</p>}
      {phase === 'error' && <p className="warn">Couldn't reach the server. <button className="link" onClick={submit}>Retry</button></p>}
      {phase === 'done' && data && <>
        <VsTable entries={data.entries} />
        <button className="primary" onClick={share}>{copied ? 'Link copied!' : first ? 'Send challenge link' : 'Challenge another friend'}</button>
        <small className="lvl">{first ? `Anyone with the link plays the same wheel and chases ${kind === 'bowl' ? 'your score' : result.score + 1}.` : 'The link works for more friends too.'}</small>
      </>}
    </div>
  )
}

function HowTo({ onClose }) {
  const steps = [
    ['🎡', 'Spin the wheel', 'Each spin shows a famous franchise T20 squad.'],
    ['🧢', 'Draft your side', 'One player per spin. No undos, one re-roll. Batters keep their usual spots.'],
    ['🏏', 'Batting', 'Chase the target in 20 overs. Level 1 is 200, level 13 is 320.'],
    ['🎯', 'Bowling', 'Draft 5 bowlers and hold them under the target: 60 down to 15.'],
    ['⬆️', 'Keep playing', 'Play as many games as you like. Beat a level to unlock the next. The first game of the day is your scored daily.'],
    ['🌦️', 'Conditions', 'Every day has a different pitch. Pick players who suit it.'],
    ['⭐', 'Tactics', 'Pick a captain, tweak the batting order, and fit bowlers to the right phase.'],
    ['⚡', 'Super Over', '3 hitters and 1 bowler: bat one over, then defend it.'],
    ['🧊', 'Streak freeze', 'Win a daily game to earn one. It saves a missed day.'],
    ['⚔️', 'Challenge a friend', 'You set a score. They get the same wheel and must beat it.'],
  ]
  return (
    <main className="howto">
      <h1>How to play</h1>
      <div className="hgrid">
        {steps.map(([icon, title, text]) => (
          <div className="hcard" key={title}>
            <div className="hh"><span className="ic">{icon}</span><b>{title}</b></div>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <p className="fine">Ratings are fan estimates, and some line-ups may not be exact.</p>
      <div className="hcta"><button className="primary" onClick={onClose}>Let's play</button></div>
    </main>
  )
}

function LevelGrid({ title, kind, total, cleared, frontier, data }) {
  return (
    <div className="lvbox">
      <div className="lvhead"><b>{title}</b><span>{cleared}/{total} beaten</span></div>
      <div className="lvgrid">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const e = data[n]
          const won = (e && e.wins > 0) || n <= cleared
          const open = !won && n === frontier
          const tgt = kind === 'bat' ? `${batTarget(n)}` : `<${bowlTarget(n)}`
          return (
            <div key={n} className={'lvc' + (won ? ' won' : open ? ' open' : '')} title={e ? `Level ${n}: best ${e.best}, won ${e.wins}x` : `Level ${n}: target ${tgt}`}>
              <b>L{n}</b>
              <span>{won ? '✓' : open ? 'next' : '🔒'}</span>
              <small>{won ? (e ? e.best : 'beaten') : tgt}</small>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WinHistory({ log, title = 'Win history' }) {
  const [all, setAll] = useState(false)
  const shown = all ? log : log.slice(0, 8)
  return (
    <>
      <h2>{title} <small>{log.length}</small></h2>
      {log.length === 0 && <p className="line">Beat a level and it will appear here.</p>}
      <ul className="recent">
        {shown.map((w, i) => (
          <li key={i}>
            <span>{w.day}</span>
            <span>{w.kind === 'bowl' ? '🎯' : '🏏'} Level {w.level}</span>
            <b>{w.score}<small className="lv"> {w.kind === 'bowl' ? `vs <${bowlTarget(w.level)}` : `vs ${batTarget(w.level)}`}</small></b>
          </li>
        ))}
      </ul>
      {log.length > 8 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${log.length}`}</button>}
    </>
  )
}

function Stats({ stats, onBack, onOpenMatch, onBackup }) {
  const today = new Date()
  const key = (d) => todayKey(d)
  const played = (k) => stats.history[k] || stats.history['bowl:' + k]
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (27 - i))
    const k = key(d)
    const hit = [stats.history[k], stats.history['bowl:' + k], stats.history['super:' + k], stats.history['full:' + k]].filter(Boolean)
    return { k, n: d.getDate(), played: hit.length > 0, won: hit.some((h) => h.won), today: i === 27 }
  })
  const recent = Object.entries(stats.history)
    .map(([k, v]) => ({ kind: k.startsWith('bowl:') ? 'bowl' : k.startsWith('super:') ? 'super' : 'bat', day: k.replace(/^(bowl|super):/, ''), ...v }))
    .sort((x, y) => (y.day + y.kind).localeCompare(x.day + x.kind)).slice(0, 8)
  const earned = BADGES.filter((b) => b.test(stats))
  return (
    <main className="stats-screen">
      <header><button className="link" onClick={onBack}>← Back</button><b>Stats &amp; badges</b><button className="link" onClick={onBackup}>☁️ Backup</button></header>
      <div className="stats">
        <div><b>🔥 {liveStreak(stats)}</b><span>current streak</span></div>
        <div><b>{Math.max(stats.bestStreak || 0, liveStreak(stats))}</b><span>best streak</span></div>
        <div><b>🧊 {stats.freezes || 0}</b><span>streak freezes</span></div>
      </div>
      <div className="stats">
        <div><b>{stats.wins}</b><span>total wins</span></div>
        <div><b>{stats.batCleared || 0}/{BAT_LEVELS}</b><span>batting cleared</span></div>
        <div><b>{stats.bowlCleared || 0}/{BOWL_LEVELS}</b><span>bowling cleared</span></div>
      </div>
      <h2>Levels won</h2>
      <LevelGrid title="🏏 Batting" kind="bat" total={BAT_LEVELS} cleared={stats.batCleared || 0} frontier={stats.batLevel} data={(stats.lvl || {}).bat || {}} />
      <LevelGrid title="🎯 Bowling" kind="bowl" total={BOWL_LEVELS} cleared={stats.bowlCleared || 0} frontier={stats.bowlLevel} data={(stats.lvl || {}).bowl || {}} />
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
      <MatchHistory onOpen={onOpenMatch} />
      {(() => {
        const ms = loadMatches(); const first = ms.length ? ms[ms.length - 1].day : '9999'
        const legacy = (stats.winLog || []).filter((w) => w.day < first)
        return legacy.length ? <WinHistory log={legacy} title="Earlier wins" /> : null
      })()}
    </main>
  )
}
