import React, { useState } from 'react'
import { loadMatches, expandMatch } from './matches.js'
import { BatCard, BowlCard } from './scorecard.jsx'
import { oversStr } from './util.js'

const KIND = { bat: ['🏏', 'Batting'], bowl: ['🎯', 'Bowling'], super: ['⚡', 'Super Over'], full: ['🏟️', 'Full match'] }
const modeText = (m) => (m.mode === 'vs' ? 'Challenge' : m.mode === 'daily' ? 'Daily' : 'Free play')
const resultText = (m) => {
  if (m.kind === 'super') return m.won ? 'Win' : m.tie ? 'Tie' : 'Loss'
  if (m.kind === 'full') return m.text || (m.won ? 'Won' : m.tie ? 'Tied' : 'Lost')
  if (m.mode === 'vs') return m.vs === 'first' ? 'Set the score' : m.won ? 'Beat it' : m.tie ? 'Tied' : 'Fell short'
  return m.won ? 'Beaten' : 'Not beaten'
}

export function MatchHistory({ onOpen, firstWinOnly }) {
  const all = loadMatches()
  const [wins, setWins] = useState(!!firstWinOnly)
  const [more, setMore] = useState(false)
  const list = wins ? all.filter((m) => m.won) : all
  const shown = more ? list : list.slice(0, 8)
  return (
    <>
      <h2>My matches <small>{all.length}</small></h2>
      {all.length > 0 && (
        <div className="tabs">
          <button className={!wins ? 'on' : ''} onClick={() => setWins(false)}>All</button>
          <button className={wins ? 'on' : ''} onClick={() => setWins(true)}>Wins</button>
        </div>
      )}
      {all.length === 0 && <p className="line">Your matches are saved here with the full scorecard. Play one!</p>}
      <ul className="matches">
        {shown.map((m) => (
          <li key={m.id} onClick={() => onOpen(m)} className={m.won ? 'won' : ''}>
            <span className="mi">{KIND[m.kind][0]}</span>
            <span className="mt"><b>{KIND[m.kind][1]}{m.level ? ` · Level ${m.level}` : ''}</b><small>{m.day} · {modeText(m)}</small></span>
            <span className="ms"><b>{m.kind === 'full' ? `${m.score} v ${m.oppScore}` : `${m.score}${m.kind === 'super' ? '' : `/${m.wickets}`}`}</b><small className={m.won ? 'w' : ''}>{resultText(m)}{m.balls && m.kind !== 'full' ? ` · ${oversStr(m.balls)} ov` : ''}</small></span>
          </li>
        ))}
      </ul>
      {list.length > 8 && <button className="link" onClick={() => setMore(!more)}>{more ? 'Show fewer' : `Show all ${list.length}`}</button>}
    </>
  )
}

export function MatchView({ m, onBack }) {
  const res = expandMatch(m)
  const [icon, name] = KIND[m.kind]
  const full = m.kind === 'full'
  return (
    <main className="stats-screen matchview">
      <header><button className="link" onClick={onBack}>← Back</button><b>{icon} {name}{m.level ? ` · Level ${m.level}` : ''}</b><span /></header>
      <div className="card mv-top">
        <small>{m.day} · {modeText(m)}</small>
        <div className={'big' + (m.won ? ' win' : '')}>{full ? `${m.score} v ${m.oppScore}` : <>{m.score}{m.kind === 'super' ? '' : <small>/{m.wickets}</small>}</>}</div>
        <span className="mv-res">{full ? `${m.text}${m.opp ? ` · vs ${m.opp.n} ${m.opp.y}` : ''}${m.first === 'bowl' ? ' · bowled first' : ' · batted first'}` : m.kind === 'super' ? `${resultText(m)} · you ${m.score} vs ${m.opp ? m.opp.s : '?'}${m.opp ? ` (${m.opp.n} ${m.opp.y})` : ''}` : m.mode === 'vs' ? resultText(m) : m.won ? `✅ Beat level ${m.level}` : `Level ${m.level} not beaten`}
          {m.kind === 'bat' && m.target && m.target < 9999 ? ` · target ${m.target}` : ''}{m.kind === 'bowl' && m.target && m.target < 9999 ? ` · limit ${m.target - 1}` : ''}
          {m.kind === 'bowl' && m.opp ? ` · vs ${m.opp.n} ${m.opp.y}` : ''}{m.balls ? ` · ${oversStr(m.balls)} ov` : ''}</span>
      </div>
      <div className="card mv-team">
        <b>{m.kind === 'bowl' ? 'Your attack' : m.kind === 'super' ? 'Your Super Over side' : 'Your XI'}</b>
        <div className="mv-picks">
          {m.picks.map((p, i) => <span key={i} className={m.cap === p.n ? 'c' : ''}>{m.cap === p.n ? '⭐ ' : ''}{p.n} <small>{p.t} {String(p.y).slice(2)}</small></span>)}
        </div>
      </div>
      {full && res && (
        <>
          <h2>{m.first === 'bowl' ? '🎯 Bowling (1st innings)' : '🏏 Batting (1st innings)'}</h2>
          {m.first === 'bowl' ? <BowlCard result={res.bowl} /> : <BatCard result={res.bat} />}
          <h2>{m.first === 'bowl' ? '🏏 Batting (2nd innings)' : '🎯 Bowling (2nd innings)'}</h2>
          {m.first === 'bowl' ? <BatCard result={res.bat} /> : <BowlCard result={res.bowl} />}
        </>
      )}
      {res && m.kind === 'bat' && <BatCard result={res} />}
      {res && m.kind === 'bowl' && <BowlCard result={res} />}
    </main>
  )
}
