export {}

/**
 * Reproduces the "host has a small network dip, everyone lags and stutters"
 * report as a pure state-machine test.
 *
 * Old behaviour: the host's own wobble emptied the live-peer set, flipped
 * every player offline, bumped the room version and re-broadcast the entire
 * room; recovery did it all again. Two full-table rewrites per wobble.
 */

const PRESENCE_GRACE_MS = 10000

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}

interface P { id: string; peerId: string; connected: boolean }

function simulate(useHysteresis: boolean, timeline: { t: number; live: string[] }[]) {
  const players: P[] = [
    { id: 'host', peerId: 'peerH', connected: true },
    { id: 'a', peerId: 'peerA', connected: true },
    { id: 'b', peerId: 'peerB', connected: true },
    { id: 'c', peerId: 'peerC', connected: true },
  ]
  const lastSeen = new Map<string, number>()
  let commits = 0

  for (const frame of timeline) {
    const live = new Set(frame.live)
    for (const p of live) lastSeen.set(p, frame.t)

    const knownPeers = players.filter(p => p.id !== 'host').length
    const selfIsolated = knownPeers > 0 && live.size <= 1
    if (useHysteresis && selfIsolated) continue

    const reachable = (peerId: string) => {
      if (live.has(peerId)) return true
      if (!useHysteresis) return false
      const seen = lastSeen.get(peerId)
      return seen !== undefined && frame.t - seen < PRESENCE_GRACE_MS
    }

    let changed = false
    for (const p of players) {
      if (p.id === 'host') continue
      const on = reachable(p.peerId)
      if (on !== p.connected) { p.connected = on; changed = true }
    }
    if (changed) commits++
  }
  return { commits, players }
}

// A 4 second host wobble: all peers vanish, then all return.
const wobble = [
  { t: 0,     live: ['peerH', 'peerA', 'peerB', 'peerC'] },
  { t: 3000,  live: ['peerH'] },                                  // dip starts
  { t: 6000,  live: ['peerH'] },
  { t: 9000,  live: ['peerH', 'peerA', 'peerB', 'peerC'] },       // recovered
  { t: 12000, live: ['peerH', 'peerA', 'peerB', 'peerC'] },
]

{
  const oldRun = simulate(false, wobble)
  const newRun = simulate(true, wobble)

  check(oldRun.commits >= 2, `OLD: host wobble rewrote the table ${oldRun.commits}x (reproduces the stutter)`)
  check(newRun.commits === 0, `NEW: host wobble causes ${newRun.commits} table rewrites`)
  check(newRun.players.every(p => p.connected), 'NEW: nobody was wrongly evicted during the dip')
}

// A genuine departure must still be recorded.
const realLeave = [
  { t: 0,     live: ['peerH', 'peerA', 'peerB', 'peerC'] },
  { t: 3000,  live: ['peerH', 'peerA', 'peerB'] },   // c leaves for good
  { t: 9000,  live: ['peerH', 'peerA', 'peerB'] },
  { t: 15000, live: ['peerH', 'peerA', 'peerB'] },   // past the grace window
  { t: 21000, live: ['peerH', 'peerA', 'peerB'] },
]
{
  const run = simulate(true, realLeave)
  const c = run.players.find(p => p.id === 'c')!
  check(!c.connected, 'a genuine departure is still recorded as offline')
  check(run.players.filter(p => p.id !== 'c' && p.id !== 'host').every(p => p.connected),
    'the remaining players stay online')
  check(run.commits === 1, `a real departure costs exactly 1 rewrite (got ${run.commits})`)
}

// A brief single-peer blip must not evict that peer.
const blip = [
  { t: 0,    live: ['peerH', 'peerA', 'peerB', 'peerC'] },
  { t: 3000, live: ['peerH', 'peerA', 'peerB'] },              // c blips out
  { t: 6000, live: ['peerH', 'peerA', 'peerB', 'peerC'] },     // and returns
  { t: 9000, live: ['peerH', 'peerA', 'peerB', 'peerC'] },
]
{
  const run = simulate(true, blip)
  check(run.commits === 0, `a 3s single-peer blip causes ${run.commits} rewrites`)
  check(run.players.every(p => p.connected), 'the blipping peer was never evicted')
}

console.log(failures === 0 ? '\nALL HOST DIP TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
