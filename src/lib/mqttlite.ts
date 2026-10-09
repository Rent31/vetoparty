// ─── VETO PARTY · minimal MQTT 3.1.1 client over WebSocket ─────────────────
//
// mqtt.js does not survive browser bundling (silent runtime failure), so this
// is a purpose-built, zero-dependency transport using only the browser-native
// WebSocket. Supports exactly what Veto Party needs:
//   CONNECT / CONNACK · SUBSCRIBE / SUBACK · PUBLISH / PUBACK (QoS 0 & 1)
//   retained publishes · keepalive pings · auto-reconnect & resubscribe
//
// Packet format: https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html

export interface MqttLiteOptions {
  keepAlive?: number          // seconds
  connectTimeout?: number     // ms until CONNACK wait fails
  clientId?: string
}

type SubWaiter = { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
type PubWaiter = { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }

const PROTOCOL = 'mqtt'
const enc = new TextEncoder()
const dec = new TextDecoder()

function remainingLength(n: number): number[] {
  const out: number[] = []
  do {
    let d = n % 128
    n = Math.floor(n / 128)
    if (n > 0) d |= 0x80
    out.push(d)
  } while (n > 0)
  return out
}

function strBytes(s: string): number[] {
  const u = enc.encode(s)
  return [(u.length >> 8) & 0xff, u.length & 0xff, ...u]
}

export class MqttLite {
  url: string
  private opts: Required<Pick<MqttLiteOptions, 'keepAlive' | 'connectTimeout'>> & MqttLiteOptions
  private ws: WebSocket | null = null
  private pid = 1
  private ended = false
  private isOpen = false
  private currentTopic: string | null = null
  private openWaiters: ((ok: boolean) => void)[] = []
  private subWaiters = new Map<number, SubWaiter>()
  private pubWaiters = new Map<number, PubWaiter>()
  private rx = new Uint8Array(0)
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelay = 1200
  private lastRx = 0

  /** fired when the client becomes CONNACK-open and SUBACK-subscribed */
  onLive: ((live: boolean) => void) | null = null
  /** incoming frame on the subscribed topic */
  onMessage: ((payload: Uint8Array, retained: boolean) => void) | null = null

  constructor(url: string, opts: MqttLiteOptions = {}) {
    this.url = url
    this.opts = { keepAlive: 20, connectTimeout: 9000, ...opts }
  }

  get live() { return this.isOpen && (this.currentTopic === null || this.isSubscribed) }
  get isSubscribed() { return this.currentTopic !== null && this.subscribedTopic === this.currentTopic }
  private subscribedTopic: string | null = null

  // ── lifecycle ─────────────────────────────────────────────────────────────

  start() {
    if (this.ws || this.ended) return
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url, PROTOCOL)
      ws.binaryType = 'arraybuffer'
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    this.rx = new Uint8Array(0)
    this.isOpen = false

    const connackTimer = setTimeout(() => {
      try { ws.close() } catch { /* noop */ }
      this.handleClose()
    }, this.opts.connectTimeout)

    ws.onopen = () => {
      this.sendRaw(this.connectPacket())
    }
    ws.onmessage = (ev) => {
      void this.handleData(ev.data).then(gotConnack => {
        if (gotConnack === 'connack') {
          clearTimeout(connackTimer)
          this.isOpen = true
          this.lastRx = Date.now()
          this.retryDelay = 1200
          this.startPingTimers()
          for (const w of this.openWaiters.splice(0)) w(true)
          if (this.currentTopic && this.subscribedTopic !== this.currentTopic) {
            void this.subscribe(this.currentTopic)
          }
          this.onLive?.(this.live)
        } else if (gotConnack === 'connack-fail') {
          clearTimeout(connackTimer)
          try { ws.close() } catch { /* noop */ }
          this.handleClose()
          for (const w of this.openWaiters.splice(0)) w(false)
        }
      })
    }
    ws.onerror = () => {
      // 'error' is always followed by 'close' in browsers - close does the work
    }
    ws.onclose = () => {
      clearTimeout(connackTimer)
      this.handleClose()
    }
  }

  end() {
    this.ended = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.isOpen = false
    this.subscribedTopic = null
    this.stopPingTimers()
    for (const [id, w] of this.subWaiters) { clearTimeout(w.timer); w.resolve(false); this.subWaiters.delete(id) }
    for (const [id, w] of this.pubWaiters) { clearTimeout(w.timer); w.resolve(false); this.pubWaiters.delete(id) }
    for (const w of this.openWaiters.splice(0)) w(false)
    try { this.ws?.close() } catch { /* noop */ }
    this.ws = null
    this.onLive?.(false)
  }

  private scheduleReconnect() {
    if (this.ended || this.reconnectTimer) return
    const delay = this.retryDelay + Math.random() * 900
    this.retryDelay = Math.min(8000, Math.round(this.retryDelay * 1.6))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.ended) this.start()
    }, delay)
  }

  private handleClose() {
    const wasLive = this.live
    this.isOpen = false
    this.subscribedTopic = null
    this.stopPingTimers()
    // fail outstanding request/response pairs so callers retry on next open
    for (const [id, w] of this.subWaiters) { clearTimeout(w.timer); w.resolve(false); this.subWaiters.delete(id) }
    for (const [id, w] of this.pubWaiters) { clearTimeout(w.timer); w.resolve(false); this.pubWaiters.delete(id) }
    this.ws = null
    if (wasLive) this.onLive?.(false)
    else this.onLive?.(false)
    if (!this.ended) this.scheduleReconnect()
  }

  // ── public api ────────────────────────────────────────────────────────────

  waitOpen(timeoutMs = 9000): Promise<boolean> {
    if (this.isOpen) return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      this.openWaiters.push(ok => { clearTimeout(timer); resolve(ok) })
      this.start()
    })
  }

  async subscribe(topic: string, qos = 1): Promise<boolean> {
    this.currentTopic = topic
    if (this.ended) return false
    const open = await this.waitOpen(this.opts.connectTimeout)
    if (!open) return false
    const pid = this.nextPid()
    // pid(2) + topic filter (2 + len) + requested qos(1)
    const packet = [
      0x82,
      ...remainingLength(2 + (2 + topic.length) + 1),
      (pid >> 8) & 0xff, pid & 0xff,
      ...strBytes(topic),
      qos,
    ]
    const ok = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { this.subWaiters.delete(pid); resolve(false) }, 8000)
      this.subWaiters.set(pid, { resolve, timer })
      this.sendRaw(packet)
    })
    if (ok) {
      this.subscribedTopic = topic
      this.onLive?.(true)
    }
    return ok
  }

  publish(topic: string, payload: Uint8Array | string, opts: { qos?: 0 | 1; retain?: boolean } = {}): Promise<boolean> {
    const qos = opts.qos ?? 1
    const retain = !!opts.retain
    if (!this.isOpen || !this.ws) return Promise.resolve(false)
    const bytes = typeof payload === 'string' ? enc.encode(payload) : payload
    let b0 = 0x30 | (retain ? 0x01 : 0)
    let pid = 0
    let head: number[] = []
    if (qos === 1) {
      b0 |= 0x02
      pid = this.nextPid()
      head = [(pid >> 8) & 0xff, pid & 0xff]
    }
    const body: number[] = [...strBytes(topic), ...head, ...bytes]
    const full = [b0, ...remainingLength(body.length), ...body]
    if (qos === 0) {
      this.sendRaw(full)
      return Promise.resolve(true)
    }
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { this.pubWaiters.delete(pid); resolve(false) }, 5000)
      this.pubWaiters.set(pid, { resolve, timer })
      this.sendRaw(full)
    })
  }

  // ── frame io ──────────────────────────────────────────────────────────────

  private sendRaw(bytes: number[]) {
    if (!this.ws || this.ws.readyState !== 1) return
    try { this.ws.send(new Uint8Array(bytes)) } catch { /* close handles it */ }
  }

  private nextPid() {
    const p = this.pid++
    if (this.pid > 0xffff) this.pid = 1
    return p
  }

  private connectPacket(): number[] {
    const clientId = this.opts.clientId ?? `ml${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`
    const keep = this.opts.keepAlive
    const varHeader = [ ...strBytes('MQTT'), 0x04, 0x02, (keep >> 8) & 0xff, keep & 0xff ]
    const payload = strBytes(clientId)
    return [0x10, ...remainingLength(varHeader.length + payload.length), ...varHeader, ...payload]
  }

  // Returns 'connack' | 'connack-fail' | null to signal ws.onmessage handler
  private async handleData(data: unknown): Promise<'connack' | 'connack-fail' | null> {
    this.lastRx = Date.now()
    let chunk: Uint8Array
    if (data instanceof ArrayBuffer) chunk = new Uint8Array(data)
    else if (data instanceof Blob) chunk = new Uint8Array(await data.arrayBuffer())
    else if (typeof data === 'string') chunk = enc.encode(data)
    else return null
    const merged = new Uint8Array(this.rx.length + chunk.length)
    merged.set(this.rx, 0)
    merged.set(chunk, this.rx.length)
    this.rx = merged

    let result: 'connack' | 'connack-fail' | null = null
    for (;;) {
      if (this.rx.length < 2) break
      const b0 = this.rx[0]
      // remaining length varint
      let mult = 1, len = 0, i = 1
      for (;;) {
        if (i >= this.rx.length) break
        const d = this.rx[i++]
        len += (d & 0x7f) * mult
        if ((d & 0x80) === 0) break
        mult *= 128
        if (mult > 128 * 128 * 128) return null // malformed
      }
      if (i > this.rx.length || this.rx.length < i + len) break // wait for more
      const type = b0 >> 4
      const body = this.rx.subarray(i, i + len)
      result = this.handlePacket(type, b0, body) ?? result
      this.rx = this.rx.slice(i + len)
    }
    return result
  }

  private handlePacket(type: number, b0: number, body: Uint8Array): 'connack' | 'connack-fail' | null {
    switch (type) {
      case 2: { // CONNACK
        const rc = body[1] ?? 5
        return rc === 0 ? 'connack' : 'connack-fail'
      }
      case 3: { // PUBLISH
        const qos = (b0 >> 1) & 0x03
        const retain = (b0 & 0x01) !== 0
        const topicLen = (body[0] << 8) | body[1]
        const topic = dec.decode(body.subarray(2, 2 + topicLen))
        let offset = 2 + topicLen
        if (qos > 0) {
          const pid = (body[offset] << 8) | body[offset + 1]
          offset += 2
          this.sendRaw([0x40, 0x02, (pid >> 8) & 0xff, pid & 0xff])
        }
        const payload = body.subarray(offset)
        if (this.subscribedTopic && topic === this.subscribedTopic) {
          this.onMessage?.(payload, retain)
        }
        return null
      }
      case 4: { // PUBACK
        const pid = (body[0] << 8) | body[1]
        const w = this.pubWaiters.get(pid)
        if (w) { clearTimeout(w.timer); w.resolve(true); this.pubWaiters.delete(pid) }
        return null
      }
      case 9: { // SUBACK
        const pid = (body[0] << 8) | body[1]
        const granted = body[2] ?? 0x80
        const w = this.subWaiters.get(pid)
        if (w) { clearTimeout(w.timer); w.resolve(granted !== 0x80); this.subWaiters.delete(pid) }
        return null
      }
      case 13: return null // PINGRESP
      default: return null
    }
  }

  // ── keepalive ─────────────────────────────────────────────────────────────

  private startPingTimers() {
    this.stopPingTimers()
    this.lastRx = Date.now()
    const period = Math.max(8000, Math.floor(this.opts.keepAlive * 800))
    this.pingTimer = setInterval(() => {
      if (this.isOpen) this.sendRaw([0xc0, 0x00])
    }, period)
    this.watchdogTimer = setInterval(() => {
      if (this.isOpen && Date.now() - this.lastRx > this.opts.keepAlive * 2.5 * 1000) {
        try { this.ws?.close() } catch { /* noop */ }
        this.handleClose()
      }
    }, period)
  }

  private stopPingTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.pingTimer = null
    this.watchdogTimer = null
  }
}
