// Display-name safety, shared by the app (instant feedback) and the server (the real check).
// A deliberately small list of common offensive words; the admin page handles anything that slips through.
const BAD = ['fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'cock', 'pussy', 'cunt', 'slut', 'whore', 'nigga', 'nigger', 'faggot', 'fag', 'retard', 'rape', 'rapist', 'nazi', 'hitler', 'porn', 'sex', 'boob', 'penis', 'vagina', 'anus', 'wank', 'twat', 'bollock', 'chut', 'madarchod', 'behenchod', 'bhosd', 'randi', 'harami', 'kutta', 'saala', 'mc', 'bc', 'terror', 'isis', 'fucker', 'fucking', 'shitty', 'bullshit', 'shithead', 'dickhead', 'asshat', 'jackass', 'dumbass', 'motherfucker', 'cocksucker']
const SUB = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' }
const squash = (s) => String(s).toLowerCase().replace(/[01345 7@$!]/g, (c) => SUB[c] || '').replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1')
const tokenize = (name) => String(name || '').toLowerCase().split(/[^a-z0-9@$!]+/).filter(Boolean).map(squash)
export function badName(name) {
  const sq = squash(name), tokens = tokenize(name)
  // short words (up to 4 letters: mc, bc, sex, cunt...) only count as whole words (after un-leeting) so "Mcgrath" or "Scunthorpe" are fine
  return BAD.some((w) => { const q = squash(w); return w.length <= 4 ? tokens.includes(q) || sq === q : sq.includes(q) })
}
