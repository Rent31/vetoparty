// ─── VETO PARTY · core shared types, identity, palette, settings ────────────

export type Id = string
export type GameId = 'spyfall' | 'chameleon' | 'imposter' | 'quoridor' | 'barricade' | 'coup' | 'wavelength'

// ── constants ────────────────────────────────────────────────────────────────

export const APP_ID = 'veto-party-council-v1'
export const MAX_PLAYERS = 10

export const PLAYER_COLORS = [
  '#d4483b', '#e07b39', '#d9a83e', '#a3a832',
  '#4ca05a', '#3ba08e', '#3e9fc2', '#4f7fd9',
  '#6f6fd9', '#9a63d9', '#c75fc2', '#d95f83',
  '#8a93a6', '#a87b52',
]

export const ROMAN_NAMES = [
  'CASSIUS', 'BRUTUS', 'CICERO', 'LIVIA', 'OCTAVIA', 'NERO',
  'AURELIA', 'TIBERIUS', 'AGRIPPA', 'FAUSTINA', 'SENECA', 'TRAJAN',
  'HADRIAN', 'LUCIA', 'MARCELLUS', 'DRUSUS', 'VALERIA', 'CATO',
  'JUNIA', 'MARCUS', 'FLAVIA', 'GAIUS', 'CORNELIA', 'AULUS',
]

// ── small helpers ────────────────────────────────────────────────────────────

export const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

export const isHex = (c: unknown): c is string =>
  typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

export const normHex = (c: string) => c.trim().toLowerCase()

export const uid = (len = 8) => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return s
}

export const roomCode = () => {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)]
  return s
}

const RN: [number, string][] = [
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]
export const roman = (n: number) => {
  let out = ''
  for (const [v, s] of RN) while (n >= v) { out += s; n -= v }
  return out || 'I'
}

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const pickOne = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── players & room state ─────────────────────────────────────────────────────

export interface CouncilPlayer {
  id: Id
  name: string
  color: string
  isAdmin: boolean
  isOwner: boolean
  isBot: boolean
  /** Watching only: never dealt into a game, never counted for start rules. */
  isSpectator: boolean
  connected: boolean
  /** When they went offline (ms). Null while connected. */
  offlineSince: number | null
  joinedAt: number
  peerId: string | null
  /** Optional team assignment (0-indexed) for team-based games. */
  team?: number | null
}

/**
 * A transport blip must NOT hand their turn (or their secret prompt) to an
 * admin. Only a sustained absence unlocks proxy control.
 */
export const PROXY_GRACE_MS = 15000

export function isSustainedOffline(p: CouncilPlayer, at = Date.now()): boolean {
  if (p.isBot || p.connected) return false
  if (typeof p.offlineSince !== 'number') return true   // legacy record
  return at - p.offlineSince >= PROXY_GRACE_MS
}

/** May an admin act on this member's behalf right now? */
export const canProxyFor = (p: CouncilPlayer, at = Date.now()): boolean =>
  p.isBot || isSustainedOffline(p, at)

/** Members who actually play - the roster every game module is handed. */
export const seatedOf = (players: CouncilPlayer[]) =>
  players.filter(p => !p.isSpectator)

export const activeSeated = (players: CouncilPlayer[]) =>
  players.filter(p => !p.isSpectator && (p.connected || p.isBot))

export interface SpyfallSettings {
  spies: number
  useCustom: boolean
  custom: string
  seconds: number
}
export interface ChameleonSettings {
  chameleons: number
  imposters?: number
  useCustom: boolean
  custom: string
  showWords: boolean
  seconds: number
}
export type ImposterSettings = ChameleonSettings

export interface QuoridorSettings {
  timer: boolean
  seconds: number
  useCustomWalls?: boolean
  customWalls?: number
}
export type BarricadeLayout = 'classic4' | 'trio3' | 'duel2'
export interface BarricadeSettings {
  layout: BarricadeLayout
  pawns: number
}
export interface CoupSettings {
  actionTimer: number
  turnTimer: number
  reformation: boolean
  useInquisitor: boolean
  contessaBlocksExamine?: boolean
  randomizeFactions?: boolean
}
export interface WavelengthSettings {
  pointsToWin: number
  seconds: number
  useCustom: boolean
  custom: string
  randomizeTeams?: boolean
  coop?: boolean
}

export interface SettingsMap {
  spyfall: SpyfallSettings
  chameleon: ChameleonSettings
  imposter?: ChameleonSettings
  quoridor: QuoridorSettings
  barricade: BarricadeSettings
  coup: CoupSettings
  wavelength: WavelengthSettings
}

export const DEFAULT_SETTINGS: SettingsMap = {
  spyfall: { spies: 1, useCustom: false, custom: '', seconds: 480 },
  chameleon: { chameleons: 1, useCustom: false, custom: '', showWords: false, seconds: 300 },
  imposter: { chameleons: 1, useCustom: false, custom: '', showWords: false, seconds: 300 },
  quoridor: { timer: false, seconds: 30, useCustomWalls: false, customWalls: 10 },
  barricade: { layout: 'classic4', pawns: 5 },
  coup: { actionTimer: 15, turnTimer: 30, reformation: false, useInquisitor: false, contessaBlocksExamine: false, randomizeFactions: false },
  wavelength: { pointsToWin: 10, seconds: 180, useCustom: false, custom: '', randomizeTeams: false, coop: false },
}

/** wins per player, broken down by game */
export type ScoreBook = Record<Id, Partial<Record<GameId, number>>>

export interface TeamState {
  count: number
  freeMovement: boolean
}

export interface RoomState {
  code: string
  createdAt: number
  ownerId: Id
  players: CouncilPlayer[]
  phase: 'lobby' | 'game'
  selectedGame: GameId
  settings: SettingsMap
  game: GameId | null
  gameState: unknown | null
  scores: ScoreBook
  showScores: boolean
  teams?: TeamState
  version: number
}

export const totalWins = (row: Partial<Record<GameId, number>> | undefined) =>
  row ? GAME_ORDER.reduce((n, g) => n + (row[g] ?? 0), 0) : 0

/** Older snapshots predate the scoreboard or teams - fill in the defaults. */
export function normalizeRoom(s: RoomState): RoomState {
  const needsScores = !s.scores || typeof s.scores !== 'object' || typeof s.showScores !== 'boolean'
  const needsSpectator = s.players?.some(
    p => typeof p.isSpectator !== 'boolean' || p.offlineSince === undefined,
  )
  const needsTeams = !s.teams || typeof s.teams.count !== 'number'
  if (!needsScores && !needsSpectator && !needsTeams) return s
  return {
    ...s,
    players: s.players.map(p => ({
      ...p,
      isSpectator: typeof p.isSpectator === 'boolean' ? p.isSpectator : false,
      offlineSince: p.offlineSince === undefined ? (p.connected ? null : 0) : p.offlineSince,
      team: typeof p.team === 'number' ? p.team : (p.team === null ? null : undefined),
    })),
    scores: s.scores && typeof s.scores === 'object' ? s.scores : {},
    showScores: typeof s.showScores === 'boolean' ? s.showScores : true,
    teams: s.teams && typeof s.teams === 'object' && typeof s.teams.count === 'number'
      ? {
          count: Math.max(2, s.teams.count),
          freeMovement: typeof s.teams.freeMovement === 'boolean' ? s.teams.freeMovement : false,
        }
      : { count: 2, freeMovement: false },
  }
}

// Single source of truth for which games exist and in what order they appear.
// Adding a game = add its id here plus entries in GAME_META / GAMES.
export const GAME_ORDER: GameId[] = ['spyfall', 'chameleon', 'quoridor', 'barricade', 'coup', 'wavelength']

export const GAME_META: Record<GameId, { name: string; tag: string; min: number; max: number; teamBased?: boolean }> = {
  spyfall: { name: 'SPYFALL', tag: 'FIND THE SPY AMONG THE SENATE', min: 3, max: 10 },
  chameleon: { name: 'CHAMELEON', tag: 'ONE WORD DIVIDES THE COUNCIL', min: 3, max: 10 },
  imposter: { name: 'CHAMELEON', tag: 'ONE WORD DIVIDES THE COUNCIL', min: 3, max: 10 },
  quoridor: { name: 'QUORIDOR', tag: 'WALLS RISE, PATHS DIE', min: 2, max: 4 },
  barricade: { name: 'BARRICADE', tag: 'STORM THE THRONE ABOVE THE WALLS', min: 2, max: 4 },
  coup: { name: 'COUP', tag: 'DECEPTION, BLUFFS, AND ABSOLUTE POWER', min: 2, max: 6 },
  wavelength: { name: 'WAVELENGTH', tag: 'READ MINDS ACROSS THE SPECTRUM', min: 2, max: 10, teamBased: true },
}

export function isTeamGame(game: GameId, settings?: SettingsMap): boolean {
  if (game === 'coup') {
    return !!settings?.coup?.reformation
  }
  if (game === 'wavelength') {
    return !settings?.wavelength?.coop
  }
  return !!GAME_META[game]?.teamBased
}

// ── local persistence (client only) ──────────────────────────────────────────

const hasDOM = () => typeof window !== 'undefined'
const get = (k: string) => (hasDOM() ? window.localStorage.getItem(k) : null)
const set = (k: string, v: string) => {
  if (!hasDOM()) return
  // storage can throw (quota or private mode) - saving must never break the caller
  try { window.localStorage.setItem(k, v) } catch { /* ignore */ }
}
const getJSON = <T,>(k: string): T | null => {
  const raw = get(k)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

// identity ────────────────────────────────────────────────────────────────────

export interface Identity { id: Id; name: string; color: string }

interface Prefs {
  name: string
  color: string
  /** Distinguishes a chosen name from names auto-generated by older builds. */
  chosen?: boolean
}

/**
 * Seat id is per-TAB (sessionStorage), not per-browser.
 *
 * Two tabs on one machine are two distinct members - without this they both
 * claim the same player record and the host's peer mapping flip-flops, which
 * silently breaks whichever tab lost the race. sessionStorage survives a
 * refresh in the same tab, so reconnect-in-place still restores your seat.
 */
function tabSeatId(): Id {
  if (typeof window === 'undefined') return 'ssr'
  try {
    let t = window.sessionStorage.getItem('vp.seat')
    if (!t) {
      t = uid(12)
      window.sessionStorage.setItem('vp.seat', t)
    }
    return t
  } catch {
    return uid(12)
  }
}

/**
 * Names are NEVER invented for the player - an unset name is empty, and the
 * UI asks for one. Only the colour is seeded on first load (and remembered
 * until they change it).
 */
function loadPrefs(): Prefs {
  const p = getJSON<Prefs>('vp.prefs.v1')
  if (p && typeof p.name === 'string') {
    const cleaned = cleanName(p.name)
    const isChosen = p.chosen === true || (p.chosen === undefined && cleaned.length > 0 && !ROMAN_NAMES.includes(cleaned))
    return {
      name: isChosen ? cleaned : '',
      color: isHex(p.color) ? normHex(p.color) : pickOne(PLAYER_COLORS),
      chosen: isChosen && cleaned.length > 0,
    }
  }
  const legacy = getJSON<Identity>('vp.identity.v1')
  const legacyName = cleanName(typeof legacy?.name === 'string' ? legacy.name : '')
  const chosen = legacyName.length > 0 && !ROMAN_NAMES.includes(legacyName)
  const fresh: Prefs = {
    name: chosen ? legacyName : '',
    color: isHex(legacy?.color) ? normHex(legacy.color) : pickOne(PLAYER_COLORS),
    chosen,
  }
  if (hasDOM()) set('vp.prefs.v1', JSON.stringify(fresh))
  return fresh
}

/** Canonical name rules, shared by the UI and the host-side validator. */
export function cleanName(raw: string): string {
  return (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 \-_.[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, 14)
}

export function ensureIdentity(): Identity {
  const prefs = loadPrefs()
  return { id: tabSeatId(), name: prefs.name, color: prefs.color }
}

/** True once the player has chosen a name - drives the first-run prompt. */
export function hasChosenName(): boolean {
  const prefs = loadPrefs()
  return prefs.chosen === true || cleanName(prefs.name).trim().length > 0
}

export function saveIdentityName(name: string) {
  const prefs = loadPrefs()
  prefs.name = cleanName(name)
  prefs.chosen = prefs.name.trim().length > 0
  set('vp.prefs.v1', JSON.stringify(prefs))
}

export function saveIdentityColor(color: string) {
  if (!isHex(color)) return
  const prefs = loadPrefs()
  prefs.color = normHex(color)
  set('vp.prefs.v1', JSON.stringify(prefs))
}

// theme & sound prefs ─────────────────────────────────────────────────────────

export const loadTheme = () => get('vp.theme') === 'light' ? 'light' : 'dark'
export const saveTheme = (t: string) => set('vp.theme', t)
export const loadSoundOn = () => get('vp.sound') !== 'off'
export const saveSoundOn = (on: boolean) => set('vp.sound', on ? 'on' : 'off')

// settings (per device, for future rooms) ─────────────────────────────────────

export function loadMySettings(): SettingsMap {
  const raw = getJSON<Partial<SettingsMap>>('vp.settings.v1') ?? {}
  const cham = (raw as Record<string, unknown>).chameleon ?? (raw as Record<string, unknown>).imposter ?? {}
  return {
    spyfall: { ...DEFAULT_SETTINGS.spyfall, ...(raw.spyfall ?? {}) },
    chameleon: { ...DEFAULT_SETTINGS.chameleon, ...cham },
    imposter: { ...DEFAULT_SETTINGS.chameleon, ...cham },
    quoridor: { ...DEFAULT_SETTINGS.quoridor, ...(raw.quoridor ?? {}) },
    barricade: { ...DEFAULT_SETTINGS.barricade, ...(raw.barricade ?? {}) },
    coup: { ...DEFAULT_SETTINGS.coup, ...(raw.coup ?? {}) },
    wavelength: { ...DEFAULT_SETTINGS.wavelength, ...(raw.wavelength ?? {}) },
  }
}
export function saveMySettings(s: SettingsMap) {
  set('vp.settings.v1', JSON.stringify(s))
}

// custom-list presets ─────────────────────────────────────────────────────────

export interface ListPreset { name: string; list: string }

export type PresetGameId = 'spyfall' | 'chameleon' | 'imposter' | 'wavelength'

export function loadPresets(game: PresetGameId): ListPreset[] {
  const normalized = game === 'imposter' ? 'chameleon' : game
  const stored = getJSON<ListPreset[]>(`vp.presets.${normalized}`)
  if (stored && stored.length > 0) return stored
  if (game === 'wavelength') {
    return [
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
  }
  return []
}
export function savePreset(game: PresetGameId, preset: ListPreset) {
  const normalized = game === 'imposter' ? 'chameleon' : game
  const all = loadPresets(normalized).filter(p => p.name !== preset.name)
  all.unshift(preset)
  set(`vp.presets.${normalized}`, JSON.stringify(all.slice(0, 12)))
}
export function deletePreset(game: PresetGameId, name: string) {
  const normalized = game === 'imposter' ? 'chameleon' : game
  set(`vp.presets.${normalized}`, JSON.stringify(loadPresets(normalized).filter(p => p.name !== name)))
}

// room snapshots (for host migration / reconnect) ─────────────────────────────

export function saveSnapshot(state: RoomState) {
  set(`vp.room.${state.code}`, JSON.stringify(state))
  set('vp.last', JSON.stringify({ code: state.code, at: Date.now() }))
}
export function loadSnapshot(code: string): RoomState | null {
  return getJSON<RoomState>(`vp.room.${code}`)
}
export function clearSnapshot(code: string) {
  if (hasDOM()) window.localStorage.removeItem(`vp.room.${code}`)
}
export function clearLastRoom(code?: string) {
  const last = getJSON<{ code: string; at: number }>('vp.last')
  if (!code || last?.code === code) window.localStorage.removeItem('vp.last')
}
export function loadLastRoom(): { code: string; at: number } | null {
  const l = getJSON<{ code: string; at: number }>('vp.last')
  return l && Date.now() - l.at < 1000 * 60 * 60 * 12 ? l : null
}
