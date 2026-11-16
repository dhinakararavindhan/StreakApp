import React, { useState } from 'react'
import { getCode, lastBackup, enableBackup, backup, removeBackup, restore, normalise } from './cloud.js'

export default function Backup({ onBack, onRestored }) {
  const [code, setCode] = useState(getCode())
  const [at, setAt] = useState(lastBackup())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [entry, setEntry] = useState('')
  const [copied, setCopied] = useState(false)
  const when = (t) => (t ? new Date(t).toLocaleString() : '')

  const turnOn = async () => { setBusy(true); setMsg(''); try { const c = await enableBackup(); setCode(c); setAt(lastBackup()); setMsg('Backed up. Save the code above somewhere safe.') } catch { setMsg("Couldn't reach the server. Try again.") } setBusy(false) }
  const now = async () => { setBusy(true); setMsg(''); try { await backup(); setAt(lastBackup()); setMsg('Backed up just now.') } catch { setMsg("Couldn't reach the server. Try again.") } setBusy(false) }
  const turnOff = async () => { if (!window.confirm('Remove your cloud backup? Your progress on this phone stays.')) return; setBusy(true); await removeBackup(); setCode(null); setAt(null); setMsg('Cloud backup removed.'); setBusy(false) }
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true) } catch { setMsg('Select the code and copy it manually.') } }
  const doRestore = async () => {
    setBusy(true); setMsg('')
    try {
      const r = await restore(entry)
      setCode(getCode()); setAt(lastBackup()); onRestored && onRestored()
      setMsg(`Restored: ${r.matches} saved matches, batting level ${r.batCleared} beaten, bowling level ${r.bowlCleared} beaten.`)
    } catch (e) { setMsg(e.status === 404 ? 'No backup found for that code. Check it and try again.' : e.message || "Couldn't restore.") }
    setBusy(false)
  }

  return (
    <main className="privacy">
      <header><button className="link" onClick={onBack}>← Back</button><b>Save your progress</b><span /></header>

      <section className="card pv">
        <b>☁️ Cloud backup</b>
        <small>Saves your levels, streak, stats and every match to our server, so a new phone or a cleared browser doesn't wipe it. No email or password needed: you get a private recovery code.</small>
        {!code && <button className="primary" onClick={turnOn} disabled={busy}>Back up my progress</button>}
        {code && (
          <>
            <div className="bk-code" aria-label="recovery code">{code}</div>
            <div className="pv-btns">
              <button className="ghost" onClick={copy}>{copied ? 'Copied!' : 'Copy code'}</button>
              <button className="ghost" onClick={now} disabled={busy}>Back up now</button>
            </div>
            <small>Keep this code like a password: anyone who has it can restore (or overwrite) your progress. We can't recover it for you. {at && <>Last backed up {when(at)}. Backups update automatically after each match.</>}</small>
            <button className="link" onClick={turnOff} disabled={busy}>Remove cloud backup</button>
          </>
        )}
      </section>

      <section className="card pv">
        <b>📲 Restore on this phone</b>
        <small>Got a recovery code from another phone? Enter it to bring your progress here.</small>
        <input value={entry} onChange={(e) => setEntry(normalise(e.target.value) || e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" spellCheck="false" />
        <button className="primary" onClick={doRestore} disabled={busy || entry.length < 19}>Restore</button>
      </section>

      {msg && <p className="pv-msg">{msg}</p>}
    </main>
  )
}
