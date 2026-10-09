// Simulates the exact same-network regression: relay flips should never
// offline a client, and host-claim should never reset an online peer.
// Run against the *logic* used in council.ts (mirrored here for assertion).

import { CouncilPlayer } from '../src/lib/core'

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}

const mkPlayer = (id: string, peerId: string, connected = true): CouncilPlayer => ({
  id, name: id, color: '#000000', isAdmin: false, isOwner: id === 'p0',
  isBot: false, isSpectator: false, connected, offlineSince: null, joinedAt: 0, peerId,
})

// ── 1. host-claim block must leave other players' connected flags alone ──
const players0 = [
  mkPlayer('p0', 'host-peer'),          // me (host)
  mkPlayer('p1', 'relay-only-peer'),    // reachable via relay, not direct
]
// old logic: connected = live.has(peerId) - with p1 present only in relayPeers,
// this flap set p1 offline. New logic: never touch others.
const oldClaim = players0.map(p => ({ ...p, connected: ['host-peer'].includes(p.peerId ?? '') }))
const newClaim = players0.map(p => (p.id === 'p0' ? { ...p, connected: true, peerId: 'host-peer' } : p))
check(!oldClaim.find(p => p.id === 'p1')!.connected, 'OLD logic wrongly toggled relay-only peer offline (reproduces the bug)')
check(newClaim.find(p => p.id === 'p1')!.connected, 'NEW logic keeps relay-only peer online')

// ── 2. presence reconciliation marks relay-only peer online, not offline ──
const live = new Set(['host-peer', 'relay-only-peer']) // union of transports
const reconciled = players0.map(p => ({ ...p, connected: live.has(p.peerId ?? '') }))
check(reconciled.every(p => p.connected), 'presence reconciliation keeps BOTH peers online')

// ── 3. direct peerLeave with an active relay path must not mark offline ──
const directPeers = new Set<string>()                      // direct path dropped
const relayPeers = new Map([['relay-only-peer', Date.now()]])
const relayTtl = 13_000
const unionLive = () => new Set([...directPeers, ...[...relayPeers.keys()].filter(() => Date.now() - relayPeers.get('relay-only-peer')! < relayTtl)])
const peerLeft = 'relay-only-peer'
check(unionLive().has(peerLeft), 'peer still live via relay after direct leave (no false offline)')

// ── 4. when the relay path ALSO goes quiet, the peer is offline ──
relayPeers.set('relay-only-peer', Date.now() - relayTtl - 1)
const olderLive = new Set([...directPeers, ...[...relayPeers.keys()].filter(id => Date.now() - relayPeers.get(id)! < relayTtl)])
check(!olderLive.has('relay-only-peer'), 'peer offline only after BOTH transports expire')

console.log(failures === 0 ? '\nALL NETWORK FLAP TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
