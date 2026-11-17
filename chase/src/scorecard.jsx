import React from 'react'
import { BOWL_SLOTS } from './data.js'
import { oversStr } from './util.js'

// ---------- stats derived from the ball-by-ball events ----------
const PP = 36   // overs 1-6
const MID = 90  // overs 7-15; overs 16-20 are the death
const phaseOf = (ball) => (ball <= PP ? 'pp' : ball <= MID ? 'mid' : 'death')
const ovFmt = (ball) => `${Math.floor((ball - 1) / 6)}.${((ball - 1) % 6) + 1}`

export function inningsStats(events) {
  const ph = { pp: { runs: 0, wkts: 0, balls: 0 }, mid: { runs: 0, wkts: 0, balls: 0 }, death: { runs: 0, wkts: 0, balls: 0 } }
  let dots = 0, fours = 0, sixes = 0
  const fow = []
  for (const e of events) {
    const p = ph[phaseOf(e.ball)]
    p.runs += e.runs; p.balls += 1
    if (e.wicket) { p.wkts += 1; fow.push({ n: e.wickets, score: e.score, over: ovFmt(e.ball), name: e.batter }) }
    if (e.runs === 0) dots += 1
    if (e.runs === 4) fours += 1
    if (e.runs === 6) sixes += 1
  }
  const balls = events.length
  const score = balls ? events[balls - 1].score : 0
  const bRuns = fours * 4 + sixes * 6
  return {
    ph, dots, fours, sixes, fow, balls, score,
    rr: balls ? (score * 6) / balls : 0,
    dotPct: balls ? Math.round((dots * 100) / balls) : 0,
    boundaryPct: score ? Math.round((bRuns * 100) / score) : 0,
  }
}
const sr = (runs, balls) => (balls ? ((runs * 100) / balls).toFixed(1) : '–')
const eco = (runs, balls) => (balls ? ((runs * 6) / balls).toFixed(1) : '–')
const phaseText = (p) => (p.balls ? `${p.runs}/${p.wkts}` : '–')

function Tiles({ items }) {
  return (
    <div className="tiles">
      {items.map(([label, value, sub]) => (
        <div className="tile" key={label}><small>{label}</small><b>{value}</b>{sub ? <span>{sub}</span> : null}</div>
      ))}
    </div>
  )
}

// ---------- batting scorecard ----------
export function BatCard({ result }) {
  const st = inningsStats(result.events)
  const rows = result.card
  const top = rows.reduce((b, c, i) => (c.runs > (rows[b]?.runs ?? -1) ? i : b), 0)
  const tot = rows.reduce((a, c) => ({ r: a.r + c.runs, b: a.b + c.balls, f: a.f + c.fours, s: a.s + c.sixes }), { r: 0, b: 0, f: 0, s: 0 })
  const best = rows[top]
  return (
    <section className="sc">
      <div className="sc-wrap">
        <table className="sc-table">
          <thead>
            <tr><th className="l">Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const bat = c.balls > 0
              return (
                <tr key={i} className={(bat ? '' : 'dnb ') + (bat && i === top ? 'best' : '')}>
                  <td className="l">
                    <b>{c.name}{bat && !c.out ? '*' : ''}{c.runs >= 100 ? ' 💯' : c.runs >= 50 ? ' 🔥' : ''}</b>
                    <small>{bat ? (c.out ? 'out' : 'not out') : 'did not bat'}</small>
                  </td>
                  <td className="r">{bat ? c.runs : '–'}</td>
                  <td>{bat ? c.balls : '–'}</td>
                  <td>{bat ? c.fours : '–'}</td>
                  <td>{bat ? c.sixes : '–'}</td>
                  <td>{bat ? sr(c.runs, c.balls) : '–'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="l"><b>Total</b><small>{result.score}/{result.wickets} · {oversStr(result.ballsUsed)} ov</small></td>
              <td className="r">{result.score}</td><td>{result.ballsUsed}</td><td>{tot.f}</td><td>{tot.s}</td><td>{sr(result.score, result.ballsUsed)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {st.fow.length > 0 && (
        <p className="fow"><b>Fall of wickets</b> {st.fow.map((f) => `${f.n}-${f.score} (${f.name}, ${f.over} ov)`).join(' · ')}</p>
      )}
      <Tiles items={[
        ['Run rate', st.rr.toFixed(2), 'per over'],
        ['Top scorer', best && best.balls ? `${best.name} ${best.runs}` : '–', best && best.balls ? `${best.balls} balls · SR ${sr(best.runs, best.balls)}` : ''],
        ['Powerplay (1-6)', phaseText(st.ph.pp), 'runs/wkts'],
        ['Middle (7-15)', phaseText(st.ph.mid), 'runs/wkts'],
        ['Death (16-20)', phaseText(st.ph.death), 'runs/wkts'],
        ['Boundaries', `${st.fours + st.sixes}`, `${st.fours}×4 · ${st.sixes}×6 · ${st.boundaryPct}% of runs`],
        ['Dot balls', `${st.dots}`, `${st.dotPct}% of deliveries`],
        ['Balls per boundary', st.fours + st.sixes ? (st.balls / (st.fours + st.sixes)).toFixed(1) : '–', ''],
      ]} />
    </section>
  )
}

// ---------- bowling scorecard ----------
export function BowlCard({ result }) {
  const st = inningsStats(result.events)
  const per = {}
  for (const e of result.events) {
    const x = (per[e.bowler] ||= { dots: 0, fours: 0, sixes: 0 })
    if (e.runs === 0) x.dots += 1
    if (e.runs === 4) x.fours += 1
    if (e.runs === 6) x.sixes += 1
  }
  const tot = result.figs.reduce((a, f) => ({ b: a.b + f.balls, r: a.r + f.runs, w: a.w + f.wkts, d: a.d + (per[f.name]?.dots || 0) }), { b: 0, r: 0, w: 0, d: 0 })
  const bestFig = [...result.figs].filter((f) => f.balls).sort((a, b) => b.wkts - a.wkts || a.runs - b.runs)[0]
  return (
    <section className="sc">
      <div className="sc-wrap">
        <table className="sc-table">
          <thead>
            <tr><th className="l">Bowler</th><th>O</th><th>0s</th><th>R</th><th>W</th><th>Econ</th></tr>
          </thead>
          <tbody>
            {result.figs.map((f, i) => (
              <tr key={i} className={f.balls ? '' : 'dnb'}>
                <td className="l"><b>{f.name}</b><small>{BOWL_SLOTS[i]}</small></td>
                <td>{f.balls ? oversStr(f.balls) : '–'}</td>
                <td>{f.balls ? per[f.name]?.dots || 0 : '–'}</td>
                <td>{f.balls ? f.runs : '–'}</td>
                <td className="r">{f.balls ? f.wkts : '–'}</td>
                <td>{f.balls ? eco(f.runs, f.balls) : '–'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="l"><b>Total</b><small>{result.score}/{result.wickets}</small></td>
              <td>{oversStr(tot.b)}</td><td>{tot.d}</td><td>{tot.r}</td><td className="r">{tot.w}</td><td>{eco(tot.r, tot.b)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {st.fow.length > 0 && (
        <p className="fow"><b>Wickets</b> {st.fow.map((f) => `${f.n}-${f.score} (${f.name}, ${f.over} ov)`).join(' · ')}</p>
      )}
      <Tiles items={[
        ['Economy', eco(tot.r, tot.b), 'runs per over'],
        ['Best bowler', bestFig ? bestFig.name : '–', bestFig ? `${bestFig.wkts}/${bestFig.runs} in ${oversStr(bestFig.balls)} ov` : ''],
        ['Powerplay (1-6)', phaseText(st.ph.pp), 'runs/wkts'],
        ['Middle (7-15)', phaseText(st.ph.mid), 'runs/wkts'],
        ['Death (16-20)', phaseText(st.ph.death), 'runs/wkts'],
        ['Dot balls', `${st.dots}`, `${st.dotPct}% of deliveries`],
        ['Boundaries conceded', `${st.fours + st.sixes}`, `${st.fours}×4 · ${st.sixes}×6`],
        ['Bowled out in', result.allOut ? `${oversStr(result.ballsUsed)} ov` : 'not out', ''],
      ]} />
    </section>
  )
}
