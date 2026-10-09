// ─── VETO PARTY · synthesized sound effects (Web Audio, no assets) ──────────

import { loadSoundOn, saveSoundOn } from './core'

let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = true

export function initSound() {
  if (typeof window === 'undefined') return
  enabled = loadSoundOn()
  const unlock = () => {
    ensureCtx()
    if (ctx?.state === 'suspended') void ctx.resume()
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

export function setSoundOn(on: boolean) {
  enabled = on
  saveSoundOn(on)
  if (on) ensureCtx()
}
export function isSoundOn() { return enabled }

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

interface ToneOpts {
  f: number          // start freq
  f2?: number        // glide target
  at?: number        // delay seconds
  dur?: number
  type?: OscillatorType
  vol?: number
  attack?: number
}

function tone(o: ToneOpts) {
  if (!enabled) return
  const c = ensureCtx()
  if (!c || !master) return
  const t0 = c.currentTime + (o.at ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = o.type ?? 'square'
  osc.frequency.setValueAtTime(o.f, t0)
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t0 + (o.dur ?? 0.15))
  const vol = o.vol ?? 0.12
  const dur = o.dur ?? 0.15
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.008))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g); g.connect(master)
  osc.start(t0); osc.stop(t0 + dur + 0.05)
}

function noise(o: { at?: number; dur?: number; vol?: number; f?: number }) {
  if (!enabled) return
  const c = ensureCtx()
  if (!c || !master) return
  const t0 = c.currentTime + (o.at ?? 0)
  const dur = o.dur ?? 0.12
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const flt = c.createBiquadFilter()
  flt.type = 'bandpass'; flt.frequency.value = o.f ?? 1800; flt.Q.value = 0.8
  const g = c.createGain()
  g.gain.value = o.vol ?? 0.14
  src.connect(flt); flt.connect(g); g.connect(master)
  src.start(t0)
}

// ── effect vocabulary ────────────────────────────────────────────────────────

export const sfx = {
  click()  { tone({ f: 660, dur: 0.05, type: 'square', vol: 0.06 }) },
  tick()   { tone({ f: 880, dur: 0.04, type: 'square', vol: 0.05 }) },
  deny()   { tone({ f: 180, f2: 120, dur: 0.18, type: 'sawtooth', vol: 0.1 }) },
  join()   { tone({ f: 392, dur: 0.1, type: 'triangle', vol: 0.1 }); tone({ f: 587, at: 0.08, dur: 0.14, type: 'triangle', vol: 0.1 }) },
  leave()  { tone({ f: 587, dur: 0.09, type: 'triangle', vol: 0.08 }); tone({ f: 392, at: 0.08, dur: 0.14, type: 'triangle', vol: 0.08 }) },
  start()  { [196, 262, 330, 392].forEach((f, i) => tone({ f, at: i * 0.09, dur: 0.22, type: 'triangle', vol: 0.11 })) },
  move()   { tone({ f: 300, f2: 460, dur: 0.09, type: 'square', vol: 0.07 }) },
  step()   { tone({ f: 240, dur: 0.045, type: 'square', vol: 0.06 }); tone({ f: 320, at: 0.05, dur: 0.045, type: 'square', vol: 0.05 }) },
  wall()   { tone({ f: 140, f2: 90, dur: 0.16, type: 'square', vol: 0.12 }); noise({ dur: 0.07, vol: 0.08, f: 500 }) },
  place()  { tone({ f: 200, f2: 120, dur: 0.14, type: 'square', vol: 0.1 }); noise({ at: 0.02, dur: 0.06, vol: 0.07, f: 700 }) },
  dice()   {
    // decelerating rattle that lands with the on-screen die (~0.9s)
    let t = 0
    for (let i = 0; i < 12; i++) {
      noise({ at: t, dur: 0.03, vol: 0.085, f: 2200 + Math.random() * 1800 })
      t += 0.035 + 0.075 * Math.pow(i / 12, 2.2)
    }
    tone({ f: 420, at: 0.9, dur: 0.1, type: 'square', vol: 0.09 })
    tone({ f: 630, at: 0.96, dur: 0.14, type: 'triangle', vol: 0.08 })
  },
  select() { tone({ f: 440, dur: 0.05, type: 'triangle', vol: 0.08 }); tone({ f: 659, at: 0.04, dur: 0.08, type: 'triangle', vol: 0.08 }) },
  capture(){ noise({ dur: 0.16, vol: 0.16, f: 900 }); tone({ f: 220, f2: 70, dur: 0.24, type: 'sawtooth', vol: 0.12 }) },
  vote()   { tone({ f: 740, dur: 0.06, type: 'triangle', vol: 0.09 }) },
  turn()   { tone({ f: 523, dur: 0.09, type: 'triangle', vol: 0.09 }); tone({ f: 784, at: 0.07, dur: 0.12, type: 'triangle', vol: 0.09 }) },
  alert()  { tone({ f: 466, dur: 0.1, type: 'square', vol: 0.1 }); tone({ f: 466, at: 0.14, dur: 0.14, type: 'square', vol: 0.1 }) },
  win()    { [262, 330, 392, 523, 659, 784].forEach((f, i) => tone({ f, at: i * 0.11, dur: 0.3, type: 'triangle', vol: 0.12 })) },
  lose()   { [392, 349, 311, 262].forEach((f, i) => tone({ f, at: i * 0.15, dur: 0.32, type: 'triangle', vol: 0.11 })) },
}

export type SfxName = keyof typeof sfx
