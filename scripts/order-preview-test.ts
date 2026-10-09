import { GAMES, PartyState, BState, getBMap, bMovesFor } from '../src/lib/games'
import { CouncilPlayer, DEFAULT_SETTINGS, PLAYER_COLORS, SettingsMap } from '../src/lib/core'

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const mk = (n: number): CouncilPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, color: PLAYER_COLORS[i],
    isAdmin: i === 0, isOwner: i === 0, isBot: false, isSpectator: false,
    connected: true, offlineSince: null, joinedAt: i, peerId: `peer${i}`,
  }))

// ── speaking order ─────────────────────────────────────────────────────────
for (const kind of ['spyfall', 'chameleon', 'imposter'] as const) {
  let firstMismatch = 0
  let wrongSize = 0
  let dupes = 0
  let strangers = 0
  const firstSeen = new Set<string>()

  for (let run = 0; run < 300; run++) {
    const players = mk(5)
    const s = GAMES[kind].init(players, clone(DEFAULT_SETTINGS)) as PartyState
    if (s.order[0] !== s.first) firstMismatch++
    if (s.order.length !== s.electorate.length) wrongSize++
    if (new Set(s.order).size !== s.order.length) dupes++
    if (s.order.some(id => !s.electorate.includes(id))) strangers++
    firstSeen.add(s.first)
  }

  check(firstMismatch === 0, `${kind}: order[0] always equals "speaks first"`)
  check(wrongSize === 0, `${kind}: order covers every seated member`)
  check(dupes === 0, `${kind}: no duplicate entries in the rotation`)
  check(strangers === 0, `${kind}: rotation contains only electorate members`)
  check(firstSeen.size > 1, `${kind}: opener is randomised (${firstSeen.size} distinct over 300 deals)`)

  // removing a member must drop them from the rotation
  const players = mk(5)
  const s = GAMES[kind].init(players, clone(DEFAULT_SETTINGS)) as PartyState
  const victim = s.order[2]
  const after = GAMES[kind].playerRemoved(s, victim, players.filter(x => x.id !== victim)) as PartyState
  check(!after.order.includes(victim), `${kind}: removed member leaves the rotation`)
}

// ── barricade preview model matches what the engine actually does ──────────
{
  const map = getBMap('duel2')
  const players = mk(2)
  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout: 'duel2', pawns: 2 } }
  const base = GAMES.barricade.init(players, settings) as BState

  const free = map.circles.find(c => c.start === null && !c.finish && !c.safe && !c.stone0)!
  const neighbour = map.neighbors[free.id].find(n => {
    const d = map.circles[n]
    return d.start === null && !d.finish && !d.safe
  })!

  const s: BState = {
    ...base,
    pieces: [{ seat: 0, circle: neighbour }, { seat: 1, circle: free.id }],
    stones: base.stones.map(() => null),
    turn: 0, dieRoll: 1, phase: 'move',
  }

  // what the preview would claim
  const mover = s.pieces[0]
  const predictedCaptures = s.pieces
    .map((pc, i) => ({ pc, i }))
    .filter(({ pc, i }) => i !== 0 && pc.circle === free.id && pc.seat !== mover.seat)
    .map(({ i }) => i)

  check(predictedCaptures.length === 1 && predictedCaptures[0] === 1, 'preview predicts exactly one capture')
  check(bMovesFor(map, s, 0).includes(free.id), 'previewed destination is a legal move')

  // what the engine really does
  const out = GAMES.barricade.act(s, 'p0', players, { t: 'move', pawn: 0, to: free.id }) as BState
  const home1 = map.circles.find(c => c.start === 1)!.id
  check(out.pieces[1].circle === home1, 'engine sends the predicted victim home (preview was truthful)')
  check(out.pieces[0].circle === free.id, 'engine lands the mover where the preview showed')
}

console.log(failures === 0 ? '\nALL ORDER + PREVIEW TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
