import { GAMES, winnersOf, PartyState, QState, BState, getBMap, bMovesFor, bPlacement, qMoves } from '../src/lib/games'
import { CouncilPlayer, DEFAULT_SETTINGS, GameId, PLAYER_COLORS, RoomState, SettingsMap, ScoreBook, totalWins, normalizeRoom } from '../src/lib/core'

const mk = (n: number): CouncilPlayer[] => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `P${i}`, color: PLAYER_COLORS[i], isAdmin: i === 0, isOwner: i === 0,
  isBot: false, isSpectator: false, connected: true, offlineSince: null, joinedAt: i, peerId: `peer${i}`,
}))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
let errors = 0
const check = (c: boolean, m: string) => { if (!c) { errors++; console.error('FAIL:', m) } }

// mirror of the engine's applyScores
function applyScores(s: RoomState): RoomState {
  if (s.phase !== 'game' || !s.game || !s.gameState) return s
  const gs = s.gameState as Record<string, unknown>
  if (gs.stage !== 'over' || gs.scored === true) return s
  const scores: ScoreBook = { ...(s.scores ?? {}) }
  for (const id of winnersOf(s.game, s.gameState)) {
    const row = { ...(scores[id] ?? {}) }
    row[s.game] = (row[s.game] ?? 0) + 1
    scores[id] = row
  }
  return { ...s, scores, gameState: { ...gs, scored: true } }
}

const room = (game: GameId, gameState: unknown, players: CouncilPlayer[], scores: ScoreBook = {}): RoomState => ({
  code: 'ABCDE', createdAt: 1, ownerId: players[0].id, players, phase: 'game',
  selectedGame: game, settings: clone(DEFAULT_SETTINGS), game, gameState,
  scores, showScores: true, version: 1,
})

// ── 1. party: council win credits non-spies only; rogue win credits spies only
for (const kind of ['spyfall', 'chameleon', 'imposter'] as const) {
  const players = mk(5)
  for (const side of ['council', 'rogue'] as const) {
    const base = GAMES[kind].init(players, clone(DEFAULT_SETTINGS)) as PartyState
    const over = { ...base, stage: 'over' as const, winner: side }
    const r = applyScores(room(kind, over, players))
    const bad = new Set(over.bad)
    for (const p of players) {
      const wins = r.scores[p.id]?.[kind] ?? 0
      const shouldWin = side === 'rogue' ? bad.has(p.id) : !bad.has(p.id)
      check(wins === (shouldWin ? 1 : 0), `${kind}/${side}: ${p.id} got ${wins}`)
    }
  }
  // aborted game (winner null) credits nobody
  const base = GAMES[kind].init(players, clone(DEFAULT_SETTINGS)) as PartyState
  const aborted = { ...base, stage: 'over' as const, winner: null }
  const r2 = applyScores(room(kind, aborted, players))
  check(Object.keys(r2.scores).length === 0, `${kind}: aborted credits nobody`)
}

// ── 2. double-count protection: re-running applyScores must not add more
{
  const players = mk(4)
  const base = GAMES.spyfall.init(players, clone(DEFAULT_SETTINGS)) as PartyState
  let r = room('spyfall', { ...base, stage: 'over', winner: 'council' }, players)
  for (let i = 0; i < 25; i++) r = applyScores(r)
  const totals = players.map(p => totalWins(r.scores[p.id]))
  check(Math.max(...totals) === 1, `double-count: totals ${totals.join(',')}`)
}

// ── 3. accumulation across many real games
{
  const players = mk(4)
  let scores: ScoreBook = {}
  let played = 0
  for (let g = 0; g < 40; g++) {
    const mod = GAMES.quoridor
    let s = mod.init(players, clone(DEFAULT_SETTINGS)) as QState
    for (let t = 0; t < 600 && s.stage === 'play'; t++) {
      const mv = qMoves(s, s.turn)
      s = mod.act(s, s.participants[s.turn], players, { t: 'move', to: mv[Math.floor(Math.random() * mv.length)] }) as QState
    }
    if (s.stage === 'over' && s.winner !== null) {
      played++
      const r = applyScores(room('quoridor', s, players, scores))
      scores = r.scores
    }
  }
  const sum = players.reduce((n, p) => n + totalWins(scores[p.id]), 0)
  check(sum === played, `accumulation: ${sum} wins recorded for ${played} games`)
  check(played > 0, 'some quoridor games finished')
}

// ── 4. barricade winner credited correctly
{
  const layout = 'duel2' as const
  const map = getBMap(layout)
  const players = mk(2)
  const settings: SettingsMap = { ...clone(DEFAULT_SETTINGS), barricade: { layout, pawns: 3 } }
  let finished = 0
  for (let g = 0; g < 40; g++) {
    const mod = GAMES.barricade
    let s = mod.init(players, settings) as BState
    for (let t = 0; t < 4000 && s.stage === 'play'; t++) {
      const actor = s.participants[s.turn]
      if (s.phase === 'roll') s = (mod.act(s, actor, players, { t: 'roll' }) as BState) ?? s
      else if (s.phase === 'move') {
        const opts = s.pieces.map((_, i) => i).filter(i => s.pieces[i].seat === s.turn && bMovesFor(map, s, i).length)
        if (!opts.length) break
        const pawn = opts[Math.floor(Math.random() * opts.length)]
        const d = bMovesFor(map, s, pawn)
        s = (mod.act(s, actor, players, { t: 'move', pawn, to: d[Math.floor(Math.random() * d.length)] }) as BState) ?? s
      } else {
        const cells = bPlacement(map, s)
        s = (mod.act(s, actor, players, { t: 'place', to: cells[0] }) as BState) ?? s
      }
    }
    if (s.stage === 'over' && s.winner !== null) {
      finished++
      const r = applyScores(room('barricade', s, players))
      const winnerId = s.participants[s.winner]
      check((r.scores[winnerId]?.barricade ?? 0) === 1, 'barricade winner credited')
      const loser = players.find(p => p.id !== winnerId)!
      check(totalWins(r.scores[loser.id]) === 0, 'barricade loser not credited')
    }
  }
  check(finished > 0, 'some barricade games finished')
}

// ── 5. wavelength winning team members credited correctly
{
  const players = mk(4)
  const base = GAMES.wavelength.init(players, clone(DEFAULT_SETTINGS)) as any
  const over = { ...base, stage: 'over', winner: 1 }
  const r = applyScores(room('wavelength', over, players))
  for (const id of base.teams[1]) {
    check((r.scores[id]?.wavelength ?? 0) === 1, `wavelength winner ${id} credited`)
  }
  for (const id of base.teams[0]) {
    check((r.scores[id]?.wavelength ?? 0) === 0, `wavelength loser ${id} not credited`)
  }
}

// ── 6. legacy snapshot without score fields is migrated safely
{
  const players = mk(3)
  const legacy = { code: 'ABCDE', createdAt: 1, ownerId: 'p0', players, phase: 'lobby',
    selectedGame: 'spyfall', settings: clone(DEFAULT_SETTINGS), game: null, gameState: null, version: 4 } as unknown as RoomState
  const n = normalizeRoom(legacy)
  check(typeof n.showScores === 'boolean' && !!n.scores, 'legacy snapshot normalized')
  check(totalWins(n.scores['p0']) === 0, 'legacy totals are zero')
}

console.log(errors === 0 ? 'ALL SCOREBOARD TESTS PASSED' : `${errors} FAILURES`)
process.exit(errors ? 1 : 0)
