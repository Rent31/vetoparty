// ─── VETO PARTY · Coup rules engine (pure functions, host-authoritative) ───

import { CouncilPlayer, CoupSettings, Id, clamp, pickOne, shuffle } from './core'

export const now = () => Date.now()

// ─── types ───────────────────────────────────────────────────────────────────

export type Character = 'Duke' | 'Assassin' | 'Captain' | 'Ambassador' | 'Contessa' | 'Inquisitor'
export type Faction = 'Loyalist' | 'Reformist'

export type ActionType =
  | 'Income'
  | 'ForeignAid'
  | 'Coup'
  | 'Tax'
  | 'Assassinate'
  | 'Steal'
  | 'Exchange'
  | 'Convert'
  | 'Embezzle'
  | 'Examine'

export interface CoupCard {
  character: Character
  revealed: boolean
}

export interface CoupPlayerState {
  id: Id
  coins: number
  influences: CoupCard[]
  alive: boolean
  faction?: Faction
}

export interface PendingAction {
  type: ActionType
  actorId: Id
  targetId?: Id
  claimedCharacter?: Character
}

export interface PendingBlock {
  blockerId: Id
  claimedCharacter: Character
}

export interface ChallengeState {
  challengerId: Id
  challengedPlayerId: Id
  claimedCharacter: Character
  passedPlayerIds: Id[]
}

export interface InfluenceLossRequest {
  playerId: Id
  reason: 'coup' | 'assassination' | 'challenge_lost' | 'challenge_failed_defense'
}

export interface ExchangeState {
  playerId: Id
  drawnCards: Character[]
}

export interface ExamineSelectionState {
  examinerId: Id
  targetId: Id
}

export interface ExamineState {
  examinerId: Id
  targetId: Id
  cardIndex: number
  character: Character
}

export interface ChallengeRevealInfo {
  challengerId: Id
  challengedId: Id
  character: Character
  wasGenuine: boolean
  cardReplaced: boolean
}

export interface CoupLogItem {
  id: string
  text: string
  at: number
  type?: string
}

export type CoupStage =
  | 'action'
  | 'action_challenge'
  | 'block'
  | 'block_challenge'
  | 'influence_loss'
  | 'exchange'
  | 'examine_selection'
  | 'examine_decision'
  | 'over'

export interface ChallengeRevealSwap {
  challengedId: Id
  challengerId: Id
  revealedCharacter: Character
  stage: 'reveal' | 'swap' | 'bluff_lost'
  outcome: 'failed' | 'succeeded'
  cardLost?: Character
  endsAt: number
}

export interface CoupState {
  stage: CoupStage
  turn: number // index into seats
  actionCount: number
  seats: Id[]  // seated players in turn order
  players: Record<Id, CoupPlayerState>
  deck: Character[]
  treasury: number
  treasuryReserve: number
  pendingAction: PendingAction | null
  pendingBlock: PendingBlock | null
  challengeState: ChallengeState | null
  blockPassedPlayerIds: Id[]
  influenceLossRequest: InfluenceLossRequest | null
  exchangeState: ExchangeState | null
  examineSelectionState: ExamineSelectionState | null
  examineState: ExamineState | null
  lastReveal: ChallengeRevealInfo | null
  challengeRevealSwap: ChallengeRevealSwap | null
  logs: CoupLogItem[]
  winner: Id | null
  endsAt: number | null
  nextBotAt: number | null
  reformation: boolean
  useInquisitor: boolean
  contessaBlocksExamine?: boolean
  actionTimer: number
  turnTimer: number
  scored?: boolean
}

export type CoupAction =
  | { t: 'action'; action: ActionType; targetId?: Id }
  | { t: 'challenge' }
  | { t: 'pass' }
  | { t: 'block'; character: Character }
  | { t: 'lose_influence'; influenceIndex: number }
  | { t: 'exchange'; keepIndices: number[] }
  | { t: 'examine_select'; cardIndex: number }
  | { t: 'examine_decision'; forceSwap: boolean }

// ─── constants ───────────────────────────────────────────────────────────────

export const ACTION_COSTS: Record<ActionType, number> = {
  Income: 0,
  ForeignAid: 0,
  Coup: 7,
  Tax: 0,
  Assassinate: 3,
  Steal: 0,
  Exchange: 0,
  Convert: 1, // 1 for self, 2 for other
  Embezzle: 0,
  Examine: 0,
}

export const ACTION_CLAIMS: Partial<Record<ActionType, Character>> = {
  Tax: 'Duke',
  Assassinate: 'Assassin',
  Steal: 'Captain',
  Exchange: 'Ambassador',
  Examine: 'Inquisitor',
}

export const BLOCKABLE_BY: Partial<Record<ActionType, Character[]>> = {
  ForeignAid: ['Duke'],
  Assassinate: ['Contessa'],
  Steal: ['Captain', 'Ambassador', 'Inquisitor'],
  Examine: ['Contessa'],
}

export function getBlockableBy(s: Pick<CoupState, 'useInquisitor' | 'contessaBlocksExamine'>, type: ActionType): Character[] {
  if (type === 'Examine') {
    return s.contessaBlocksExamine ? ['Contessa'] : []
  }
  if (type === 'Steal') {
    return s.useInquisitor ? ['Captain', 'Inquisitor'] : ['Captain', 'Ambassador']
  }
  return BLOCKABLE_BY[type] ? [...BLOCKABLE_BY[type]!] : []
}

export const CHARACTER_DESCRIPTIONS: Record<Character, string> = {
  Duke: 'Tax: Take 3 coins. Blocks Foreign Aid.',
  Assassin: 'Assassinate: Pay 3 coins, target loses influence. Blocked by Contessa.',
  Captain: 'Steal: Take 2 coins from target. Blocks Steal.',
  Ambassador: 'Exchange: Draw 2 cards, keep what you want. Blocks Steal.',
  Contessa: 'Blocks Assassination.',
  Inquisitor: 'Exchange: Draw 1 card, swap or keep. Examine: Look at target card. Blocks Steal.',
}

// ─── helper functions ────────────────────────────────────────────────────────

const logId = () => Math.random().toString(36).slice(2, 9)

function addLog(s: CoupState, text: string, type?: string): CoupState {
  const item: CoupLogItem = { id: logId(), text, at: now(), type }
  return { ...s, logs: [item, ...s.logs].slice(0, 50) }
}

function playerName(players: CouncilPlayer[], id: Id): string {
  return players.find(p => p.id === id)?.name ?? id
}

function aliveSeats(s: CoupState): Id[] {
  return s.seats.filter(id => s.players[id]?.alive)
}

function nextTurnIndex(s: CoupState, currentTurn: number): number {
  const n = s.seats.length
  if (n === 0) return 0
  for (let step = 1; step <= n; step++) {
    const idx = (currentTurn + step) % n
    const pid = s.seats[idx]
    if (s.players[pid]?.alive) return idx
  }
  return currentTurn
}

function buildDeck(playerCount: number, useInquisitor: boolean, reformation: boolean): Character[] {
  const roles: Character[] = useInquisitor
    ? ['Duke', 'Assassin', 'Captain', 'Inquisitor', 'Contessa']
    : ['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa']

  // 3 copies each for 2-6 players; 4-5 copies for expanded 7-10 players
  const copies = reformation && playerCount > 6 ? (playerCount > 8 ? 5 : 4) : 3
  const deck: Character[] = []
  for (const role of roles) {
    for (let i = 0; i < copies; i++) deck.push(role)
  }
  return shuffle(deck)
}

function hasRole(p: CoupPlayerState, role: Character): boolean {
  return p.influences.some(inf => !inf.revealed && inf.character === role)
}

function unrevealedIndices(p: CoupPlayerState): number[] {
  const res: number[] = []
  p.influences.forEach((inf, i) => { if (!inf.revealed) res.push(i) })
  return res
}

export function isFactionRestricted(s: CoupState, actorId: Id, targetId: Id): boolean {
  if (!s.reformation) return false
  if (actorId === targetId) return false
  const p1 = s.players[actorId]
  const p2 = s.players[targetId]
  if (!p1?.faction || !p2?.faction) return false
  if (p1.faction !== p2.faction) return false

  // If all surviving players share the same faction, restriction is lifted
  const alives = aliveSeats(s)
  if (alives.length <= 1) return false
  const firstFaction = s.players[alives[0]]?.faction
  const allSame = alives.every(id => s.players[id]?.faction === firstFaction)
  return !allSame
}

function checkWin(s: CoupState): CoupState {
  const alives = aliveSeats(s)
  if (alives.length <= 1) {
    const winnerId = alives[0] ?? null
    return {
      ...s,
      stage: 'over',
      winner: winnerId,
      endsAt: null,
      nextBotAt: null,
      pendingAction: null,
      pendingBlock: null,
      challengeState: null,
      challengeRevealSwap: null,
      influenceLossRequest: null,
      exchangeState: null,
      examineSelectionState: null,
      examineState: null,
    }
  }

  return s
}

// ─── initialization ──────────────────────────────────────────────────────────

export function coupInit(players: CouncilPlayer[], settings: CoupSettings): CoupState {
  const seats = shuffle(players.map(p => p.id))
  const deck = buildDeck(seats.length, settings.useInquisitor, settings.reformation)
  const playerStates: Record<Id, CoupPlayerState> = {}

  let deckIdx = 0

  let randomizedAssignments: Faction[] | null = null
  if (settings.reformation && settings.randomizeFactions) {
    const list: Faction[] = seats.map((_, idx) => (idx % 2 === 0 ? 'Loyalist' : 'Reformist'))
    randomizedAssignments = shuffle(list)
  }

  seats.forEach((id, i) => {
    const pl = players.find(p => p.id === id)
    const card1 = deck[deckIdx++]
    const card2 = deck[deckIdx++]
    const teamIdx = typeof pl?.team === 'number' ? pl.team : i
    const faction: Faction | undefined = settings.reformation
      ? (settings.randomizeFactions
        ? randomizedAssignments![i]
        : (teamIdx % 2 === 0 ? 'Loyalist' : 'Reformist'))
      : undefined

    playerStates[id] = {
      id,
      coins: 2,
      influences: [
        { character: card1, revealed: false },
        { character: card2, revealed: false },
      ],
      alive: true,
      faction,
    }
  })

  const remainingDeck = deck.slice(deckIdx)
  const turnSec = settings.turnTimer > 0 ? settings.turnTimer : 0
  const endsAt = turnSec > 0 ? now() + turnSec * 1000 : null

  const firstPlayer = seats[0]
  const firstName = players.find(p => p.id === firstPlayer)?.name ?? 'Player 1'

  let state: CoupState = {
    stage: 'action',
    turn: 0,
    actionCount: 0,
    seats,
    players: playerStates,
    deck: remainingDeck,
    treasury: Math.max(0, 50 - seats.length * 2),
    treasuryReserve: 0,
    pendingAction: null,
    pendingBlock: null,
    challengeState: null,
    blockPassedPlayerIds: [],
    influenceLossRequest: null,
    exchangeState: null,
    examineSelectionState: null,
    examineState: null,
    lastReveal: null,
    challengeRevealSwap: null,
    logs: [],
    winner: null,
    endsAt,
    nextBotAt: now() + 1200,
    reformation: settings.reformation,
    useInquisitor: settings.useInquisitor,
    contessaBlocksExamine: settings.contessaBlocksExamine ?? false,
    actionTimer: settings.actionTimer,
    turnTimer: settings.turnTimer,
  }

  state = addLog(state, `Session opened. ${firstName} holds the floor.`, 'start')
  return state
}

// ─── actions dispatcher ──────────────────────────────────────────────────────

export function coupAct(
  state: CoupState,
  actor: Id,
  players: CouncilPlayer[],
  action: CoupAction,
): CoupState | null {
  if (state.stage === 'over') return null
  const pl = state.players[actor]
  if (!pl || !pl.alive) return null

  switch (action.t) {
    case 'action':
      return handleDeclareAction(state, actor, action.action, action.targetId, players)
    case 'challenge':
      return handleChallenge(state, actor, players)
    case 'pass':
      return handlePass(state, actor, players)
    case 'block':
      return handleBlock(state, actor, action.character, players)
    case 'lose_influence':
      return handleChooseInfluenceLoss(state, actor, action.influenceIndex, players)
    case 'exchange':
      return handleChooseExchange(state, actor, action.keepIndices, players)
    case 'examine_select':
      return handleExamineSelect(state, actor, action.cardIndex, players)
    case 'examine_decision':
      return handleExamineDecision(state, actor, action.forceSwap, players)
    default:
      return null
  }
}

// ─── action declaration ──────────────────────────────────────────────────────

function handleDeclareAction(
  s: CoupState,
  actorId: Id,
  type: ActionType,
  targetId: Id | undefined,
  players: CouncilPlayer[],
): CoupState | null {
  if (s.stage !== 'action') return null
  const curId = s.seats[s.turn]
  if (curId !== actorId) return null

  const actor = s.players[actorId]
  if (!actor || !actor.alive) return null

  // Mandatory coup if 10 or more coins
  if (actor.coins >= 10 && type !== 'Coup') return null

  // Check cost
  const baseCost = ACTION_COSTS[type]
  let cost = baseCost
  if (type === 'Convert') {
    if (!s.reformation) return null
    if (targetId && (!s.players[targetId] || !s.players[targetId].alive)) return null
    cost = targetId && targetId !== actorId ? 2 : 1
  }
  if (actor.coins < cost) return null

  // Target requirements
  const requiresTarget = ['Coup', 'Assassinate', 'Steal', 'Examine'].includes(type)
  if (requiresTarget) {
    if (!targetId || targetId === actorId) return null
    const target = s.players[targetId]
    if (!target || !target.alive) return null
    if (type === 'Steal' && target.coins <= 0) return null
    if (isFactionRestricted(s, actorId, targetId)) return null
  }

  // Determine claim
  let claimedCharacter = ACTION_CLAIMS[type]
  if (type === 'Exchange' && s.useInquisitor) {
    claimedCharacter = 'Inquisitor'
  }

  const actorName = playerName(players, actorId)
  const targetName = targetId ? playerName(players, targetId) : ''

  // Deduct cost upfront
  let updatedPlayers = { ...s.players }
  let treasury = s.treasury
  let treasuryReserve = s.treasuryReserve

  if (cost > 0) {
    if (type === 'Convert') {
      updatedPlayers[actorId] = { ...actor, coins: actor.coins - cost }
      treasuryReserve += cost
    } else {
      updatedPlayers[actorId] = { ...actor, coins: actor.coins - cost }
      treasury += cost
    }
  }

  // Income: unchallengeable, unblockable
  if (type === 'Income') {
    const updatedActor = updatedPlayers[actorId]
    updatedPlayers[actorId] = { ...updatedActor, coins: updatedActor.coins + 1 }
    treasury = Math.max(0, treasury - 1)
    let nextState: CoupState = {
      ...s,
      players: updatedPlayers,
      treasury,
      treasuryReserve,
      stage: 'action',
      turn: nextTurnIndex(s, s.turn),
      endsAt: s.turnTimer > 0 ? now() + s.turnTimer * 1000 : null,
      nextBotAt: now() + 900,
    }
    nextState = addLog(nextState, `${actorName} takes Income (+1 coin).`, 'income')
    return nextState
  }

  // Convert (Reformation): unchallengeable, unblockable
  if (type === 'Convert') {
    const affectedId = targetId && targetId !== actorId ? targetId : actorId
    const currentFaction = updatedPlayers[affectedId].faction
    const newFaction: Faction = currentFaction === 'Loyalist' ? 'Reformist' : 'Loyalist'
    updatedPlayers[affectedId] = { ...updatedPlayers[affectedId], faction: newFaction }
    const affectedName = playerName(players, affectedId)
    let nextState: CoupState = {
      ...s,
      players: updatedPlayers,
      treasury,
      treasuryReserve,
      stage: 'action',
      turn: nextTurnIndex(s, s.turn),
      endsAt: s.turnTimer > 0 ? now() + s.turnTimer * 1000 : null,
      nextBotAt: now() + 900,
    }
    const logMsg = affectedId === actorId
      ? `${actorName} converted themself to ${newFaction}.`
      : `${actorName} converted ${affectedName} to ${newFaction}.`
    nextState = addLog(nextState, logMsg, 'convert')
    return nextState
  }

  // Coup: unchallengeable, unblockable -> target loses influence
  if (type === 'Coup') {
    const target = updatedPlayers[targetId!]
    const unrevealed = unrevealedIndices(target)
    let nextState: CoupState = {
      ...s,
      players: updatedPlayers,
      treasury,
      treasuryReserve,
      pendingAction: { type, actorId, targetId },
    }
    nextState = addLog(nextState, `${actorName} launches a Coup against ${targetName}!`, 'coup')

    if (unrevealed.length === 1) {
      // Auto-reveal only card
      return applyInfluenceLoss(nextState, targetId!, unrevealed[0], 'coup', players)
    }
    // Target chooses which card to lose
    return {
      ...nextState,
      stage: 'influence_loss',
      influenceLossRequest: { playerId: targetId!, reason: 'coup' },
      endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
      nextBotAt: now() + 800,
    }
  }

  // Challengeable actions: Tax, Assassinate, Steal, Exchange, Embezzle, Examine
  const isChallengeable = !!claimedCharacter || type === 'Embezzle'
  const actionTimerMs = s.actionTimer > 0 ? s.actionTimer * 1000 : null

  if (isChallengeable) {
    let nextState: CoupState = {
      ...s,
      actionCount: (s.actionCount || 0) + 1,
      players: updatedPlayers,
      treasury,
      treasuryReserve,
      stage: 'action_challenge',
      pendingAction: { type, actorId, targetId, claimedCharacter },
      challengeState: {
        challengerId: '',
        challengedPlayerId: actorId,
        claimedCharacter: claimedCharacter || 'Duke', // For Embezzle inverse claim
        passedPlayerIds: [actorId],
      },
      blockPassedPlayerIds: [],
      endsAt: actionTimerMs ? now() + actionTimerMs : null,
      nextBotAt: now() + 800,
    }

    if (type === 'Embezzle') {
      nextState = addLog(nextState, `${actorName} claims Embezzle (claims no Duke).`, 'claim')
    } else {
      const claimMsg = targetName
        ? `${actorName} claims ${claimedCharacter} to ${type} against ${targetName}.`
        : `${actorName} claims ${claimedCharacter} to ${type}.`
      nextState = addLog(nextState, claimMsg, 'claim')
    }
    return nextState
  }

  // Foreign Aid: not challengeable, but blockable by Duke
  if (type === 'ForeignAid') {
    let nextState: CoupState = {
      ...s,
      actionCount: (s.actionCount || 0) + 1,
      players: updatedPlayers,
      treasury,
      treasuryReserve,
      stage: 'block',
      pendingAction: { type, actorId },
      blockPassedPlayerIds: [actorId],
      endsAt: actionTimerMs ? now() + actionTimerMs : null,
      nextBotAt: now() + 800,
    }
    nextState = addLog(nextState, `${actorName} claims Foreign Aid (+2 coins).`, 'declare')
    return nextState
  }

  return null
}

// ─── challenge handling ──────────────────────────────────────────────────────

function handleChallenge(s: CoupState, challengerId: Id, players: CouncilPlayer[]): CoupState | null {
  if (s.stage === 'action_challenge') {
    return resolveActionChallenge(s, challengerId, players)
  }
  if (s.stage === 'block_challenge') {
    return resolveBlockChallenge(s, challengerId, players)
  }
  return null
}

function resolveActionChallenge(s: CoupState, challengerId: Id, players: CouncilPlayer[]): CoupState | null {
  const pa = s.pendingAction
  if (!pa || !s.challengeState) return null
  if (challengerId === pa.actorId) return null
  if (s.challengeState.passedPlayerIds.includes(challengerId)) return null

  const challenger = s.players[challengerId]
  const challenged = s.players[pa.actorId]
  if (!challenger?.alive || !challenged?.alive) return null

  const claimed = pa.claimedCharacter!
  const isEmbezzle = pa.type === 'Embezzle'
  const challengerName = playerName(players, challengerId)
  const challengedName = playerName(players, challenged.id)

  let state = { ...s }
  state = addLog(state, `${challengerName} challenges ${challengedName}!`, 'challenge')

  // Inverse challenge for Embezzle: Challenger wins if actor DOES have Duke
  const actorHasClaimed = isEmbezzle
    ? !hasRole(challenged, 'Duke')
    : hasRole(challenged, claimed)

  if (actorHasClaimed) {
    // Challenge FAILS: challenged player was truthful, challenger loses influence
    state = addLog(state, `${challengedName} was truthful. ${challengerName} loses an influence!`, 'challenge_fail')
    state.lastReveal = {
      challengerId,
      challengedId: challenged.id,
      character: claimed,
      wasGenuine: true,
      cardReplaced: true,
    }

    // Replace the truthful card in deck
    if (!isEmbezzle) {
      state = replaceHandCard(state, challenged.id, claimed)
    }

    return {
      ...state,
      challengeRevealSwap: {
        challengedId: challenged.id,
        challengerId,
        revealedCharacter: claimed,
        outcome: 'failed',
        stage: 'reveal',
        endsAt: now() + 1800,
      },
      nextBotAt: now() + 3800,
    }
  } else {
    // Challenge SUCCEEDS: challenged player lied, challenged player loses influence
    state = addLog(state, `${challengedName} was BLUFFING and got caught!`, 'challenge_success')
    state.lastReveal = {
      challengerId,
      challengedId: challenged.id,
      character: claimed,
      wasGenuine: false,
      cardReplaced: false,
    }

    // Refund cost if applicable (e.g. Assassinate costs 3)
    const cost = ACTION_COSTS[pa.type]
    if (cost > 0 && pa.type !== 'Convert') {
      const curCoins = state.players[pa.actorId].coins
      state.players = {
        ...state.players,
        [pa.actorId]: { ...state.players[pa.actorId], coins: curCoins + cost },
      }
      state.treasury = Math.max(0, state.treasury - cost)
    }

    const unrevealed = unrevealedIndices(challenged)
    if (unrevealed.length === 1) {
      const lostChar = challenged.influences[unrevealed[0]].character
      state = applyInfluenceLoss(state, challenged.id, unrevealed[0], 'challenge_failed_defense', players)
      return {
        ...state,
        pendingAction: null,
        challengeRevealSwap: {
          challengedId: challenged.id,
          challengerId,
          revealedCharacter: claimed,
          cardLost: lostChar,
          outcome: 'succeeded',
          stage: 'bluff_lost',
          endsAt: now() + 2600,
        },
        nextBotAt: now() + 3200,
      }
    }

    return {
      ...state,
      stage: 'influence_loss',
      pendingAction: null, // Action cancelled
      influenceLossRequest: { playerId: challenged.id, reason: 'challenge_failed_defense' },
      endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
      nextBotAt: now() + 800,
    }
  }
}

function resolveBlockChallenge(s: CoupState, challengerId: Id, players: CouncilPlayer[]): CoupState | null {
  const pb = s.pendingBlock
  const pa = s.pendingAction
  if (!pb || !pa || !s.challengeState) return null
  if (challengerId === pb.blockerId) return null

  const challenger = s.players[challengerId]
  const blocker = s.players[pb.blockerId]
  if (!challenger?.alive || !blocker?.alive) return null

  const challengerName = playerName(players, challengerId)
  const blockerName = playerName(players, blocker.id)
  let state = { ...s }
  state = addLog(state, `${challengerName} challenges ${blockerName}'s block!`, 'challenge')

  const blockerHasCard = hasRole(blocker, pb.claimedCharacter)

  if (blockerHasCard) {
    // Block stands! Challenger loses an influence, original action cancelled
    state = addLog(state, `${blockerName} reveals ${pb.claimedCharacter}. Block stands! ${challengerName} loses influence.`, 'challenge_fail')
    state.lastReveal = {
      challengerId,
      challengedId: blocker.id,
      character: pb.claimedCharacter,
      wasGenuine: true,
      cardReplaced: true,
    }
    state = replaceHandCard(state, blocker.id, pb.claimedCharacter)

    return {
      ...state,
      challengeRevealSwap: {
        challengedId: blocker.id,
        challengerId,
        revealedCharacter: pb.claimedCharacter,
        outcome: 'failed',
        stage: 'reveal',
        endsAt: now() + 1800,
      },
      nextBotAt: now() + 3800,
    }
  } else {
    // Blocker lied! Block fails, blocker loses influence, action proceeds
    state = addLog(state, `${blockerName} did NOT have ${pb.claimedCharacter}! Block broken.`, 'challenge_success')
    state.lastReveal = {
      challengerId,
      challengedId: blocker.id,
      character: pb.claimedCharacter,
      wasGenuine: false,
      cardReplaced: false,
    }

    const unrevealed = unrevealedIndices(blocker)
    if (unrevealed.length === 1) {
      const lostChar = blocker.influences[unrevealed[0]].character
      state = applyInfluenceLoss(state, blocker.id, unrevealed[0], 'challenge_failed_defense', players)
      // Blocker lost, action resolves directly after animation!
      return {
        ...state,
        challengeRevealSwap: {
          challengedId: blocker.id,
          challengerId,
          revealedCharacter: pb.claimedCharacter,
          cardLost: lostChar,
          outcome: 'succeeded',
          stage: 'bluff_lost',
          endsAt: now() + 2600,
        },
        nextBotAt: now() + 3200,
      }
    }

    return {
      ...state,
      stage: 'influence_loss',
      influenceLossRequest: { playerId: blocker.id, reason: 'challenge_failed_defense' },
      endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
      nextBotAt: now() + 800,
    }
  }
}

// ─── block handling ──────────────────────────────────────────────────────────

function handleBlock(s: CoupState, blockerId: Id, character: Character, players: CouncilPlayer[]): CoupState | null {
  if (s.stage !== 'block') return null
  const pa = s.pendingAction
  if (!pa) return null
  if (blockerId === pa.actorId) return null

  const blocker = s.players[blockerId]
  if (!blocker || !blocker.alive) return null

  // Check valid blocker role for action
  const allowed = getBlockableBy(s, pa.type)
  if (!allowed.includes(character)) return null

  // Targeted actions (Assassinate, Steal, Examine) can ONLY be blocked by the target!
  if (['Assassinate', 'Steal', 'Examine'].includes(pa.type) && blockerId !== pa.targetId) {
    return null
  }

  // Reformation faction check for Foreign Aid block
  if (pa.type === 'ForeignAid' && isFactionRestricted(s, blockerId, pa.actorId)) {
    return null
  }

  const blockerName = playerName(players, blockerId)
  let nextState: CoupState = {
    ...s,
    stage: 'block_challenge',
    actionCount: (s.actionCount || 0) + 1,
    pendingBlock: { blockerId, claimedCharacter: character },
    challengeState: {
      challengerId: '',
      challengedPlayerId: blockerId,
      claimedCharacter: character,
      passedPlayerIds: [blockerId],
    },
    endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
    nextBotAt: now() + 800,
  }
  nextState = addLog(nextState, `${blockerName} blocks with ${character}!`, 'block')
  return nextState
}

// ─── pass handling ───────────────────────────────────────────────────────────

function handlePass(s: CoupState, playerId: Id, players: CouncilPlayer[]): CoupState | null {
  const p = s.players[playerId]
  if (!p || !p.alive) return null

  if (s.stage === 'action_challenge') {
    if (!s.challengeState) return null
    if (s.challengeState.passedPlayerIds.includes(playerId)) return null
    const nextPassed = [...s.challengeState.passedPlayerIds, playerId]

    const aliveCount = aliveSeats(s).length
    const nextState: CoupState = {
      ...s,
      challengeState: { ...s.challengeState, passedPlayerIds: nextPassed },
      nextBotAt: now() + 600,
    }

    if (nextPassed.length >= aliveCount) {
      // Everyone passed on action challenge!
      return handleAllPassedActionChallenge(nextState, players)
    }
    return nextState
  }

  if (s.stage === 'block') {
    const pa = s.pendingAction
    if (!pa) return null
    if (s.blockPassedPlayerIds.includes(playerId)) return null
    const nextPassed = [...s.blockPassedPlayerIds, playerId]

    // Determine who was eligible to block
    const isTargeted = ['Assassinate', 'Steal', 'Examine'].includes(pa.type)
    const allPassed = isTargeted
      ? (pa.targetId ? nextPassed.includes(pa.targetId) : true)
      : aliveSeats(s).every(id => id === pa.actorId || nextPassed.includes(id))

    if (allPassed) {
      // All passed block! Action resolves
      return executeResolvedAction(s, pa, players)
    }
    return {
      ...s,
      blockPassedPlayerIds: nextPassed,
      nextBotAt: now() + 600,
    }
  }

  if (s.stage === 'block_challenge') {
    if (!s.challengeState || !s.pendingBlock) return null
    if (s.challengeState.passedPlayerIds.includes(playerId)) return null
    const nextPassed = [...s.challengeState.passedPlayerIds, playerId]

    const aliveCount = aliveSeats(s).length
    if (nextPassed.length >= aliveCount) {
      // Block stands unchallenged! Action cancelled
      let nextState = addLog(s, `Block stands unchallenged. Action counteracted.`, 'block')
      return advanceTurnAfterActionEnded(nextState, players)
    }
    return {
      ...s,
      challengeState: { ...s.challengeState, passedPlayerIds: nextPassed },
      nextBotAt: now() + 600,
    }
  }

  return null
}

function handleAllPassedActionChallenge(s: CoupState, players: CouncilPlayer[]): CoupState {
  const checked = checkWin(s)
  if (checked.stage === 'over') return checked

  const pa = checked.pendingAction!
  if (pa.targetId && !checked.players[pa.targetId]?.alive) {
    return advanceTurnAfterActionEnded(checked, players)
  }

  const blockable = getBlockableBy(checked, pa.type)

  if (blockable && blockable.length > 0) {
    const isTargeted = ['Assassinate', 'Steal', 'Examine'].includes(pa.type)
    // For targeted actions, only the target can block; all other alive players auto-pass
    const initialPassed = isTargeted
      ? aliveSeats(checked).filter(id => id !== pa.targetId)
      : [pa.actorId]

    return {
      ...checked,
      stage: 'block',
      actionCount: (checked.actionCount || 0) + 1,
      challengeState: null,
      blockPassedPlayerIds: initialPassed,
      endsAt: checked.actionTimer > 0 ? now() + checked.actionTimer * 1000 : null,
      nextBotAt: now() + 800,
    }
  }
  return executeResolvedAction(checked, pa, players)
}

function checkAfterActionChallengeDefended(
  s: CoupState,
  pa: PendingAction,
  challengerId: Id,
  players: CouncilPlayer[],
): CoupState {
  const checked = checkWin(s)
  if (checked.stage === 'over') return checked

  if (pa.targetId && !checked.players[pa.targetId]?.alive) {
    return advanceTurnAfterActionEnded(checked, players)
  }

  const blockable = getBlockableBy(checked, pa.type)
  if (blockable && blockable.length > 0) {
    // If targeted, the target (even if they challenged and survived) is still eligible to block.
    // If not targeted, any alive player other than the actor and the failed challenger can block.
    const isTargeted = ['Assassinate', 'Steal', 'Examine'].includes(pa.type)
    const initialPassed = isTargeted
      ? aliveSeats(checked).filter(id => id !== pa.targetId)
      : Array.from(new Set([pa.actorId, challengerId]))

    return {
      ...checked,
      stage: 'block',
      actionCount: (checked.actionCount || 0) + 1,
      challengeState: null,
      blockPassedPlayerIds: initialPassed,
      endsAt: checked.actionTimer > 0 ? now() + checked.actionTimer * 1000 : null,
      nextBotAt: now() + 800,
    }
  }
  return executeResolvedAction(checked, pa, players)
}

// ─── resolved actions ────────────────────────────────────────────────────────

function executeResolvedAction(s: CoupState, pa: PendingAction, players: CouncilPlayer[]): CoupState {
  const checked = checkWin(s)
  if (checked.stage === 'over') return checked

  if (pa.targetId && !checked.players[pa.targetId]?.alive) {
    return advanceTurnAfterActionEnded(checked, players)
  }

  const actor = checked.players[pa.actorId]
  const actorName = playerName(players, pa.actorId)
  const targetName = pa.targetId ? playerName(players, pa.targetId) : ''

  let updatedPlayers = { ...checked.players }
  let treasury = checked.treasury
  let treasuryReserve = checked.treasuryReserve

  switch (pa.type) {
    case 'Tax': {
      updatedPlayers[pa.actorId] = { ...actor, coins: actor.coins + 3 }
      treasury = Math.max(0, treasury - 3)
      let nextState: CoupState = {
        ...s,
        players: updatedPlayers,
        treasury,
        pendingAction: null,
        pendingBlock: null,
      }
      nextState = addLog(nextState, `${actorName} collects Tax (+3 coins).`, 'resolve')
      return advanceTurnAfterActionEnded(nextState, players)
    }

    case 'ForeignAid': {
      updatedPlayers[pa.actorId] = { ...actor, coins: actor.coins + 2 }
      treasury = Math.max(0, treasury - 2)
      let nextState: CoupState = {
        ...s,
        players: updatedPlayers,
        treasury,
        pendingAction: null,
        pendingBlock: null,
      }
      nextState = addLog(nextState, `${actorName} takes Foreign Aid (+2 coins).`, 'resolve')
      return advanceTurnAfterActionEnded(nextState, players)
    }

    case 'Steal': {
      const target = updatedPlayers[pa.targetId!]
      const stolen = Math.min(2, target.coins)
      updatedPlayers[pa.targetId!] = { ...target, coins: target.coins - stolen }
      updatedPlayers[pa.actorId] = { ...actor, coins: actor.coins + stolen }
      let nextState: CoupState = {
        ...s,
        players: updatedPlayers,
        pendingAction: null,
        pendingBlock: null,
      }
      nextState = addLog(nextState, `${actorName} steals ${stolen} coin${stolen === 1 ? '' : 's'} from ${targetName}.`, 'resolve')
      return advanceTurnAfterActionEnded(nextState, players)
    }

    case 'Assassinate': {
      const target = updatedPlayers[pa.targetId!]
      if (!target.alive) {
        return advanceTurnAfterActionEnded({ ...s, pendingAction: null, pendingBlock: null }, players)
      }
      const unrevealed = unrevealedIndices(target)
      let nextState: CoupState = {
        ...s,
        pendingAction: null,
        pendingBlock: null,
      }
      nextState = addLog(nextState, `${targetName} is assassinated!`, 'assassinate')
      if (unrevealed.length === 1) {
        nextState = applyInfluenceLoss(nextState, pa.targetId!, unrevealed[0], 'assassination', players)
        return advanceTurnAfterActionEnded(nextState, players)
      }
      return {
        ...nextState,
        stage: 'influence_loss',
        influenceLossRequest: { playerId: pa.targetId!, reason: 'assassination' },
        endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
        nextBotAt: now() + 800,
      }
    }

    case 'Exchange': {
      const drawCount = pa.claimedCharacter === 'Inquisitor' ? 1 : 2
      const drawnCards = s.deck.slice(0, drawCount)
      const newDeck = s.deck.slice(drawCount)

      let nextState: CoupState = {
        ...s,
        stage: 'exchange',
        deck: newDeck,
        exchangeState: { playerId: pa.actorId, drawnCards },
        pendingAction: null,
        pendingBlock: null,
        endsAt: s.turnTimer > 0 ? now() + s.turnTimer * 1000 : null,
        nextBotAt: now() + 900,
      }
      nextState = addLog(nextState, `${actorName} draws for Exchange.`, 'exchange')
      return nextState
    }

    case 'Embezzle': {
      const takeAmount = treasuryReserve
      updatedPlayers[pa.actorId] = { ...actor, coins: actor.coins + takeAmount }
      treasuryReserve = 0
      let nextState: CoupState = {
        ...s,
        players: updatedPlayers,
        treasuryReserve,
        pendingAction: null,
        pendingBlock: null,
      }
      nextState = addLog(nextState, `${actorName} embezzles ${takeAmount} coin${takeAmount === 1 ? '' : 's'} from reserve.`, 'resolve')
      return advanceTurnAfterActionEnded(nextState, players)
    }

    case 'Examine': {
      const target = updatedPlayers[pa.targetId!]
      const unrevealed = unrevealedIndices(target)
      if (unrevealed.length === 0) {
        return advanceTurnAfterActionEnded({ ...s, pendingAction: null, pendingBlock: null }, players)
      }
      if (unrevealed.length === 1) {
        const cardIndex = unrevealed[0]
        const card = target.influences[cardIndex].character
        return {
          ...s,
          stage: 'examine_decision',
          examineState: { examinerId: pa.actorId, targetId: target.id, cardIndex, character: card },
          pendingAction: null,
          pendingBlock: null,
          endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
          nextBotAt: now() + 900,
        }
      }
      return {
        ...s,
        stage: 'examine_selection',
        examineSelectionState: { examinerId: pa.actorId, targetId: target.id },
        pendingAction: null,
        pendingBlock: null,
        endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
        nextBotAt: now() + 800,
      }
    }

    default:
      return advanceTurnAfterActionEnded(s, players)
  }
}

// ─── influence loss handling ─────────────────────────────────────────────────

function handleChooseInfluenceLoss(
  s: CoupState,
  playerId: Id,
  influenceIndex: number,
  players: CouncilPlayer[],
): CoupState | null {
  if (s.stage !== 'influence_loss' || !s.influenceLossRequest) return null
  if (s.influenceLossRequest.playerId !== playerId) return null

  const p = s.players[playerId]
  if (!p || !p.alive) return null
  if (influenceIndex < 0 || influenceIndex >= p.influences.length) return null
  if (p.influences[influenceIndex].revealed) return null

  const reason = s.influenceLossRequest.reason
  const lostCard = p.influences[influenceIndex].character
  let nextState = applyInfluenceLoss(s, playerId, influenceIndex, reason, players)

  // Determine next phase based on reason
  if (reason === 'coup' || reason === 'assassination') {
    return advanceTurnAfterActionEnded(nextState, players)
  }

  if (reason === 'challenge_failed_defense') {
    return {
      ...nextState,
      challengeRevealSwap: {
        challengedId: playerId,
        challengerId: s.challengeState?.challengerId || s.lastReveal?.challengerId || '',
        revealedCharacter: lostCard,
        cardLost: lostCard,
        outcome: 'succeeded',
        stage: 'bluff_lost',
        endsAt: now() + 2600,
      },
      nextBotAt: now() + 3200,
    }
  }

  if (reason === 'challenge_lost') {
    // Challenger lost influence
    if (nextState.pendingBlock) {
      let st = addLog(nextState, 'Block stands successful. Action counteracted.', 'block')
      return advanceTurnAfterActionEnded(st, players)
    }
    if (nextState.pendingAction) {
      const pa = nextState.pendingAction
      return checkAfterActionChallengeDefended(nextState, pa, playerId, players)
    }
    return advanceTurnAfterActionEnded(nextState, players)
  }

  return advanceTurnAfterActionEnded(nextState, players)
}

function applyInfluenceLoss(
  s: CoupState,
  playerId: Id,
  idx: number,
  reason: string,
  players: CouncilPlayer[],
): CoupState {
  const p = s.players[playerId]
  const card = p.influences[idx]
  const char = card.character

  const updatedInfluences = p.influences.map((inf, i) =>
    i === idx ? { ...inf, revealed: true } : inf,
  )
  const remainingAlive = updatedInfluences.some(inf => !inf.revealed)
  const name = playerName(players, playerId)

  let nextState: CoupState = {
    ...s,
    players: {
      ...s.players,
      [playerId]: {
        ...p,
        influences: updatedInfluences,
        alive: remainingAlive,
      },
    },
    influenceLossRequest: null,
  }

  nextState = addLog(nextState, `${name} lost influence: ${char}.`, 'loss')

  if (!remainingAlive) {
    nextState = addLog(nextState, `${name} has been ELIMINATED!`, 'eliminate')
  }

  return checkWin(nextState)
}

// ─── exchange handling ───────────────────────────────────────────────────────

function handleChooseExchange(
  s: CoupState,
  playerId: Id,
  keepIndices: number[],
  players: CouncilPlayer[],
): CoupState | null {
  if (s.stage !== 'exchange' || !s.exchangeState) return null
  if (s.exchangeState.playerId !== playerId) return null

  const p = s.players[playerId]
  if (!p || !p.alive) return null

  const unrevealed = unrevealedIndices(p)
  if (keepIndices.length !== unrevealed.length) return null

  const unrevealedCards = unrevealed.map(i => p.influences[i].character)
  const allPool = [...unrevealedCards, ...s.exchangeState.drawnCards]

  // Validate indices
  const valid = keepIndices.every(i => i >= 0 && i < allPool.length)
  if (!valid) return null
  if (new Set(keepIndices).size !== keepIndices.length) return null

  const keptCards = keepIndices.map(i => allPool[i])
  const returnedCards = allPool.filter((_, i) => !keepIndices.includes(i))

  let keptIdx = 0
  const updatedInfluences = p.influences.map(inf => {
    if (inf.revealed) return inf
    return { ...inf, character: keptCards[keptIdx++] }
  })

  const newDeck = shuffle([...s.deck, ...returnedCards])
  const name = playerName(players, playerId)

  let nextState: CoupState = {
    ...s,
    stage: 'action',
    players: {
      ...s.players,
      [playerId]: { ...p, influences: updatedInfluences },
    },
    deck: newDeck,
    exchangeState: null,
  }
  nextState = addLog(nextState, `${name} completed the Exchange.`, 'resolve')
  return advanceTurnAfterActionEnded(nextState, players)
}

// ─── examine handling (Inquisitor) ───────────────────────────────────────────

function handleExamineSelect(
  s: CoupState,
  targetId: Id,
  cardIndex: number,
  players: CouncilPlayer[],
): CoupState | null {
  if (s.stage !== 'examine_selection' || !s.examineSelectionState) return null
  if (s.examineSelectionState.targetId !== targetId) return null

  const target = s.players[targetId]
  if (!target || !target.alive) return null
  if (cardIndex < 0 || cardIndex >= target.influences.length) return null
  if (target.influences[cardIndex].revealed) return null

  const character = target.influences[cardIndex].character
  return {
    ...s,
    stage: 'examine_decision',
    examineSelectionState: null,
    examineState: {
      examinerId: s.examineSelectionState.examinerId,
      targetId,
      cardIndex,
      character,
    },
    endsAt: s.actionTimer > 0 ? now() + s.actionTimer * 1000 : null,
    nextBotAt: now() + 800,
  }
}

function handleExamineDecision(
  s: CoupState,
  examinerId: Id,
  forceSwap: boolean,
  players: CouncilPlayer[],
): CoupState | null {
  if (s.stage !== 'examine_decision' || !s.examineState) return null
  if (s.examineState.examinerId !== examinerId) return null

  const { targetId, cardIndex, character } = s.examineState
  const target = s.players[targetId]
  const targetName = playerName(players, targetId)
  const examinerName = playerName(players, examinerId)

  let nextState: CoupState = { ...s, examineState: null }

  if (forceSwap && s.deck.length > 0) {
    const newCard = s.deck[0]
    const updatedInfluences = target.influences.map((inf, i) =>
      i === cardIndex ? { ...inf, character: newCard } : inf,
    )
    const newDeck = shuffle([...s.deck.slice(1), character])
    nextState.players = {
      ...nextState.players,
      [targetId]: { ...target, influences: updatedInfluences },
    }
    nextState.deck = newDeck
    nextState = addLog(nextState, `${examinerName} examined ${targetName}'s card and forced a swap.`, 'resolve')
  } else {
    nextState = addLog(nextState, `${examinerName} examined ${targetName}'s card and allowed them to keep it.`, 'resolve')
  }

  return advanceTurnAfterActionEnded(nextState, players)
}

// ─── hand card replacement (truthful defense) ────────────────────────────────

function replaceHandCard(s: CoupState, playerId: Id, role: Character): CoupState {
  const p = s.players[playerId]
  if (!p) return s

  const idx = p.influences.findIndex(inf => !inf.revealed && inf.character === role)
  if (idx < 0 || s.deck.length === 0) return s

  const newCard = s.deck[0]
  const newDeck = shuffle([...s.deck.slice(1), role])
  const updatedInfluences = p.influences.map((inf, i) =>
    i === idx ? { ...inf, character: newCard } : inf,
  )

  return {
    ...s,
    deck: newDeck,
    players: {
      ...s.players,
      [playerId]: { ...p, influences: updatedInfluences },
    },
  }
}

// ─── turn advancement ────────────────────────────────────────────────────────

function advanceTurnAfterActionEnded(s: CoupState, players: CouncilPlayer[]): CoupState {
  const checked = checkWin(s)
  if (checked.stage === 'over') return checked

  const nextTurn = nextTurnIndex(checked, checked.turn)
  const nextPlayerId = checked.seats[nextTurn]
  const nextPlayer = checked.players[nextPlayerId]
  const nextPlayerName = playerName(players, nextPlayerId)

  const turnSec = checked.turnTimer > 0 ? checked.turnTimer : 0
  const endsAt = turnSec > 0 ? now() + turnSec * 1000 : null

  let nextState: CoupState = {
    ...checked,
    stage: 'action',
    turn: nextTurn,
    pendingAction: null,
    pendingBlock: null,
    challengeState: null,
    blockPassedPlayerIds: [],
    influenceLossRequest: null,
    exchangeState: null,
    examineSelectionState: null,
    examineState: null,
    endsAt,
    nextBotAt: now() + 900,
  }

  if (nextPlayer && nextPlayer.coins >= 10) {
    nextState = addLog(nextState, `${nextPlayerName} has ${nextPlayer.coins} coins and MUST Coup!`, 'turn')
  }

  return nextState
}

// ─── bot decisions ───────────────────────────────────────────────────────────

function botChooseAction(s: CoupState, botId: Id): CoupAction | null {
  const bot = s.players[botId]
  if (!bot || !bot.alive) return null

  const opponents = aliveSeats(s).filter(id => id !== botId && !isFactionRestricted(s, botId, id))
  if (opponents.length === 0 && aliveSeats(s).length > 1) {
    // Everyone in same faction and restricted -> use Convert
    return { t: 'action', action: 'Convert' }
  }

  // Pick target with most coins or highest threat
  const targetId = opponents.slice().sort((a, b) => (s.players[b]?.coins ?? 0) - (s.players[a]?.coins ?? 0))[0]

  // Forced coup at 10+ coins
  if (bot.coins >= 10 && targetId) {
    return { t: 'action', action: 'Coup', targetId }
  }

  // Coup if 7+ coins
  if (bot.coins >= 7 && targetId) {
    return { t: 'action', action: 'Coup', targetId }
  }

  // Assassinate if has 3+ coins (highest lethal priority)
  const hasAssassin = hasRole(bot, 'Assassin')
  if (bot.coins >= 3 && targetId && (hasAssassin || Math.random() < 0.55)) {
    return { t: 'action', action: 'Assassinate', targetId }
  }

  // Tax if has Duke or bluffing (accumulate coins toward Coup)
  const hasDuke = hasRole(bot, 'Duke')
  if (hasDuke || Math.random() < 0.5) {
    return { t: 'action', action: 'Tax' }
  }

  // Steal if has Captain or Ambassador
  const hasCaptain = hasRole(bot, 'Captain')
  const stealTarget = opponents.find(id => (s.players[id]?.coins ?? 0) >= 1)
  if (stealTarget && (hasCaptain || Math.random() < 0.35)) {
    return { t: 'action', action: 'Steal', targetId: stealTarget }
  }

  // Exchange if has Ambassador and weak cards
  const hasAmb = hasRole(bot, 'Ambassador') || hasRole(bot, 'Inquisitor')
  if (hasAmb && Math.random() < 0.5) {
    return { t: 'action', action: 'Exchange' }
  }

  // Embezzle if Reformation and reserve > 0
  if (s.reformation && s.treasuryReserve > 2 && !hasDuke) {
    return { t: 'action', action: 'Embezzle' }
  }

  // Default: Foreign Aid or Income
  return Math.random() < 0.5 ? { t: 'action', action: 'ForeignAid' } : { t: 'action', action: 'Income' }
}

function botDecideChallenge(s: CoupState, botId: Id): boolean {
  const pa = s.pendingAction
  const cs = s.challengeState
  if (!pa || !cs) return false

  const bot = s.players[botId]
  if (!bot || !bot.alive) return false

  const claimed = cs.claimedCharacter
  // Card counting: how many copies visible in bot hand or revealed?
  let visible = 0
  for (const seat of s.seats) {
    const pl = s.players[seat]
    if (!pl) continue
    if (seat === botId) {
      pl.influences.forEach(inf => { if (inf.character === claimed) visible++ })
    } else {
      pl.influences.forEach(inf => { if (inf.revealed && inf.character === claimed) visible++ })
    }
  }

  // If 3 copies visible, challenger definitely bluffed!
  if (visible >= 3) return true
  if (visible === 2) return Math.random() < 0.45

  // Target of Assassination or Steal has higher motivation to challenge
  if (pa.targetId === botId) {
    return Math.random() < 0.18
  }
  return Math.random() < 0.08
}

function botDecideBlock(s: CoupState, botId: Id): Character | null {
  const pa = s.pendingAction
  if (!pa) return null
  const bot = s.players[botId]
  if (!bot || !bot.alive) return null

  if (pa.type === 'Assassinate' && pa.targetId === botId) {
    if (hasRole(bot, 'Contessa')) return 'Contessa'
    // If only 1 card left, bluff Contessa rather than die!
    if (unrevealedIndices(bot).length === 1 && Math.random() < 0.45) return 'Contessa'
    return null
  }

  if (pa.type === 'Steal' && pa.targetId === botId) {
    if (hasRole(bot, 'Captain')) return 'Captain'
    if (s.useInquisitor) {
      if (hasRole(bot, 'Inquisitor')) return 'Inquisitor'
    } else {
      if (hasRole(bot, 'Ambassador')) return 'Ambassador'
    }
    if (Math.random() < 0.25) return 'Captain'
    return null
  }

  if (pa.type === 'Examine' && pa.targetId === botId && s.contessaBlocksExamine) {
    if (hasRole(bot, 'Contessa')) return 'Contessa'
    if (Math.random() < 0.25) return 'Contessa'
    return null
  }

  if (pa.type === 'ForeignAid') {
    if (hasRole(bot, 'Duke')) return 'Duke'
    return null
  }

  return null
}

function botPickInfluenceToLose(p: CoupPlayerState): number {
  const unrevealed = unrevealedIndices(p)
  if (unrevealed.length <= 1) return unrevealed[0] ?? 0

  // Role value ranking: keep Duke/Contessa/Assassin over Ambassador/Captain
  const rank: Record<Character, number> = {
    Duke: 5,
    Contessa: 4.5,
    Assassin: 4,
    Inquisitor: 3.8,
    Captain: 3.5,
    Ambassador: 3,
  }

  const sorted = unrevealed.slice().sort((a, b) => {
    const rA = rank[p.influences[a].character] ?? 0
    const rB = rank[p.influences[b].character] ?? 0
    return rA - rB // lowest rank first to lose
  })
  return sorted[0]
}

function botPickExchangeCards(unrevealedCount: number, pool: Character[]): number[] {
  const rank: Record<Character, number> = {
    Duke: 5,
    Contessa: 4.5,
    Assassin: 4,
    Inquisitor: 3.8,
    Captain: 3.5,
    Ambassador: 3,
  }
  const indexed = pool.map((c, i) => ({ c, i, score: rank[c] ?? 0 }))
  indexed.sort((a, b) => b.score - a.score)
  return indexed.slice(0, unrevealedCount).map(x => x.i)
}

// ─── tick host handler ───────────────────────────────────────────────────────

export function coupTick(state: CoupState, at: number, players: CouncilPlayer[]): CoupState | null {
  if (state.stage === 'over') return null

  // 1. Victory check
  const checked = checkWin(state)
  if (checked.stage === 'over') return checked

  // 2. Handle challenge reveal & swap animation
  if (checked.challengeRevealSwap) {
    if (at >= checked.challengeRevealSwap.endsAt) {
      if (checked.challengeRevealSwap.stage === 'bluff_lost') {
        const stateWithoutSwap = { ...checked, challengeRevealSwap: null }
        if (stateWithoutSwap.pendingBlock) {
          if (stateWithoutSwap.pendingAction) {
            const pa = stateWithoutSwap.pendingAction
            return executeResolvedAction(stateWithoutSwap, pa, players)
          }
        }
        return advanceTurnAfterActionEnded(stateWithoutSwap, players)
      }

      if (checked.challengeRevealSwap.stage === 'reveal') {
        return {
          ...checked,
          challengeRevealSwap: {
            ...checked.challengeRevealSwap,
            stage: 'swap',
            endsAt: at + 1500,
          },
          nextBotAt: at + 2500,
        }
      } else {
        // Swap animation completed: proceed to challenger influence loss
        const crs = checked.challengeRevealSwap
        const challenger = checked.players[crs.challengerId]
        const stateWithoutSwap = { ...checked, challengeRevealSwap: null }
        if (!challenger || !challenger.alive) {
          return advanceTurnAfterActionEnded(stateWithoutSwap, players)
        }
        const unrevealed = unrevealedIndices(challenger)
        if (unrevealed.length === 1) {
          const afterLoss = applyInfluenceLoss(stateWithoutSwap, crs.challengerId, unrevealed[0], 'challenge_lost', players)
          if (afterLoss.stage === 'over') return afterLoss
          if (checked.pendingBlock) {
            let nextState = addLog(afterLoss, 'Block stands successful.', 'block')
            return advanceTurnAfterActionEnded(nextState, players)
          }
          if (checked.pendingAction) {
            return checkAfterActionChallengeDefended(afterLoss, checked.pendingAction, crs.challengerId, players)
          }
          return advanceTurnAfterActionEnded(afterLoss, players)
        }

        return {
          ...stateWithoutSwap,
          stage: 'influence_loss',
          influenceLossRequest: { playerId: crs.challengerId, reason: 'challenge_lost' },
          endsAt: checked.actionTimer > 0 ? at + checked.actionTimer * 1000 : null,
          nextBotAt: at + 1200,
        }
      }
    }
    return null
  }

  const isBotOrAbsent = (id: Id) => {
    const pl = players.find(p => p.id === id)
    return !pl || pl.isBot || !pl.connected
  }

  // 2. Action stage
  if (checked.stage === 'action') {
    const curId = checked.seats[checked.turn]
    const curPlayer = checked.players[curId]
    if (!curPlayer || !curPlayer.alive) {
      return advanceTurnAfterActionEnded(checked, players)
    }

    const timedOut = checked.endsAt && at >= checked.endsAt
    const botReady = isBotOrAbsent(curId) && (!checked.nextBotAt || at >= checked.nextBotAt)

    if (timedOut) {
      // Timeout fallback: only actions that make no character claim
      const opponents = aliveSeats(checked).filter(id => id !== curId && !isFactionRestricted(checked, curId, id))
      const targetId = opponents.slice().sort((a, b) => (checked.players[b]?.coins ?? 0) - (checked.players[a]?.coins ?? 0))[0]

      if (curPlayer.coins >= 10 && targetId) {
        return coupAct(checked, curId, players, { t: 'action', action: 'Coup', targetId })
      }
      if (curPlayer.coins >= 7 && targetId) {
        return coupAct(checked, curId, players, { t: 'action', action: 'Coup', targetId })
      }
      if (opponents.length === 0 && aliveSeats(checked).length > 1 && checked.reformation) {
        return coupAct(checked, curId, players, { t: 'action', action: 'Convert' })
      }
      return coupAct(checked, curId, players, { t: 'action', action: 'Income' })
    }

    if (botReady) {
      const act = botChooseAction(checked, curId)
      if (act && act.t === 'action') {
        const res = coupAct(checked, curId, players, act)
        if (res) return res
      }
      return coupAct(checked, curId, players, { t: 'action', action: 'Income' })
    }
    return null
  }

  // 3. Action Challenge stage
  if (checked.stage === 'action_challenge') {
    if (!checked.challengeState) return null
    const passed = new Set(checked.challengeState.passedPlayerIds)
    const aliveList = aliveSeats(checked)
    const timedOut = checked.endsAt && at >= checked.endsAt

    const eligibleChallengers = aliveList.filter(id => !passed.has(id))
    if (timedOut || eligibleChallengers.length === 0) {
      // Auto-pass everyone
      return handleAllPassedActionChallenge(checked, players)
    }

    // Bot challenge evaluation
    const pendingBots = eligibleChallengers.filter(id => isBotOrAbsent(id))
    if (pendingBots.length > 0 && (!checked.nextBotAt || at >= checked.nextBotAt)) {
      const bId = pendingBots[0]
      const shouldChallenge = botDecideChallenge(checked, bId)
      if (shouldChallenge) {
        return coupAct(checked, bId, players, { t: 'challenge' })
      } else {
        return coupAct(checked, bId, players, { t: 'pass' })
      }
    }
    return null
  }

  // 4. Block stage
  if (checked.stage === 'block') {
    const pa = checked.pendingAction
    if (!pa) return advanceTurnAfterActionEnded(checked, players)
    if (pa.targetId && !checked.players[pa.targetId]?.alive) {
      return advanceTurnAfterActionEnded(checked, players)
    }

    const timedOut = checked.endsAt && at >= checked.endsAt
    const passed = new Set(checked.blockPassedPlayerIds)
    const isTargeted = ['Assassinate', 'Steal', 'Examine'].includes(pa.type)
    const eligible = isTargeted
      ? (pa.targetId && checked.players[pa.targetId]?.alive && !passed.has(pa.targetId) ? [pa.targetId] : [])
      : aliveSeats(checked).filter(id => id !== pa.actorId && !passed.has(id))

    if (timedOut || eligible.length === 0) {
      return executeResolvedAction(checked, pa, players)
    }

    const pendingBots = eligible.filter(id => isBotOrAbsent(id))
    if (pendingBots.length > 0 && (!checked.nextBotAt || at >= checked.nextBotAt)) {
      const bId = pendingBots[0]
      const blockChar = botDecideBlock(checked, bId)
      if (blockChar) {
        return coupAct(checked, bId, players, { t: 'block', character: blockChar })
      } else {
        return coupAct(checked, bId, players, { t: 'pass' })
      }
    }
    return null
  }

  // 5. Block Challenge stage
  if (checked.stage === 'block_challenge') {
    if (!checked.challengeState || !checked.pendingBlock) return null
    const timedOut = checked.endsAt && at >= checked.endsAt
    const passed = new Set(checked.challengeState.passedPlayerIds)
    const aliveList = aliveSeats(checked)
    const eligibleBlockChallengers = aliveList.filter(id => !passed.has(id))

    if (timedOut || eligibleBlockChallengers.length === 0) {
      let nextState = addLog(checked, 'Block stands unchallenged.', 'block')
      return advanceTurnAfterActionEnded(nextState, players)
    }

    const pendingBots = eligibleBlockChallengers.filter(id => isBotOrAbsent(id))
    if (pendingBots.length > 0 && (!checked.nextBotAt || at >= checked.nextBotAt)) {
      const bId = pendingBots[0]
      // 15% challenge block
      if (Math.random() < 0.15) {
        return coupAct(checked, bId, players, { t: 'challenge' })
      } else {
        return coupAct(checked, bId, players, { t: 'pass' })
      }
    }
    return null
  }

  // 6. Influence Loss stage
  if (checked.stage === 'influence_loss') {
    const req = checked.influenceLossRequest
    if (!req) return null
    const target = checked.players[req.playerId]
    if (!target) return null

    const timedOut = checked.endsAt && at >= checked.endsAt
    const botReady = isBotOrAbsent(req.playerId) && (!checked.nextBotAt || at >= checked.nextBotAt)

    if (timedOut || botReady) {
      const cardIdx = botPickInfluenceToLose(target)
      return coupAct(checked, req.playerId, players, { t: 'lose_influence', influenceIndex: cardIdx })
    }
    return null
  }

  // 7. Exchange stage
  if (checked.stage === 'exchange') {
    const ex = checked.exchangeState
    if (!ex) return null
    const p = checked.players[ex.playerId]
    if (!p) return null

    const timedOut = checked.endsAt && at >= checked.endsAt
    const botReady = isBotOrAbsent(ex.playerId) && (!checked.nextBotAt || at >= checked.nextBotAt)

    if (timedOut || botReady) {
      const unrevealed = unrevealedIndices(p)
      const allPool = [...unrevealed.map(i => p.influences[i].character), ...ex.drawnCards]
      const keeps = botPickExchangeCards(unrevealed.length, allPool)
      return coupAct(checked, ex.playerId, players, { t: 'exchange', keepIndices: keeps })
    }
    return null
  }

  // 8. Examine stages
  if (checked.stage === 'examine_selection') {
    const sel = checked.examineSelectionState
    if (!sel) return null
    const timedOut = checked.endsAt && at >= checked.endsAt
    const botReady = isBotOrAbsent(sel.targetId) && (!checked.nextBotAt || at >= checked.nextBotAt)

    if (timedOut || botReady) {
      const target = checked.players[sel.targetId]
      const unrevealed = target ? unrevealedIndices(target) : [0]
      return coupAct(checked, sel.targetId, players, { t: 'examine_select', cardIndex: unrevealed[0] })
    }
    return null
  }

  if (checked.stage === 'examine_decision') {
    const dec = checked.examineState
    if (!dec) return null
    const timedOut = checked.endsAt && at >= checked.endsAt
    const botReady = isBotOrAbsent(dec.examinerId) && (!checked.nextBotAt || at >= checked.nextBotAt)

    if (timedOut || botReady) {
      const forceSwap = ['Duke', 'Assassin', 'Contessa'].includes(dec.character)
      return coupAct(checked, dec.examinerId, players, { t: 'examine_decision', forceSwap })
    }
    return null
  }

  return null
}

// ─── skip handler ────────────────────────────────────────────────────────────

export function coupSkip(state: CoupState, players: CouncilPlayer[]): CoupState | null {
  if (state.stage === 'over') return null

  switch (state.stage) {
    case 'action': {
      const curId = state.seats[state.turn]
      const p = state.players[curId]
      if (p && p.coins >= 10) {
        const opponents = aliveSeats(state).filter(id => id !== curId)
        return coupAct(state, curId, players, { t: 'action', action: 'Coup', targetId: opponents[0] })
      }
      return coupAct(state, curId, players, { t: 'action', action: 'Income' })
    }

    case 'action_challenge':
      return handleAllPassedActionChallenge(state, players)

    case 'block': {
      const pa = state.pendingAction
      if (pa) return executeResolvedAction(state, pa, players)
      return advanceTurnAfterActionEnded(state, players)
    }

    case 'block_challenge': {
      let nextState = addLog(state, 'Block skipped and accepted.', 'block')
      return advanceTurnAfterActionEnded(nextState, players)
    }

    case 'influence_loss': {
      const req = state.influenceLossRequest
      if (req) {
        const p = state.players[req.playerId]
        if (p) {
          const unrevealed = unrevealedIndices(p)
          return coupAct(state, req.playerId, players, { t: 'lose_influence', influenceIndex: unrevealed[0] })
        }
      }
      return advanceTurnAfterActionEnded(state, players)
    }

    case 'exchange': {
      const ex = state.exchangeState
      if (ex) {
        const p = state.players[ex.playerId]
        if (p) {
          const unrevealed = unrevealedIndices(p)
          const keeps = unrevealed.map((_, i) => i) // Keep first original cards
          return coupAct(state, ex.playerId, players, { t: 'exchange', keepIndices: keeps })
        }
      }
      return advanceTurnAfterActionEnded(state, players)
    }

    case 'examine_selection': {
      const sel = state.examineSelectionState
      if (sel) {
        const target = state.players[sel.targetId]
        if (target) {
          const unrevealed = unrevealedIndices(target)
          return coupAct(state, sel.targetId, players, { t: 'examine_select', cardIndex: unrevealed[0] })
        }
      }
      return advanceTurnAfterActionEnded(state, players)
    }

    case 'examine_decision': {
      const dec = state.examineState
      if (dec) {
        return coupAct(state, dec.examinerId, players, { t: 'examine_decision', forceSwap: false })
      }
      return advanceTurnAfterActionEnded(state, players)
    }

    default:
      return advanceTurnAfterActionEnded(state, players)
  }
}

// ─── player removed ──────────────────────────────────────────────────────────

export function coupPlayerRemoved(state: CoupState, id: Id, players: CouncilPlayer[]): CoupState | null {
  if (state.stage === 'over') return null
  const p = state.players[id]
  if (!p) return null

  // Mark eliminated and reveal all cards
  const updatedInfluences = p.influences.map(inf => ({ ...inf, revealed: true }))
  const nextPlayers = {
    ...state.players,
    [id]: { ...p, influences: updatedInfluences, alive: false },
  }

  let nextState: CoupState = {
    ...state,
    players: nextPlayers,
  }

  const name = playerName(players, id)
  nextState = addLog(nextState, `${name} has withdrawn from the court.`, 'eliminate')

  // Check if game over
  const checked = checkWin(nextState)
  if (checked.stage === 'over') return checked

  // If active turn player left, advance turn
  const curId = nextState.seats[nextState.turn]
  if (curId === id) {
    return advanceTurnAfterActionEnded(nextState, players)
  }

  // If player in influence loss left, advance turn
  if (nextState.influenceLossRequest?.playerId === id) {
    nextState.influenceLossRequest = null
    return advanceTurnAfterActionEnded(nextState, players)
  }

  // If in exchange and left
  if (nextState.exchangeState?.playerId === id) {
    nextState.exchangeState = null
    return advanceTurnAfterActionEnded(nextState, players)
  }

  return nextState
}
