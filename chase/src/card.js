// Draws a shareable result card (PNG) with canvas. No external assets.
export async function makeCard({ mode, level, score, wickets, won, line, names, footer }) {
  const F = '"Plus Jakarta Sans Variable", system-ui, sans-serif'
  try { await Promise.all([document.fonts.load(`800 100px ${F}`), document.fonts.load(`600 40px ${F}`)]) } catch {}
  const W = 1080, H = 1350
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#5b5bf0'); bg.addColorStop(1, '#8b5cf6')
  g.fillStyle = bg; g.fillRect(0, 0, W, H)
  g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(W - 120, 140, 320, 0, Math.PI * 2); g.fill()
  g.fillStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.arc(120, H - 160, 260, 0, Math.PI * 2); g.fill()
  g.textAlign = 'center'
  g.fillStyle = '#fff'; g.font = `800 54px ${F}`; g.fillText('CHASE 300', W / 2, 118)
  g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `600 38px ${F}`; g.fillText(`${mode} · Level ${level}`, W / 2, 178)
  // score card
  g.fillStyle = 'rgba(255,255,255,.96)'; g.beginPath(); g.roundRect(80, 230, W - 160, 420, 48); g.fill()
  g.fillStyle = '#121936'; g.font = `800 230px ${F}`
  const sc = String(score), sw = g.measureText(sc).width
  g.fillText(sc, W / 2 - 40, 470)
  g.textAlign = 'left'; g.fillStyle = '#667090'; g.font = `800 90px ${F}`; g.fillText(`/${wickets}`, W / 2 - 40 + sw / 2 + 10, 470)
  g.textAlign = 'center'
  // shrink-to-fit so long verdicts are never cut off
  const fit = (text, weight, start, maxW) => { let s = start; g.font = `${weight} ${s}px ${F}`; while (g.measureText(text).width > maxW && s > 20) { s -= 2; g.font = `${weight} ${s}px ${F}` } }
  g.fillStyle = won ? '#d97706' : '#5b5bf0'
  const head = won ? '🏆 Level cleared!' : line
  fit(head, 800, 46, W - 220); g.fillText(head, W / 2, 570)
  if (won) { g.fillStyle = '#667090'; fit(line, 600, 32, W - 220); g.fillText(line, W / 2, 615) }
  // lineup
  g.textAlign = 'left'; g.font = `700 40px ${F}`
  const colW = 440, x0 = 130, y0 = 790, rowH = 74
  names.forEach((n, i) => {
    const col = i < 6 ? 0 : 1, row = col === 0 ? i : i - 6
    const x = x0 + col * (colW + 60), y = y0 + row * rowH
    g.fillStyle = 'rgba(255,255,255,.65)'; g.fillText(String(i + 1), x, y)
    g.fillStyle = '#fff'; g.fillText(n.length > 16 ? n.slice(0, 15) + '…' : n, x + 62, y)
  })
  g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `600 34px ${F}`
  g.fillText(footer, W / 2, H - 70)
  return new Promise((res) => c.toBlob(res, 'image/png'))
}

export async function shareCard(opts) {
  const blob = await makeCard(opts)
  const file = new File([blob], 'chase300-result.png', { type: 'image/png' })
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return 'shared' }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled' }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  return 'downloaded'
}
