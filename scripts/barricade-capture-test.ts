import {
  GAMES, BState, getBMap, bMovesFor, bPlacement,
} from '../src/lib/games'
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

// ── 1. reproduce the ordering bug directly ─────────────────────────────────
// OLD logic: move first, then findIndex for a victim -> can match the mover.
{
  const pieces = [
    { seat: 0, circle: 40 },  // mover, LOWER index
    { seat: 1, circle: 55 },  // victim, higher index
  ]
  const seat = 0, to = 55, pawn = 0
  const moved = pieces.map((p, i) => (i === pawn ? { ...p, circle: to } : p))
  const oldVictim = moved.findIndex(p => p.circle === to)          // finds the MOVER
  const oldCaptured = oldVictim !== -1 && moved[oldVictim].seat !== seat
  check(!oldCaptured, 'OLD logic skipped the capture (reproduces the stacked-pieces bug)')

  const newVictims = pieces.reduce<number[]>((acc, p, i) => {
    if (i !== pawn && p.circle === to && p.seat !== seat) acc.push(i)
    return acc
  }, [])
  check(newVictims.length === 1 && newVictims[0] === 1, 'NEW logic finds the real victim')
}

// ── 2. real engine: capture works regardless of piece ordering ─────────────
{
  const map = getBMap('duel2')
  const players = mk(2)
  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout: 'duel2', pawns: 2 } }

  // Try BOTH orderings: attacker index below and above the victim index.
  for (const attackerFirst of [true, false]) {
    const base = GAMES.barricade.init(players, settings) as BState
    const free = map.circles.find(c => c.start === null && !c.finish && !c.safe && !c.stone0)!
    const target = free.id
    const neighbour = map.neighbors[target].find(n => {
      const d = map.circles[n]
      return d.start === null && !d.finish && !d.safe
    })!

    const attacker = { seat: 0, circle: neighbour }
    const victim = { seat: 1, circle: target }
    const s: BState = {
      ...base,
      pieces: attackerFirst ? [attacker, victim] : [victim, attacker],
      stones: base.stones.map(() => null),
      turn: 0,
      dieRoll: 1,
      phase: 'move',
    }
    const pawnIdx = attackerFirst ? 0 : 1
    const victimIdx = attackerFirst ? 1 : 0

    const legal = bMovesFor(map, s, pawnIdx)
    if (!legal.includes(target)) { check(false, `capture target reachable (attackerFirst=${attackerFirst})`); continue }

    const out = GAMES.barricade.act(s, 'p0', players, { t: 'move', pawn: pawnIdx, to: target }) as BState | null
    if (!out) { check(false, `move accepted (attackerFirst=${attackerFirst})`); continue }

    const home1 = map.circles.find(c => c.start === 1)!.id
    const attackerLanded = out.pieces[pawnIdx].circle === target
    const victimSentHome = out.pieces[victimIdx].circle === home1
    const noStack = out.pieces.filter(p => p.circle === target).length === 1

    check(attackerLanded, `attacker lands on the square (attackerFirst=${attackerFirst})`)
    check(victimSentHome, `victim sent home (attackerFirst=${attackerFirst})`)
    check(noStack, `no two pieces share the square (attackerFirst=${attackerFirst})`)
  }
}

// ── 3. fuzz: no non-home circle may ever hold 2+ pieces ────────────────────
{
  let violations = 0
  let captures = 0
  let games = 0

  for (const layout of ['duel2', 'trio3', 'classic4'] as const) {
    const map = getBMap(layout)
    const players = mk(map.seats)
    for (const pawns of [2, 5]) {
      const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout, pawns } }
      for (let run = 0; run < 8; run++) {
        let s = GAMES.barricade.init(players, settings) as BState
        games++
        for (let step = 0; step < 2500 && s.stage === 'play'; step++) {
          const actor = s.participants[s.turn]
          if (s.phase === 'roll') {
            s = (GAMES.barricade.act(s, actor, players, { t: 'roll' }) as BState) ?? s
          } else if (s.phase === 'move') {
            const opts = s.pieces
              .map((_, i) => i)
              .filter(i => s.pieces[i].seat === s.turn && bMovesFor(map, s, i).length)
            if (!opts.length) break
            const pawn = opts[Math.floor(Math.random() * opts.length)]
            const dests = bMovesFor(map, s, pawn)
            const to = dests[Math.floor(Math.random() * dests.length)]
            const before = s.pieces.filter(p => p.circle === to && p.seat !== s.turn).length
            const next = GAMES.barricade.act(s, actor, players, { t: 'move', pawn, to }) as BState | null
            if (!next) break
            if (before > 0) {
              captures++
              const stillThere = next.pieces.filter(p => p.circle === to).length
              if (stillThere !== 1) violations++
            }
            s = next
          } else {
            const cells = bPlacement(map, s)
            if (!cells.length) break
            s = (GAMES.barricade.act(s, actor, players, { t: 'place', to: cells[0] }) as BState) ?? s
          }

          // invariant: only home squares may stack pieces
          const counts = new Map<number, number>()
          for (const p of s.pieces) counts.set(p.circle, (counts.get(p.circle) ?? 0) + 1)
          for (const [circle, n] of counts) {
            if (n > 1 && map.circles[circle].start === null) violations++
          }
        }
      }
    }
  }
  check(captures > 0, `fuzz produced real captures (${captures} across ${games} games)`)
  check(violations === 0, `no illegal piece stacking in ${games} games (${violations} violations)`)
}

console.log(failures === 0 ? '\nALL BARRICADE CAPTURE TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures ? 1 : 0)
