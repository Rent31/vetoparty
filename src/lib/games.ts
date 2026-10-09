// ─── VETO PARTY · game rules engines (pure functions, host-authoritative) ───

import {
  BarricadeLayout, BarricadeSettings, ChameleonSettings, CoupSettings, CouncilPlayer, GameId, Id,
  ImposterSettings, QuoridorSettings, SettingsMap, SpyfallSettings, WavelengthSettings,
  clamp, isSustainedOffline, pickOne, shuffle,
} from './core'
import {
  ActionType, ChallengeRevealSwap, Character, CoupAction, CoupCard, CoupLogItem,
  CoupPlayerState, CoupStage, CoupState, Faction, coupAct, coupInit,
  coupPlayerRemoved, coupSkip, coupTick,
} from './coup'
import {
  WavelengthAction, WavelengthRoundScore, WavelengthStage, WavelengthState,
  wAct, wInit, wPlayerRemoved, wSkip, wTick,
} from './wavelength'

export {
  type ActionType, type ChallengeRevealSwap, type Character, type CoupAction, type CoupCard, type CoupLogItem,
  type CoupPlayerState, type CoupStage, type CoupState, type Faction, coupAct, coupInit,
  coupPlayerRemoved, coupSkip, coupTick, isFactionRestricted,
} from './coup'

export {
  type WavelengthAction, type WavelengthRoundScore, type WavelengthStage, type WavelengthState,
  parseSpectrumCards, WAVELENGTH_DEFAULT_CARDS, WAVELENGTH_PRESETS,
} from './wavelength'

export const now = () => Date.now()

// ─────────────────────────────────────────────────────────────────────────────
// WORD BANKS
// ─────────────────────────────────────────────────────────────────────────────

export const SPYFALL_LOCATIONS = [
  'Airplane', 'Bank', 'Beach', 'Casino', 'Circus', 'Hospital', 'Hotel',
  'Military Base', 'Movie Studio', 'Ocean Liner', 'Passenger Train',
  'Pirate Ship', 'Polar Station', 'Police Station', 'Restaurant',
  'School', 'Service Station', 'Space Station', 'Submarine', 'Supermarket',
  'Theater', 'University', 'Amusement Park', 'Art Museum', 'Candy Factory',
  'Cathedral', 'Construction Site', 'Farm', 'Jail', 'Library',
  'Nightclub', 'Race Track', 'Retirement Home', 'Ski Resort', 'Zoo',
  'Embassy', 'Bowling Alley', 'Campground', 'Harbor', 'Vineyard',
]

export const CHAMELEON_WORDS = [
  'Anchor','Antenna','Apron','Attic','Axe','Bacon','Badge','Balloon','Bamboo','Banjo',
  'Barrel','Beacon','Bellows','Bench','Biscuit','Blender','Bonfire','Boulder','Bowtie','Bridle',
  'Bucket','Butter','Cabinet','Cactus','Candle','Canoe','Carpet','Castle','Cauldron','Cello',
  'Chainsaw','Chalk','Chimney','Claw','Cloak','Coconut','Compass','Cork','Crane','Crown',
  'Dagger','Dentist','Dew','Domino','Doorbell','Dragon','Drum','Dune','Easel','Ember',
  'Engine','Falcon','Ferry','Fiddle','Flame','Flask','Flute','Fog','Furnace','Galleon',
  'Gargoyle','Garland','Gazebo','Glacier','Goblet','Gong','Granite','Gravy','Guitar','Hammer',
  'Hammock','Harp','Heater','Helmet','Honey','Hourglass','Hut','Icicle','Iron','Ivory',
  'Jewel','Jigsaw','Kettle','Lantern','Lasso','Locket','Lumber','Magnet','Mango','Marble',
  'Meadow','Mirror','Mitten','Molasses','Monocle','Mosaic','Muffin','Needle','Notebook','Oar',
  'Onion','Orchard','Oven','Owl','Paddle','Pantry','Parachute','Peacock','Pepper','Piano',
  'Pillow','Piston','Plank','Plow','Pocket','Pony','Potion','Puzzle','Quill','Raccoon',
  'Radar','Raft','Rake','Ribbon','Rivet','Salmon','Saddle','Satchel','Scaffold','Scythe',
  'Seashell','Sheriff','Shovel','Silo','Skillet','Slippers','Spigot','Spinach','Steeple','Stool',
  'Stove','Sundial','Tambourine','Teapot','Thimble','Throne','Toboggan','Tornado','Trident','Trumpet',
  'Turnip','Umbrella','Vault','Violin','Wagon','Waltz','Wedge','Whistle','Windmill','Zeppelin',
]

export const IMPOSTER_WORDS = CHAMELEON_WORDS

export function parseList(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(';')) {
    const t = part.trim().replace(/\s+/g, ' ')
    const key = t.toLowerCase()
    if (t && !seen.has(key)) { seen.add(key); out.push(t) }
  }
  return out
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// ─────────────────────────────────────────────────────────────────────────────
// 1 & 2 · SPYFALL / CHAMELEON  (shared "party deduction" engine)
// ─────────────────────────────────────────────────────────────────────────────

export type PartyKind = 'spyfall' | 'chameleon' | 'imposter'
export type PartyStage = 'play' | 'vote' | 'accuse' | 'verdict' | 'over'

export interface PartyState {
  kind: PartyKind
  stage: PartyStage
  endsAt: number | null
  subject: string
  pack: string[]
  bad: Id[]
  first: Id
  /** Suggested speaking rotation; order[0] is always `first`. */
  order: Id[]
  electorate: Id[]
  votes: Record<Id, Id>
  accused: Id | null
  guess: string | null
  freeGuess: boolean
  verdicts: Record<Id, boolean>
  winner: 'council' | 'rogue' | null
}

type PartyAction =
  | { t: 'vote'; target: Id | null }
  | { t: 'accuse'; guess: string }
  | { t: 'verdict'; accept: boolean }

const activeIds = (players: CouncilPlayer[]) =>
  players.filter(p => p.connected || p.isBot).map(p => p.id)

function partyInit(kind: PartyKind, players: CouncilPlayer[], settings: SpyfallSettings | ChameleonSettings): PartyState {
  const custom = settings.useCustom ? parseList(settings.custom) : []
  const isSpy = kind === 'spyfall'
  const bank =
    isSpy
      ? (custom.length >= 3 ? custom : SPYFALL_LOCATIONS)
      : (custom.length >= 2 ? custom : CHAMELEON_WORDS)
  const ids = players.map(p => p.id)
  const badCount = clamp(
    isSpy ? (settings as SpyfallSettings).spies : ((settings as ChameleonSettings).chameleons ?? (settings as ImposterSettings).imposters ?? 1),
    1, Math.max(1, ids.length - 2),
  )
  const showWords = !isSpy && ((settings as ChameleonSettings).showWords) && custom.length >= 2
  // One shuffle drives both the rotation and who opens - they must agree.
  const speakingOrder = shuffle(ids)
  return {
    kind,
    stage: 'play',
    endsAt: settings.seconds > 0 ? now() + settings.seconds * 1000 : null,
    subject: pickOne(bank),
    pack: isSpy ? bank.slice().sort() : showWords ? bank.slice().sort() : [],
    bad: shuffle(ids).slice(0, badCount),
    first: speakingOrder[0],
    order: speakingOrder,
    electorate: ids,
    votes: {},
    accused: null,
    guess: null,
    freeGuess: !isSpy && !showWords,
    verdicts: {},
    winner: null,
  }
}

export interface PartyTally {
  eligible: Id[]
  counts: Record<Id, number>
  allIn: boolean
  top: Id[]
  tie: boolean
}

export function partyTally(s: PartyState, players: CouncilPlayer[]): PartyTally {
  const eligible = s.electorate.filter(id => {
    const p = players.find(x => x.id === id)
    return p ? p.connected || p.isBot : false
  })
  const counts: Record<Id, number> = {}
  let max = 0
  for (const v of eligible) {
    const target = s.votes[v]
    if (target && s.electorate.includes(target)) {
      counts[target] = (counts[target] ?? 0) + 1
      max = Math.max(max, counts[target])
    }
  }
  const allIn = eligible.length > 0 && eligible.every(v => s.votes[v])
  const top = Object.keys(counts).filter(id => counts[id] === max && max > 0)
  return { eligible, counts, allIn, top, tie: allIn && top.length > 1 }
}

function resolveVote(s: PartyState, players: CouncilPlayer[], accused: Id): PartyState {
  if (s.bad.includes(accused)) {
    return { ...s, stage: 'accuse', accused }
  }
  return { ...s, stage: 'over', accused, winner: 'rogue' }
}

function maybeResolveVote(s: PartyState, players: CouncilPlayer[]): PartyState {
  const t = partyTally(s, players)
  const votedCount = t.eligible.filter(id => !!s.votes[id]).length
  const remaining = t.eligible.length - votedCount

  // Sort candidate vote counts descending
  const sorted = Object.entries(t.counts).sort((a, b) => b[1] - a[1])
  if (sorted.length > 0) {
    const [topCandidate, topCount] = sorted[0]
    const secondCount = sorted.length > 1 ? sorted[1][1] : 0
    // If the top candidate cannot be tied or beaten even if all remaining voters vote for the runner-up
    if (topCount > secondCount + remaining) {
      return resolveVote(s, players, topCandidate)
    }
  }

  if (t.allIn && t.top.length === 1) return resolveVote(s, players, t.top[0])
  return s
}

export function verdictStatus(s: PartyState, players: CouncilPlayer[]) {
  const voters = s.electorate.filter(id => {
    if (s.bad.includes(id)) return false
    const p = players.find(x => x.id === id)
    return p ? p.connected || p.isBot : false
  })
  let yea = 0, nay = 0
  for (const v of voters) if (s.verdicts[v] !== undefined) s.verdicts[v] ? yea++ : nay++
  const allIn = voters.length > 0 && voters.every(v => s.verdicts[v] !== undefined)
  return { voters, yea, nay, allIn, tie: allIn && yea === nay }
}

function partyAct(s: PartyState, actor: Id, players: CouncilPlayer[], a: PartyAction): PartyState | null {
  if (a.t === 'vote' && s.stage === 'vote') {
    if (!s.electorate.includes(actor)) return null
    const votes = { ...s.votes }
    if (a.target === null) {
      if (votes[actor] === undefined) return null
      delete votes[actor]
    } else {
      if (!s.electorate.includes(a.target) || actor === a.target) return null
      if (votes[actor] === a.target) return null // idempotent - replay-safe
      votes[actor] = a.target
    }
    return maybeResolveVote({ ...s, votes }, players)
  }
  if (a.t === 'accuse' && s.stage === 'accuse' && actor === s.accused && typeof a.guess === 'string' && a.guess.trim()) {
    if (s.freeGuess) {
      return { ...s, stage: 'verdict', guess: a.guess.trim(), verdicts: {} }
    }
    // must match the ACTUAL subject - not merely be a member of the list
    const win = norm(a.guess) === norm(s.subject)
    return { ...s, stage: 'over', guess: a.guess.trim(), winner: win ? 'rogue' : 'council' }
  }
  if (a.t === 'verdict' && s.stage === 'verdict') {
    if (!s.electorate.includes(actor) || s.bad.includes(actor)) return null
    const next = { ...s, verdicts: { ...s.verdicts, [actor]: a.accept } }
    const v = verdictStatus(next, players)
    const remaining = v.voters.length - (v.yea + v.nay)
    if (v.yea > v.nay + remaining) {
      return { ...next, stage: 'over', winner: 'rogue' }
    }
    if (v.nay > v.yea + remaining) {
      return { ...next, stage: 'over', winner: 'council' }
    }
    if (v.allIn && !v.tie) return { ...next, stage: 'over', winner: v.yea > v.nay ? 'rogue' : 'council' }
    return next
  }
  return null
}

function partyTick(s: PartyState, at: number): PartyState | null {
  if (s.stage === 'play' && s.endsAt && at >= s.endsAt) return { ...s, stage: 'vote', endsAt: null }
  return null
}

function partySkip(s: PartyState, players: CouncilPlayer[]): PartyState | null {
  switch (s.stage) {
    case 'play': return { ...s, stage: 'vote', endsAt: null }
    case 'vote': {
      const t = partyTally(s, players)
      const accused = t.top.length ? pickOne(t.top) : pickOne(t.eligible.length ? t.eligible : s.electorate)
      return resolveVote(s, players, accused)
    }
    case 'accuse': return { ...s, stage: 'over', winner: 'council' }
    case 'verdict': return { ...s, stage: 'over', winner: 'council' }
    default: return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · QUORIDOR
// ─────────────────────────────────────────────────────────────────────────────

export interface QFence { r: number; c: number; o: 'h' | 'v'; by?: number }
export interface QState {
  stage: 'play' | 'over'
  participants: Id[]
  pawns: { r: number; c: number }[]
  goals: { t: 'r' | 'c'; v: number }[]
  fences: QFence[]
  fencesLeft: number[]
  turn: number
  endsAt: number | null
  winner: number | null
  timer: boolean
  seconds: number
}

type QAction = { t: 'move'; to: [number, number] } | { t: 'fence'; f: QFence }

const Q_SEATS = [
  { r: 8, c: 4, goal: { t: 'r', v: 0 } as const },
  { r: 0, c: 4, goal: { t: 'r', v: 8 } as const },
  { r: 4, c: 8, goal: { t: 'c', v: 0 } as const },
  { r: 4, c: 0, goal: { t: 'c', v: 8 } as const },
]
const Q_FENCES: Record<number, number> = { 2: 10, 3: 6, 4: 5 }

function qBlocked(s: Pick<QState, 'fences'>, r: number, c: number, dr: number, dc: number): boolean {
  for (const f of s.fences) {
    if (f.o === 'h') {
      if (dr === 1 && f.r === r && (f.c === c || f.c === c - 1)) return true
      if (dr === -1 && f.r === r - 1 && (f.c === c || f.c === c - 1)) return true
    } else {
      if (dc === 1 && f.c === c && (f.r === r || f.r === r - 1)) return true
      if (dc === -1 && f.c === c - 1 && (f.r === r || f.r === r - 1)) return true
    }
  }
  return false
}

const qInside = (r: number, c: number) => r >= 0 && r < 9 && c >= 0 && c < 9

export function qMoves(s: QState, i: number): [number, number][] {
  const { r, c } = s.pawns[i]
  const occ = new Set(s.pawns.map(p => `${p.r},${p.c}`))
  const out: [number, number][] = []
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  for (const [dr, dc] of dirs) {
    if (qBlocked(s, r, c, dr, dc)) continue
    const r1 = r + dr, c1 = c + dc
    if (!qInside(r1, c1)) continue
    if (!occ.has(`${r1},${c1}`)) { out.push([r1, c1]); continue }
    // pawn ahead - try the straight jump
    if (!qBlocked(s, r1, c1, dr, dc)) {
      const r2 = r1 + dr, c2 = c1 + dc
      if (qInside(r2, c2) && !occ.has(`${r2},${c2}`)) { out.push([r2, c2]); continue }
    }
    // diagonal escapes around the blocking pawn
    for (const [er, ec] of dr !== 0 ? [[0, 1], [0, -1]] as [number, number][] : [[1, 0], [-1, 0]] as [number, number][]) {
      if (qBlocked(s, r1, c1, er, ec)) continue
      const r2 = r1 + er, c2 = c1 + ec
      if (qInside(r2, c2) && !occ.has(`${r2},${c2}`)) out.push([r2, c2])
    }
  }
  return out
}

function qHasPath(s: Pick<QState, 'fences'>, from: { r: number; c: number }, goal: { t: 'r' | 'c'; v: number }): boolean {
  const seen = new Set<string>([`${from.r},${from.c}`])
  const q = [from]
  while (q.length) {
    const cur = q.pop()!
    if (goal.t === 'r' ? cur.r === goal.v : cur.c === goal.v) return true
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
      const nr = cur.r + dr, nc = cur.c + dc
      if (!qInside(nr, nc) || seen.has(`${nr},${nc}`) || qBlocked(s, cur.r, cur.c, dr, dc)) continue
      seen.add(`${nr},${nc}`)
      q.push({ r: nr, c: nc })
    }
  }
  return false
}

export function qFenceValid(s: QState, i: number, f: QFence): boolean {
  if (s.fencesLeft[i] <= 0) return false
  if (f.r < 0 || f.r > 7 || f.c < 0 || f.c > 7) return false
  for (const x of s.fences) {
    if (x.o === f.o && x.r === f.r && x.c === f.c) return false
    if (f.o === 'h' && x.o === 'h' && x.r === f.r && Math.abs(x.c - f.c) === 1) return false
    if (f.o === 'v' && x.o === 'v' && x.c === f.c && Math.abs(x.r - f.r) === 1) return false
    if (x.o !== f.o && x.r === f.r && x.c === f.c) return false
  }
  const test = { fences: [...s.fences, f] }
  return s.pawns.every((p, idx) => qHasPath(test, p, s.goals[idx]))
}

/**
 * Can this seat do anything at all? Pawns can be boxed in by a combination of
 * walls and other pawns, and if that player also has no walls left they can
 * never act. Rare (about 1 game in 4500 under random play) but a permanent
 * deadlock when it happens, so the turn must pass automatically.
 */
export function qHasAction(s: QState, i: number): boolean {
  if (qMoves(s, i).length) return true
  if (s.fencesLeft[i] <= 0) return false
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (qFenceValid(s, i, { r, c, o: 'h' })) return true
      if (qFenceValid(s, i, { r, c, o: 'v' })) return true
    }
  }
  return false
}

function qInit(players: CouncilPlayer[], settings: QuoridorSettings): QState {
  const n = Math.min(players.length, 4)
  const order = shuffle(players.slice(0, n).map(p => p.id))
  const defaultWalls = Q_FENCES[n] ?? 5
  const wallsCount = settings.useCustomWalls && typeof settings.customWalls === 'number'
    ? clamp(settings.customWalls, 0, 30)
    : defaultWalls
  return {
    stage: 'play',
    participants: order,
    pawns: order.map((_, i) => ({ r: Q_SEATS[i].r, c: Q_SEATS[i].c })),
    goals: order.map((_, i) => ({ ...Q_SEATS[i].goal })),
    fences: [],
    fencesLeft: order.map(() => wallsCount),
    turn: Math.floor(Math.random() * n),
    endsAt: settings.timer ? now() + settings.seconds * 1000 : null,
    winner: null,
    timer: settings.timer,
    seconds: settings.seconds,
  }
}

function qAdvance(s: QState): QState {
  return {
    ...s,
    turn: (s.turn + 1) % s.participants.length,
    endsAt: s.timer ? now() + s.seconds * 1000 : null,
  }
}

function qAct(s: QState, actor: Id, _players: CouncilPlayer[], a: QAction): QState | null {
  if (s.stage !== 'play') return null
  const i = s.turn
  if (s.participants[i] !== actor) return null
  if (a.t === 'move') {
    if (!Array.isArray(a.to) || a.to.length !== 2) return null
    if (!a.to.every(n => Number.isInteger(n))) return null
    const ok = qMoves(s, i).some(([r, c]) => r === a.to[0] && c === a.to[1])
    if (!ok) return null
    const pawns = s.pawns.map((p, idx) => (idx === i ? { r: a.to[0], c: a.to[1] } : p))
    const g = s.goals[i]
    const won = g.t === 'r' ? a.to[0] === g.v : a.to[1] === g.v
    if (won) return { ...s, pawns, stage: 'over', winner: i, endsAt: null }
    return qAdvance({ ...s, pawns })
  }
  if (a.t === 'fence') {
    const raw = a.f
    if (!raw || (raw.o !== 'h' && raw.o !== 'v')) return null
    if (!Number.isInteger(raw.r) || !Number.isInteger(raw.c)) return null
    const f: QFence = { r: raw.r, c: raw.c, o: raw.o }
    if (!qFenceValid(s, i, f)) return null
    const fencesLeft = s.fencesLeft.map((n, idx) => (idx === i ? n - 1 : n))
    return qAdvance({ ...s, fences: [...s.fences, { ...f, by: i }], fencesLeft })
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · BARRICADE  (Malefiz) - board parser + rules
// ─────────────────────────────────────────────────────────────────────────────

const MAP_TEMPLATES: Record<BarricadeLayout, string> = {
  duel2: `
        F
        -
O-O-O-O-S-O-O-O-O
-               -
O               O
-               -
O-O-O-O-S-O-O-O-O
        -
D       S
        -
    S-O-S-Z-S
    -       -
    O       O
    -       -
S-O-O-O-S-O-O-O-S
-       -       -
O       O       O
-       -       -
X-X-X-X-X-X-X-X-X
    -       -
    1   P   2
`,
  trio3: `
            F
            -
O-O-O-O-O-O-S-O-O-O-O-O-O
-                       -
O                       O
-                       -
O-O-O-O-O-O-S-O-O-O-O-O-O
            -
D           S
            -
        O-O-S-O-O   P
        -       -
        O       O
        -       -
    O-O-S-O-Z-O-S-O-O
    -               -
    O               O
    -               -
S-O-O-O-S-O-O-O-S-O-O-O-S
-       -       -       -
X       X       X       X
-       -       -       -
X-X-X-X-X-X-X-X-X-X-X-X-X
    -       -       -
    1       2       3
`,
  classic4: `
                F
                -
O-O-O-O-O-O-O-O-S-O-O-O-O-O-O-O-O
-                               -
O                               O
-                               -
O-O-O-O-O-O-O-O-S-O-O-O-O-O-O-O-O
                -
D               S
                -
            O-O-S-O-O
            -       -
            O       O
            -       -
        O-O-S-O-O-O-S-O-O
        -               -
        O               O
        -               -
    O-O-O-O-O-O-Z-O-O-O-O-O-O
    -       -       -       -
    O       O       O       O
    -       -       -       -
S-O-O-O-S-O-O-O-S-O-O-O-S-O-O-O-S
-       -       -       -       -
X       X       X       X       X
-       -       -       -       -
X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X
    -       -       -       -
    1       2   P   3       4
`,
}

export interface BCircle {
  id: number
  x: number
  y: number
  start: number | null   // seat index (0-based) whose home this is
  finish: boolean
  safe: boolean
  /** Bottom entry row only: barricades may never be placed here. */
  noBarricade: boolean
  stone0: boolean        // has a barricade at game start
}
export interface BMap {
  circles: BCircle[]
  neighbors: number[][]
  edges: [number, number][]
  w: number
  h: number
  seats: number
}

const mapCache = new Map<BarricadeLayout, BMap>()

export function getBMap(layout: BarricadeLayout): BMap {
  const hit = mapCache.get(layout)
  if (hit) return hit

  const lines = MAP_TEMPLATES[layout].split('\n').map(l => l.replace(/\s+$/, ''))
  const isCircle = (ch: string) => 'OFZSX123456'.includes(ch)
  interface Pt { x: number; y: number; ch: string }
  const pts: Pt[] = []
  const links: Pt[] = []
  lines.forEach((line, y) => {
    for (let x = 0; x < line.length; x++) {
      const ch = line[x]
      if (ch === ' ') continue
      if (isCircle(ch)) pts.push({ x, y, ch })
      else if (ch === '-' || ch === '|' || ch === '/') links.push({ x, y, ch })
    }
  })
  const at = (x: number, y: number) => pts.find(p => p.x === x && p.y === y)

  const idOf = new Map<Pt, number>()
  pts.forEach((p, i) => idOf.set(p, i))
  const neighbors: number[][] = pts.map(() => [])
  const edges: [number, number][] = []
  for (const l of links) {
    const found: Pt[] = []
    const push = (p: Pt | undefined) => { if (p && !found.includes(p)) found.push(p) }
    push(at(l.x - 1, l.y)); push(at(l.x + 1, l.y))
    push(at(l.x, l.y - 1)); push(at(l.x, l.y + 1))
    if (l.ch === '/') { push(at(l.x - 1, l.y + 1)); push(at(l.x + 1, l.y - 1)) }
    if (l.ch === '|') { push(at(l.x - 1, l.y - 1)); push(at(l.x + 1, l.y + 1)) }
    if (found.length === 2) {
      const [a, b] = [idOf.get(found[0])!, idOf.get(found[1])!]
      neighbors[a].push(b); neighbors[b].push(a)
      edges.push([a, b])
    }
  }
  const circles: BCircle[] = pts.map((p, i) => ({
    id: i,
    x: p.x / 2,
    y: p.y / 2,
    start: /^[1-6]$/.test(p.ch) ? parseInt(p.ch, 10) - 1 : null,
    finish: p.ch === 'F',
    safe: p.ch === 'X',
    noBarricade: false,
    stone0: p.ch === 'S',
  }))

  // In Malefiz only the row pieces enter on is barred to barricades. Some maps
  // draw two rows of X, so mark just the bottom-most one.
  const safeRows = circles.filter(c => c.safe).map(c => c.y)
  if (safeRows.length) {
    const entryRow = Math.max(...safeRows)
    for (const c of circles) c.noBarricade = c.safe && c.y === entryRow
  }
  const w = Math.max(...circles.map(c => c.x)) + 1
  const h = Math.max(...circles.map(c => c.y)) + 1
  const seats = circles.filter(c => c.start !== null).length
  const map: BMap = { circles, neighbors, edges, w, h, seats }
  mapCache.set(layout, map)
  return map
}

export interface BPiece { seat: number; circle: number }
export interface BState {
  stage: 'play' | 'over'
  layout: BarricadeLayout
  participants: Id[]            // index = seat
  pieces: BPiece[]
  stones: (number | null)[]     // stoneId -> circle | null (being carried)
  turn: number                  // seat index
  dieRoll: number | null
  lastRoll: number | null
  phase: 'roll' | 'move' | 'place'
  carrying: number | null       // stoneId awaiting placement
  winner: number | null
}

type BAction =
  | { t: 'roll' }
  | { t: 'move'; pawn: number; to: number }
  | { t: 'place'; to: number }

const bStoneAt = (s: BState, circle: number) => s.stones.findIndex(c => c === circle)
const bPieceAt = (s: BState, circle: number) => s.pieces.findIndex(p => p.circle === circle)
const bStartCircle = (map: BMap, seat: number) => map.circles.find(c => c.start === seat)!.id

export function bMovesFor(map: BMap, s: BState, pawnIdx: number): number[] {
  const die = s.dieRoll
  if (!die) return []
  const me = s.pieces[pawnIdx]
  if (!me) return []
  const results = new Set<number>()
  const walk = (circle: number, left: number, visited: number[]) => {
    if (left === 0) { results.add(circle); return }
    for (const nb of map.neighbors[circle]) {
      if (visited.includes(nb)) continue
      if (bStoneAt(s, nb) !== -1 && left !== 1) continue
      // No safe-zone immunity: a pawn may be taken anywhere on the board.
      walk(nb, left - 1, [...visited, circle])
    }
  }
  walk(me.circle, die, [me.circle])
  return [...results].filter(c => {
    const def = map.circles[c]
    if (def.start !== null) return false
    // Check EVERY piece on the square, not just the first one found: a circle
    // can transiently hold more than one piece in a legacy/recovered state.
    if (s.pieces.some((p, i) => i !== pawnIdx && p.circle === c && p.seat === me.seat)) return false
    return true
  })
}

export function bAnyMoves(map: BMap, s: BState, seat: number): boolean {
  return s.pieces.some((p, i) => p.seat === seat && bMovesFor(map, s, i).length > 0)
}

export function bPlacement(map: BMap, s: BState): number[] {
  return map.circles
    .filter(c =>
      c.start === null && !c.finish && !c.noBarricade &&
      bStoneAt(s, c.id) === -1 && bPieceAt(s, c.id) === -1,
    )
    .map(c => c.id)
}

function bInit(players: CouncilPlayer[], settings: BarricadeSettings): BState {
  const map = getBMap(settings.layout)
  // Seat as many players as we have; any remaining home slots stay empty so a
  // small group can still play a larger board.
  const seated = players.slice(0, map.seats)
  const pieces: BPiece[] = []
  for (let seat = 0; seat < seated.length; seat++) {
    const home = bStartCircle(map, seat)
    for (let k = 0; k < settings.pawns; k++) pieces.push({ seat, circle: home })
  }
  return {
    stage: 'play',
    layout: settings.layout,
    participants: seated.map(p => p.id),
    pieces,
    stones: map.circles.filter(c => c.stone0).map(c => c.id),
    turn: Math.floor(Math.random() * Math.max(1, seated.length)),
    dieRoll: null,
    lastRoll: null,
    phase: 'roll',
    carrying: null,
    winner: null,
  }
}

function bEndTurn(s: BState): BState {
  const same = s.lastRoll === 6
  return {
    ...s,
    dieRoll: null,
    phase: 'roll',
    carrying: null,
    turn: same ? s.turn : (s.turn + 1) % s.participants.length,
  }
}

function bAct(s: BState, actor: Id, _players: CouncilPlayer[], a: BAction): BState | null {
  if (s.stage !== 'play') return null
  const map = getBMap(s.layout)
  const seat = s.turn
  if (s.participants[seat] !== actor) return null

  if (a.t === 'roll' && s.phase === 'roll') {
    const dieRoll = 1 + Math.floor(Math.random() * 6)
    const next: BState = { ...s, dieRoll, lastRoll: dieRoll }
    if (!bAnyMoves(map, next, seat)) {
      // no legal move - forfeit the turn entirely
      return { ...next, dieRoll: null, phase: 'roll', turn: (seat + 1) % s.participants.length }
    }
    return { ...next, phase: 'move' }
  }

  if (a.t === 'move' && s.phase === 'move') {
    const pawn = s.pieces[a.pawn]
    if (!pawn || pawn.seat !== seat) return null
    if (!a.to && a.to !== 0) return null
    if (!bMovesFor(map, s, a.pawn).includes(a.to)) return null
    const dest = map.circles[a.to]
    const stoneIdx = bStoneAt(s, a.to)

    // Identify victims BEFORE the mover occupies the square, and skip the
    // mover's own index. Searching afterwards could match our own pawn first
    // (whichever has the lower array index), silently cancelling the capture
    // and leaving both pieces stacked on one circle.
    const victims = s.pieces.reduce<number[]>((acc, p, i) => {
      if (i !== a.pawn && p.circle === a.to && p.seat !== seat) acc.push(i)
      return acc
    }, [])

    const finalPieces = s.pieces.map((p, i) => {
      if (i === a.pawn) return { ...p, circle: a.to }
      // send every captured enemy home (normally one, but stay defensive so a
      // legacy/corrupted stack is cleaned up rather than preserved)
      if (victims.includes(i)) return { ...p, circle: bStartCircle(map, p.seat) }
      return p
    })

    if (dest.finish) {
      return { ...s, pieces: finalPieces, stage: 'over', winner: seat, phase: 'roll', dieRoll: null }
    }
    if (stoneIdx !== -1) {
      const stones = s.stones.map((c, i) => (i === stoneIdx ? null : c))
      return { ...s, pieces: finalPieces, stones, carrying: stoneIdx, phase: 'place', dieRoll: null }
    }
    return bEndTurn({ ...s, pieces: finalPieces })
  }

  if (a.t === 'place' && s.phase === 'place' && s.carrying !== null) {
    if (!bPlacement(map, s).includes(a.to)) return null
    const stones = s.stones.map((c, i) => (i === s.carrying ? a.to : c))
    return bEndTurn({ ...s, stones })
  }

  return null
}

function bForceAdvance(s: BState): BState {
  const map = getBMap(s.layout)
  let next = s
  if (s.phase === 'place' && s.carrying !== null) {
    const cells = bPlacement(map, s)
    if (cells.length) {
      next = { ...s, stones: s.stones.map((c, i) => (i === s.carrying ? pickOne(cells) : c)) }
    }
  }
  return {
    ...next,
    dieRoll: null,
    phase: 'roll',
    carrying: null,
    turn: (next.turn + 1) % next.participants.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY - uniform interface used by the council engine
// ─────────────────────────────────────────────────────────────────────────────

export interface AnyModule {
  id: GameId
  init(players: CouncilPlayer[], settings: SettingsMap): unknown
  act(state: unknown, actor: Id, players: CouncilPlayer[], action: unknown): unknown | null
  tick(state: unknown, at: number, players: CouncilPlayer[]): unknown | null
  skip(state: unknown, players: CouncilPlayer[]): unknown | null
  playerRemoved(state: unknown, id: Id, players: CouncilPlayer[]): unknown | null
  canStart(players: CouncilPlayer[], settings: SettingsMap): string | null
}

/**
 * Who won a finished game - used to credit the scoreboard.
 * Returns [] for an aborted/adjourned game so nobody is credited.
 */
export function winnersOf(game: GameId, gs: unknown): Id[] {
  if (!gs || typeof gs !== 'object') return []
  const o = gs as Record<string, unknown>
  if (o.stage !== 'over') return []

  if (game === 'spyfall' || game === 'chameleon' || game === 'imposter') {
    const s = gs as PartyState
    if (s.winner === null) return []
    const bad = new Set(s.bad)
    return s.winner === 'rogue'
      ? s.electorate.filter(id => bad.has(id))
      : s.electorate.filter(id => !bad.has(id))
  }

  if (game === 'coup') {
    const s = gs as CoupState
    return s.winner ? [s.winner] : []
  }

  if (game === 'wavelength') {
    const s = gs as WavelengthState
    if (s.coop) return [] // Coop does not record individual versus wins
    if (s.winner === null) return []
    return s.teams[s.winner] ?? []
  }

  const s = gs as { winner: number | null; participants: Id[] }
  if (s.winner === null || !Array.isArray(s.participants)) return []
  const id = s.participants[s.winner]
  return id ? [id] : []
}

/**
 * How a finished game turned out FOR ONE PLAYER.
 *
 *   'won'  - they are on the winning side
 *   'lost' - they took part and did not win
 *   null   - not their business: spectator, non-participant, still playing,
 *            or the game was adjourned with no winner
 *
 * Shared by the results screens so the "VETOED" banner can never contradict
 * the winner shown beside it.
 */
export function outcomeFor(game: GameId, gs: unknown, playerId: Id): 'won' | 'lost' | null {
  if (!gs || typeof gs !== 'object') return null
  const o = gs as Record<string, unknown>
  if (o.stage !== 'over') return null

  if (game === 'spyfall' || game === 'chameleon' || game === 'imposter') {
    const s = gs as PartyState
    if (!Array.isArray(s.electorate) || !s.electorate.includes(playerId)) return null
    if (s.winner === null) return null
    const wasRogue = Array.isArray(s.bad) && s.bad.includes(playerId)
    return (s.winner === 'rogue') === wasRogue ? 'won' : 'lost'
  }

  if (game === 'coup') {
    const s = gs as CoupState
    if (s.winner === null) return null
    if (!s.seats.includes(playerId)) return null
    return s.winner === playerId ? 'won' : 'lost'
  }

  if (game === 'wavelength') {
    const s = gs as WavelengthState
    if (s.winner === null) return null
    if (s.coop) return 'won'
    const team0 = s.teams[0] || []
    const team1 = s.teams[1] || []
    if (!team0.includes(playerId) && !team1.includes(playerId)) return null
    const playerTeam = team0.includes(playerId) ? 0 : 1
    return s.winner === playerTeam ? 'won' : 'lost'
  }

  const s = gs as { winner: number | null; participants: Id[] }
  if (!Array.isArray(s.participants) || !s.participants.includes(playerId)) return null
  if (s.winner === null) return null
  return s.participants[s.winner] === playerId ? 'won' : 'lost'
}

/** Runtime shape check - guarantees gameState actually belongs to `game`. */
export function matchesGame(game: GameId, gs: unknown): boolean {
  if (!gs || typeof gs !== 'object') return false
  const o = gs as Record<string, unknown>
  if (typeof o.stage !== 'string') return false
  switch (game) {
    case 'spyfall':
    case 'chameleon':
    case 'imposter':
      return (o.kind === game || (game === 'chameleon' && o.kind === 'imposter') || (game === 'imposter' && o.kind === 'chameleon')) && Array.isArray(o.bad) && Array.isArray(o.electorate) && Array.isArray(o.pack)
    case 'quoridor':
      return Array.isArray(o.pawns) && Array.isArray(o.fences) && Array.isArray(o.participants) && Array.isArray(o.goals)
    case 'barricade':
      return Array.isArray(o.pieces) && Array.isArray(o.stones) && Array.isArray(o.participants) && typeof o.layout === 'string'
    case 'coup':
      return Array.isArray(o.seats) && typeof o.players === 'object' && Array.isArray(o.deck) && Array.isArray(o.logs)
    case 'wavelength':
      return Array.isArray(o.teams) && Array.isArray(o.scores) && Array.isArray(o.card) && typeof o.stage === 'string'
  }
  return false
}

export function sanitizeSettings(game: GameId, raw: unknown, playerCount: number): unknown {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0)
  const bool = (v: unknown) => v === true
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2000) : '')
  if (game === 'spyfall') return {
    spies: clamp(Math.round(num(o.spies)) || 1, 1, Math.max(1, playerCount - 2)),
    useCustom: bool(o.useCustom), custom: str(o.custom),
    seconds: o.seconds === 0 ? 0 : clamp(num(o.seconds) || 480, 10, 7200),
  } satisfies SpyfallSettings
  if (game === 'chameleon' || game === 'imposter') return {
    chameleons: clamp(Math.round(num(o.chameleons ?? o.imposters)) || 1, 1, Math.max(1, playerCount - 2)),
    useCustom: bool(o.useCustom), showWords: bool(o.showWords), custom: str(o.custom),
    seconds: o.seconds === 0 ? 0 : clamp(num(o.seconds) || 300, 10, 7200),
  } satisfies ChameleonSettings
  if (game === 'quoridor') return {
    timer: bool(o.timer),
    seconds: clamp(num(o.seconds) || 30, 5, 600),
    useCustomWalls: bool(o.useCustomWalls),
    customWalls: clamp(Math.round(num(o.customWalls)) || 10, 0, 30),
  } satisfies QuoridorSettings
  if (game === 'barricade') return {
    layout: (['classic4', 'trio3', 'duel2'] as const).includes(o.layout as BarricadeLayout) ? o.layout as BarricadeLayout : 'classic4',
    pawns: clamp(Math.round(num(o.pawns)) || 5, 1, 5),
  } satisfies BarricadeSettings
  if (game === 'wavelength') return {
    pointsToWin: clamp(Math.round(num(o.pointsToWin)) || 10, 1, 50),
    seconds: o.seconds === 0 ? 0 : clamp(num(o.seconds) || 180, 10, 7200),
    useCustom: bool(o.useCustom),
    custom: typeof o.custom === 'string' ? o.custom : '',
    randomizeTeams: bool(o.randomizeTeams),
    coop: bool(o.coop),
  } satisfies WavelengthSettings
  return {
    actionTimer: o.actionTimer === 0 ? 0 : clamp(Math.round(num(o.actionTimer)) || 15, 0, 120),
    turnTimer: o.turnTimer === 0 ? 0 : clamp(Math.round(num(o.turnTimer)) || 30, 0, 180),
    reformation: bool(o.reformation),
    useInquisitor: bool(o.useInquisitor),
    contessaBlocksExamine: bool(o.contessaBlocksExamine),
    randomizeFactions: bool(o.randomizeFactions),
  } satisfies CoupSettings
}

const partyModule = (kind: PartyKind): AnyModule => ({
  id: kind,
  init: (players, settings) =>
    partyInit(kind, players, (kind === 'spyfall' ? settings.spyfall : (settings.chameleon ?? settings.imposter!))),
  act: (state, actor, players, action) =>
    partyAct(state as PartyState, actor, players, action as PartyAction),
  tick: (state, at) => partyTick(state as PartyState, at),
  skip: (state, players) => partySkip(state as PartyState, players),
  playerRemoved: (state, id, players) => {
    const s = state as PartyState
    const votes = Object.fromEntries(Object.entries(s.votes).filter(([v, t]) => v !== id && t !== id))
    const verdicts = Object.fromEntries(Object.entries(s.verdicts).filter(([v]) => v !== id))
    const order = (s.order ?? []).filter(x => x !== id)
    const next = { ...s, votes, verdicts, order }
    if (next.stage === 'vote') return maybeResolveVote(next, players)
    // a vanished spy cannot name the secret - the council prevails by default
    if (next.stage === 'accuse' && next.accused === id) return { ...next, stage: 'over' as const, winner: 'council' as const }
    if (next.stage === 'verdict') {
      if (next.accused === id) return { ...next, stage: 'over' as const, winner: 'council' as const }
      const v = verdictStatus(next, players)
      if (v.allIn && !v.tie) return { ...next, stage: 'over' as const, winner: v.yea > v.nay ? 'rogue' : 'council' }
    }
    return next
  },
  canStart: (players) => players.length >= 3 ? null : 'NEEDS 3+ MEMBERS',
})

export const GAMES: Record<GameId, AnyModule> = {
  spyfall: partyModule('spyfall'),
  chameleon: partyModule('chameleon'),
  imposter: partyModule('imposter'),
  quoridor: {
    id: 'quoridor',
    init: (players, settings) => qInit(players, settings.quoridor),
    act: (state, actor, players, action) => qAct(state as QState, actor, players, action as QAction),
    tick: (state, at, players) => {
      const s = state as QState
      if (s.stage !== 'play') return null
      if (s.timer && s.endsAt && at >= s.endsAt) return qAdvance(s)
      // Skip only a SUSTAINED absence: a brief transport blip must never
      // cost someone their turn.
      const cur = players.find(p => p.id === s.participants[s.turn])
      if (!cur || isSustainedOffline(cur, at)) return qAdvance(s)
      // Boxed in with no walls left: pass rather than deadlock the table.
      if (!qHasAction(s, s.turn)) {
        const anyoneCanAct = s.participants.some((_, i) => qHasAction(s, i))
        if (anyoneCanAct) return qAdvance(s)
      }
      return null
    },
    skip: (state) => {
      const s = state as QState
      return s.stage === 'play' ? qAdvance(s) : null
    },
    playerRemoved: () => null,
    canStart: (players) => players.length >= 2 ? null : 'NEEDS 2+ MEMBERS',
  },
  barricade: {
    id: 'barricade',
    init: (players, settings) => bInit(players, settings.barricade),
    act: (state, actor, players, action) => bAct(state as BState, actor, players, action as BAction),
    tick: (state, at, players) => {
      const s = state as BState
      if (s.stage !== 'play') return null
      const cur = players.find(p => p.id === s.participants[s.turn])
      if (!cur || isSustainedOffline(cur, at)) return bForceAdvance(s)
      return null
    },
    skip: (state) => {
      const s = state as BState
      return s.stage === 'play' ? bForceAdvance(s) : null
    },
    playerRemoved: () => null,
    canStart: (players, settings) => {
      const seats = getBMap(settings.barricade.layout).seats
      if (players.length < 2) return 'NEEDS 2+ MEMBERS'
      return players.length <= seats ? null : `BOARD SEATS ONLY ${seats}`
    },
  },
  coup: {
    id: 'coup',
    init: (players, settings) => coupInit(players, settings.coup),
    act: (state, actor, players, action) => coupAct(state as CoupState, actor, players, action as CoupAction),
    tick: (state, at, players) => coupTick(state as CoupState, at, players),
    skip: (state, players) => coupSkip(state as CoupState, players),
    playerRemoved: (state, id, players) => coupPlayerRemoved(state as CoupState, id, players),
    canStart: (players, settings) => {
      const max = settings.coup.reformation ? 10 : 6
      if (players.length < 2) return 'NEEDS 2+ MEMBERS'
      return players.length <= max ? null : `COUP SEATS UP TO ${max}`
    },
  },
  wavelength: {
    id: 'wavelength',
    init: (players, settings) => wInit(players, settings.wavelength),
    act: (state, actor, players, action) => wAct(state as WavelengthState, actor, players, action as WavelengthAction),
    tick: (state, at, players) => wTick(state as WavelengthState, at, players),
    skip: (state, players) => wSkip(state as WavelengthState, players),
    playerRemoved: (state, id, players) => wPlayerRemoved(state as WavelengthState, id, players),
    canStart: (players, settings) => {
      const seated = players.filter(p => !p.isSpectator)
      if (seated.length < 2) return 'NEEDS 2+ MEMBERS'
      if (seated.length > 10) return 'WAVELENGTH SEATS UP TO 10'

      const wSet = settings.wavelength
      const coop = !!wSet?.coop
      const randomize = !!wSet?.randomizeTeams

      if (!coop && !randomize) {
        const team0 = seated.filter(p => ((p.team ?? 0) % 2) === 0)
        const team1 = seated.filter(p => ((p.team ?? 0) % 2) === 1)
        if (team0.length < 2 || team1.length < 2) {
          return 'TEAMS NEED 2+ PLAYERS EACH'
        }
      } else if (!coop && randomize) {
        if (seated.length < 4) return 'NEEDS 4+ MEMBERS'
      }
      return null
    },
  },
}
