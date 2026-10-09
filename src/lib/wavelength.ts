// VETO PARTY - WAVELENGTH ENGINE (Host Authoritative, Pure Functions)

import { CouncilPlayer, Id, WavelengthSettings, clamp, pickOne, shuffle } from './core'

export type WavelengthStage = 'clue' | 'guess' | 'counter' | 'reveal' | 'over'

export interface WavelengthRoundScore {
  activePts: number
  counterPts: number
  diff: number
  bullseye: boolean
  counterCorrect: boolean
}

export interface WavelengthState {
  stage: WavelengthStage
  round: number
  activeTeam: number // 0 or 1
  teams: [Id[], Id[]] // player IDs in team 0 and team 1
  scores: [number, number]
  psychic: Id
  psychicIndex: [number, number] // tracks rotation index per team
  card: [string, string]
  target: number // 0 to 100 (percentage)
  clue: string | null
  dialValue: number // 0 to 100
  dialHolder: Id | null
  dialHolderAt: number | null
  dialConfirms: Id[]
  counterGuess: 'left' | 'right' | null
  counterConfirms: Id[]
  roundScore: WavelengthRoundScore | null
  winner: number | null // 0 or 1 (team index)
  endsAt: number | null
  seconds: number
  pointsToWin: number
  randomizeTeams: boolean
  coop: boolean
  deck: [string, string][]
}

export type WavelengthAction =
  | { t: 'clue'; clue: string }
  | { t: 'dial_grab' }
  | { t: 'dial'; value: number }
  | { t: 'dial_release'; value?: number }
  | { t: 'confirm_dial' }
  | { t: 'counter'; guess: 'left' | 'right' }
  | { t: 'confirm_counter' }
  | { t: 'next_round' }

export const WAVELENGTH_DEFAULT_CARDS: [string, string][] = [
  ['Hot', 'Cold'],
  ['Bad', 'Good'],
  ['Useless', 'Useful'],
  ['Boring', 'Exciting'],
  ['Weak', 'Strong'],
  ['Quiet', 'Loud'],
  ['Cheap', 'Expensive'],
  ['Temporary', 'Permanent'],
  ['Introvert', 'Extrovert'],
  ['Underrated', 'Overrated'],
  ['Dangerous', 'Safe'],
  ['Soft', 'Hard'],
  ['Fantasy', 'Sci-Fi'],
  ['Casual', 'Formal'],
  ['Harmless', 'Harmful'],
  ['Divided', 'Whole'],
  ['Rare', 'Common'],
  ['Artisanal', 'Mass Produced'],
  ['Guilty Pleasure', 'Openly Love'],
  ['Waste of Time', 'Good Use of Time'],
  ['Snack', 'Meal'],
  ['For Kids', 'For Adults'],
  ['Boring Hobby', 'Interesting Hobby'],
  ['Tastes Bad', 'Tastes Good'],
  ['Easy to Do', 'Hard to Do'],
  ['Worst Day of the Year', 'Best Day of the Year'],
  ['Cat Person', 'Dog Person'],
  ['Wise', 'Intelligent'],
  ['Poorly Made', 'Well Made'],
  ['Normal Pet', 'Exotic Pet'],
  ['Mainstream', 'Niche'],
  ['Comedy', 'Drama'],
  ['Dystopia', 'Utopia'],
  ['Rough', 'Smooth'],
  ['Friend', 'Enemy'],
  ['Liberal', 'Conservative'],
  ['Bad Habit', 'Good Habit'],
  ['Ugly', 'Beautiful'],
  ['Need', 'Want'],
  ['Dry', 'Wet'],
  ['Villain', 'Hero'],
  ['Unpopular', 'Popular'],
  ['Star Wars', 'Star Trek'],
  ['Dark', 'Light'],
  ['Job', 'Career'],
  ['Short Lived', 'Long Lived'],
  ['Plain', 'Fancy'],
  ['Ineffective', 'Effective'],
  ['Square', 'Round'],
  ['Messy Food', 'Clean Food'],
  ['Sad Song', 'Happy Song'],
  ['Action Movie', 'Adventure Movie'],
  ['Fragile', 'Durable'],
  ['80s', '90s'],
  ['Role Model', 'Bad Influence'],
  ['Unhealthy', 'Healthy'],
  ['Basic', 'Hipster'],
  ['Bad Superpower', 'Good Superpower'],
  ['Low Calorie', 'High Calorie'],
  ['Easy Subject', 'Hard Subject'],
  ['Requires Luck', 'Requires Skill'],
  ['Sport', 'Game'],
  ['Movie', 'Film'],
  ['Failure', 'Masterpiece'],
  ['Unfashionable', 'Fashionable'],
  ['Mildly Addictive', 'Highly Addictive'],
  ['Easy to Spell', 'Hard to Spell'],
  ['Vice', 'Virtue'],
  ['Unreliable', 'Reliable'],
  ['Fad', 'Classic'],
  ['Normal', 'Weird'],
  ['Colorless', 'Colorful'],
  ['Feels Bad', 'Feels Good'],
  ['Inessential', 'Essential'],
  ['Dirty', 'Clean'],
  ['Flavorless', 'Flavorful'],
  ['Underpaid', 'Overpaid'],
  ['Forbidden', 'Encouraged'],
  ['Lowbrow', 'Highbrow'],
  ['Trashy', 'Classy'],
  ['Smells Bad', 'Smells Good'],
]

export const WAVELENGTH_PRESETS = [
  {
    name: 'CLASSIC',
    list: 'Hot|Cold;Good|Evil;Rough|Smooth;Dangerous|Safe;Useless|Useful;Boring|Exciting;Cheap|Expensive;Introvert|Extrovert;Temporary|Permanent;Underrated|Overrated;Quiet|Loud;Harmless|Harmful',
  },
  {
    name: 'POPCULTURE',
    list: 'Star Wars|Star Trek;Action Movie|Adventure Movie;Gryffindor|Slytherin;Villain|Hero;Movie|Film;Fad|Classic;80s|90s;Comedy|Drama;Book was better|Movie was better',
  },
  {
    name: 'PHILOSOPHY',
    list: 'Nature|Nurture;Virtue|Vice;Wise|Intelligent;Science|Art;Liberal|Conservative;Forgivable|Unforgivable;Normal|Weird;Deep thought|Shallow thought;True|False',
  },
]

export function parseSpectrumCards(raw: string): [string, string][] {
  const seen = new Set<string>()
  const out: [string, string][] = []
  for (const part of raw.split(';')) {
    const t = part.trim()
    if (!t) continue
    const pipes = t.split('|').map(s => s.trim().replace(/\s+/g, ' '))
    if (pipes.length >= 2 && pipes[0] && pipes[1]) {
      const key = `${pipes[0].toLowerCase()}|${pipes[1].toLowerCase()}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push([pipes[0], pipes[1]])
      }
    }
  }
  return out
}

const now = () => Date.now()

function generateTarget(): number {
  // Target center across full 0% to 100% spectrum (including extreme ends 0-5% and 95-100%)
  return Math.floor(Math.random() * 101)
}

export function calcWavelengthScore(
  target: number,
  dialValue: number,
  counterGuess: 'left' | 'right' | null,
): WavelengthRoundScore {
  const diff = Math.abs(target - dialValue)
  let activePts = 0
  let bullseye = false

  if (diff <= 2.5) {
    activePts = 4
    bullseye = true
  } else if (diff <= 6.5) {
    activePts = 3
  } else if (diff <= 10.5) {
    activePts = 2
  }

  let counterCorrect = false
  let counterPts = 0

  if (!bullseye && counterGuess) {
    if (counterGuess === 'left' && target < dialValue) {
      counterCorrect = true
      counterPts = 1
    } else if (counterGuess === 'right' && target > dialValue) {
      counterCorrect = true
      counterPts = 1
    }
  }

  return { activePts, counterPts, diff, bullseye, counterCorrect }
}

export function wInit(players: CouncilPlayer[], settings: WavelengthSettings): WavelengthState {
  const seated = players.filter(p => !p.isSpectator)
  const isCoop = !!settings.coop
  let team0: Id[] = []
  let team1: Id[] = []

  if (isCoop) {
    team0 = seated.map(p => p.id)
    team1 = []
  } else if (settings.randomizeTeams) {
    const shuffled = shuffle(seated.map(p => p.id))
    shuffled.forEach((id, idx) => {
      if (idx % 2 === 0) team0.push(id)
      else team1.push(id)
    })
  } else {
    for (const p of seated) {
      const t = typeof p.team === 'number' ? p.team % 2 : 0
      if (t === 0) team0.push(p.id)
      else team1.push(p.id)
    }

    if (team1.length === 0 && team0.length >= 2) {
      team0 = []
      team1 = []
      seated.forEach((p, idx) => {
        if (idx % 2 === 0) team0.push(p.id)
        else team1.push(p.id)
      })
    }
  }

  // Ensure team 0 has at least one player
  if (team0.length === 0 && seated.length > 0) {
    team0.push(seated[0].id)
    team1 = team1.filter(id => id !== seated[0].id)
  }

  const customPairs = settings.useCustom ? parseSpectrumCards(settings.custom) : []
  const deckSource = customPairs.length >= 2 ? customPairs : WAVELENGTH_DEFAULT_CARDS
  const deck = shuffle([...deckSource])
  const card = deck.pop() || pickOne(WAVELENGTH_DEFAULT_CARDS)

  const activeTeam = 0
  const psychic = team0[0] || seated[0]?.id || 'p0'
  const target = generateTarget()
  const seconds = settings.seconds || 0
  const endsAt = seconds > 0 ? now() + seconds * 1000 : null

  return {
    stage: 'clue',
    round: 1,
    activeTeam,
    teams: [team0, team1],
    scores: [0, 0],
    psychic,
    psychicIndex: [1, 0],
    card,
    target,
    clue: null,
    dialValue: 50,
    dialHolder: null,
    dialHolderAt: null,
    dialConfirms: [],
    counterGuess: null,
    counterConfirms: [],
    roundScore: null,
    winner: null,
    endsAt,
    seconds,
    pointsToWin: settings.pointsToWin || 10,
    randomizeTeams: !!settings.randomizeTeams,
    coop: isCoop,
    deck,
  }
}

export function wAct(
  state: WavelengthState,
  actor: Id,
  _players: CouncilPlayer[],
  action: WavelengthAction,
): WavelengthState | null {
  if (state.stage === 'over') return null

  const activeTeam = state.teams[state.activeTeam] || []
  const opposingTeam = state.teams[1 - state.activeTeam] || []
  const nonPsychicActive = activeTeam.filter(id => id !== state.psychic)
  const eligibleToDial = nonPsychicActive.length > 0 ? nonPsychicActive : activeTeam

  switch (action.t) {
    case 'clue': {
      if (state.stage !== 'clue') return null
      // Only psychic may transmit clue
      if (actor !== state.psychic) return null
      const clue = action.clue.trim().replace(/\s+/g, ' ')
      if (!clue) return null

      const endsAt = state.seconds > 0 ? now() + state.seconds * 1000 : null
      return {
        ...state,
        stage: 'guess',
        clue,
        dialConfirms: [],
        endsAt,
      }
    }

    case 'dial_grab': {
      if (state.stage !== 'guess') return null
      if (!eligibleToDial.includes(actor)) return null

      const isHeldByOther = state.dialHolder !== null && state.dialHolder !== actor
      const isStale = !!state.dialHolderAt && (now() - state.dialHolderAt > 7000)
      if (isHeldByOther && !isStale) return null

      return {
        ...state,
        dialHolder: actor,
        dialHolderAt: now(),
      }
    }

    case 'dial': {
      if (state.stage !== 'guess') return null
      // Everyone on the active team except the psychic can adjust the dial
      if (!eligibleToDial.includes(actor)) return null

      const isHeldByOther = state.dialHolder !== null && state.dialHolder !== actor
      const isStale = !!state.dialHolderAt && (now() - state.dialHolderAt > 7000)
      if (isHeldByOther && !isStale) return null

      const value = clamp(Math.round(action.value * 10) / 10, 0, 100)
      // When a member makes a change, all confirms are reset
      const resetConfirms = value !== state.dialValue ? [] : state.dialConfirms
      return {
        ...state,
        dialValue: value,
        dialHolder: actor,
        dialHolderAt: now(),
        dialConfirms: resetConfirms,
      }
    }

    case 'dial_release': {
      if (state.stage !== 'guess') return null
      if (!eligibleToDial.includes(actor)) return null

      if (state.dialHolder !== null && state.dialHolder !== actor) {
        return null
      }

      let value = state.dialValue
      let resetConfirms = state.dialConfirms
      if (action.value !== undefined) {
        value = clamp(Math.round(action.value * 10) / 10, 0, 100)
        if (value !== state.dialValue) {
          resetConfirms = []
        }
      }

      return {
        ...state,
        dialValue: value,
        dialHolder: null,
        dialHolderAt: null,
        dialConfirms: resetConfirms,
      }
    }

    case 'confirm_dial': {
      if (state.stage !== 'guess') return null
      if (!eligibleToDial.includes(actor)) return null

      if (state.dialHolder !== null && state.dialHolder !== actor) {
        const isStale = !!state.dialHolderAt && (now() - state.dialHolderAt > 7000)
        if (!isStale) return null
      }

      const newConfirms = state.dialConfirms.includes(actor)
        ? state.dialConfirms.filter(id => id !== actor)
        : [...state.dialConfirms, actor]

      const majorityNeeded = Math.floor(eligibleToDial.length / 2) + 1
      if (newConfirms.length >= majorityNeeded) {
        // In Coop mode, skip intercept phase directly to reveal!
        if (state.coop) {
          return transitionToReveal({
            ...state,
            dialHolder: null,
            dialHolderAt: null,
            dialConfirms: newConfirms,
          })
        }

        // Versus mode: move to counter phase
        const endsAt = state.seconds > 0 ? now() + Math.min(state.seconds, 60) * 1000 : null
        return {
          ...state,
          stage: 'counter',
          dialHolder: null,
          dialHolderAt: null,
          dialConfirms: [],
          counterConfirms: [],
          endsAt,
        }
      }

      return {
        ...state,
        dialHolder: state.dialHolder === actor ? null : state.dialHolder,
        dialHolderAt: state.dialHolder === actor ? null : state.dialHolderAt,
        dialConfirms: newConfirms,
      }
    }

    case 'counter': {
      if (state.stage !== 'counter') return null
      if (!opposingTeam.includes(actor)) return null

      // When guess changes, all confirms are reset
      const resetConfirms = action.guess !== state.counterGuess ? [] : state.counterConfirms
      return { ...state, counterGuess: action.guess, counterConfirms: resetConfirms }
    }

    case 'confirm_counter': {
      if (state.stage !== 'counter') return null
      if (!opposingTeam.includes(actor)) return null
      if (!state.counterGuess) return null // Must select left or right first

      const newConfirms = state.counterConfirms.includes(actor)
        ? state.counterConfirms.filter(id => id !== actor)
        : [...state.counterConfirms, actor]

      const majorityNeeded = Math.floor(opposingTeam.length / 2) + 1
      if (newConfirms.length >= majorityNeeded) {
        return transitionToReveal({ ...state, counterConfirms: newConfirms })
      }

      return {
        ...state,
        counterConfirms: newConfirms,
      }
    }

    case 'next_round': {
      if (state.stage !== 'reveal') return null
      const actorPlayer = _players.find(p => p.id === actor)
      if (actorPlayer && !actorPlayer.isAdmin && !actorPlayer.isOwner) return null
      return startNextRound(state)
    }
  }

  return null
}

function transitionToReveal(state: WavelengthState): WavelengthState {
  const roundScore = calcWavelengthScore(state.target, state.dialValue, state.counterGuess)
  const newScores: [number, number] = [state.scores[0], state.scores[1]]

  newScores[state.activeTeam] += roundScore.activePts
  if (!state.coop) {
    newScores[1 - state.activeTeam] += roundScore.counterPts
  }

  let winner: number | null = null
  const winThreshold = state.pointsToWin

  if (state.coop) {
    if (newScores[0] >= winThreshold) {
      winner = 0
    }
  } else {
    // Win evaluation: must reach pointsToWin and lead over the other team
    if (newScores[0] >= winThreshold || newScores[1] >= winThreshold) {
      if (newScores[0] > newScores[1]) {
        winner = 0
      } else if (newScores[1] > newScores[0]) {
        winner = 1
      }
    }
  }

  return {
    ...state,
    stage: 'reveal',
    scores: newScores,
    roundScore,
    winner,
    dialHolder: null,
    dialHolderAt: null,
    dialConfirms: [],
    counterConfirms: [],
    endsAt: null,
  }
}

function startNextRound(state: WavelengthState): WavelengthState {
  if (state.winner !== null) {
    return { ...state, stage: 'over', dialHolder: null, dialHolderAt: null, endsAt: null }
  }

  let nextActiveTeam = state.coop ? 0 : 1 - state.activeTeam
  let teams: [Id[], Id[]] = [state.teams[0], state.teams[1]]

  if (!state.coop && state.randomizeTeams) {
    const allSeated = [...state.teams[0], ...state.teams[1]]
    const shuffled = shuffle(allSeated)
    const t0: Id[] = []
    const t1: Id[] = []
    shuffled.forEach((id, idx) => {
      if (idx % 2 === 0) t0.push(id)
      else t1.push(id)
    })
    teams = [t0, t1]
  }

  const nextTeamMembers = teams[nextActiveTeam]
  const pIdx = state.psychicIndex[nextActiveTeam]
  const psychic = nextTeamMembers[pIdx % nextTeamMembers.length] || 'p0'

  const newPsychicIndex: [number, number] = [state.psychicIndex[0], state.psychicIndex[1]]
  newPsychicIndex[nextActiveTeam] = pIdx + 1

  let deck = [...state.deck]
  if (deck.length === 0) {
    deck = shuffle([...WAVELENGTH_DEFAULT_CARDS])
  }
  const card = deck.pop() || pickOne(WAVELENGTH_DEFAULT_CARDS)
  const target = generateTarget()
  const endsAt = state.seconds > 0 ? now() + state.seconds * 1000 : null

  return {
    ...state,
    stage: 'clue',
    round: state.round + 1,
    activeTeam: nextActiveTeam,
    teams,
    psychic,
    psychicIndex: newPsychicIndex,
    card,
    target,
    clue: null,
    dialValue: 50,
    dialHolder: null,
    dialHolderAt: null,
    dialConfirms: [],
    counterGuess: null,
    counterConfirms: [],
    roundScore: null,
    endsAt,
    deck,
  }
}

export function wTick(
  state: WavelengthState,
  at: number,
  players: CouncilPlayer[],
): WavelengthState | null {
  if (state.stage === 'over') return null

  // Timeout progression
  if (state.endsAt && at >= state.endsAt) {
    if (state.stage === 'clue') {
      const clue = `Vibe: ${state.card[0]} / ${state.card[1]}`
      const endsAt = state.seconds > 0 ? at + state.seconds * 1000 : null
      return { ...state, stage: 'guess', clue, endsAt }
    }
    if (state.stage === 'guess') {
      const endsAt = state.seconds > 0 ? at + Math.min(state.seconds, 45) * 1000 : null
      return { ...state, stage: 'counter', dialHolder: null, dialHolderAt: null, dialConfirms: [], endsAt }
    }
    if (state.stage === 'counter') {
      const fallbackGuess = state.counterGuess || (Math.random() > 0.5 ? 'left' : 'right')
      return transitionToReveal({ ...state, counterGuess: fallbackGuess })
    }
    if (state.stage === 'reveal') {
      return startNextRound(state)
    }
  }

  // Safety release on dial lock if player disconnected or held for > 7s without activity
  if (state.stage === 'guess' && state.dialHolder !== null) {
    const holder = players.find(p => p.id === state.dialHolder)
    if (!holder || !holder.connected || (state.dialHolderAt && at - state.dialHolderAt > 7000)) {
      return { ...state, dialHolder: null, dialHolderAt: null }
    }
  }

  // Autonomous bot progression
  const psychicPlayer = players.find(p => p.id === state.psychic)
  if (state.stage === 'clue' && psychicPlayer?.isBot) {
    const clue = `Beacon: ${state.card[state.target < 50 ? 0 : 1]}`
    const endsAt = state.seconds > 0 ? at + state.seconds * 1000 : null
    return { ...state, stage: 'guess', clue, endsAt }
  }

  const activeTeamMembers = state.teams[state.activeTeam].map(id => players.find(p => p.id === id)).filter(Boolean) as CouncilPlayer[]
  const activeBots = activeTeamMembers.length > 0 && activeTeamMembers.every(p => p.isBot)

  if (state.stage === 'guess' && activeBots) {
    // Bot adjusts dial near target with slight error
    const noise = Math.floor(Math.random() * 15) - 7
    const dialValue = clamp(state.target + noise, 0, 100)
    const endsAt = state.seconds > 0 ? at + Math.min(state.seconds, 45) * 1000 : null
    return { ...state, dialValue, dialHolder: null, dialHolderAt: null, dialConfirms: [], stage: 'counter', endsAt }
  }

  const opposingTeamMembers = state.teams[1 - state.activeTeam].map(id => players.find(p => p.id === id)).filter(Boolean) as CouncilPlayer[]
  const opposingBots = opposingTeamMembers.length > 0 && opposingTeamMembers.every(p => p.isBot)

  if (!state.coop && state.stage === 'counter' && opposingBots) {
    const guess: 'left' | 'right' = state.target < state.dialValue ? 'left' : 'right'
    return transitionToReveal({ ...state, counterGuess: guess })
  }

  // Only auto-advance reveal if ALL active seated players across the game are bots
  const allBots = state.coop ? activeBots : (activeBots && opposingBots)
  if (state.stage === 'reveal' && allBots) {
    return startNextRound(state)
  }

  return null
}

export function wSkip(state: WavelengthState, _players: CouncilPlayer[]): WavelengthState | null {
  if (state.stage === 'over') return null
  if (state.stage === 'clue') {
    const clue = `Broadcast: ${state.card[0]}`
    return { ...state, stage: 'guess', clue, dialConfirms: [], endsAt: state.seconds > 0 ? now() + state.seconds * 1000 : null }
  }
  if (state.stage === 'guess') {
    return { ...state, stage: 'counter', dialHolder: null, dialHolderAt: null, dialConfirms: [], counterConfirms: [], endsAt: state.seconds > 0 ? now() + 45 * 1000 : null }
  }
  if (state.stage === 'counter') {
    return transitionToReveal({ ...state, counterGuess: state.counterGuess || 'left' })
  }
  if (state.stage === 'reveal') {
    return startNextRound(state)
  }
  return null
}

export function wPlayerRemoved(
  state: WavelengthState,
  id: Id,
  _players: CouncilPlayer[],
): WavelengthState {
  const team0 = state.teams[0].filter(x => x !== id)
  const team1 = state.teams[1].filter(x => x !== id)

  let psychic = state.psychic
  if (psychic === id) {
    const activeMembers = state.activeTeam === 0 ? team0 : team1
    psychic = activeMembers[0] || (team0[0] || team1[0] || 'p0')
  }

  return {
    ...state,
    teams: [team0, team1],
    psychic,
    dialHolder: state.dialHolder === id ? null : state.dialHolder,
    dialHolderAt: state.dialHolder === id ? null : state.dialHolderAt,
    dialConfirms: state.dialConfirms.filter(x => x !== id),
    counterConfirms: state.counterConfirms.filter(x => x !== id),
  }
}
