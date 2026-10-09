import assert from 'node:assert'
import { isTeamGame, CouncilPlayer } from '../src/lib/core'
import { wInit, wAct, calcWavelengthScore } from '../src/lib/wavelength'
import { GAMES, winnersOf, outcomeFor, sanitizeSettings } from '../src/lib/games'

console.log('Testing Wavelength lobby team assignment, coop mode, and randomized teams...')

const makePlayer = (id: string, name: string, team = 0): CouncilPlayer => ({
  id,
  name,
  isBot: false,
  connected: true,
  team,
  color: '#e056fd',
  isAdmin: false,
  isOwner: false,
  isSpectator: false,
  offlineSince: null,
  joinedAt: Date.now(),
  peerId: null,
})

const defaultWavelengthSettings = {
  pointsToWin: 10,
  seconds: 60,
  useCustom: false,
  custom: '',
  randomizeTeams: false,
  coop: false,
}

const dummyPlayers: CouncilPlayer[] = [
  makePlayer('p1', 'Player 1', 0),
  makePlayer('p2', 'Player 2', 1),
  makePlayer('p3', 'Player 3', 0),
  makePlayer('p4', 'Player 4', 1),
]

// 1. Team assignment respects lobby teams
const w1 = wInit(dummyPlayers, { ...defaultWavelengthSettings })
assert.deepStrictEqual(w1.teams[0], ['p1', 'p3'], 'Team 0 should have p1 and p3')
assert.deepStrictEqual(w1.teams[1], ['p2', 'p4'], 'Team 1 should have p2 and p4')

// 2. If all players on Team 0 (default in lobby), evenly split
const allTeam0Players: CouncilPlayer[] = [
  makePlayer('p1', 'Player 1', 0),
  makePlayer('p2', 'Player 2', 0),
  makePlayer('p3', 'Player 3', 0),
  makePlayer('p4', 'Player 4', 0),
]
const w2 = wInit(allTeam0Players, { ...defaultWavelengthSettings })
assert.strictEqual(w2.teams[0].length, 2, 'Team 0 should have 2 players')
assert.strictEqual(w2.teams[1].length, 2, 'Team 1 should have 2 players')

// 3. Coop mode
const wCoop = wInit(dummyPlayers, { ...defaultWavelengthSettings, coop: true })
assert.strictEqual(wCoop.teams[0].length, 4, 'All players should be on Team 0 in coop mode')
assert.strictEqual(wCoop.teams[1].length, 0, 'Team 1 should be empty in coop mode')
assert.strictEqual(isTeamGame('wavelength', { wavelength: { ...defaultWavelengthSettings, coop: true } } as any), false, 'isTeamGame should be false in coop mode')
assert.strictEqual(isTeamGame('wavelength', { wavelength: { ...defaultWavelengthSettings, coop: false } } as any), true, 'isTeamGame should be true in versus mode')

// 4. Coop mode does not record wins
const finishedCoopState = { ...wCoop, stage: 'over', winner: 0, scores: [10, 0] as [number, number] }
assert.deepStrictEqual(winnersOf('wavelength', finishedCoopState), [], 'winnersOf must return empty list in coop')
assert.strictEqual(outcomeFor('wavelength', finishedCoopState, 'p1'), 'won', 'outcomeFor p1 should be won')

// 4b. Test canStart seating restrictions
// Default (coop off, randomize off): both teams must have 2+ players
const unbalancedPlayers: CouncilPlayer[] = [
  makePlayer('p1', 'Player 1', 0),
  makePlayer('p2', 'Player 2', 0),
  makePlayer('p3', 'Player 3', 0),
  makePlayer('p4', 'Player 4', 1), // Only 1 player on Team 1
]
assert.strictEqual(
  GAMES.wavelength.canStart(unbalancedPlayers, { wavelength: { ...defaultWavelengthSettings } } as any),
  'TEAMS NEED 2+ PLAYERS EACH'
)
// Balanced 2 on each team can start
assert.strictEqual(
  GAMES.wavelength.canStart(dummyPlayers, { wavelength: { ...defaultWavelengthSettings } } as any),
  null
)
// In coop mode, 2 players total can start
assert.strictEqual(
  GAMES.wavelength.canStart([dummyPlayers[0], dummyPlayers[1]], { wavelength: { ...defaultWavelengthSettings, coop: true } } as any),
  null
)
// In randomize teams mode, 2 players cannot start (needs 4+ members)
assert.strictEqual(
  GAMES.wavelength.canStart([dummyPlayers[0], dummyPlayers[1]], { wavelength: { ...defaultWavelengthSettings, randomizeTeams: true } } as any),
  'NEEDS 4+ MEMBERS'
)

// 5. Coop flow skips intercept directly to reveal
let coopTurn = wAct(wCoop, wCoop.psychic, dummyPlayers, { t: 'clue', clue: 'Hot Coffee' })!
assert.strictEqual(coopTurn.stage, 'guess', 'Should move to guess')
coopTurn = wAct(coopTurn, 'p2', dummyPlayers, { t: 'dial', value: 50 })!
const nonPsychic = coopTurn.teams[0].filter(id => id !== coopTurn.psychic)
for (const p of nonPsychic) {
  if (coopTurn.stage === 'reveal') break
  const next = wAct(coopTurn, p, dummyPlayers, { t: 'confirm_dial' })
  if (next) coopTurn = next
}
assert.strictEqual(coopTurn.stage, 'reveal', 'Should transition directly to reveal in coop')
// Advances when host advances via next_round action
dummyPlayers[0].isOwner = true
const nextRoundState = GAMES.wavelength.act(coopTurn, 'p1', dummyPlayers, { t: 'next_round' }) as any
assert.strictEqual(nextRoundState.stage, 'clue', 'Should advance to clue stage after host advances')
assert.strictEqual(nextRoundState.round, 2, 'Should advance to round 2')

console.log('Testing Spyfall and Chameleon voting threshold logic...')

const partyPlayers: CouncilPlayer[] = [
  makePlayer('p1', 'Player 1'),
  makePlayer('p2', 'Player 2'),
  makePlayer('p3', 'Player 3'),
  makePlayer('p4', 'Player 4'),
  makePlayer('p5', 'Player 5'),
]

// Initialize a party game (spyfall)
const spyfall = GAMES.spyfall.init(partyPlayers, { spyfall: { seconds: 300, spies: 1, locationPack: 'standard' } } as any) as any
// Set stage to vote
spyfall.stage = 'vote'
spyfall.electorate = ['p1', 'p2', 'p3', 'p4', 'p5']
spyfall.votes = {}

// 5 voters. 1 vote for p2. Remaining: 4. 1 > 0 + 4 is false -> stage stays 'vote'
let s = GAMES.spyfall.act(spyfall, 'p1', partyPlayers, { t: 'vote', target: 'p2' } as any) as any
assert.strictEqual(s.stage, 'vote')

// 2 votes for p2, 1 vote for p3. Remaining: 2. 2 > 1 + 2 (2 > 3 is false) -> stage stays 'vote'
s = GAMES.spyfall.act(s, 'p2', partyPlayers, { t: 'vote', target: 'p3' } as any)
s = GAMES.spyfall.act(s, 'p3', partyPlayers, { t: 'vote', target: 'p2' } as any)
assert.strictEqual(s.stage, 'vote')

// 3rd vote for p2. Total votes for p2 = 3. p3 has 1. Remaining uncast: 1.
// 3 > 1 + 1 (3 > 2 is true!). Even if remaining 1 voter votes for p3, p3 gets at most 2.
// Outcome cannot change -> resolves immediately!
s = GAMES.spyfall.act(s, 'p4', partyPlayers, { t: 'vote', target: 'p2' } as any)
assert.notStrictEqual(s.stage, 'vote', 'Stage should advance when result is mathematically unassailable')

console.log('Testing Chameleon verdict unassailable threshold logic...')
const chameleon = GAMES.chameleon.init(partyPlayers, { chameleon: { seconds: 300, chameleons: 1, topicPack: 'standard' } } as any) as any
chameleon.stage = 'verdict'
chameleon.electorate = ['p1', 'p2', 'p3', 'p4', 'p5']
chameleon.bad = ['p5'] // p5 is the chameleon, 4 council voters: p1, p2, p3, p4
chameleon.verdicts = {}

// 4 voters (p1, p2, p3, p4).
// p1 votes true. Yea = 1, Nay = 0, remaining = 3. 1 > 0 + 3 is false.
let c = GAMES.chameleon.act(chameleon, 'p1', partyPlayers, { t: 'verdict', accept: true } as any) as any
assert.strictEqual(c.stage, 'verdict')

// p2 votes true. Yea = 2, Nay = 0, remaining = 2. 2 > 0 + 2 is false (could tie 2-2).
c = GAMES.chameleon.act(c, 'p2', partyPlayers, { t: 'verdict', accept: true } as any)
assert.strictEqual(c.stage, 'verdict')

// p3 votes true. Yea = 3, Nay = 0, remaining = 1. 3 > 0 + 1 (3 > 1 is true!).
// Outcome cannot change! Stage advances to 'over'!
c = GAMES.chameleon.act(c, 'p3', partyPlayers, { t: 'verdict', accept: true } as any)
assert.strictEqual(c.stage, 'over', 'Stage should advance to over when yea cannot be beaten or tied')
assert.strictEqual(c.winner, 'rogue')

console.log('ALL TESTS PASSED!')
