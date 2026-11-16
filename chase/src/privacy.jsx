import React, { useState } from 'react'
import { AGE_BANDS, STATES, TEAM_CITIES } from './profile.js'
import { saveProfile, deleteProfile, deleteMe } from './api.js'
import { analyticsOn, setAnalytics, setMinor, isMinor, getProfile, setProfile, track } from './analytics.js'

export default function Privacy({ onBack }) {
  const saved = getProfile() || {}
  const [on, setOn] = useState(analyticsOn())
  const [age, setAge] = useState(saved.age || '')
  const [state, setState] = useState(saved.state || '')
  const [team, setTeam] = useState(saved.team || '')
  const [consent, setConsent] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const minor = isMinor()

  const toggle = () => { const n = !on; setAnalytics(n); setOn(analyticsOn()) }
  const save = async () => {
    setMsg('')
    if (age === 'u18') {
      setMinor(true); setProfile(null); setOn(false)
      try { await deleteProfile() } catch {}
      setMsg("Thanks for telling us. For players under 18 we don't store any profile details and we switch off usage stats. You can keep playing as normal.")
      return
    }
    if (!age || !state || !team) { setMsg('Please choose all three.'); return }
    if (!consent) { setMsg('Please tick the box to agree.'); return }
    setBusy(true)
    try { await saveProfile({ age, state, team }); setMinor(false); setProfile({ age, state, team }); track('profile_saved'); setMsg('Saved. Thank you! You can change or delete this any time.') }
    catch { setMsg("Couldn't save right now. Please try again.") }
    setBusy(false)
  }
  const removeProfile = async () => { setBusy(true); try { await deleteProfile() } catch {} setProfile(null); setAge(''); setState(''); setTeam(''); setConsent(false); setMsg('Your profile details were deleted.'); setBusy(false) }
  const wipe = async () => {
    if (!window.confirm('Delete everything we hold about you on our servers? This removes your profile, leaderboard scores, challenge entries, reminder subscription and usage stats. Progress on this phone stays.')) return
    setBusy(true)
    try { const r = await deleteMe(); setProfile(null); setAge(''); setState(''); setTeam(''); setMsg(`Done. Removed your server data (${r.removedScores} leaderboard scores).`) }
    catch { setMsg("Couldn't reach the server. Please try again.") }
    setBusy(false)
  }

  return (
    <main className="privacy">
      <header><button className="link" onClick={onBack}>← Back</button><b>Privacy &amp; data</b><span /></header>

      <section className="card pv">
        <div className="pv-row">
          <div><b>Anonymous usage stats</b><small>Helps us see what to improve. No name, no phone number, no location. {minor && 'Switched off because you said you are under 18.'}</small></div>
          <button className={'switch' + (on ? ' on' : '')} onClick={toggle} disabled={minor} aria-pressed={on} aria-label="Toggle anonymous usage stats"><i /></button>
        </div>
      </section>

      <section className="card pv">
        <b>About you <small className="optl">optional</small></b>
        <small>Helps us understand our players and show advertisers or sponsors <u>group</u> numbers only (never individuals). Players under 18 are never profiled.</small>
        <div className="pv-grid">
          <label>Age<select value={age} onChange={(e) => setAge(e.target.value)}><option value="">Choose</option>{AGE_BANDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>State<select value={state} onChange={(e) => setState(e.target.value)}><option value="">Choose</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="wide">Favourite team city<select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">Choose</option>{TEAM_CITIES.map((s) => <option key={s}>{s}</option>)}</select></label>
        </div>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>I agree to share these details with Chase 300 for audience statistics. I can delete them at any time.</span></label>
        <div className="pv-btns">
          <button className="primary" onClick={save} disabled={busy}>Save</button>
          {saved.age && <button className="ghost" onClick={removeProfile} disabled={busy}>Delete my profile</button>}
        </div>
      </section>

      {msg && <p className="pv-msg">{msg}</p>}

      <section className="card pv">
        <b>Your data</b>
        <button className="ghost" onClick={wipe} disabled={busy}>Delete all my data from the server</button>
        <a className="link" href="/privacy.html">Read the full privacy policy</a>
      </section>
    </main>
  )
}
