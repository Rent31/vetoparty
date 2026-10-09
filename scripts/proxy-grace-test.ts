import {
  CouncilPlayer, PLAYER_COLORS, PROXY_GRACE_MS, canProxyFor, isSustainedOffline, normalizeRoom, RoomState, DEFAULT_SETTINGS,
} from '../src/lib/core'

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}

const mk = (over: Partial<CouncilPlayer> = {}): CouncilPlayer => ({
  id: 'p1', name: 'CHAMELEON', color: PLAYER_COLORS[0],
  isAdmin: false, isOwner: false, isBot: false, isSpectator: false,
  connected: true, offlineSince: null, joinedAt: 0, peerId: 'peer1',
  ...over,
})

const NOW = 1_000_000

// ── the reported bug: chameleon typing, brief presence blip ─────────────────
{
  const typing = mk({ connected: true })
  check(!canProxyFor(typing, NOW), 'connected chameleon: host gets NO duplicate prompt')

  // transport blip one second ago (this is what used to hand over the prompt)
  const blip = mk({ connected: false, offlineSince: NOW - 1000 })
  check(!canProxyFor(blip, NOW), 'after a 1s blip: still NO proxy prompt')

  const midBlip = mk({ connected: false, offlineSince: NOW - (PROXY_GRACE_MS - 1000) })
  check(!canProxyFor(midBlip, NOW), `after ${(PROXY_GRACE_MS - 1000) / 1000}s: still no proxy`)

  // OLD behaviour for comparison: any disconnect instantly granted control
  const oldLogic = (p: CouncilPlayer) => p.isBot || !p.connected
  check(oldLogic(blip), 'OLD logic granted the prompt after a 1s blip (reproduces the bug)')
}

// ── genuinely gone: proxy must still work ──────────────────────────────────
{
  const gone = mk({ connected: false, offlineSince: NOW - (PROXY_GRACE_MS + 1000) })
  check(canProxyFor(gone, NOW), 'a sustained absence still unlocks proxy control')
  check(isSustainedOffline(gone, NOW), 'isSustainedOffline agrees')
}

// ── bots are always controllable ───────────────────────────────────────────
{
  const bot = mk({ isBot: true, connected: false, offlineSince: null })
  check(canProxyFor(bot, NOW), 'bots remain controllable immediately')
  check(!isSustainedOffline(bot, NOW), 'a bot is not "offline", it is proxied')
}

// ── reconnect clears the stamp ─────────────────────────────────────────────
{
  const back = mk({ connected: true, offlineSince: null })
  check(!canProxyFor(back, NOW), 'reconnecting revokes proxy control immediately')
}

// ── legacy records (no stamp) degrade safely, not dangerously ──────────────
{
  const legacy = mk({ connected: false, offlineSince: undefined as unknown as null })
  check(canProxyFor(legacy, NOW), 'legacy offline record still proxyable (no deadlock)')

  const legacyRoom = {
    code: 'ABCDE', createdAt: 1, ownerId: 'p0',
    players: [
      { id: 'p0', name: 'A', color: '#fff', isAdmin: true, isOwner: true, isBot: false, isSpectator: false, connected: true, joinedAt: 0, peerId: 'x' },
      { id: 'p1', name: 'B', color: '#eee', isAdmin: false, isOwner: false, isBot: false, isSpectator: false, connected: false, joinedAt: 1, peerId: 'y' },
    ],
    phase: 'lobby', selectedGame: 'spyfall', settings: DEFAULT_SETTINGS,
    game: null, gameState: null, scores: {}, showScores: true, version: 2,
  } as unknown as RoomState
  const n = normalizeRoom(legacyRoom)
  check(n.players[0].offlineSince === null, 'connected legacy player gets a null stamp')
  check(n.players[1].offlineSince === 0, 'offline legacy player is treated as long-gone')
}

console.log(failures === 0 ? '\nALL PROXY GRACE TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
