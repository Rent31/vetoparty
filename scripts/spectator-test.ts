import { GAMES, PartyState, QState, BState, getBMap } from '../src/lib/games'
import {
  CouncilPlayer, DEFAULT_SETTINGS, PLAYER_COLORS, SettingsMap,
  activeSeated, normalizeRoom, RoomState,
} from '../src/lib/core'

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const mk = (n: number, spectatorIdx: number[] = []): CouncilPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, color: PLAYER_COLORS[i],
    isAdmin: i === 0, isOwner: i === 0, isBot: false,
    isSpectator: spectatorIdx.includes(i),
    connected: true, offlineSince: null, joinedAt: i, peerId: `peer${i}`,
  }))

// ── 1. spectators are excluded from the seated roster ──────────────────────
{
  const players = mk(6, [4, 5])
  const seated = activeSeated(players)
  check(seated.length === 4, `activeSeated drops spectators (${seated.length} of 6)`)
  check(!seated.some(p => p.isSpectator), 'no spectator survives the filter')
}

// ── 2. party games never deal a spectator in ───────────────────────────────
for (const kind of ['spyfall', 'chameleon', 'imposter'] as const) {
  for (let run = 0; run < 80; run++) {
    const players = mk(6, [4, 5])
    const s = GAMES[kind].init(activeSeated(players), clone(DEFAULT_SETTINGS)) as PartyState
    const specIds = ['p4', 'p5']
    if (s.electorate.some(id => specIds.includes(id))) {
      check(false, `${kind}: spectator entered the electorate`); break
    }
    if (s.bad.some(id => specIds.includes(id))) {
      check(false, `${kind}: spectator assigned a secret role`); break
    }
    if (specIds.includes(s.first)) {
      check(false, `${kind}: spectator chosen to speak first`); break
    }
  }
  check(true, `${kind}: 80 deals never seated a spectator`)

  // a spectator's vote must be rejected outright
  const players = mk(5, [4])
  let s = GAMES[kind].init(activeSeated(players), clone(DEFAULT_SETTINGS)) as PartyState
  s = { ...s, stage: 'vote' }
  const res = GAMES[kind].act(s, 'p4', players, { t: 'vote', target: 'p1' })
  check(res === null, `${kind}: spectator ballot rejected`)
}

// ── 3. board games never seat a spectator ──────────────────────────────────
{
  const players = mk(5, [3, 4])
  const q = GAMES.quoridor.init(activeSeated(players), clone(DEFAULT_SETTINGS)) as QState
  check(!q.participants.some(id => ['p3', 'p4'].includes(id)), 'quoridor excludes spectators')
  check(q.participants.length === 3, `quoridor seats only players (${q.participants.length})`)
  const move = GAMES.quoridor.act(q, 'p4', players, { t: 'move', to: [7, 4] })
  check(move === null, 'quoridor rejects a spectator move')

  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout: 'trio3', pawns: 3 } }
  const b = GAMES.barricade.init(activeSeated(players), settings) as BState
  check(!b.participants.some(id => ['p3', 'p4'].includes(id)), 'barricade excludes spectators')
  check(b.pieces.every(p => p.seat < 3), 'barricade pawns belong to seated players only')
  check(GAMES.barricade.act(b, 'p4', players, { t: 'roll' }) === null, 'barricade rejects a spectator roll')

  const c = GAMES.coup.init(activeSeated(players), clone(DEFAULT_SETTINGS)) as any
  check(!c.seats.some((id: string) => ['p3', 'p4'].includes(id)), 'coup excludes spectators')
  check(c.seats.length === 3, `coup seats only players (${c.seats.length})`)
  check(GAMES.coup.act(c, 'p4', players, { t: 'action', action: 'Income' }) === null, 'coup rejects a spectator action')

  const w = GAMES.wavelength.init(activeSeated(players), clone(DEFAULT_SETTINGS)) as any
  check(!w.teams[0].concat(w.teams[1]).some((id: string) => ['p3', 'p4'].includes(id)), 'wavelength excludes spectators')
  check(GAMES.wavelength.act(w, 'p4', players, { t: 'dial', value: 20 }) === null, 'wavelength rejects a spectator dial')
}

// ── 4. canStart counts only seated members ─────────────────────────────────
{
  // 2 players + 4 spectators must NOT satisfy a 3-player minimum
  const players = mk(6, [2, 3, 4, 5])
  const reason = GAMES.spyfall.canStart(activeSeated(players), clone(DEFAULT_SETTINGS))
  check(reason !== null, 'spyfall blocks start when spectators pad the count')

  const enough = mk(6, [4, 5])
  check(GAMES.spyfall.canStart(activeSeated(enough), clone(DEFAULT_SETTINGS)) === null, '4 seated + 2 watching can start')
}

// ── 5. legacy rooms without the field are migrated, not broken ─────────────
{
  const legacy = {
    code: 'ABCDE', createdAt: 1, ownerId: 'p0',
    players: [{ id: 'p0', name: 'P0', color: '#fff', isAdmin: true, isOwner: true, isBot: false, connected: true, joinedAt: 0, peerId: 'x' }],
    phase: 'lobby', selectedGame: 'spyfall', settings: clone(DEFAULT_SETTINGS),
    game: null, gameState: null, version: 3,
  } as unknown as RoomState
  const n = normalizeRoom(legacy)
  check(n.players[0].isSpectator === false, 'legacy player defaults to seated')
  check(typeof n.showScores === 'boolean' && !!n.scores, 'legacy scoreboard fields still backfilled')
}

console.log(failures === 0 ? '\nALL SPECTATOR TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
