export {}
import { getBMap, bPlacement, bMovesFor, BState, GAMES } from '../src/lib/games'
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

// 1. exactly ONE row is barred from barricades
for (const layout of ['duel2', 'trio3', 'classic4'] as const) {
  const map = getBMap(layout)
  const safeRows = [...new Set(map.circles.filter(c => c.safe).map(c => c.y))].sort((a, b) => a - b)
  const barredRows = [...new Set(map.circles.filter(c => c.noBarricade).map(c => c.y))]
  check(barredRows.length === 1, `${layout}: exactly 1 barred row (safe rows drawn: ${safeRows.length})`)
  check(barredRows[0] === Math.max(...safeRows), `${layout}: the barred row is the bottom entry row`)

  // the upper safe row (when present) must now accept barricades
  if (safeRows.length > 1) {
    const upper = map.circles.filter(c => c.safe && c.y === Math.min(...safeRows))
    check(upper.every(c => !c.noBarricade), `${layout}: upper safe row now allows barricades`)
  }
}

// 2. placement offers the upper safe row, never the entry row
{
  const map = getBMap('classic4')
  const players = mk(4)
  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout: 'classic4', pawns: 1 } }
  const base = GAMES.barricade.init(players, settings) as BState
  const s: BState = { ...base, stones: base.stones.map(() => null), phase: 'place', carrying: 0 }
  const cells = bPlacement(map, s)
  const entryY = Math.max(...map.circles.filter(c => c.safe).map(c => c.y))
  check(cells.every(id => map.circles[id].y !== entryY), 'no placement offered on the entry row')
  const upperY = Math.min(...map.circles.filter(c => c.safe).map(c => c.y))
  check(cells.some(id => map.circles[id].safe && map.circles[id].y === upperY), 'upper safe row IS offered')
}

// 3. a pawn standing in a safe row can be captured
{
  const map = getBMap('classic4')
  const players = mk(4)
  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout: 'classic4', pawns: 1 } }
  const base = GAMES.barricade.init(players, settings) as BState

  const safeCell = map.circles.find(c => c.safe && map.neighbors[c.id].some(n => {
    const d = map.circles[n]
    return d.start === null && !d.finish
  }))!
  const from = map.neighbors[safeCell.id].find(n => {
    const d = map.circles[n]
    return d.start === null && !d.finish
  })!

  const s: BState = {
    ...base,
    pieces: [{ seat: 0, circle: from }, { seat: 1, circle: safeCell.id }],
    stones: base.stones.map(() => null),
    turn: 0, dieRoll: 1, phase: 'move',
  }
  check(bMovesFor(map, s, 0).includes(safeCell.id), 'a safe-row square with an enemy on it is reachable')

  const out = GAMES.barricade.act(s, 'p0', players, { t: 'move', pawn: 0, to: safeCell.id }) as BState | null
  check(!!out, 'the capture move is accepted')
  if (out) {
    const home1 = map.circles.find(c => c.start === 1)!.id
    check(out.pieces[1].circle === home1, 'the captured pawn is sent home from the safe row')
    check(out.pieces[0].circle === safeCell.id, 'the attacker occupies the safe row square')
  }
}

// 4. barricades still never land on home or finish
{
  for (const layout of ['duel2', 'trio3', 'classic4'] as const) {
    const map = getBMap(layout)
    const players = mk(map.seats)
    const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout, pawns: 2 } }
    const base = GAMES.barricade.init(players, settings) as BState
    const s: BState = { ...base, stones: base.stones.map(() => null), phase: 'place', carrying: 0 }
    const cells = bPlacement(map, s)
    check(cells.every(id => map.circles[id].start === null && !map.circles[id].finish),
      `${layout}: placement never offers home or finish squares`)
  }
}

// 5. two pawns able to reach the same square: selection must decide which
{
  const map = getBMap('classic4')
  const players = mk(4)
  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout: 'classic4', pawns: 2 } }
  const base = GAMES.barricade.init(players, settings) as BState

  // find a square reachable in 1 step from two different squares
  let found: { target: number; a: number; b: number } | null = null
  for (const c of map.circles) {
    if (c.start !== null || c.finish) continue
    const nbs = map.neighbors[c.id].filter(n => map.circles[n].start === null && !map.circles[n].finish)
    if (nbs.length >= 2) { found = { target: c.id, a: nbs[0], b: nbs[1] }; break }
  }
  check(!!found, 'found a contested square with two approach squares')

  if (found) {
    const s: BState = {
      ...base,
      pieces: [{ seat: 0, circle: found.a }, { seat: 0, circle: found.b }],
      stones: base.stones.map(() => null),
      turn: 0, dieRoll: 1, phase: 'move',
    }
    const m0 = bMovesFor(map, s, 0)
    const m1 = bMovesFor(map, s, 1)
    check(m0.includes(found.target) && m1.includes(found.target),
      'both pawns can legally reach the contested square')

    // the engine honours whichever pawn index is named
    const viaFirst = GAMES.barricade.act(s, 'p0', players, { t: 'move', pawn: 0, to: found.target }) as BState
    const viaSecond = GAMES.barricade.act(s, 'p0', players, { t: 'move', pawn: 1, to: found.target }) as BState
    check(viaFirst.pieces[0].circle === found.target && viaFirst.pieces[1].circle === found.b,
      'naming pawn 0 moves pawn 0 and leaves pawn 1 put')
    check(viaSecond.pieces[1].circle === found.target && viaSecond.pieces[0].circle === found.a,
      'naming pawn 1 moves pawn 1 and leaves pawn 0 put')
  }
}

console.log(failures === 0 ? '\nALL BARRICADE RULES TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
