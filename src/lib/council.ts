'use client'
// ─── VETO PARTY · P2P council engine (Trystero WebRTC, host-authoritative) ───
//
// The room creator's browser is the authoritative host. If the host drops,
// the next admin (then next member) takes over using the latest replicated
// state snapshot. Everyone persists snapshots locally for refresh recovery.

import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import type { Room } from 'trystero'
import {
  APP_ID, CouncilPlayer, DEFAULT_SETTINGS, GameId, Id, Identity, MAX_PLAYERS,
  PLAYER_COLORS, ROMAN_NAMES, RoomState, SettingsMap,
  activeSeated, clamp, cleanName, clearLastRoom, clearSnapshot, ensureIdentity, isHex, loadMySettings, loadSnapshot, normHex,
  normalizeRoom, roomCode, saveIdentityColor, saveIdentityName, saveMySettings,
  saveSnapshot, shuffle, uid,
} from './core'
import { GAMES, matchesGame, now, sanitizeSettings, winnersOf } from './games'
import { rtcConfig } from './rtc'
import { EncryptedRelay, RelayMessage } from './relay'

export type ModerateOp =
  | { op: 'kick' | 'leave' | 'promote' | 'demote'; target: Id }
  | { op: 'rename'; target: Id; value: string }
  | { op: 'recolor'; target: Id; value: string }
  | { op: 'addBot' }
  | { op: 'removeBot'; target: Id }
  | { op: 'showScores'; value: boolean }
  | { op: 'resetScores' }
  | { op: 'spectate'; target: Id; value: boolean }
  | { op: 'setTeam'; target: Id; team: number | null }
  | { op: 'setTeamCount'; count: number }
  | { op: 'setFreeMovement'; value: boolean }
  | { op: 'randomizeTeams' }

type Intent = (
  | { t: 'hello'; id: Id; name: string; color: string; spectator?: boolean }
  | { t: 'full' }
  | { t: 'expelled' }
  | { t: 'need' }
  | { t: 'sync'; state: RoomState }
  | { t: 'settings'; game: GameId; settings: unknown }
  | { t: 'select'; game: GameId }
  | { t: 'start' }
  | { t: 'toLobby' }
  | { t: 'endGame' }
  | { t: 'skip' }
  | { t: 'action'; actor: Id; action: unknown }
  | { t: 'moderate'; m: ModerateOp }
) & { mid?: string }

export interface CouncilSnap {
  status: 'boot' | 'connecting' | 'online' | 'expelled' | 'gone' | 'full'
  state: RoomState | null
  selfPeer: string
  hostPeer: string | null
  isHost: boolean
  peerCount: number
  acked: boolean
  myId: Id
  searchingMs: number
  relayReady: number
}

export interface CouncilApi extends CouncilSnap {
  sendAction: (action: unknown, actor?: Id) => void
  sendSettings: (game: GameId, settings: unknown) => void
  selectGame: (game: GameId) => void
  startGame: () => void
  toLobby: () => void
  endGame: () => void
  skipStage: () => void
  moderate: (m: ModerateOp) => void
  leave: () => void
  retry: () => void
  applyProfile: (opts?: { spectator?: boolean }) => void
  setSpectating: (value: boolean, target?: Id) => void
}

/**
 * How long a peer must be continuously unseen before the host records them as
 * disconnected. Without this, the HOST's own network dip empties the live set,
 * flips everyone offline, bumps the version and re-broadcasts the whole room
 * to every peer, then repeats on recovery. That storm is what makes the entire
 * table stutter when only one connection actually wobbled.
 */
const PRESENCE_GRACE_MS = 10000
/** Relay presence older than this is considered disconnected. */
const RELAY_PEER_TTL_MS = 13000
/** How long a restored (non-creator) client waits for peers before self-hosting. */
const HOST_GRACE_MS = 6000
/** Window in which a removed member's queued heartbeats are ignored. */
const KICK_DEBOUNCE_MS = 12000
/** Give up looking for a council after this long with no peers at all. */
const GONE_MS = 30000
/** Peers are visible but no state yet - allow longer for the ICE handshake. */
const GONE_WITH_PEERS_MS = 60000

export interface PendingCreate { code: string; useSaved: boolean }

/**
 * Compatibility marker for older links. Creation no longer depends on this:
 * the URL carries the same intent, so blocked/private sessionStorage cannot
 * make OPEN SESSION silently fail before navigation.
 */
export function stageCreate(code: string, useSaved: boolean): boolean {
  try {
    sessionStorage.setItem('vp.create', JSON.stringify({ code, useSaved } satisfies PendingCreate))
    return true
  } catch {
    return false
  }
}
function takeCreate(code: string): PendingCreate | null {
  try {
    const raw = sessionStorage.getItem('vp.create')
    if (!raw) return null
    const pc = JSON.parse(raw) as PendingCreate
    if (pc.code === code) { sessionStorage.removeItem('vp.create'); return pc }
  } catch { /* noop */ }
  return null
}

const freeColor = (players: CouncilPlayer[], exclude?: Id) => {
  const taken = new Set(players.filter(p => p.id !== exclude).map(p => normHex(p.color ?? '')))
  const free = PLAYER_COLORS.filter(c => !taken.has(normHex(c)))
  if (free.length) return free[Math.floor(Math.random() * free.length)]
  // palette exhausted (custom colors in play) - generate a distinct one
  for (let i = 0; i < 64; i++) {
    const c = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`
    if (!taken.has(c)) return c
  }
  return PLAYER_COLORS[players.length % PLAYER_COLORS.length]
}

const colorClash = (players: CouncilPlayer[], color: string, exclude?: Id) =>
  players.some(p => p.id !== exclude && normHex(p.color ?? '') === normHex(color))

/**
 * Credit the winners of a just-finished game, exactly once.
 * Marked with `scored` on the game state so replays/resyncs cannot double-count.
 */
function applyScores(s: RoomState): RoomState {
  if (s.phase !== 'game' || !s.game || !s.gameState) return s
  const gs = s.gameState as Record<string, unknown>
  if (gs.stage !== 'over' || gs.scored === true) return s

  const scores: RoomState['scores'] = { ...(s.scores ?? {}) }
  for (const id of winnersOf(s.game, s.gameState)) {
    const row = { ...(scores[id] ?? {}) }
    row[s.game] = (row[s.game] ?? 0) + 1
    scores[id] = row
  }
  return { ...s, scores, gameState: { ...gs, scored: true } }
}

/** Structural guard - never let a malformed peer payload reach React. */
function isValidRoom(s: unknown, code: string): s is RoomState {
  if (!s || typeof s !== 'object') return false
  const r = s as Partial<RoomState>
  if (r.code !== code) return false
  if (typeof r.version !== 'number' || typeof r.createdAt !== 'number') return false
  if (typeof r.ownerId !== 'string') return false
  if (!Array.isArray(r.players)) return false
  if (!r.players.every(p => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.color === 'string')) return false
  if (r.phase !== 'lobby' && r.phase !== 'game') return false
  if (!r.settings || typeof r.settings !== 'object') return false
  if (!GAMES[r.selectedGame as GameId]) return false
  if (r.game !== null && !GAMES[r.game as GameId]) return false
  if (r.phase === 'game' && (!r.game || !r.gameState)) return false
  if (r.game && r.gameState && !matchesGame(r.game, r.gameState)) return false
  return true
}

const botName = (players: CouncilPlayer[]) => {
  const used = new Set(players.map(p => p.name))
  const free = ROMAN_NAMES.filter(n => !used.has(n) && !players.some(p => p.name === n))
  if (free.length) return `[${free[0]}]`
  let i = 2
  while (players.some(p => p.name === `[UNIT ${i}]`)) i++
  return `[UNIT ${i}]`
}

// ─── engine ─────────────────────────────────────────────────────────────────

export class CouncilEngine {
  code: string
  create: PendingCreate | null
  identity: Identity
  onChange: () => void

  state: RoomState | null = null
  selfPeer = ''
  hostPeer: string | null = null
  isHost = false
  status: CouncilSnap['status'] = 'boot'
  acked = false

  private room: Room | null = null
  private relay: EncryptedRelay | null = null
  private peers = new Set<string>()
  private relayPeers = new Map<string, number>()
  /** Host-side: when each peer was last observed on ANY transport. */
  private peerLastSeen = new Map<string, number>()
  private seenIntents = new Map<string, number>()
  private sendState: ((s: RoomState, o?: { target?: string }) => Promise<void>) | null = null
  private sendIntentRaw: ((i: Intent, o?: { target?: string }) => Promise<void>) | null = null
  private destroyed = false
  private timers: ReturnType<typeof setInterval>[] = []
  private wasAcked = false
  private bootAt = Date.now()
  private lastIntent: { i: Intent; at: number } | null = null
  /**
   * Recently removed members, by id -> expiry. NOT a ban list: it is never
   * persisted, never shown in the UI, and lapses after a few seconds. It only
   * exists so a kicked client's in-flight `hello` heartbeats cannot re-seat
   * them before they have processed the expulsion.
   */
  private removedUntil = new Map<Id, number>()
  /** Requested role for our FIRST seating (admins can change it later). */
  joinAsSpectator = false
  /** Set once we learn we were removed - stops us announcing ourselves back. */
  private expelledSelf = false
  private lastBroadcast = -1
  private pulseTick = 0

  constructor(code: string, onChange: () => void, requestedCreate?: PendingCreate | null) {
    this.code = code
    this.onChange = onChange
    this.identity = ensureIdentity()
    // URL intent is authoritative; sessionStorage remains a compatibility
    // fallback. A saved room always wins below, so refreshing a creator URL
    // restores rather than replacing the council.
    this.create = requestedCreate?.code === code ? requestedCreate : takeCreate(code)
    const snap = loadSnapshot(code)
    if (isValidRoom(snap, code)) {
      // freeze stale presence: only I can be "connected" from a snapshot
      snap.players = snap.players.map(p => p.isBot ? p : { ...p, connected: false, peerId: null })
      this.state = normalizeRoom(snap)
    }
  }

  async start() {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.persistFlush)
    try {
      await this.connect()
    } catch (err) {
      console.error('[council] join failed', err)
      if (!this.destroyed) {
        this.status = this.state ? 'online' : 'gone'
        this.onChange()
      }
    }
  }

  private async connect() {
    this.status = 'connecting'
    this.onChange()
    const trystero = await import('trystero')
    if (this.destroyed) return
    this.selfPeer = trystero.selfId
    this.relay = new EncryptedRelay(
      this.code,
      this.selfPeer,
      m => this.guard(() => this.receiveRelay(m)),
      () => this.guard(() => { this.reevaluate(); this.onChange() }),
    )
    void this.relay.start()

    const room = trystero.joinRoom(
      {
        appId: APP_ID,
        rtcConfig: rtcConfig(),
        relayConfig: { redundancy: 5 },
      },
      `council.${this.code}`,
      { onJoinError: (d) => console.error('[council] relay rejected join', d) },
    )
    this.room = room

    type Wire<T> = {
      send: (d: T, o?: { target?: string }) => Promise<void>
      onMessage: ((d: T, ctx: { peerId: string }) => void) | null
    }
    const stateAction = room.makeAction('vp-state') as unknown as Wire<RoomState>
    stateAction.onMessage = (data, ctx) => this.guard(() => this.receiveState(data, ctx.peerId))
    this.sendState = async (state, o) => {
      const mid = uid(14)
      const direct = stateAction.send(state, o).catch(() => undefined)
      const relayed = this.relay?.send('state', state, o?.target, mid, true)
      await Promise.allSettled([direct, relayed])
    }

    const intentAction = room.makeAction('vp-intent') as unknown as Wire<Intent>
    intentAction.onMessage = (data, ctx) => this.guard(() => this.receiveIntent(data, ctx.peerId))
    this.sendIntentRaw = async (intent, o) => {
      const wire = { ...intent, mid: intent.mid ?? uid(14) } as Intent
      const direct = intentAction.send(wire, o).catch(() => undefined)
      const relayed = this.relay?.send('intent', wire, o?.target, wire.mid)
      await Promise.allSettled([direct, relayed])
    }

    room.onPeerJoin = (peer: string) => this.guard(() => {
      this.peers.add(peer)
      if (this.isHostRole && this.state) {
        // greet the newcomer with the latest record
        void this.sendState?.(this.state, { target: peer })
      } else if (!this.state) {
        // we are empty-handed - ask whoever just arrived
        void this.sendIntentRaw?.({ t: 'need' }, { target: peer })
      }
      this.reevaluate()
      this.hello()
    })
    room.onPeerLeave = (peer: string) => this.guard(() => {
      this.peers.delete(peer)
      // Deliberately NOT marking them offline here. Our own network dip makes
      // Trystero fire this for every peer at once, and an immediate commit
      // would evict the whole table, bump the version and re-broadcast the
      // room twice (once on loss, once on recovery). pulse() owns presence,
      // with hysteresis, so a wobble costs nothing.
      this.reevaluate()
    })

    // creator seeds a fresh council immediately
    if (this.create && !this.state) {
      this.seed()
    }

    // recurring duties
    this.timers.push(setInterval(() => this.guard(() => this.hello()), 2500))
    this.timers.push(setInterval(() => this.guard(() => this.pulse()), 3000))
    this.timers.push(setInterval(() => this.guard(() => this.tickHost()), 500))
    this.timers.push(setInterval(() => this.guard(() => this.reevaluate()), 1500))
    this.timers.push(setInterval(() => this.guard(() => this.markGone()), 2000))

    this.hello()
    if (!this.state) void this.sendIntentRaw?.({ t: 'need' })
    this.reevaluate()
    this.onChange()
  }

  /** Never let a peer message or timer throw into React / the RTC callbacks. */
  private guard(fn: () => void) {
    if (this.destroyed) return
    try { fn() } catch (err) { console.error('[council]', err) }
  }

  destroy() {
    // no roster removal here - peers will see the peer-leave and mark us
    // disconnected, keeping our seat warm for a seamless reconnect.
    this.destroyed = true
    this.timers.forEach(clearInterval)
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.persistFlush)
    this.persistFlush()
    void this.room?.leave()
    this.room = null
    this.relay?.stop()
    this.relay = null
    this.relayPeers.clear()
  }

  // ── identity / seeding ─────────────────────────────────────────────────────

  private seed() {
    const name = cleanName(this.identity.name).trim() || 'FIRST CONSUL'
    const color = isHex(this.identity.color) ? normHex(this.identity.color) : PLAYER_COLORS[0]
    const me: CouncilPlayer = {
      id: this.identity.id,
      name,
      color,
      isAdmin: true,
      isOwner: true,
      isBot: false,
      isSpectator: false,
      connected: true,
      offlineSince: null,
      joinedAt: now(),
      peerId: this.selfPeer,
    }
    const settings: SettingsMap = this.create?.useSaved ? loadMySettings() : JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
    this.state = {
      code: this.code,
      createdAt: now(),
      ownerId: this.identity.id,
      players: [me],
      phase: 'lobby',
      selectedGame: 'spyfall',
      settings,
      game: null,
      gameState: null,
      scores: {},
      showScores: true,
      teams: { count: 2, freeMovement: false },
      version: 1,
    }
    this.isHost = true
    this.hostPeer = this.selfPeer
    this.status = 'online'
    this.persistLocal()
    this.acked = true
    this.wasAcked = true
  }

  private me(): CouncilPlayer | null {
    return this.state?.players.find(p => p.id === this.identity.id) ?? null
  }

  // ── election ───────────────────────────────────────────────────────────────

  private get isHostRole(): boolean {
    if (!this.selfPeer || this.expelledSelf) return false
    const live = this.livePeers()
    const st = this.state
    if (!st) return !!this.create

    // Startup can toggle the relay and direct transports in any order. While
    // we are still inside the discovery window, anyone who already inherited
    // duty (creator seeding, elected caretaker, refreshed host) keeps it
    // instead of re-fighting authority on every broker connect/disconnect.
    if (this.isHost && Date.now() - this.bootAt < HOST_GRACE_MS) return true

    const cand = st.players.filter(p => !p.isBot && p.peerId && live.has(p.peerId))
    if (!cand.length) {
      // The creator hosts instantly. Anyone else is holding a *restored*
      // snapshot whose peers simply have not been discovered yet - claiming
      // authority now would clobber the real host's state, so wait out a
      // discovery grace period first.
      if (this.create) return true
      if (Date.now() - this.bootAt < HOST_GRACE_MS) return false
      // nobody mapped yet - lowest live peer plays caretaker
      return [...live].sort()[0] === this.selfPeer
    }
    const score = (p: CouncilPlayer) => (p.id === st.ownerId ? 0 : p.isAdmin ? 1 : 2)
    cand.sort((a, b) => score(a) - score(b) || a.joinedAt - b.joinedAt)
    return cand[0].peerId === this.selfPeer
  }

  private receiveRelay(m: RelayMessage) {
    if (this.destroyed || this.expelledSelf || m.from === this.selfPeer) return
    this.relayPeers.set(m.from, Date.now())

    if (m.kind === 'presence') {
      this.onChange()
      return
    }
    if (m.kind === 'state') {
      this.receiveState(m.data as RoomState, m.from)
      return
    }
    if (m.kind === 'intent') this.receiveIntent(m.data as Intent, m.from)
  }

  /** All currently reachable peers, no matter which transport reached them. */
  private livePeers(): Set<string> {
    const cutoff = Date.now() - RELAY_PEER_TTL_MS
    for (const [id, at] of this.relayPeers) if (at < cutoff) this.relayPeers.delete(id)
    return new Set([...this.peers, ...this.relayPeers.keys(), this.selfPeer].filter(Boolean))
  }

  /** Trystero's peer map is the source of truth; our Set can drift. */
  private syncPeers() {
    const room = this.room
    if (!room) return
    try {
      const ids = Object.keys(room.getPeers())
      const next = new Set(ids)
      if (next.size !== this.peers.size || ids.some(id => !this.peers.has(id))) {
        this.peers = next
      }
    } catch { /* transport not ready */ }
  }

  private reevaluate() {
    if (this.destroyed) return
    this.syncPeers()
    const prevHostPeer = this.hostPeer
    const was = this.isHost
    const am = this.isHostRole
    if (am) {
      const st = this.state
      this.hostPeer = this.selfPeer
      if (!was || !this.isHost) {
        this.isHost = true
        // refresh presence from the live set and claim authority
        if (st) {
          const live = this.livePeers()
          const next: RoomState = {
            ...st,
            players: st.players.map(p => {
              if (p.isBot) return p
              // Rebind OUR OWN record to the current peer id: after a refresh
              // the restored snapshot holds a dead id, which would otherwise
              // block our ack forever.
              if (p.id === this.identity.id) return { ...p, connected: true, offlineSince: null, peerId: this.selfPeer }
              // Do NOT let a host-claim flap everyone offline: relay-link
              // status changes re-run this block, and resetting `connected`
              // here fights the pulse that reconciles presence continuously.
              return p
            }),
            version: st.version + 1,
          }
          this.state = next
          this.persistLocal()
          this.broadcast()
          // Draw the real presence map immediately after claiming so board
          // timers and voting eligibility do not flap while waiting for the
          // next 3s pulse.
          this.pulseTick = 0
          setTimeout(() => this.guard(() => this.pulse()), 120)
        }
      }
    } else {
      this.isHost = false
      // find who we believe hosts
      const st = this.state
      if (st) {
        const live = this.livePeers()
        const cand = st.players.filter(p => !p.isBot && p.peerId && live.has(p.peerId))
        const score = (p: CouncilPlayer) => (p.id === st.ownerId ? 0 : p.isAdmin ? 1 : 2)
        cand.sort((a, b) => score(a) - score(b) || a.joinedAt - b.joinedAt)
        this.hostPeer = cand[0]?.peerId ?? [...live].sort()[0] ?? null
      }
    }
    // host migrated → clients replay the latest action; it may have died
    // with the old host. Host-origin operations are NOT replayed: a new host
    // inherits the authoritative record, and re-executing its own stale
    // moderation would corrupt the roster.
    const replayable = !!this.lastIntent && ['action', 'sync'].includes(this.lastIntent.i.t)
    if (
      prevHostPeer && this.hostPeer && prevHostPeer !== this.hostPeer &&
      replayable && this.lastIntent && Date.now() - this.lastIntent.at < 6000
    ) {
      const li = this.lastIntent
      setTimeout(() => { if (!this.destroyed) this.send(li.i) }, 450)
    }
    if (this.state && this.status !== 'online') this.status = 'online'
    this.recomputeAck()
    this.onChange()
  }

  private recomputeAck() {
    const was = this.acked
    this.acked = !!this.state?.players.some(
      p => p.id === this.identity.id && p.connected && p.peerId === this.selfPeer,
    )
    if (this.acked) this.wasAcked = true
    if (this.wasAcked && this.state && !this.state.players.some(p => p.id === this.identity.id)) {
      this.markExpelled()
    }
    if (was !== this.acked) this.onChange()
  }

  private markExpelled() {
    if (this.expelledSelf) return
    this.expelledSelf = true
    this.status = 'expelled'
    this.state = null
    clearLastRoom(this.code)
    clearSnapshot(this.code)   // don't auto-restore; a deliberate rejoin still works
    this.relay?.stop()
    this.relay = null
    void this.room?.leave()
    this.room = null
    this.peers.clear()
    this.relayPeers.clear()
    this.onChange()
  }

  private markGone() {
    if (this.acked || this.expelledSelf) return
    if (this.status !== 'connecting' && this.status !== 'online') return
    const waited = Date.now() - this.bootAt
    // A retained relay snapshot may arrive after every real member has left.
    // It is useful for refresh recovery, but it must not spin a brand-new
    // guest forever when no host is actually alive.
    const hasOtherLivePeer = this.livePeers().size > 1
    const budget = hasOtherLivePeer ? GONE_WITH_PEERS_MS : GONE_MS
    if (waited > budget) {
      this.status = 'gone'
      this.onChange()
    }
  }

  /**
   * Called once the player has completed the first-run profile prompt.
   * Re-reads the saved identity and announces immediately.
   */
  applyProfile(opts?: { spectator?: boolean }) {
    if (this.destroyed) return
    this.identity = ensureIdentity()
    if (opts && typeof opts.spectator === 'boolean') this.joinAsSpectator = opts.spectator
    if (this.state && this.isHost) {
      // We are the authority (e.g. the creator naming themselves): seat now.
      this.receiveIntent(this.helloIntent(), this.selfPeer)
    }
    this.sendHelloRaw()
    this.reevaluate()
    this.onChange()
  }

  /** Re-announce and restart the search without reloading the page. */
  retry() {
    if (this.destroyed || this.expelledSelf) return
    this.bootAt = Date.now()
    if (!this.state) this.status = 'connecting'
    this.syncPeers()
    void this.sendIntentRaw?.({ t: 'need' })
    this.sendHelloRaw()
    this.reevaluate()
    this.onChange()
  }

  // ── wire io ────────────────────────────────────────────────────────────────

  private hello() {
    if (this.destroyed || this.expelledSelf || !this.selfPeer) return
    // No name yet → the UI is still asking. Stay silent rather than being
    // seated as a placeholder.
    if (!this.identity.name.trim()) return
    const me = this.me()
    if (this.acked && this.state && me && me.peerId === this.selfPeer) return
    this.sendHelloRaw()
  }

  private helloIntent(): Intent {
    return {
      t: 'hello',
      id: this.identity.id,
      name: this.identity.name,
      color: this.identity.color,
      spectator: this.joinAsSpectator,
    }
  }

  private sendHelloRaw() {
    const intent = this.helloIntent()
    // Always broadcast (peers may not have mapped us yet) AND, when we hold
    // authority, seat ourselves locally - a host never receives its own
    // wire messages, so without this it could never ack its own seat.
    void this.sendIntentRaw?.(intent)
    if (this.isHost && this.state) this.receiveIntent(intent, this.selfPeer)
  }

  send(i: Intent) {
    this.lastIntent = { i, at: Date.now() }
    // a voluntary exit must never read as an expulsion
    if (i.t === 'moderate' && i.m.op === 'leave' && i.m.target === this.identity.id) {
      this.wasAcked = false
      clearLastRoom(this.code)
    }
    if (this.isHost) {
      this.receiveIntent(i, this.selfPeer)
    } else {
      void this.sendIntentRaw?.(i)
      if (i.t === 'moderate' && i.m.op === 'rename' && i.m.target === this.identity.id) saveIdentityName(i.m.value)
      if (i.t === 'moderate' && i.m.op === 'recolor' && i.m.target === this.identity.id) saveIdentityColor(i.m.value)
    }
  }

  private broadcast() {
    if (this.state) {
      this.lastBroadcast = this.state.version
      void this.sendState?.(this.state)
    }
    this.onChange()
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null

  private persistFlush = () => {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    if (!this.state) return
    saveSnapshot(this.state)
    if (this.state.ownerId === this.identity.id) saveMySettings(this.state.settings)
  }

  private persistLocal() {
    if (!this.state) return
    // localStorage writes are synchronous and stall low-end devices during
    // bursts (typing, rapid actions) - coalesce into one trailing save that
    // flushes on tab close and room teardown
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(this.persistFlush, 350)
  }

  private receiveState(data: RoomState, peer: string) {
    if (this.destroyed || !isValidRoom(data, this.code)) return
    if (this.state && data.createdAt !== this.state.createdAt) return // foreign collision, ignore
    if (this.state && data.version < this.state.version) {
      // I hold a newer replica than the broadcaster - donate it if they host
      if (this.hostPeer && peer === this.hostPeer) {
        void this.sendIntentRaw?.({ t: 'sync', state: this.state }, { target: peer })
      }
      return
    }
    if (this.state && data.version === this.state.version) {
      // Same version from two authorities means a brief split brain. Only a
      // claiming host needs to resolve it: defer to the lower peer id and
      // stand down. Plain clients ignore it, so the host's 3s state pulse
      // cannot cause needless re-renders.
      if (this.isHost && peer && this.selfPeer && peer < this.selfPeer) {
        this.state = normalizeRoom(data)
        this.isHost = false
        this.persistLocal()
        this.reevaluate()
        this.onChange()
      }
      return
    }
    // a caretaker host might hold an older copy - adopt newer authoritative state
    this.state = normalizeRoom(data)
    this.persistLocal()
    if (this.status === 'connecting' || this.status === 'gone') this.status = 'online'
    this.reevaluate()
    this.onChange()
  }

  // ── host-side intent processing ────────────────────────────────────────────

  private commit(fn: (st: RoomState) => RoomState | null) {
    if (!this.state || !this.isHost) return
    try {
      const raw = fn(JSON.parse(JSON.stringify(this.state)) as RoomState)
      if (!raw) return
      const next = applyScores(normalizeRoom(raw))
      next.version = this.state.version + 1
      this.state = next
      this.persistLocal()
      this.broadcast()
    } catch (err) {
      console.error('council commit failed', err)
    }
  }

  private playerByPeer(peer: string): CouncilPlayer | null {
    return this.state?.players.find(p => p.peerId === peer) ?? null
  }

  private receiveIntent(i: Intent, fromPeer: string) {
    if (this.destroyed || !i || typeof i !== 'object' || typeof i.t !== 'string') return
    if (i.mid) {
      if (this.seenIntents.has(i.mid)) return
      this.seenIntents.set(i.mid, Date.now())
    }
    // host → peer notices still land when we are not hosting
    if (i.t === 'full') {
      if (!this.acked) { this.status = 'full'; this.onChange() }
      return
    }
    if (i.t === 'expelled') {
      this.markExpelled()
      return
    }
    if (!this.isHost || !this.state) return
    const st = this.state

    switch (i.t) {
      case 'hello': {
        const until = this.removedUntil.get(i.id)
        if (until && Date.now() < until) {
          // they have not registered the expulsion yet - tell them again
          if (fromPeer !== this.selfPeer) void this.sendIntentRaw?.({ t: 'expelled' }, { target: fromPeer })
          return
        }
        if (until) this.removedUntil.delete(i.id)
        const name = cleanName(String(i.name ?? '')).trim()
        // A member must have chosen a name before they can hold a seat.
        if (!name) return
        this.commit(s => {
          const existing = s.players.find(p => p.id === i.id)
          if (existing) {
            let color = isHex(existing.color) ? normHex(existing.color) : freeColor(s.players, existing.id)
            if (colorClash(s.players, color, existing.id)) color = freeColor(s.players, existing.id)
            return {
              ...s,
              players: s.players.map(p => p.id === existing.id
                ? { ...p, color, connected: true, offlineSince: null, peerId: fromPeer }
                : p),
            }
          }
          if (s.players.length >= MAX_PLAYERS) {
            void this.sendIntentRaw?.({ t: 'full' }, { target: fromPeer })
            return null
          }
          let color = isHex(i.color) ? normHex(i.color) : freeColor(s.players)
          if (colorClash(s.players, color)) color = freeColor(s.players)
          const isOwner = i.id === s.ownerId
          const np: CouncilPlayer = {
            id: i.id, name, color,
            isAdmin: isOwner, isOwner, isBot: false,
            isSpectator: i.spectator === true,
            connected: true, offlineSince: null, joinedAt: now(), peerId: fromPeer,
          }
          return { ...s, players: [...s.players, np] }
        })
        return
      }

      case 'need': {
        if (fromPeer !== this.selfPeer && this.state) {
          void this.sendState?.(this.state, { target: fromPeer })
        }
        return
      }

      case 'sync': {
        const inc = i.state
        if (isValidRoom(inc, st.code) && inc.createdAt === st.createdAt && inc.version > st.version) {
          this.state = inc
          this.persistLocal()
          this.broadcast()
        }
        return
      }

      case 'settings': {
        const sender = this.playerByPeer(fromPeer)
        if (!sender || !(sender.isAdmin || sender.isOwner)) return
        if (!GAMES[i.game]) return
        const active = activeSeated(st.players).length
        const clean = sanitizeSettings(i.game, i.settings, Math.max(active, 3))
        this.commit(s => s.phase === 'lobby'
          ? { ...s, settings: { ...s.settings, [i.game]: clean as never } }
          : { ...s, settings: { ...s.settings, [i.game]: clean as never } })
        return
      }

      case 'select': {
        const sender = this.playerByPeer(fromPeer)
        if (!sender || !(sender.isAdmin || sender.isOwner) || !GAMES[i.game]) return
        this.commit(s => s.phase === 'lobby' ? { ...s, selectedGame: i.game } : s)
        return
      }

      case 'start': {
        const sender = this.playerByPeer(fromPeer)
        if (!sender || !(sender.isAdmin || sender.isOwner)) return
        this.commit(s => {
          const active = activeSeated(s.players)
          // reconvene: same game again straight from the results screen
          if (s.phase === 'game' && s.game && (s.gameState as { stage?: string } | null)?.stage === 'over') {
            const mod = GAMES[s.game]
            if (mod.canStart(active, s.settings) !== null) return { ...s, phase: 'lobby', game: null, gameState: null }
            return { ...s, gameState: mod.init(active, s.settings) }
          }
          if (s.phase !== 'lobby') return null
          const mod = GAMES[s.selectedGame]
          if (mod.canStart(active, s.settings) !== null) return null
          return { ...s, phase: 'game', game: s.selectedGame, gameState: mod.init(active, s.settings) }
        })
        return
      }

      case 'toLobby': {
        const sender = this.playerByPeer(fromPeer)
        if (!sender || !(sender.isAdmin || sender.isOwner)) return
        this.commit(s => s.phase === 'game' ? { ...s, phase: 'lobby', game: null, gameState: null } : null)
        return
      }

      case 'endGame': {
        const sender = this.playerByPeer(fromPeer)
        if (!sender || !(sender.isAdmin || sender.isOwner)) return
        this.commit(s => {
          if (s.phase !== 'game' || !s.gameState) return null
          const gs = s.gameState as { stage?: string; winner?: unknown }
          if (gs.stage === 'over') return null
          return { ...s, gameState: { ...gs, stage: 'over', winner: null, endsAt: null } }
        })
        return
      }

      case 'skip': {
        const sender = this.playerByPeer(fromPeer)
        if (!sender || !(sender.isAdmin || sender.isOwner)) return
        this.commit(s => {
          if (s.phase !== 'game' || !s.game || !s.gameState) return null
          const ns = GAMES[s.game].skip(s.gameState, s.players)
          return ns ? { ...s, gameState: ns } : null
        })
        return
      }

      case 'action': {
        this.commit(s => {
          if (s.phase !== 'game' || !s.game || !s.gameState) return null
          const sender = this.playerByPeer(fromPeer)
          if (!sender) return null
          const actor = s.players.find(p => p.id === i.actor)
          if (!actor) return null
          const privileged = sender.isAdmin || sender.isOwner
          const canControl = actor.id === sender.id || (privileged && (actor.isBot || !actor.connected))
          if (!canControl) return null
          // A spectator holds no seat, so they can never act - not even for
          // themselves, and admins cannot proxy a move onto them.
          if (actor.isSpectator) return null
          const ns = GAMES[s.game].act(s.gameState, actor.id, s.players, i.action)
          return ns ? { ...s, gameState: ns } : null
        })
        return
      }

      case 'moderate': {
        this.handleModerate(i.m, fromPeer)
        return
      }
    }
  }

  private handleModerate(m: ModerateOp, fromPeer: string) {
    const st = this.state!
    const sender = this.playerByPeer(fromPeer)
    if (!sender) return
    const sAdmin = sender.isAdmin || sender.isOwner

    const removePlayer = (target: Id) => this.commit(s => {
      const players = s.players.filter(p => p.id !== target)
      let gameState = s.gameState
      if (s.game && gameState) gameState = GAMES[s.game].playerRemoved(gameState, target, players) ?? gameState
      return { ...s, players, gameState }
    })

    switch (m.op) {
      case 'kick': {
        const target = st.players.find(p => p.id === m.target)
        if (!target || target.isOwner || target.id === sender.id) return
        if (!sender.isOwner && !(sender.isAdmin && !target.isAdmin)) return
        this.removedUntil.set(m.target, Date.now() + KICK_DEBOUNCE_MS)
        if (target.peerId) void this.sendIntentRaw?.({ t: 'expelled' }, { target: target.peerId })
        removePlayer(m.target)
        return
      }
      case 'leave': {
        if (m.target !== sender.id) return
        removePlayer(m.target)
        return
      }
      case 'promote': {
        const target = st.players.find(p => p.id === m.target)
        if (!sender.isOwner || !target || target.isOwner) return
        this.commit(s => ({ ...s, players: s.players.map(p => p.id === m.target ? { ...p, isAdmin: true } : p) }))
        return
      }
      case 'demote': {
        const target = st.players.find(p => p.id === m.target)
        if (!sender.isOwner || !target || target.isOwner) return
        this.commit(s => ({ ...s, players: s.players.map(p => p.id === m.target ? { ...p, isAdmin: false } : p) }))
        return
      }
      case 'rename': {
        const target = st.players.find(p => p.id === m.target)
        if (!target) return
        const ok = target.id === sender.id || sender.isOwner || (sAdmin && !target.isAdmin && !target.isOwner)
        if (!ok) return
        const name = String(m.value).toUpperCase().replace(/[^A-Z0-9 \-_.[\]]/g, '').slice(0, 14)
        if (!name) return
        this.commit(s => ({ ...s, players: s.players.map(p => p.id === m.target ? { ...p, name } : p) }))
        return
      }
      case 'recolor': {
        const target = st.players.find(p => p.id === m.target)
        if (!target || !isHex(m.value)) return
        const ok = target.id === sender.id || sender.isOwner || (sAdmin && !target.isAdmin && !target.isOwner)
        if (!ok) return
        const color = normHex(m.value)
        if (colorClash(st.players, color, m.target)) return
        this.commit(s => ({ ...s, players: s.players.map(p => p.id === m.target ? { ...p, color } : p) }))
        return
      }
      case 'addBot': {
        if (!sAdmin) return
        this.commit(s => {
          if (s.players.length >= MAX_PLAYERS) return null
          const bot: CouncilPlayer = {
            id: `bot-${uid(6)}`,
            name: botName(s.players),
            color: freeColor(s.players),
            isAdmin: false, isOwner: false, isBot: true,
            isSpectator: false,
            connected: false, offlineSince: null, joinedAt: now() + 1, peerId: null,
          }
          return { ...s, players: [...s.players, bot] }
        })
        return
      }
      case 'removeBot': {
        if (!sAdmin) return
        const target = st.players.find(p => p.id === m.target)
        if (!target?.isBot) return
        removePlayer(m.target)
        return
      }
      case 'spectate': {
        const target = st.players.find(p => p.id === m.target)
        if (!target || target.isBot) return
        // yourself always; admins may seat/bench others, never the owner
        const allowed = target.id === sender.id ||
          (sAdmin && !target.isOwner && (sender.isOwner || !target.isAdmin))
        if (!allowed) return
        const value = m.value === true
        if (target.isSpectator === value) return
        this.commit(s => {
          const players = s.players.map(p => p.id === m.target ? { ...p, isSpectator: value } : p)
          // Leaving the table mid-game must not freeze that game.
          let gameState = s.gameState
          if (value && s.game && gameState) {
            gameState = GAMES[s.game].playerRemoved(gameState, m.target, players) ?? gameState
          }
          return { ...s, players, gameState }
        })
        return
      }
      case 'showScores': {
        if (!sAdmin) return
        this.commit(s => ({ ...s, showScores: m.value === true }))
        return
      }
      case 'resetScores': {
        if (!sAdmin) return
        this.commit(s => ({ ...s, scores: {} }))
        return
      }
      case 'setTeam': {
        const target = st.players.find(p => p.id === m.target)
        if (!target) return
        const isFree = st.teams?.freeMovement && sender.id === target.id
        if (!sAdmin && !isFree) return
        const team = typeof m.team === 'number' ? Math.max(0, m.team) : null
        this.commit(s => ({
          ...s,
          players: s.players.map(p => p.id === m.target ? { ...p, team } : p),
        }))
        return
      }
      case 'setTeamCount': {
        if (!sAdmin) return
        const count = Math.max(2, Math.min(MAX_PLAYERS, Math.floor(m.count)))
        this.commit(s => ({
          ...s,
          teams: {
            count,
            freeMovement: s.teams?.freeMovement ?? false,
          },
          players: s.players.map(p => (typeof p.team === 'number' && p.team >= count) ? { ...p, team: count - 1 } : p),
        }))
        return
      }
      case 'setFreeMovement': {
        if (!sAdmin) return
        this.commit(s => ({
          ...s,
          teams: {
            count: s.teams?.count ?? 2,
            freeMovement: m.value === true,
          },
        }))
        return
      }
      case 'randomizeTeams': {
        if (!sAdmin) return
        this.commit(s => {
          const numTeams = s.teams?.count ?? 2
          const active = activeSeated(s.players)
          const shuffled = shuffle(active)
          const teamMap = new Map<Id, number>()
          shuffled.forEach((p: CouncilPlayer, idx: number) => {
            teamMap.set(p.id, idx % numTeams)
          })
          return {
            ...s,
            players: s.players.map(p => ({
              ...p,
              team: teamMap.has(p.id) ? teamMap.get(p.id)! : (p.isSpectator ? null : p.team ?? 0),
            })),
          }
        })
        return
      }
    }
  }

  // ── host timer duties ──────────────────────────────────────────────────────

  /**
   * Self-healing pulse. WebRTC datachannel messages can be dropped during
   * renegotiation, so rather than assume delivery we re-assert state (host)
   * or re-ask for it (client) on a slow cadence until everyone agrees.
   */
  private pulse() {
    if (this.destroyed || this.expelledSelf || !this.selfPeer) return
    this.syncPeers()
    const seenCutoff = Date.now() - 1000 * 60 * 5
    for (const [id, at] of this.seenIntents) if (at < seenCutoff) this.seenIntents.delete(id)

    if (this.isHost) {
      const live = this.livePeers()
      const nowTs = Date.now()
      for (const peer of live) this.peerLastSeen.set(peer, nowTs)

      // Reachable on EITHER transport, with hysteresis: coming back is applied
      // at once, going away must persist. Otherwise our own wobble rewrites
      // the whole roster twice and every client re-renders the table.
      const reachable = (peerId: string | null) => {
        if (!peerId) return false
        if (live.has(peerId)) return true
        const seen = this.peerLastSeen.get(peerId)
        return seen !== undefined && nowTs - seen < PRESENCE_GRACE_MS
      }

      // If we can suddenly see nobody at all, the isolated party is almost
      // certainly us. Never mass-evict the table on our own dip.
      const knownPeers = this.state
        ? this.state.players.filter(p => !p.isBot && p.peerId && p.id !== this.identity.id).length
        : 0
      const selfIsolated = knownPeers > 0 && live.size <= 1

      if (this.state && !selfIsolated) {
        const presenceChanged = this.state.players.some(p =>
          !p.isBot && p.id !== this.identity.id && p.connected !== reachable(p.peerId),
        )
        if (presenceChanged) {
          this.commit(st => ({
            ...st,
            players: st.players.map(p => {
              if (p.isBot || p.id === this.identity.id) return p
              const on = reachable(p.peerId)
              if (on === p.connected) return p
              return { ...p, connected: on, offlineSince: on ? null : now() }
            }),
          }))
          return
        }
      }
      // Careless floods waste bandwidth, but the host must never go quiet.
      // Re-assert whenever the version moves, and keep a slow keepalive for
      // peers that missed a direct datachannel update entirely.
      if (this.state && live.size > 1) {
        this.pulseTick++
        const changed = this.state.version !== this.lastBroadcast
        if (changed || this.pulseTick % 4 === 0) {
          this.lastBroadcast = this.state.version
          void this.sendState?.(this.state)
        }
      }
      // drop expired kick debounces
      const nowMs = Date.now()
      for (const [id, until] of this.removedUntil) if (nowMs >= until) this.removedUntil.delete(id)
      return
    }

    // not hosting: make sure we have a record and a seat
    if (!this.state) {
      void this.sendIntentRaw?.({ t: 'need' })
      return
    }
    if (!this.acked) this.sendHelloRaw()
  }

  private tickHost() {
    if (this.destroyed || !this.isHost || !this.state?.gameState || !this.state.game) return
    this.commit(s => {
      if (!s.game || !s.gameState) return null
      // Someone who walked to the gallery mid-game must not stall their own
      // turn: present them to the rules engine as absent so it auto-advances.
      const roster = s.players.map(p =>
        p.isSpectator ? { ...p, connected: false, isBot: false, offlineSince: 0 } : p,
      )
      const ns = GAMES[s.game].tick(s.gameState, now(), roster)
      return ns ? { ...s, gameState: ns } : null
    })
  }

  // ── public snapshot ────────────────────────────────────────────────────────

  snapshot(): CouncilSnap {
    return {
      status: this.status,
      state: this.state,
      selfPeer: this.selfPeer,
      hostPeer: this.hostPeer,
      isHost: this.isHost,
      peerCount: Math.max(0, this.livePeers().size - 1),
      relayReady: this.relay?.connectedCount ?? 0,
      acked: this.acked,
      myId: this.identity.id,
      searchingMs: Date.now() - this.bootAt,
    }
  }
}

// ─── react binding ───────────────────────────────────────────────────────────

const sameSnap = (a: CouncilSnap, b: CouncilSnap) =>
  a.status === b.status &&
  a.state === b.state &&
  a.isHost === b.isHost &&
  a.acked === b.acked &&
  a.hostPeer === b.hostPeer &&
  a.peerCount === b.peerCount &&
  a.myId === b.myId &&
  a.selfPeer === b.selfPeer &&
  a.relayReady === b.relayReady

export function useCouncil(code: string, requestedCreate?: PendingCreate | null): CouncilApi {
  const [snap, setSnap] = useState<CouncilSnap>(() => ({
    status: 'boot', state: null, selfPeer: '', hostPeer: null,
    isHost: false, peerCount: 0, acked: false, myId: '', searchingMs: 0, relayReady: 0,
  }))
  const ref = useRef<CouncilEngine | null>(null)
  const createRef = useRef<PendingCreate | null>(requestedCreate ?? null)

  useEffect(() => {
    const engine = new CouncilEngine(code.toUpperCase(), () => {
      // skip no-op notifications so heartbeats don't re-render the tree;
      // transition priority keeps typing and scrolling smooth under bursts
      const next = engine.snapshot()
      startTransition(() => {
        setSnap(prev => (sameSnap(prev, next) ? prev : next))
      })
    }, createRef.current)
    ref.current = engine
    void engine.start()
    return () => { engine.destroy(); ref.current = null }
  }, [code])

  return useMemo<CouncilApi>(() => ({
    ...snap,
    sendAction: (action, actor) => ref.current?.send({ t: 'action', actor: actor ?? snap.myId, action }),
    sendSettings: (game, settings) => ref.current?.send({ t: 'settings', game, settings }),
    selectGame: (game) => ref.current?.send({ t: 'select', game }),
    startGame: () => ref.current?.send({ t: 'start' }),
    toLobby: () => ref.current?.send({ t: 'toLobby' }),
    endGame: () => ref.current?.send({ t: 'endGame' }),
    skipStage: () => ref.current?.send({ t: 'skip' }),
    moderate: (m) => ref.current?.send({ t: 'moderate', m }),
    leave: () => { ref.current?.send({ t: 'moderate', m: { op: 'leave', target: snap.myId } }) },
    retry: () => ref.current?.retry(),
    applyProfile: (opts) => ref.current?.applyProfile(opts),
    setSpectating: (value, target) =>
      ref.current?.send({ t: 'moderate', m: { op: 'spectate', target: target ?? snap.myId, value } }),
  }), [snap])
}

export const newCouncilCode = roomCode
export { clamp }
