'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Eye, Flag, Info,
  Lock, Radio, RotateCcw, Users, Volume2, X,
} from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CouncilApi } from '@/lib/council'
import { CouncilPlayer, SettingsMap, roman } from '@/lib/core'
import {
  WavelengthAction, WavelengthRoundScore, WavelengthStage, WavelengthState,
  outcomeFor,
} from '@/lib/games'
import { sfx } from '@/lib/sound'
import {
  Avatar, Btn, Countdown, RoleTag, Stamp, TimerBar,
  VetoedBanner,
} from '@/components/ui'
import { ScoreStrip } from '@/components/scoreboard'

function stageIndex(stage: WavelengthStage): number {
  switch (stage) {
    case 'clue': return 1
    case 'guess': return 2
    case 'counter': return 3
    case 'reveal': return 4
    case 'over': return 5
  }
}

// Convert percentage 0..100 to angle in radians:
// 0% -> Math.PI (180 deg, Left)
// 50% -> Math.PI / 2 (90 deg, Top)
// 100% -> 0 (0 deg, Right)
function percentToAngle(p: number): number {
  return Math.PI - (p / 100) * Math.PI
}

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy - r * Math.sin(angleRad),
  }
}

function describeArc(cx: number, cy: number, rInner: number, rOuter: number, startP: number, endP: number): string {
  const clampedStart = Math.max(0, Math.min(100, startP))
  const clampedEnd = Math.max(0, Math.min(100, endP))
  if (clampedStart >= clampedEnd) return ''

  const startAngle = percentToAngle(clampedStart)
  const endAngle = percentToAngle(clampedEnd)

  const p1 = polarToCartesian(cx, cy, rOuter, startAngle)
  const p2 = polarToCartesian(cx, cy, rOuter, endAngle)
  const p3 = polarToCartesian(cx, cy, rInner, endAngle)
  const p4 = polarToCartesian(cx, cy, rInner, startAngle)

  return [
    `M ${p1.x} ${p1.y}`,
    `A ${rOuter} ${rOuter} 0 0 1 ${p2.x} ${p2.y}`,
    `L ${p3.x} ${p3.y}`,
    `A ${rInner} ${rInner} 0 0 0 ${p4.x} ${p4.y}`,
    'Z',
  ].join(' ')
}

// Shared dial value store: one source of truth for the needle, the slider and
// every % readout so they can never drift apart on any screen. Pointer input
// snaps 1:1 while dragging (zero lag on the finger); remote updates ease toward
// the target so every other screen glides smoothly between network ticks
// instead of jumping.
function createDialStore(initial: number) {
  let target = initial
  let display = initial
  let dragging = false
  let raf: number | null = null
  const listeners = new Set<() => void>()

  const emit = () => {
    listeners.forEach(l => l())
  }

  const schedule = () => {
    if (raf === null) raf = requestAnimationFrame(tick)
  }

  const tick = () => {
    raf = null
    const gap = target - display
    if (Math.abs(gap) < 0.08) {
      display = target
    } else {
      display += gap * 0.35
    }
    emit()
    if (display !== target) schedule()
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    get: () => display,
    isDragging: () => dragging,
    setTarget(v: number, opts?: { snap?: boolean }) {
      target = Math.max(0, Math.min(100, v))
      if (dragging || opts?.snap) {
        display = target
        if (raf !== null) {
          cancelAnimationFrame(raf)
          raf = null
        }
        emit()
      } else {
        schedule()
      }
    },
    setDragging(d: boolean) {
      if (dragging === d) return
      dragging = d
      if (d) {
        display = target
        if (raf !== null) {
          cancelAnimationFrame(raf)
          raf = null
        }
        emit()
      }
    },
  }
}

type DialStore = ReturnType<typeof createDialStore>

function useDialValue(store: DialStore): number {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

// The needle is its own subscriber so dragging re-renders these few SVG nodes
// only - never the dial's static artwork and never the whole game tree.
const DialNeedle = memo(function DialNeedle({
  store,
  color,
  cx,
  cy,
  r,
}: {
  store: DialStore
  color: string
  cx: number
  cy: number
  r: number
}) {
  const value = useDialValue(store)
  const tip = polarToCartesian(cx, cy, r, percentToAngle(value))
  return (
    <g className="pointer-events-none drop-shadow-lg">
      <line
        x1={cx}
        y1={cy}
        x2={tip.x}
        y2={tip.y}
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        className="drop-shadow-md"
      />
      <circle cx={cx} cy={cy} r="14" fill="#2a241e" stroke={color} strokeWidth="3" />
      <circle cx={cx} cy={cy} r="6" fill={color} />
      <circle cx={tip.x} cy={tip.y} r="6.5" fill={color} stroke="#14110e" strokeWidth="2" />
    </g>
  )
})

// Integer percent readout (guess-stage nudge row and counter-stage line).
const DialValue = memo(function DialValue({ store }: { store: DialStore }) {
  const value = useDialValue(store)
  return <>{Math.round(value)}%</>
})

// The slider is its own subscriber for the same reason as the needle. Styled by
// the .wl-slider class: its element box IS the visible control (no UA-invisible
// padding), so the non-scrollable zone is exactly the slider itself.
const DialSlider = memo(function DialSlider({
  store,
  disabled,
  onGrab,
  onMove,
  onRelease,
}: {
  store: DialStore
  disabled: boolean
  onGrab: (pointerId: number | null) => boolean
  onMove: (val: number) => void
  onRelease: (val?: number) => void
}) {
  const value = useDialValue(store)
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={0.1}
      value={value}
      disabled={disabled}
      aria-label="Dial position"
      onPointerDown={e => {
        if (onGrab(e.pointerId)) {
          // keep drags alive (and their release caught) outside the window
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            // best-effort
          }
        }
      }}
      onChange={e => onMove(parseFloat(e.target.value))}
      onPointerUp={e => onRelease(parseFloat(e.currentTarget.value))}
      onKeyUp={e => {
        if (e.key.startsWith('Arrow')) onRelease()
      }}
      className="wl-slider"
    />
  )
})

// Static dial artwork (rim, ticks, zones, hub, baseline). Memoized so state
// echoes and needle moves never re-diff these nodes, and its own drop-shadow
// layer lets the browser cache the filter while the needle group moves.
const DialFace = memo(function DialFace({
  target,
  showTarget,
  cx,
  cy,
  rOuter,
  rInner,
}: {
  target: number
  showTarget: boolean
  cx: number
  cy: number
  rOuter: number
  rInner: number
}) {
  // Target zones
  const arc4 = describeArc(cx, cy, rInner, rOuter, target - 2.5, target + 2.5)
  const arc3Left = describeArc(cx, cy, rInner, rOuter, target - 6.5, target - 2.5)
  const arc3Right = describeArc(cx, cy, rInner, rOuter, target + 2.5, target + 6.5)
  const arc2Left = describeArc(cx, cy, rInner, rOuter, target - 10.5, target - 6.5)
  const arc2Right = describeArc(cx, cy, rInner, rOuter, target + 6.5, target + 10.5)
  return (
    <g className="pointer-events-none select-none drop-shadow-lg">
    {/* Base Arc Track */}
    <path
      d={describeArc(cx, cy, rInner, rOuter, 0, 100)}
      fill="url(#dialRimGrad)"
      stroke="var(--line-strong)"
      strokeWidth="2"
    />

    {/* Tick marks around perimeter */}
    {Array.from({ length: 21 }, (_, i) => {
      const p = i * 5
      const rad = percentToAngle(p)
      const outer = polarToCartesian(cx, cy, rOuter, rad)
      const inner = polarToCartesian(cx, cy, rOuter - (i % 5 === 0 ? 10 : 5), rad)
      return (
        <line
          key={i}
          x1={inner.x}
          y1={inner.y}
          x2={outer.x}
          y2={outer.y}
          stroke="var(--line-strong)"
          strokeWidth={i % 5 === 0 ? 2 : 1}
          opacity={0.7}
        />
      )
    })}

    {/* Target Wedge (when visible) */}
    {showTarget && (
      <g className="transition-all duration-300">
        {/* 2 Pt Zone */}
        {arc2Left && <path d={arc2Left} fill="#f59e0b" opacity="0.65" />}
        {arc2Right && <path d={arc2Right} fill="#f59e0b" opacity="0.65" />}

        {/* 3 Pt Zone */}
        {arc3Left && <path d={arc3Left} fill="#eab308" opacity="0.9" />}
        {arc3Right && <path d={arc3Right} fill="#eab308" opacity="0.9" />}

        {/* 4 Pt Bullseye Zone */}
        {arc4 && (
          <path
            d={arc4}
            fill="url(#bullseyeGrad)"
            stroke="#fca5a5"
            strokeWidth="1.5"
            filter="url(#dialGlow)"
          />
        )}

        {/* Bullseye Center Marker */}
        {(() => {
          const tRad = percentToAngle(target)
          const tOuter = polarToCartesian(cx, cy, rOuter + 2, tRad)
          const tInner = polarToCartesian(cx, cy, rInner - 2, tRad)
          return (
            <line
              x1={tInner.x}
              y1={tInner.y}
              x2={tOuter.x}
              y2={tOuter.y}
              stroke="#ffffff"
              strokeWidth="2.5"
            />
          )
        })()}
      </g>
    )}

    {/* Center Hub Housing */}
    <path
      d={`M ${cx - rInner + 10} ${cy} A ${rInner - 10} ${rInner - 10} 0 0 1 ${cx + rInner - 10} ${cy} Z`}
      fill="#14110e"
      stroke="var(--line)"
      strokeWidth="2"
    />

    {/* Center Base Line */}
    <line x1={cx - rOuter - 8} y1={cy} x2={cx + rOuter + 8} y2={cy} stroke="var(--line-strong)" strokeWidth="2.5" />
    </g>
  )
})

export const WavelengthDial = memo(function WavelengthDial({
  target,
  store,
  needleColor = 'var(--gold)',
  showTarget,
  showNeedle = true,
  interactive = false,
  onChange,
  onGrab,
  onRelease,
  onCommit,
}: {
  target: number
  store: DialStore
  needleColor?: string
  showTarget: boolean
  showNeedle?: boolean
  interactive?: boolean
  onChange?: (val: number) => void
  /** Return false to refuse the grab (locked / not eligible) - the drag then never starts. */
  onGrab?: (pointerId: number | null) => boolean | void
  onRelease?: (val: number) => void
  onCommit?: (val: number) => void
}) {
  const cx = 150
  const cy = 145
  const rOuter = 130
  const rInner = 80
  const rNeedle = 135


  const svgRef = useRef<SVGSVGElement | null>(null)
  const hitboxRef = useRef<SVGPathElement | null>(null)
  const isDraggingSvgRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)

  // touch-action on SVG child elements is ignored by some mobile browsers,
  // which let page scrolling steal every slide on the dial. A non-passive
  // touchstart/touchmove preventDefault is honored everywhere and pins the
  // gesture to the dial only for touches that land ON the display arc -
  // anything around the display (hub, corners, margins) scrolls normally.
  useEffect(() => {
    const el = hitboxRef.current
    if (!interactive || !el) return
    const pin = (e: TouchEvent) => {
      e.preventDefault()
    }
    el.addEventListener('touchstart', pin, { passive: false })
    el.addEventListener('touchmove', pin, { passive: false })
    return () => {
      el.removeEventListener('touchstart', pin)
      el.removeEventListener('touchmove', pin)
    }
  }, [interactive])

  const handlePointerCalc = (clientX: number, clientY: number) => {
    if (!svgRef.current) return null
    const rect = svgRef.current.getBoundingClientRect()
    const clickX = clientX - rect.left
    const clickY = clientY - rect.top
    const scaleX = 300 / rect.width
    const scaleY = 165 / rect.height
    const svgX = clickX * scaleX
    const svgY = clickY * scaleY

    const dx = svgX - cx
    const dy = cy - svgY

    // Fold positions below the pivot horizon instead of clamping them. A drag that
    // dips under the center line stays continuous with the rim it crossed - clamping
    // made the needle teleport end-to-end whenever dx flipped sign.
    let angle = Math.atan2(dy, dx)
    if (angle < 0) angle = -angle

    const percent = Math.round((1 - angle / Math.PI) * 1000) / 10
    return Math.max(0, Math.min(100, percent))
  }

  const handlePointerDown = (e: React.PointerEvent<SVGPathElement>) => {
    if (!interactive || !onChange) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const accepted = onGrab ? onGrab(e.pointerId) : true
    if (accepted === false) return
    isDraggingSvgRef.current = true
    pointerIdRef.current = e.pointerId
    // Keep the pointer (and its release) routed to us even outside the window.
    const captureEl = e.currentTarget
    try {
      captureEl.setPointerCapture(e.pointerId)
    } catch {
      // best-effort: window listeners below keep the drag alive regardless
    }
    const percent = handlePointerCalc(e.clientX, e.clientY)
    if (percent !== null) {
      onChange(percent)
    }

    // Only the pointer that started the drag may drive or end it - a second
    // finger (or palm) must never jump the needle or release the dial.
    const onGlobalPointerMove = (ev: PointerEvent) => {
      if (!isDraggingSvgRef.current || ev.pointerId !== pointerIdRef.current) return
      const p = handlePointerCalc(ev.clientX, ev.clientY)
      if (p !== null) {
        onChange(p)
      }
    }

    const onGlobalPointerUp = (ev: PointerEvent) => {
      if (!isDraggingSvgRef.current || ev.pointerId !== pointerIdRef.current) return
      isDraggingSvgRef.current = false
      pointerIdRef.current = null
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('pointerup', onGlobalPointerUp)
      window.removeEventListener('pointercancel', onGlobalPointerUp)
      try {
        captureEl.releasePointerCapture(ev.pointerId)
      } catch {
        // already released (e.g. the hitbox unmounted mid-drag)
      }
      const p = handlePointerCalc(ev.clientX, ev.clientY)
      const finalVal = p !== null ? p : store.get()
      if (onRelease) {
        onRelease(finalVal)
      } else if (onCommit) {
        onCommit(finalVal)
      }
    }

    window.addEventListener('pointermove', onGlobalPointerMove)
    window.addEventListener('pointerup', onGlobalPointerUp)
    window.addEventListener('pointercancel', onGlobalPointerUp)
  }

  return (
    // No touch-action here: the whole box around the dial must stay scrollable.
    // Only the display arc itself pins touch gestures (see hitboxRef above).
    <div className="relative mx-auto w-full max-w-[420px] select-none">
      <svg
        ref={svgRef}
        viewBox="0 0 300 165"
        className="w-full h-auto overflow-visible block select-none pointer-events-none"
      >
        <defs>
          <linearGradient id="dialRimGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1e1b18" />
            <stop offset="50%" stopColor="#2c2620" />
            <stop offset="100%" stopColor="#1e1b18" />
          </linearGradient>

          <linearGradient id="bullseyeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>

          <filter id="dialGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Static artwork is memoized (see DialFace) */}
        <DialFace target={target} showTarget={showTarget} cx={cx} cy={cy} rOuter={rOuter} rInner={rInner} />

        {/* Needle Indicator */}
        {showNeedle && (
          <DialNeedle store={store} color={needleColor} cx={cx} cy={cy} r={rNeedle} />
        )}

        {/* Interactive Hitbox Arc: the dial display itself - the only touch-action:none zone */}
        {interactive && (
          <path
            ref={hitboxRef}
            d={describeArc(cx, cy, 75, 135, 0, 100)}
            fill="transparent"
            pointerEvents="all"
            className="cursor-pointer active:cursor-grabbing pointer-events-auto touch-none"
            style={{ pointerEvents: 'all', touchAction: 'none' }}
            onPointerDown={handlePointerDown}
          />
        )}
      </svg>
    </div>
  )
})

export function WavelengthGame({
  api,
  state,
  settings,
}: {
  api: CouncilApi
  state: WavelengthState
  settings: SettingsMap
}) {
  const st = api.state!
  const players = st.players
  const myId = api.myId
  const me = players.find(p => p.id === myId)
  const meAdmin = !!me && (me.isAdmin || me.isOwner)

  const [clueInput, setClueInput] = useState('')
  const [dialStore] = useState(() => createDialStore(state.dialValue))

  const activeMembers = state.teams[state.activeTeam] || []
  const opposingMembers = state.teams[1 - state.activeTeam] || []
  const isActiveTeam = activeMembers.includes(myId)
  const isOpposingTeam = opposingMembers.includes(myId)
  const isPsychic = state.psychic === myId

  const nonPsychicActive = activeMembers.filter(id => id !== state.psychic)
  const eligibleToDial = nonPsychicActive.length > 0 ? nonPsychicActive : activeMembers
  const canAdjustDial = eligibleToDial.includes(myId)

  const isLockedByOther =
    state.stage === 'guess' &&
    state.dialHolder !== null &&
    state.dialHolder !== myId

  const isHoldingDial = state.dialHolder === myId

  // Track if local user is actively dragging / holding the dial
  const [isDragging, setIsDragging] = useState(false)
  const isDraggingRef = useRef(false)
  const activePointerIdRef = useRef<number | null>(null)
  const lastSentRef = useRef<number>(0)
  const lastSentValRef = useRef<number>(state.dialValue)
  const pendingValRef = useRef<number | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Sync dial store when state dial updates remotely, UNLESS local user is
  // actively dragging. Eased on purpose: other screens glide between network
  // ticks instead of jumping, and the needle/slider/% always show one value.
  useEffect(() => {
    if (!isDraggingRef.current) {
      dialStore.setTarget(state.dialValue)
    }
  }, [state.dialValue, dialStore])

  // Reset drag ref on stage or round change
  useEffect(() => {
    isDraggingRef.current = false
    setIsDragging(false)
    activePointerIdRef.current = null
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    pendingValRef.current = null
    dialStore.setDragging(false)
    dialStore.setTarget(state.dialValue, { snap: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stage, state.round])

  const pMeta = (id: string) => players.find(x => x.id === id)
  const nameOf = (id: string) => pMeta(id)?.name ?? 'SENATOR'
  const psychicPlayer = pMeta(state.psychic)

  const holderPlayer = state.dialHolder ? pMeta(state.dialHolder) : null
  const needleColor = holderPlayer?.color || 'var(--gold)'

  const iLost = !state.coop && outcomeFor('wavelength', state, myId) === 'lost'
  const totalMs = (settings.wavelength.seconds || 180) * 1000

  const sendAct = useCallback((action: WavelengthAction) => {
    api.sendAction(action)
  }, [api])

  const handleDialGrab = useCallback((pointerId: number | null = null): boolean => {
    if ((isLockedByOther && !isDraggingRef.current) || !canAdjustDial) return false
    isDraggingRef.current = true
    setIsDragging(true)
    activePointerIdRef.current = pointerId
    dialStore.setDragging(true)
    sendAct({ t: 'dial_grab' })
    return true
  }, [isLockedByOther, canAdjustDial, dialStore, sendAct])

  const handleDialChange = useCallback((val: number) => {
    if ((isLockedByOther && !isDraggingRef.current) || !canAdjustDial) return
    isDraggingRef.current = true
    setIsDragging(true)
    dialStore.setDragging(true)
    dialStore.setTarget(val)

    pendingValRef.current = val
    const now = Date.now()
    const elapsed = now - lastSentRef.current
    const delta = Math.abs(val - lastSentValRef.current)

    // When jerking the dial fast, sacrifice intermediate accuracy by skipping very fast micro-steps
    // and throttling to ~190ms so peer message queues do not backlog.
    const isFastMovement = delta > 10 || (elapsed < 140 && delta > 5)
    const throttleMs = isFastMovement ? 190 : 100

    if (elapsed >= throttleMs) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      lastSentRef.current = now
      lastSentValRef.current = val
      pendingValRef.current = null
      sendAct({ t: 'dial', value: val })
    } else if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (pendingValRef.current !== null && isDraggingRef.current) {
          const latest = pendingValRef.current
          lastSentRef.current = Date.now()
          lastSentValRef.current = latest
          pendingValRef.current = null
          sendAct({ t: 'dial', value: latest })
        }
      }, throttleMs - elapsed)
    }
  }, [isLockedByOther, canAdjustDial, dialStore, sendAct])

  // Idempotent: compat events (mouseup/touchend after pointerup) and the dial's
  // own release handler all land here - only the first one may commit and send.
  const handleDialRelease = useCallback((val?: number) => {
    if (!isDraggingRef.current || !canAdjustDial) return
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const finalVal = val !== undefined ? val : dialStore.get()
    pendingValRef.current = null
    isDraggingRef.current = false
    activePointerIdRef.current = null
    setIsDragging(false)
    dialStore.setDragging(false)
    dialStore.setTarget(finalVal, { snap: true })
    lastSentValRef.current = finalVal
    sendAct({ t: 'dial_release', value: finalVal })
    lastSentRef.current = Date.now()
  }, [canAdjustDial, dialStore, sendAct])

  // Safety global listener: if the pointer releases anywhere, end the drag -
  // but only for the pointer that started it (a second finger lifting must not
  // let go of the dial), and only on pointer events (compat mouse/touch events
  // would double-fire a release).
  const handleDialReleaseRef = useRef(handleDialRelease)
  useEffect(() => {
    handleDialReleaseRef.current = handleDialRelease
  })

  useEffect(() => {
    const handleGlobalRelease = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return
      const active = activePointerIdRef.current
      if (active !== null && ev.pointerId !== active) return
      handleDialReleaseRef.current()
    }
    window.addEventListener('pointerup', handleGlobalRelease)
    window.addEventListener('pointercancel', handleGlobalRelease)
    return () => {
      window.removeEventListener('pointerup', handleGlobalRelease)
      window.removeEventListener('pointercancel', handleGlobalRelease)
    }
  }, [])

  const handleNudge = useCallback((delta: number) => {
    if (isLockedByOther || !canAdjustDial) return
    const nextVal = Math.max(0, Math.min(100, Math.round((dialStore.get() + delta) * 10) / 10))
    dialStore.setTarget(nextVal)
    lastSentValRef.current = nextVal
    sendAct({ t: 'dial_release', value: nextVal })
  }, [isLockedByOther, canAdjustDial, dialStore, sendAct])

  const submitClue = () => {
    if (!clueInput.trim()) return
    sendAct({ t: 'clue', clue: clueInput.trim() })
    setClueInput('')
    sfx.vote()
  }

  const activeTeamName = state.coop ? 'COUNCIL' : state.activeTeam === 0 ? 'TEAM I' : 'TEAM II'
  const opposingTeamName = state.activeTeam === 0 ? 'TEAM II' : 'TEAM I'

  const dialMajority = Math.floor(eligibleToDial.length / 2) + 1
  const counterMajority = Math.floor(opposingMembers.length / 2) + 1

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-2 py-2 sm:px-4">
      {/* Stage Rail */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4].map(n => (
          <div
            key={n}
            className={`h-1.5 flex-1 transition-colors ${
              stageIndex(state.stage) >= n ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'
            }`}
          />
        ))}
        <Countdown endsAt={state.endsAt} />
      </div>
      <TimerBar endsAt={state.endsAt} totalMs={totalMs} />

      {/* Top Banner: Arena Header & Team Scores */}
      <div className="panel flex flex-col gap-3 p-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-[var(--accent)]" />
            <div>
              <h1 className="f-display text-xs sm:text-sm font-black tracking-[0.2em] text-[var(--gold)]">
                SPECTRUM CHAMBER
              </h1>
              <span className="f-mono text-[0.52rem] sm:text-[0.55rem] font-bold tracking-[0.16em] text-[var(--muted)]">
                ROUND {state.round} · TARGET: {state.pointsToWin} PTS
              </span>
            </div>
          </div>

          {/* Team Score Badges */}
          {state.coop ? (
            <div className="flex items-center gap-2 border border-[var(--gold)] bg-[var(--gold)]/15 px-3 py-1 shadow-sm">
              <span className="f-display text-[0.68rem] font-bold text-[var(--gold)]">COUNCIL SCORE</span>
              <span className="f-mono text-sm font-black text-[var(--ink)]">
                {state.scores[0]} / {state.pointsToWin} PTS
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 sm:gap-4">
              <div
                className={`flex items-center gap-2 border px-2.5 py-1 transition-colors ${
                  state.activeTeam === 0
                    ? 'border-[var(--accent)] bg-[var(--accent)]/15 shadow-sm'
                    : 'border-[var(--line)] bg-[var(--bg2)]'
                }`}
              >
                <span className="f-display text-[0.68rem] font-bold text-[var(--accent)]">TEAM I</span>
                <span className="f-mono text-sm font-black text-[var(--ink)]">{state.scores[0]}</span>
              </div>

              <span className="f-display text-xs font-bold text-[var(--muted)]">VS</span>

              <div
                className={`flex items-center gap-2 border px-2.5 py-1 transition-colors ${
                  state.activeTeam === 1
                    ? 'border-[var(--gold)] bg-[var(--gold)]/15 shadow-sm'
                    : 'border-[var(--line)] bg-[var(--bg2)]'
                }`}
              >
                <span className="f-display text-[0.68rem] font-bold text-[var(--gold)]">TEAM II</span>
                <span className="f-mono text-sm font-black text-[var(--ink)]">{state.scores[1]}</span>
              </div>
            </div>
          )}
        </div>

        {/* Role & Phase Status Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <RoleTag tone={state.coop ? 'gold' : state.activeTeam === 0 ? 'accent' : 'gold'}>
              {state.coop ? 'COUNCIL TURN' : `${activeTeamName} TURN`}
            </RoleTag>
            <span className="f-mono text-[0.65rem] text-[var(--muted)]">
              PSYCHIC:{' '}
              <strong className="text-[var(--ink)] font-bold">{psychicPlayer?.name ?? 'BOT'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="label !text-[0.55rem]">PHASE:</span>
            <span className="f-mono text-[0.65rem] font-bold uppercase text-[var(--gold)]">
              {state.stage === 'clue' && 'I. TRANSMIT CLUE'}
              {state.stage === 'guess' && 'II. TUNE THE DIAL'}
              {state.stage === 'counter' && 'III. INTERCEPT (LEFT / RIGHT)'}
              {state.stage === 'reveal' && 'IV. SPECTRUM REVEAL'}
              {state.stage === 'over' && 'CONCLUDED'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Chamber: Spectrum Card & Dial */}
      <div className="panel-hard brackets relative flex flex-col items-center gap-4 p-4 sm:p-6 text-center">
        {/* Opposing Concepts Header */}
        <div className="grid grid-cols-2 w-full gap-3 sm:gap-6 border-b border-[var(--line)] pb-4">
          <div className="flex flex-col items-start text-left border-l-2 border-[var(--accent)] pl-3">
            <span className="label !text-[0.55rem]">SPECTRUM LEFT</span>
            <span className="f-display text-sm sm:text-lg font-black tracking-wide text-[var(--ink)]">
              {state.card[0]}
            </span>
          </div>
          <div className="flex flex-col items-end text-right border-r-2 border-[var(--gold)] pr-3">
            <span className="label !text-[0.55rem]">SPECTRUM RIGHT</span>
            <span className="f-display text-sm sm:text-lg font-black tracking-wide text-[var(--ink)]">
              {state.card[1]}
            </span>
          </div>
        </div>

        {/* Current Clue (when transmitted) */}
        {state.clue && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-1 border-2 border-[var(--accent)] bg-[var(--accent)]/10 px-5 py-2.5 shadow-md"
          >
            <span className="label !text-[0.52rem] flex items-center gap-1">
              <Radio size={12} className="text-[var(--accent)] animate-pulse" /> PSYCHIC TRANSMISSION
            </span>
            <span className="f-display text-base sm:text-xl font-black tracking-wider text-[var(--gold)] uppercase">
              &ldquo;{state.clue}&rdquo;
            </span>
          </motion.div>
        )}

        {/* Interactive / Visual Spectrum Dial */}
        <div className="w-full flex flex-col items-center py-2">
          <WavelengthDial
            target={state.target}
            store={dialStore}
            needleColor={needleColor}
            showTarget={state.stage === 'reveal' || state.stage === 'over' || (state.stage === 'clue' && isPsychic)}
            showNeedle={state.stage !== 'clue' || !isPsychic}
            interactive={state.stage === 'guess' && canAdjustDial && !isLockedByOther}
            onGrab={handleDialGrab}
            onChange={handleDialChange}
            onRelease={handleDialRelease}
          />
        </div>

        {/* ── STAGE 1: TRANSMIT CLUE ── */}
        {state.stage === 'clue' && (
          <div className="w-full max-w-md flex flex-col items-center gap-3">
            {isPsychic ? (
              <div className="flex flex-col items-center gap-2 w-full">
                <div className="border border-[var(--gold)]/40 bg-[var(--gold)]/10 p-2.5 text-center w-full">
                  <span className="f-mono text-xs font-bold text-[var(--gold)]">
                    YOU ARE THE PSYCHIC · TARGET VISIBLE ON DIAL
                  </span>
                  <p className="f-mono text-[0.62rem] text-[var(--muted)] mt-1">
                    Provide a clue indicating where the target lies between {state.card[0]} and {state.card[1]}.
                  </p>
                </div>
                <div className="flex w-full gap-2 mt-1">
                  <input
                    type="text"
                    maxLength={40}
                    value={clueInput}
                    onChange={e => setClueInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitClue()}
                    placeholder="Enter your clue..."
                    className="flex-1 border-2 border-[var(--line-strong)] bg-[var(--bg)] px-3 py-2 text-sm font-bold text-[var(--ink)] focus:border-[var(--accent)] outline-none"
                    autoFocus
                  />
                  <Btn variant="accent" disabled={!clueInput.trim()} onClick={submitClue}>
                    TRANSMIT
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 p-3 text-center">
                <Radio size={24} className="text-[var(--accent)] animate-pulse" />
                <span className="f-display text-sm font-bold tracking-wider text-[var(--ink)]">
                  AWAITING TRANSMISSION FROM {nameOf(state.psychic)}
                </span>
                <span className="f-mono text-[0.62rem] text-[var(--muted)]">
                  The psychic sees the target and is formulating a clue...
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── STAGE 2: TUNE THE DIAL ── */}
        {state.stage === 'guess' && (
          <div className="w-full max-w-lg flex flex-col items-center gap-3">
            <span className="label !text-[0.6rem] text-[var(--muted)]">
              {isPsychic
                ? 'YOU ARE THE PSYCHIC · YOUR TEAM IS TUNING THE DIAL'
                : canAdjustDial
                ? `${activeTeamName}: TUNE THE DIAL TO MATCH THE TRANSMISSION`
                : `${activeTeamName} IS CURRENTLY TUNING THE DIAL`}
            </span>

            {/* Slider and controls for active team members (excluding psychic) */}
            {canAdjustDial && (
              <div className="w-full flex flex-col items-center gap-3">
                <div className="w-full px-4">
                  <DialSlider
                    store={dialStore}
                    disabled={isLockedByOther && !isDragging}
                    onGrab={handleDialGrab}
                    onMove={handleDialChange}
                    onRelease={handleDialRelease}
                  />

                  {/* Dial Status Prompt: placed in a fixed-height slot directly below the slider so touching the slider NEVER shifts any layout */}
                  <div className="mt-2 min-h-[34px] flex items-center justify-center pointer-events-none select-none">
                    {isHoldingDial ? (
                      <div className="flex items-center justify-center gap-2 p-1.5 border border-[var(--line-strong)] bg-[var(--bg2)] text-xs f-mono w-full">
                        <span
                          className="h-2 w-2 rounded-full animate-ping shrink-0"
                          style={{ backgroundColor: needleColor }}
                        />
                        <span className="font-bold tracking-wide text-[var(--ink)]">
                          YOU ARE MOVING THE NEEDLE (RELEASE TO UNLOCK)
                        </span>
                      </div>
                    ) : isLockedByOther ? (
                      <div className="flex items-center justify-center gap-2 p-1.5 border border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] text-xs f-mono w-full">
                        <Lock size={14} className="animate-pulse text-[var(--gold)] shrink-0" />
                        <span className="font-bold tracking-wide">
                          {pMeta(state.dialHolder!)?.name?.toUpperCase() || 'A TEAMMATE'} IS ADJUSTING THE DIAL...
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  <Btn small variant="outline" disabled={isLockedByOther} onClick={() => handleNudge(-5)}>
                    -5
                  </Btn>
                  <Btn small variant="outline" disabled={isLockedByOther} onClick={() => handleNudge(-1)}>
                    -1
                  </Btn>
                  <span className="f-mono text-xs font-bold px-3 py-1 border border-[var(--line)] bg-[var(--bg2)] text-[var(--gold)]">
                    <DialValue store={dialStore} />
                  </span>
                  <Btn small variant="outline" disabled={isLockedByOther} onClick={() => handleNudge(1)}>
                    +1
                  </Btn>
                  <Btn small variant="outline" disabled={isLockedByOther} onClick={() => handleNudge(5)}>
                    +5
                  </Btn>
                </div>

                <Btn
                  variant={state.dialConfirms.includes(myId) ? 'ok' : 'accent'}
                  disabled={isLockedByOther}
                  className="!px-8 !py-3 text-xs font-bold tracking-widest mt-1"
                  onClick={() => {
                    sendAct({ t: 'confirm_dial' })
                    sfx.vote()
                  }}
                >
                  <Check size={14} />
                  {state.dialConfirms.includes(myId)
                    ? 'CONFIRMED (CLICK TO UNCONFIRM)'
                    : 'CONFIRM DIAL POSITION'}
                </Btn>
                <div className="mt-1 flex items-center justify-center gap-1 min-h-[10px]">
                  {state.dialConfirms.map(id => (
                    <span
                      key={id}
                      title={nameOf(id)}
                      className="h-2.5 w-2.5 border border-[var(--bg)]"
                      style={{ background: pMeta(id)?.color ?? '#666' }}
                    />
                  ))}
                </div>
                <span className="f-mono text-[0.58rem] text-[var(--muted)]">
                  Adjusting the dial resets all team confirmations.
                </span>
              </div>
            )}

            {!canAdjustDial && (
              <div className="flex flex-col items-center gap-1 p-2">
                <span className="f-mono text-xs text-[var(--muted)]">
                  {state.dialHolder
                    ? `${pMeta(state.dialHolder)?.name || 'Teammate'} is moving the needle...`
                    : isPsychic
                    ? 'Your teammates are discussing and setting the dial needle.'
                    : 'Teammates are discussing where to place the needle...'}
                </span>
                <span className="f-mono text-xs font-bold text-[var(--gold)]">
                  CURRENT DIAL: <DialValue store={dialStore} />
                </span>
                <div className="mt-1 flex items-center justify-center gap-1 min-h-[10px]">
                  {state.dialConfirms.map(id => (
                    <span
                      key={id}
                      title={nameOf(id)}
                      className="h-2.5 w-2.5 border border-[var(--bg)]"
                      style={{ background: pMeta(id)?.color ?? '#666' }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STAGE 3: INTERCEPT (LEFT / RIGHT) ── */}
        {state.stage === 'counter' && (
          <div className="w-full max-w-md flex flex-col items-center gap-3">
            <div className="border border-[var(--line)] bg-[var(--bg2)] p-2 text-center w-full">
              <span className="label !text-[0.55rem] text-[var(--gold)]">
                {opposingTeamName} INTERCEPT OPPORTUNITY
              </span>
              <p className="f-mono text-xs text-[var(--ink)] mt-0.5">
                Is the secret target to the <strong>LEFT</strong> or <strong>RIGHT</strong> of the dial?
              </p>
            </div>

            {isOpposingTeam && (
              <div className="w-full flex flex-col items-center gap-3">
                <div className="grid grid-cols-2 gap-3 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      sendAct({ t: 'counter', guess: 'left' })
                      sfx.vote()
                    }}
                    className={`flex items-center justify-center gap-2 border-2 p-3 font-mono font-bold text-xs transition-all ${
                      state.counterGuess === 'left'
                        ? 'border-[var(--accent)] bg-[var(--accent)] text-white shadow-md'
                        : 'border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--ink)]'
                    }`}
                  >
                    <ArrowLeft size={16} /> LEFT
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      sendAct({ t: 'counter', guess: 'right' })
                      sfx.vote()
                    }}
                    className={`flex items-center justify-center gap-2 border-2 p-3 font-mono font-bold text-xs transition-all ${
                      state.counterGuess === 'right'
                        ? 'border-[var(--gold)] bg-[var(--gold)] text-black shadow-md'
                        : 'border-[var(--line)] hover:border-[var(--line-strong)] text-[var(--ink)]'
                    }`}
                  >
                    RIGHT <ArrowRight size={16} />
                  </button>
                </div>

                <Btn
                  variant={state.counterConfirms.includes(myId) ? 'ok' : 'accent'}
                  disabled={!state.counterGuess}
                  className="w-full !py-3 text-xs font-bold tracking-widest"
                  onClick={() => {
                    sendAct({ t: 'confirm_counter' })
                    sfx.vote()
                  }}
                >
                  <Check size={14} />
                  {state.counterConfirms.includes(myId)
                    ? 'CONFIRMED (CLICK TO UNCONFIRM)'
                    : 'CONFIRM GUESS & REVEAL'}
                </Btn>
                <div className="mt-1 flex items-center justify-center gap-1 min-h-[10px]">
                  {state.counterConfirms.map(id => (
                    <span
                      key={id}
                      title={nameOf(id)}
                      className="h-2.5 w-2.5 border border-[var(--bg)]"
                      style={{ background: pMeta(id)?.color ?? '#666' }}
                    />
                  ))}
                </div>
                <span className="f-mono text-[0.58rem] text-[var(--muted)]">
                  Changing your selection resets all confirmations.
                </span>
              </div>
            )}

            {!isOpposingTeam && (
              <div className="p-2 text-center flex flex-col items-center gap-1">
                <span className="f-mono text-xs text-[var(--muted)]">
                  {opposingTeamName} is deciding whether the target is left or right...
                </span>
                {state.counterGuess && (
                  <div className="mt-1">
                    <RoleTag tone="gold">SELECTED: {state.counterGuess.toUpperCase()}</RoleTag>
                  </div>
                )}
                <div className="mt-1 flex items-center justify-center gap-1 min-h-[10px]">
                  {state.counterConfirms.map(id => (
                    <span
                      key={id}
                      title={nameOf(id)}
                      className="h-2.5 w-2.5 border border-[var(--bg)]"
                      style={{ background: pMeta(id)?.color ?? '#666' }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STAGE 4: SPECTRUM REVEAL ── */}
        {state.stage === 'reveal' && state.roundScore && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md flex flex-col items-center gap-3 border border-[var(--line)] bg-[var(--bg2)] p-4"
          >
            <div className="flex items-center gap-2">
              <span className="f-display text-sm font-bold tracking-wider text-[var(--gold)]">
                ROUND SCORE BREAKDOWN
              </span>
            </div>

            {state.coop ? (
              <div className="w-full text-center">
                <div className="border border-[var(--line)] p-3 flex flex-col items-center gap-1 bg-[var(--bg)]">
                  <span className="label !text-[0.52rem]">COUNCIL TEAM (ACTIVE)</span>
                  <span className="f-display text-2xl font-black text-[var(--accent)]">
                    +{state.roundScore.activePts} PTS
                  </span>
                  <span className="f-mono text-[0.65rem] text-[var(--muted)]">
                    {state.roundScore.bullseye
                      ? 'BULLSEYE (4 PTS)!'
                      : state.roundScore.activePts === 3
                      ? 'VERY CLOSE (3 PTS)'
                      : state.roundScore.activePts === 2
                      ? 'ON THE WEDGE (2 PTS)'
                      : 'MISSED (0 PTS)'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 w-full text-center">
                <div className="border border-[var(--line)] p-2.5 flex flex-col items-center gap-1">
                  <span className="label !text-[0.52rem]">{activeTeamName} (ACTIVE)</span>
                  <span className="f-display text-xl font-black text-[var(--accent)]">
                    +{state.roundScore.activePts} PTS
                  </span>
                  <span className="f-mono text-[0.62rem] text-[var(--muted)]">
                    {state.roundScore.bullseye
                      ? 'BULLSEYE (4 PTS)!'
                      : state.roundScore.activePts === 3
                      ? 'VERY CLOSE (3 PTS)'
                      : state.roundScore.activePts === 2
                      ? 'ON THE WEDGE (2 PTS)'
                      : 'MISSED (0 PTS)'}
                  </span>
                </div>

                <div className="border border-[var(--line)] p-2.5 flex flex-col items-center gap-1">
                  <span className="label !text-[0.52rem]">{opposingTeamName} (COUNTER)</span>
                  <span className="f-display text-xl font-black text-[var(--gold)]">
                    +{state.roundScore.counterPts} PTS
                  </span>
                  <span className="f-mono text-[0.62rem] text-[var(--muted)]">
                    {state.roundScore.bullseye
                      ? 'NO STEAL ON BULLSEYE'
                      : state.roundScore.counterCorrect
                      ? `CORRECT (${state.counterGuess?.toUpperCase()})`
                      : `INCORRECT (${state.counterGuess?.toUpperCase()})`}
                  </span>
                </div>
              </div>
            )}

            {/* Next Round Trigger: Display for host / admin */}
            <div className="w-full flex justify-center mt-2">
              {meAdmin ? (
                <Btn
                  variant="accent"
                  className="w-full !py-3 text-xs font-bold tracking-widest"
                  onClick={() => {
                    sendAct({ t: 'next_round' })
                    sfx.vote()
                  }}
                >
                  {state.winner !== null ? 'VIEW FINAL RESULTS' : 'NEXT ROUND'} <ArrowRight size={14} />
                </Btn>
              ) : (
                <div className="w-full py-2.5 text-center border border-[var(--line)] bg-[var(--bg)]">
                  <span className="f-mono text-xs font-bold tracking-wider text-[var(--muted)]">
                    AWAITING THE CONSUL TO PROCEED...
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Roster & Team Alignment Strip */}
      {state.coop ? (
        <div className="panel p-3 flex flex-col gap-2 border-l-4 border-l-[var(--gold)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
            <span className="f-display text-xs font-bold text-[var(--gold)]">COUNCIL CO-OP ENSEMBLE</span>
            <span className="f-mono text-xs font-bold text-[var(--ink)]">{state.scores[0]} / {state.pointsToWin} PTS</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {state.teams[0].map(id => {
              const pl = pMeta(id)
              if (!pl) return null
              const isTurnPsychic = state.psychic === id
              return (
                <div
                  key={id}
                  className={`flex items-center gap-1.5 border px-2 py-1 text-xs ${
                    isTurnPsychic
                      ? 'border-[var(--accent)] bg-[var(--accent)]/15'
                      : 'border-[var(--line)] bg-[var(--bg2)]'
                  }`}
                >
                  <Avatar color={pl.color} name={pl.name} size={18} />
                  <span className="f-mono text-[0.65rem] font-bold">{pl.name}</span>
                  {id === myId && <RoleTag tone="gold">YOU</RoleTag>}
                  {isTurnPsychic && <RoleTag tone="accent">PSYCHIC</RoleTag>}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Team 0 Roster */}
          <div className="panel p-3 flex flex-col gap-2 border-l-4 border-l-[var(--accent)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
              <span className="f-display text-xs font-bold text-[var(--accent)]">TEAM I</span>
              <span className="f-mono text-xs font-bold text-[var(--ink)]">{state.scores[0]} PTS</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {state.teams[0].map(id => {
                const pl = pMeta(id)
                if (!pl) return null
                const isTurnPsychic = state.psychic === id
                return (
                  <div
                    key={id}
                    className={`flex items-center gap-1.5 border px-2 py-1 text-xs ${
                      isTurnPsychic
                        ? 'border-[var(--accent)] bg-[var(--accent)]/15'
                        : 'border-[var(--line)] bg-[var(--bg2)]'
                    }`}
                  >
                    <Avatar color={pl.color} name={pl.name} size={18} />
                    <span className="f-mono text-[0.65rem] font-bold">{pl.name}</span>
                    {id === myId && <RoleTag tone="gold">YOU</RoleTag>}
                    {isTurnPsychic && <RoleTag tone="accent">PSYCHIC</RoleTag>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Team 1 Roster */}
          <div className="panel p-3 flex flex-col gap-2 border-l-4 border-l-[var(--gold)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
              <span className="f-display text-xs font-bold text-[var(--gold)]">TEAM II</span>
              <span className="f-mono text-xs font-bold text-[var(--ink)]">{state.scores[1]} PTS</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {state.teams[1].map(id => {
                const pl = pMeta(id)
                if (!pl) return null
                const isTurnPsychic = state.psychic === id
                return (
                  <div
                    key={id}
                    className={`flex items-center gap-1.5 border px-2 py-1 text-xs ${
                      isTurnPsychic
                        ? 'border-[var(--gold)] bg-[var(--gold)]/15'
                        : 'border-[var(--line)] bg-[var(--bg2)]'
                    }`}
                  >
                    <Avatar color={pl.color} name={pl.name} size={18} />
                    <span className="f-mono text-[0.65rem] font-bold">{pl.name}</span>
                    {id === myId && <RoleTag tone="gold">YOU</RoleTag>}
                    {isTurnPsychic && <RoleTag tone="gold">PSYCHIC</RoleTag>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Game Over Modal Popup */}
      <AnimatePresence>
        {state.stage === 'over' && (
          <motion.div
            key="over"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg)]/90 p-4"
          >
            <motion.div
              initial={{ scale: 0.86, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="panel-hard brackets flex w-full max-w-md flex-col items-center gap-4 p-5 text-center sm:p-6"
            >
              {iLost && <VetoedBanner />}

              {state.winner !== null ? (
                <>
                  <Stamp tone="gold" className="!text-xl sm:!text-2xl">
                    {state.coop
                      ? 'COUNCIL SUCCEEDS'
                      : state.winner === 0
                      ? 'TEAM I PREVAILS'
                      : 'TEAM II PREVAILS'}
                  </Stamp>

                  <span className="f-mono text-[0.65rem] font-bold tracking-[0.2em] text-[var(--muted)]">
                    {state.coop
                      ? `TARGET REACHED: ${state.scores[0]} / ${state.pointsToWin} PTS`
                      : `FINAL SCORE: ${state.scores[0]} - ${state.scores[1]}`}
                  </span>

                  {/* Winning Team Players */}
                  <div className="flex w-full flex-col gap-1.5 border border-[var(--line)] bg-[var(--bg2)]/60 p-3">
                    <span className="label !text-[0.5rem]">
                      {state.coop ? 'COUNCIL ENSEMBLE' : 'VICTORIOUS SENATORS'}
                    </span>
                    <div className="flex flex-wrap justify-center gap-2 mt-1">
                      {state.teams[state.winner].map(id => {
                        const pl = pMeta(id)
                        if (!pl) return null
                        return (
                          <div
                            key={id}
                            className="flex items-center gap-1.5 border border-[var(--gold)]/40 bg-[var(--bg)] px-2 py-1"
                          >
                            <Avatar color={pl.color} name={pl.name} size={20} />
                            <span className="f-mono text-xs font-bold text-[var(--ink)]">{pl.name}</span>
                            {id === myId && <RoleTag tone="gold">YOU</RoleTag>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <Stamp className="!text-white">SESSION ADJOURNED</Stamp>
                  <span className="f-mono text-[0.65rem] font-bold tracking-[0.2em] text-[var(--muted)]">
                    CONCLUDED BY THE CONSUL
                  </span>

                  <span className="f-mono text-[0.65rem] font-bold tracking-[0.2em] text-[var(--muted)]">
                    {state.coop
                      ? `SCORE REACHED: ${state.scores[0]} / ${state.pointsToWin} PTS`
                      : `FINAL SCORE: ${state.scores[0]} - ${state.scores[1]}`}
                  </span>

                  {/* Display each team's score even when adjourned */}
                  {state.coop ? (
                    <div className="flex items-center gap-2 border border-[var(--gold)] bg-[var(--gold)]/10 px-4 py-1.5 shadow-sm">
                      <span className="f-display text-[0.68rem] font-bold text-[var(--gold)]">COUNCIL SCORE</span>
                      <span className="f-mono text-sm font-black text-[var(--ink)]">
                        {state.scores[0]} / {state.pointsToWin} PTS
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 border border-[var(--line)] bg-[var(--bg2)] px-4 py-2 shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="f-display text-[0.68rem] font-bold text-[var(--accent)]">TEAM I</span>
                        <span className="f-mono text-sm font-black text-[var(--ink)]">{state.scores[0]} PTS</span>
                      </div>
                      <span className="f-display text-xs font-bold text-[var(--muted)]">VS</span>
                      <div className="flex items-center gap-2">
                        <span className="f-display text-[0.68rem] font-bold text-[var(--gold)]">TEAM II</span>
                        <span className="f-mono text-sm font-black text-[var(--ink)]">{state.scores[1]} PTS</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              <ScoreStrip api={api} />

              {meAdmin ? (
                <div className="flex flex-wrap justify-center gap-2 mt-2">
                  <Btn variant="accent" onClick={api.startGame}>
                    RECONVENE <ArrowRight size={14} />
                  </Btn>
                  <Btn variant="outline" onClick={api.toLobby}>
                    LOBBY
                  </Btn>
                </div>
              ) : (
                <span className="label vp-pulse mt-2">AWAITING THE CONSUL</span>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
