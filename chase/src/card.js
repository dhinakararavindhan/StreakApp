// Draws a shareable result card (PNG) with canvas. No external assets.
export async function makeCard({ mode, level, score, wickets, won, line, names, footer }) {
  const W = 1080, H = 1350
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#070a1c'; g.fillRect(0, 0, W, H)
  const grad = g.createRadialGradient(W / 2, 330, 40, W / 2, 330, 700)
  grad.addColorStop(0, won ? 'rgba(245,185,66,.28)' : 'rgba(80,100,200,.18)'); grad.addColorStop(1, 'rgba(7,10,28,0)')
  g.fillStyle = grad; g.fillRect(0, 0, W, H)
  g.textAlign = 'center'
  g.fillStyle = '#f5b942'; g.font = '800 54px system-ui, sans-serif'; g.fillText('CHASE 300', W / 2, 120)
  g.fillStyle = '#8b93c4'; g.font = '600 38px system-ui, sans-serif'; g.fillText(`${mode} · Level ${level}`, W / 2, 182)
  g.fillStyle = '#eef1ff'; g.font = '900 250px system-ui, sans-serif'; g.fillText(String(score), W / 2 - 60, 470)
  const sw = g.measureText(String(score)).width
  g.fillStyle = '#8b93c4'; g.font = '800 96px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(`/${wickets}`, W / 2 - 60 + sw / 2 + 12, 470)
  g.textAlign = 'center'
  g.fillStyle = won ? '#f5b942' : '#eef1ff'; g.font = '800 48px system-ui, sans-serif'; g.fillText(won ? '🏆 Level cleared!' : line, W / 2, 575)
  g.fillStyle = '#8b93c4'; g.font = '600 36px system-ui, sans-serif'; g.fillText(won ? line : '', W / 2, 630)
  // lineup
  g.textAlign = 'left'; g.font = '600 40px system-ui, sans-serif'
  const colW = 460, x0 = 110, y0 = 740, rowH = 74
  names.forEach((n, i) => {
    const col = i < 6 ? 0 : 1, row = col === 0 ? i : i - 6
    const x = x0 + col * (colW + 40), y = y0 + row * rowH
    g.fillStyle = '#f5b942'; g.fillText(String(i + 1), x, y)
    g.fillStyle = '#eef1ff'; g.fillText(n.length > 17 ? n.slice(0, 16) + '…' : n, x + 56, y)
  })
  g.textAlign = 'center'; g.fillStyle = '#8b93c4'; g.font = '600 34px system-ui, sans-serif'
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
