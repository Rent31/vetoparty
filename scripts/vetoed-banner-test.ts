export {}

import { GAMES, PartyState, QState, BState, outcomeFor, getBMap } from '../src/lib/games'
import { CouncilPlayer, DEFAULT_SETTINGS, PLAYER_COLORS, SettingsMap } from '../src/lib/core'

let failures = 0
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`)
  if (!ok) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const mk = (n: number): CouncilPlayer[] => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `P${i}`, color: PLAYER_COLORS[i],
  isAdmin: i === 0, isOwner: i === 0, isBot: false, isSpectator: false,
  connected: true, offlineSince: null, joinedAt: i, peerId: `peer${i}`,
}))

// ── party games: exactly the losing side is vetoed ─────────────────────────
for (const kind of ['spyfall', 'chameleon', 'imposter'] as const) {
  const players = mk(5)
  const base = GAMES[kind].init(players, clone(DEFAULT_SETTINGS)) as PartyState
  const bad = new Set(base.bad)

  for (const winner of ['council', 'rogue'] as const) {
    const over = { ...base, stage: 'over' as const, winner }
    let wrong = 0
    for (const p of players) {
      const got = outcomeFor(kind, over, p.id)
      const isRogue = bad.has(p.id)
      const shouldWin = winner === 'rogue' ? isRogue : !isRogue
      if (got !== (shouldWin ? 'won' : 'lost')) wrong++
    }
    check(wrong === 0, `${kind}/${winner}: every player gets the correct verdict`)

    const vetoed = players.filter(p => outcomeFor(kind, over, p.id) === 'lost').length
    const expected = winner === 'rogue' ? players.length - bad.size : bad.size
    check(vetoed === expected, `${kind}/${winner}: ${vetoed} players vetoed (expected ${expected})`)
    check(vetoed > 0 && vetoed < players.length, `${kind}/${winner}: winners are never vetoed`)
  }

  // adjourned game: nobody is told they lost
  const adjourned = { ...base, stage: 'over' as const, winner: null }
  check(players.every(p => outcomeFor(kind, adjourned, p.id) === null),
    `${kind}: an adjourned game vetoes nobody`)

  // a spectator is outside the electorate and never sees the stamp
  check(outcomeFor(kind, { ...base, stage: 'over', winner: 'council' }, 'ghost') === null,
    `${kind}: a non-participant is never vetoed`)

  // mid-game must not show a verdict at all
  check(players.every(p => outcomeFor(kind, base, p.id) === null),
    `${kind}: no verdict while the game is still running`)
}

// ── quoridor: everyone except the winner is vetoed ─────────────────────────
{
  const players = mk(4)
  const base = GAMES.quoridor.init(players, clone(DEFAULT_SETTINGS)) as QState
  const over: QState = { ...base, stage: 'over', winner: 2 }
  const winnerId = over.participants[2]

  check(outcomeFor('quoridor', over, winnerId) === 'won', 'quoridor: winner is not vetoed')
  const losers = over.participants.filter(id => outcomeFor('quoridor', over, id) === 'lost')
  check(losers.length === over.participants.length - 1, `quoridor: ${losers.length} losers vetoed`)
  check(!losers.includes(winnerId), 'quoridor: winner absent from the vetoed set')
  check(outcomeFor('quoridor', over, 'ghost') === null, 'quoridor: spectator not vetoed')
  check(outcomeFor('quoridor', base, over.participants[0]) === null, 'quoridor: no verdict mid-game')
}

// ── barricade: same rule, and a real finished game ─────────────────────────
{
  const map = getBMap('duel2')
  const players = mk(2)
  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout: 'duel2', pawns: 1 } }
  const base = GAMES.barricade.init(players, settings) as BState

  const finish = map.circles.find(c => c.finish)!
  const approach = map.neighbors[finish.id][0]
  const s: BState = {
    ...base,
    pieces: [{ seat: 0, circle: approach }, { seat: 1, circle: base.pieces[1].circle }],
    stones: base.stones.map(() => null),
    turn: 0, dieRoll: 1, phase: 'move',
  }
  const out = GAMES.barricade.act(s, 'p0', players, { t: 'move', pawn: 0, to: finish.id }) as BState | null
  check(!!out && out.stage === 'over', 'barricade: reaching the throne ends the game')
  if (out) {
    check(outcomeFor('barricade', out, 'p0') === 'won', 'barricade: winner is not vetoed')
    check(outcomeFor('barricade', out, 'p1') === 'lost', 'barricade: loser IS vetoed')
    check(outcomeFor('barricade', out, 'ghost') === null, 'barricade: spectator not vetoed')
  }
}

// ── coup: everyone except the winner is vetoed ─────────────────────────
{
  const players = mk(4)
  const base = GAMES.coup.init(players, clone(DEFAULT_SETTINGS)) as any
  const over = { ...base, stage: 'over', winner: 'p2' }
  const winnerId = 'p2'

  check(outcomeFor('coup', over, winnerId) === 'won', 'coup: winner is not vetoed')
  const losers = over.seats.filter((id: string) => outcomeFor('coup', over, id) === 'lost')
  check(losers.length === over.seats.length - 1, `coup: ${losers.length} losers vetoed`)
  check(!losers.includes(winnerId), 'coup: winner absent from the vetoed set')
  check(outcomeFor('coup', over, 'ghost') === null, 'coup: spectator not vetoed')
  check(outcomeFor('coup', base, over.seats[0]) === null, 'coup: no verdict mid-game')
}

// ── wavelength: losing team is vetoed, winning team is not ─────────
{
  const players = mk(4)
  const base = GAMES.wavelength.init(players, clone(DEFAULT_SETTINGS)) as any
  const over = { ...base, stage: 'over', winner: 0 }

  for (const id of base.teams[0]) {
    check(outcomeFor('wavelength', over, id) === 'won', `wavelength team 0: ${id} won`)
  }
  for (const id of base.teams[1]) {
    check(outcomeFor('wavelength', over, id) === 'lost', `wavelength team 1: ${id} lost`)
  }
  check(outcomeFor('wavelength', over, 'ghost') === null, 'wavelength: non-participant not vetoed')
  check(outcomeFor('wavelength', base, players[0].id) === null, 'wavelength: no verdict mid-game')
}

// ── the banner must never contradict the recorded winner ───────────────────
{
  const players = mk(4)
  const base = GAMES.quoridor.init(players, clone(DEFAULT_SETTINGS)) as QState
  let contradictions = 0
  for (let w = 0; w < base.participants.length; w++) {
    const over: QState = { ...base, stage: 'over', winner: w }
    for (const id of over.participants) {
      const shown = outcomeFor('quoridor', over, id)
      const isWinner = over.participants[w] === id
      if ((shown === 'won') !== isWinner) contradictions++
      if (shown === 'lost' && isWinner) contradictions++
    }
  }
  check(contradictions === 0, 'verdict never contradicts the displayed winner')
}

console.log(failures === 0 ? '\nALL VETOED BANNER TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
