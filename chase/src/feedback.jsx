import React, { useState } from 'react'
import { sendFeedback } from './api.js'
import { track } from './analytics.js'

const TYPES = [['bug', '🐞 Something broke'], ['idea', '💡 I have an idea'], ['other', '💬 Something else']]

export default function Feedback({ onBack }) {
  const [type, setType] = useState('idea')
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [phase, setPhase] = useState('ask') // ask | sending | done | error
  const [msg, setMsg] = useState('')
  const send = async () => {
    if (text.trim().length < 5) { setMsg('Please write a little more.'); return }
    setPhase('sending'); setMsg('')
    try { await sendFeedback(type, text, contact, window.innerWidth + 'x' + window.innerHeight); track('feedback', { type }); setPhase('done') }
    catch (e) { setMsg(e.message || 'Could not send. Try again.'); setPhase(e.status === 429 ? 'ask' : 'error') }
  }
  return (
    <main className="feedback">
      <header><button className="link" onClick={onBack}>← Back</button><b>Send feedback</b><span /></header>
      {phase === 'done' ? (
        <>
          <div className="card" style={{ textAlign: 'center' }}><div style={{ fontSize: '2.4rem' }}>🙏</div><b>Thank you!</b><p className="mut">We read every message.</p></div>
          <button className="primary" onClick={onBack}>Back to the game</button>
        </>
      ) : (
        <>
          <p className="hint">Found a bug, or want a feature? Tell us. It goes straight to the team.</p>
          <div className="tabs">{TYPES.map(([k, l]) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>{l}</button>)}</div>
          <textarea value={text} maxLength={600} rows={6} placeholder={type === 'bug' ? 'What happened? What did you tap before it broke?' : 'What should we add or change?'} onChange={(e) => setText(e.target.value)} />
          <small className="mut">{text.length}/600</small>
          <input value={contact} maxLength={60} placeholder="Optional: a way to reach you (email or phone)" onChange={(e) => setContact(e.target.value)} />
          <small className="mut">We only use your contact to reply. Leave it blank to stay anonymous. No names or scores are attached.</small>
          {msg && <p className="warn">{msg}</p>}
          <button className="primary" disabled={phase === 'sending'} onClick={send}>{phase === 'sending' ? 'Sending…' : phase === 'error' ? 'Retry' : 'Send feedback'}</button>
        </>
      )}
    </main>
  )
}
