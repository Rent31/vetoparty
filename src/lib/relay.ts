'use client'

// ─── VETO PARTY · encrypted relay mesh ───────────────────────────────────────
//
// Trystero/WebRTC stays the preferred transport. Some NATs cannot establish
// ANY direct route without TURN, so this mesh mirrors control/state packets
// through redundant public MQTT-over-WebSocket brokers (port 443 all the way,
// no UDP, no NAT traversal).
//
// Brokers see only:
//   • an opaque SHA-256 topic
//   • AES-GCM ciphertext with an ECDSA signature
// They never see names, votes, secrets, game state, or room codes.
//
// The room code is the shared passphrase. Party-game room codes are not meant
// as high-security passwords; WebRTC remains end-to-end DTLS.

import { APP_ID, uid } from './core'
import { MqttLite } from './mqttlite'

export type RelayKind = 'state' | 'intent' | 'presence'

interface PlainEnvelope {
  v: 1
  id: string
  from: string
  target?: string
  kind: RelayKind
  sentAt: number
  data: unknown
}

interface CipherEnvelope {
  v: 2
  iv: string
  body: string
  pub: string   // sender's public key (SPKI, base64)
  sig: string   // ECDSA P-256 signature over iv||body
}

export interface RelayMessage {
  id: string
  from: string
  target?: string
  kind: RelayKind
  data: unknown
}

interface BrokerState {
  url: string
  ml: MqttLite
  ready: boolean
}

/**
 * Five entry points across THREE independent operators (verified by
 * cross-publish testing: the EMQX pair share a cluster, as do the HiveMQ
 * pair, so they are extra ingress rather than extra failure domains).
 * All are WSS on HTTPS-friendly ports - no UDP, no NAT traversal.
 */
const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',       // EMQX
  'wss://broker.hivemq.com:8884/mqtt',    // HiveMQ
  'wss://test.mosquitto.org:8081/mqtt',   // Mosquitto (independent)
  'wss://broker-cn.emqx.io:8084/mqtt',    // EMQX alt ingress
  'wss://mqtt-dashboard.com:8884/mqtt',   // HiveMQ alt ingress
]

const BROKERS = (process.env.NEXT_PUBLIC_RELAY_BROKERS
  ? process.env.NEXT_PUBLIC_RELAY_BROKERS.split(';').map(u => u.trim()).filter(Boolean)
  : DEFAULT_BROKERS).slice(0, 5)

const bytesTo64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const b64ToBytes = (s: string) => {
  const binary = atob(s)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

async function digest(s: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
}

async function roomKey(code: string): Promise<CryptoKey> {
  const material = await digest(`${APP_ID}:relay-key:${code.toUpperCase()}`)
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

async function roomTopic(code: string): Promise<string> {
  const hash = await digest(`${APP_ID}:relay-topic:${code.toUpperCase()}`)
  return `vp/${bytesTo64(hash.subarray(0, 20)).replace(/[+/=]/g, '')}`
}

const SIG_ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIG_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const

async function makeSigningKeys() {
  const pair = await crypto.subtle.generateKey(SIG_ALG, false, ['sign', 'verify'])
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  return { priv: pair.privateKey, pub: bytesTo64(spki) }
}

const verifyKeyCache = new Map<string, CryptoKey>()
async function importVerifyKey(pub: string): Promise<CryptoKey | null> {
  const hit = verifyKeyCache.get(pub)
  if (hit) return hit
  try {
    const key = await crypto.subtle.importKey('spki', b64ToBytes(pub), SIG_ALG, false, ['verify'])
    if (verifyKeyCache.size > 200) verifyKeyCache.clear()
    verifyKeyCache.set(pub, key)
    return key
  } catch {
    return null
  }
}

function signedBytes(iv: string, body: string) {
  return new TextEncoder().encode(`${iv}.${body}`)
}

async function encrypt(
  key: CryptoKey,
  signing: { priv: CryptoKey; pub: string },
  plain: PlainEnvelope,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const bytes = new TextEncoder().encode(JSON.stringify(plain))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)
  const ivB64 = bytesTo64(iv)
  const bodyB64 = bytesTo64(new Uint8Array(encrypted))
  const sig = new Uint8Array(
    await crypto.subtle.sign(SIG_PARAMS, signing.priv, signedBytes(ivB64, bodyB64)),
  )
  const wire: CipherEnvelope = { v: 2, iv: ivB64, body: bodyB64, pub: signing.pub, sig: bytesTo64(sig) }
  return JSON.stringify(wire)
}

async function decrypt(
  key: CryptoKey,
  raw: Uint8Array,
): Promise<{ msg: PlainEnvelope; pub: string } | null> {
  try {
    if (raw.byteLength > 1_000_000) return null
    const wire = JSON.parse(new TextDecoder().decode(raw)) as CipherEnvelope
    if (
      wire.v !== 2 || typeof wire.iv !== 'string' || typeof wire.body !== 'string' ||
      typeof wire.pub !== 'string' || typeof wire.sig !== 'string'
    ) return null

    // Verify BEFORE decrypting so forged packets never reach the cipher.
    const verifyKey = await importVerifyKey(wire.pub)
    if (!verifyKey) return null
    const ok = await crypto.subtle.verify(
      SIG_PARAMS,
      verifyKey,
      b64ToBytes(wire.sig),
      signedBytes(wire.iv, wire.body),
    )
    if (!ok) return null

    const clear = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBytes(wire.iv) },
      key,
      b64ToBytes(wire.body),
    )
    const msg = JSON.parse(new TextDecoder().decode(clear)) as PlainEnvelope
    if (
      msg.v !== 1 || typeof msg.id !== 'string' || typeof msg.from !== 'string' ||
      !['state', 'intent', 'presence'].includes(msg.kind)
    ) return null
    const age = Date.now() - Number(msg.sentAt)
    const maxAge = msg.kind === 'state' ? 1000 * 60 * 60 * 12 : 1000 * 60 * 2
    if (!Number.isFinite(age) || age < -60_000 || age > maxAge) return null
    return { msg, pub: wire.pub }
  } catch {
    return null
  }
}

export class EncryptedRelay {
  private code: string
  private self: string
  private onMessage: (m: RelayMessage) => void
  private onStatus: () => void
  private key: CryptoKey | null = null
  private topic = ''
  private brokers: BrokerState[] = []
  private stopped = false
  private seen = new Map<string, number>()
  private rxQueue: Promise<void> = Promise.resolve()
  private senderKeys = new Map<string, string>()
  private presenceTimer: ReturnType<typeof setInterval> | null = null
  private outbox: { kind: RelayKind; data: unknown; target?: string; id: string; retain?: boolean }[] = []
  private latestState: { data: unknown; id: string } | null = null
  /** Pending repeat timers for state packets, so stale ones can be dropped. */
  private stateRepeats: ReturnType<typeof setTimeout>[] = []

  constructor(
    code: string,
    self: string,
    onMessage: (m: RelayMessage) => void,
    onStatus: () => void,
  ) {
    this.code = code
    this.self = self
    this.onMessage = onMessage
    this.onStatus = onStatus
  }

  get connected() { return this.brokers.some(b => b.ready) }
  get connectedCount() { return this.brokers.filter(b => b.ready).length }

  async start() {
    try {
      const [key, topic, signing] = await Promise.all([
        roomKey(this.code),
        roomTopic(this.code),
        makeSigningKeys(),
      ])
      if (this.stopped) return
      this.key = key
      this.topic = topic
      this.signingKey = signing

      for (const url of BROKERS) {
        try {
          const ml = new MqttLite(url, { keepAlive: 20, connectTimeout: 9000 })
          const state: BrokerState = { url, ml, ready: false }
          this.brokers.push(state)

          ml.onLive = live => {
            if (this.stopped) return
            const was = state.ready
            state.ready = live
            if (live && !was) {
              void this.send('presence', null)
              this.flush()
              if (this.latestState) {
                void this.publishOne(state, 'state', this.latestState.data, undefined, this.latestState.id, true)
              }
            }
            if (live !== was) this.onStatus()
          }
          ml.onMessage = payload => this.receive(payload)
          // subscribe() opens the connection itself and re-subscribes after
          // every reconnect - this is the subscription, not only a listener.
          void ml.subscribe(topic)
        } catch { /* next broker */ }
      }

      this.presenceTimer = setInterval(() => {
        this.pruneSeen()
        void this.send('presence', null)
      }, 4000)
    } catch (err) {
      console.warn('[relay] unavailable; WebRTC still active', err)
    }
  }

  private signingKey: { priv: CryptoKey; pub: string } | null = null

  async send(kind: RelayKind, data: unknown, target?: string, id = uid(12), retain = false) {
    if (this.stopped) return id
    if (kind === 'state' && retain && !target) this.latestState = { data, id }
    if (!this.key || !this.signingKey || !this.topic || !this.connected) {
      // Keep only useful recent packets; presence can be regenerated.
      if (kind !== 'presence') {
        this.outbox.push({ kind, data, target, id, retain })
        if (this.outbox.length > 40) this.outbox.shift()
      }
      return id
    }
    // Every packet goes to EVERY ready endpoint. Volume here is tiny and it
    // eliminates the disjoint-ingress failure (sender's brokers ≠ receiver's).
    await Promise.allSettled(
      this.brokers.filter(b => b.ready).map(b => this.publishOne(b, kind, data, target, id, retain)),
    )
    // End-to-end repetition across reconnect windows; recipients deduplicate.
    if (kind !== 'presence') {
      // A newer state supersedes an older one, so repeating the old packet is
      // pure waste. Drop queued state repeats whenever fresher state arrives.
      if (kind === 'state') {
        for (const t of this.stateRepeats) clearTimeout(t)
        this.stateRepeats = []
      }
      for (const delay of [750, 2400]) {
        const timer = setTimeout(() => {
          if (this.stopped || !this.key || !this.signingKey || !this.topic) return
          for (const b of this.brokers) {
            if (b.ready) void this.publishOne(b, kind, data, target, id, retain)
          }
        }, delay)
        if (kind === 'state') this.stateRepeats.push(timer)
      }
    }
    return id
  }

  private async publishOne(
    broker: BrokerState,
    kind: RelayKind,
    data: unknown,
    target: string | undefined,
    id: string,
    retain: boolean,
  ) {
    if (this.stopped || !this.key || !this.signingKey || !this.topic || !broker.ready) return
    const plain: PlainEnvelope = { v: 1, id, from: this.self, target, kind, sentAt: Date.now(), data }
    const wire = await encrypt(this.key, this.signingKey, plain)
    if (retain && kind === 'state') {
      // Live packet for current members + retained twin for late join/refresh
      // (public brokers occasionally ACK a retained write without fanning it
      // out to already-subscribed clients).
      await broker.ml.publish(this.topic, wire, { qos: 1, retain: false })
      await broker.ml.publish(this.topic, wire, { qos: 1, retain: true })
    } else {
      await broker.ml.publish(this.topic, wire, { qos: 1, retain: false })
    }
  }

  private flush() {
    if (!this.connected || !this.outbox.length) return
    const queued = this.outbox.splice(0)
    for (const q of queued) void this.send(q.kind, q.data, q.target, q.id, q.retain)
  }

  private receive(raw: Uint8Array) {
    // Verify-and-pin must not race: WebCrypto is async and mirrored copies
    // would otherwise interleave against the sender-key compare-and-set.
    this.rxQueue = this.rxQueue.then(() => this.process(raw).catch(() => undefined))
  }

  private async process(raw: Uint8Array) {
    if (this.stopped || !this.key) return
    const verified = await decrypt(this.key, raw)
    if (!verified) return
    const { msg, pub } = verified
    if (msg.from === this.self) return
    if (msg.target && msg.target !== this.self) return

    // Trust-on-first-use: pin each sender to the signing key it first used so
    // another room member cannot forge its identity (they all share the AES
    // key, so encryption alone cannot stop impersonation).
    const pinned = this.senderKeys.get(msg.from)
    if (pinned && pinned !== pub) return
    if (!pinned) this.senderKeys.set(msg.from, pub)

    if (this.seen.has(msg.id)) return // mirrored across the relay mesh
    this.seen.set(msg.id, Date.now())
    this.onMessage({ id: msg.id, from: msg.from, target: msg.target, kind: msg.kind, data: msg.data })
  }

  private pruneSeen() {
    const cutoff = Date.now() - 1000 * 60 * 5
    for (const [id, at] of this.seen) if (at < cutoff) this.seen.delete(id)
  }

  stop() {
    this.stopped = true
    if (this.presenceTimer) clearInterval(this.presenceTimer)
    this.presenceTimer = null
    for (const b of this.brokers) {
      try { b.ml.end() } catch { /* noop */ }
    }
    for (const t of this.stateRepeats) clearTimeout(t)
    this.stateRepeats = []
    this.brokers = []
    this.outbox = []
    this.latestState = null
    this.senderKeys.clear()
  }
}
