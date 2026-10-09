'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Dices } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CouncilApi } from '@/lib/council'
import { canProxyFor } from '@/lib/core'
import {
  BState, bMovesFor, bPlacement, getBMap, outcomeFor,
} from '@/lib/games'
import { sfx } from '@/lib/sound'
import {
  Avatar, Btn, ConfirmBar, RoleTag, Stamp, useCoarsePointer, VetoedBanner,
} from '@/components/ui'
import { ScoreStrip } from '@/components/scoreboard'

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
}

const ROLL_MS = 900

/**
 * Tumbles through random faces before settling on the real roll.
 * `rollId` changes whenever a NEW roll lands, which restarts the animation.
 */
function DieFace({ value, spent, rollId, awaiting, onSettled }: {
  value: number | null
  spent?: boolean
  rollId: number
  /** True while waiting for a new roll: the previous value is NOT actionable. */
  awaiting?: boolean
  /** Fired when the tumble finishes and the real value is shown. */
  onSettled?: (rollId: number) => void
}) {
  const [face, setFace] = useState<number | null>(value)
  const [rolling, setRolling] = useState(false)
  const firstRun = useRef(true)
  // keep the latest callback without making it a tumbling effect dependency
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; setFace(value); return }
    if (value === null) { setFace(null); setRolling(false); return }

    setRolling(true)
    const started = Date.now()
    let timer: ReturnType<typeof setTimeout>

    const tumble = () => {
      const elapsed = Date.now() - started
      if (elapsed >= ROLL_MS) {
        setFace(value)          // land on the authoritative result
        setRolling(false)
        settledRef.current?.(rollId)
        return
      }
      setFace(1 + Math.floor(Math.random() * 6))
      // ease out: flips start fast and slow down as it settles
      const delay = 55 + 150 * Math.pow(elapsed / ROLL_MS, 2.2)
      timer = setTimeout(tumble, delay)
    }
    tumble()
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId])

  useEffect(() => {
    if (!rolling) setFace(value)
  }, [value, rolling])

  // Rolling a 6 grants another turn. While that next roll is pending the old
  // value must not be shown, or it reads as "you have a 6" when you do not.
  const shown = awaiting ? null : face

  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <motion.div
        animate={rolling
          ? { rotate: [0, -16, 14, -9, 0], scale: [1, 1.14, 0.94, 1.06, 1] }
          : { rotate: 0, scale: 1 }}
        transition={rolling
          ? { duration: ROLL_MS / 1000, ease: 'easeOut' }
          : { type: 'spring', stiffness: 420, damping: 16 }}
        className={`relative grid h-14 w-14 grid-cols-3 grid-rows-3 gap-[6%] border-2 bg-[var(--panel)] p-[12%] ${
          shown ? 'border-[var(--line-strong)]' : 'border-dashed border-[var(--line)]'
        } ${spent && !rolling ? 'opacity-45' : ''} ${rolling ? 'border-[var(--accent)]' : ''}`}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={shown && PIPS[shown].includes(i) ? 'bg-[var(--ink)]' : 'bg-transparent'} />
        ))}
        {!shown && (
          <span className="absolute inset-0 flex items-center justify-center f-display text-lg font-black text-[var(--line-strong)]">?</span>
        )}
      </motion.div>
      <span className={`f-mono text-[0.7rem] font-bold tabular ${
        rolling ? 'text-[var(--accent)]' : shown ? 'text-[var(--ink)]' : 'text-[var(--muted)]'
      }`}>
        {shown ?? (awaiting ? 'ROLL' : '..')}
      </span>
    </div>
  )
}

/**
 * Evenly spaced ring so a stack is symmetrical at ANY pawn count.
 *
 * Radius and pawn size are solved together so that (a) neighbours on the ring
 * never overlap and (b) the whole cluster stays inside a fixed extent.
 */
const STACK_EXTENT = 0.34   // max distance from cell centre to a pawn corner
const STACK_FILL = 0.8      // fraction of the inter-pawn chord a pawn may use

function stackOffsets(n: number): { dx: number; dy: number; size: number }[] {
  if (n <= 0) return []
  if (n === 1) return [{ dx: 0, dy: 0, size: 0.34 }]
  const chord = 2 * Math.sin(Math.PI / n)             // per unit radius
  const radius = STACK_EXTENT / (1 + chord * STACK_FILL * Math.SQRT1_2)
  const size = Math.max(0.1, Math.min(0.26, radius * chord * STACK_FILL))
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n
    return { dx: Math.cos(a) * radius, dy: Math.sin(a) * radius, size }
  })
}

interface Echo {
  id: number
  at: number
  movers: { idx: number; from: number; to: number; seat: number }[]
  victims: { idx: number; from: number; to: number; seat: number }[]
  stoneTaken: number | null
  stonePlaced: number | null
}

/**
 * Remote turns used to resolve instantly, so it was hard to see what anyone
 * did. This diffs the authoritative state and replays the last action as a
 * fading trail plus a caption, for every client including the mover.
 */
function useMoveEcho(state: BState): Echo | null {
  const prev = useRef<{ pieces: { seat: number; circle: number }[]; stones: (number | null)[] } | null>(null)
  const seq = useRef(0)
  const [echo, setEcho] = useState<Echo | null>(null)

  useEffect(() => {
    const before = prev.current
    const now = {
      pieces: state.pieces.map(p => ({ seat: p.seat, circle: p.circle })),
      stones: [...state.stones],
    }
    prev.current = now
    if (!before || before.pieces.length !== now.pieces.length) return

    const moved: { idx: number; from: number; to: number; seat: number }[] = []
    now.pieces.forEach((p, i) => {
      const b = before.pieces[i]
      if (b && b.circle !== p.circle) moved.push({ idx: i, from: b.circle, to: p.circle, seat: p.seat })
    })

    let stoneTaken: number | null = null
    let stonePlaced: number | null = null
    before.stones.forEach((c, i) => {
      const after = now.stones[i]
      if (c !== null && after === null) stoneTaken = c
      if (c === null && after !== null) stonePlaced = after
    })

    if (!moved.length && stonePlaced === null && stoneTaken === null) return

    // A fresh deal moves everything at once; that is not an action to replay.
    if (moved.length > 3) return

    const homeOf = (seat: number) => state.participants[seat] !== undefined
      ? getBMap(state.layout).circles.find(c => c.start === seat)?.id
      : undefined
    const victims = moved.filter(m => m.to === homeOf(m.seat))
    const movers = moved.filter(m => !victims.includes(m))

    seq.current += 1
    setEcho({ id: seq.current, at: Date.now(), movers, victims, stoneTaken, stonePlaced })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pieces, state.stones])

  // let the trail fade out on its own
  useEffect(() => {
    if (!echo) return
    const t = setTimeout(() => setEcho(e => (e && e.id === echo.id ? null : e)), 2600)
    return () => clearTimeout(t)
  }, [echo])

  return echo
}

export function BarricadeGame({ api, state }: { api: CouncilApi; state: BState }) {
  const st = api.state!
  const players = st.players
  const myId = api.myId
  const me = players.find(p => p.id === myId)
  const meAdmin = !!me && (me.isAdmin || me.isOwner)
  const [selectedPawn, setSelectedPawn] = useState<number | null>(null)
  const [pendingPlace, setPendingPlace] = useState<number | null>(null)
  const [pendingMove, setPendingMove] = useState<{ pawn: number; to: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const coarse = useCoarsePointer()
  useEffect(() => {
    setSelectedPawn(null)
    setPendingPlace(null)
    setPendingMove(null)
    setHover(null)
  }, [state.turn, state.phase, state.stage])

  // A fresh wall-clock token re-renders the board when the tumble ends.
  const [, forceSettle] = useState(0)
  /**
   * WHEN the current roll stops animating, in wall-clock ms.
   *
   * This is a ref set the INSTANT a new roll key is seen, so the first frame
   * of a new roll already reads as "still rolling". Tracking settled-ness in
   * React state updated inside an effect is what made the first roll and
   * every re-roll flash destinations for one frame before the die started.
   */
  const settledAtRef = useRef<number>(0)
  const lastSeenRoll = useRef<string>('')
  const [rollId, setRollId] = useState(0)

  const newRollAll = state.dieRoll !== null
  const rollKey = newRollAll
    ? `${state.turn}-${state.dieRoll}-${state.pieces.map(p => p.circle).join('')}`
    : null

  // On mount, treat an already-present roll as having just begun animating, so
  // the FIRST turn of the game also waits for the tumble instead of flashing.
  if (rollKey && lastSeenRoll.current !== rollKey) {
    lastSeenRoll.current = rollKey
    settledAtRef.current = Date.now() + ROLL_MS
    setRollId(n => n + 1)   // drives the tumble effect via rollId
  }

  const echo = useMoveEcho(state)
  const map = getBMap(state.layout)
  const cur = state.participants[state.turn]
  const curP = players.find(p => p.id === cur)
  const mine = cur === myId
  const proxy = meAdmin && !!curP && canProxyFor(curP)
  const canAct = state.stage === 'play' && (mine || proxy)
  const actor = cur

  const colorOf = (id: string) => players.find(p => p.id === id)?.color ?? '#666'
  const nameOf = (id: string) => players.find(p => p.id === id)?.name ?? '?'
  const seatTaken = (seat: number) => seat >= 0 && seat < state.participants.length
  const seatColor = (seat: number) =>
    seatTaken(seat) ? colorOf(state.participants[seat]) : 'var(--line)'

  /**
   * Absolute position of every pawn, including its slot within a home stack.
   * The pawns use these positions in one persistent render layer, so the same
   * DOM element can glide between squares instead of unmounting/remounting.
   */
  const piecePositions = useMemo(() => {
    const grouped = new Map<number, number[]>()
    state.pieces.forEach((pc, i) => {
      const ids = grouped.get(pc.circle)
      if (ids) ids.push(i)
      else grouped.set(pc.circle, [i])
    })
    const out = new Map<number, { x: number; y: number; size: number }>()
    for (const [circle, ids] of grouped) {
      const c = map.circles[circle]
      if (!c) continue
      const offsets = stackOffsets(ids.length)
      ids.forEach((id, i) => {
        const o = offsets[i] ?? { dx: 0, dy: 0, size: 0.34 }
        out.set(id, { x: c.x + o.dx, y: c.y + o.dy, size: o.size })
      })
    }
    return out
  }, [state.pieces, map])

  const myPawns = useMemo(
    () => state.pieces.map((p, i) => ({ ...p, idx: i })).filter(p => p.seat === state.turn),
    [state.pieces, state.turn],
  )

  // No wall wait is needed when there is no roll at all. Otherwise the die is
  // still tumbling until its wall-clock deadline passes.
  const dieSettled = !newRollAll || Date.now() >= settledAtRef.current
  const movesByPawn = useMemo(() => {
    const m = new Map<number, number[]>()
    if (canAct && state.phase === 'move' && dieSettled) {
      for (const p of myPawns) m.set(p.idx, bMovesFor(map, state, p.idx))
    }
    return m
  }, [canAct, state, myPawns, map, dieSettled])

  const allTargets = useMemo(() => {
    const set = new Map<number, number[]>()
    movesByPawn.forEach((dests, pawn) => {
      for (const d of dests) {
        if (!set.has(d)) set.set(d, [])
        set.get(d)!.push(pawn)
      }
    })
    return set
  }, [movesByPawn])

  const placementCells = useMemo(
    () => (canAct && state.phase === 'place' && dieSettled ? new Set(bPlacement(map, state)) : new Set<number>()),
    [canAct, state, map, dieSettled],
  )

  const stoneAt = (circle: number) => state.stones.findIndex(c => c === circle)

  /**
   * Which pawn would travel to this circle.
   *
   * With a pawn selected the choice is explicit, so never substitute another
   * one: that is the whole point of selecting. With nothing selected we fall
   * back to the first pawn that can reach the square (the original one-tap
   * flow, kept intact).
   */
  const resolvePawn = (circle: number): number | null => {
    if (selectedPawn !== null) {
      return movesByPawn.get(selectedPawn)?.includes(circle) ? selectedPawn : null
    }
    const cand = allTargets.get(circle)
    return cand && cand.length ? cand[0] : null
  }

  const tapPawn = (idx: number) => {
    if (!canAct || state.phase !== 'move') return
    const dests = movesByPawn.get(idx)
    if (!dests || !dests.length) { sfx.deny(); return }
    sfx.tick()
    setSelectedPawn(prev => (prev === idx ? null : idx))
  }

  const tapCircle = (circle: number) => {
    if (!canAct) return
    if (state.phase === 'move') {
      const pawn = resolvePawn(circle)
      if (pawn === null) {
        // tapping empty space clears an explicit selection
        if (selectedPawn !== null) { sfx.tick(); setSelectedPawn(null) }
        return
      }
      if (coarse) {
        // Touch: stage it so the preview can be inspected before committing.
        sfx.tick()
        setPendingMove({ pawn, to: circle })
      } else {
        // Pointer: the hover preview already showed the outcome, so commit.
        api.sendAction({ t: 'move', pawn, to: circle }, actor)
        setSelectedPawn(null)
        setHover(null)
      }
      return
    }
    if (state.phase === 'place' && placementCells.has(circle)) {
      if (coarse) {
        sfx.tick()
        setPendingPlace(circle)
      } else {
        api.sendAction({ t: 'place', to: circle }, actor)
        setHover(null)
      }
    }
  }

  /**
   * What WOULD happen if the candidate action were taken. Drives the hover
   * preview on pointer devices and the pre-confirm preview on touch.
   */
  const activeDests = selectedPawn !== null ? new Set(movesByPawn.get(selectedPawn) ?? []) : new Set<number>()

  /**
   * Is this square a legal destination right now? Selecting a pawn narrows it
   * to that pawn's moves. Shared by the board highlights and the pawn layer so
   * the two can never disagree about what is clickable.
   */
  const isDestination = (circle: number) =>
    canAct && state.phase === 'move' && dieSettled &&
    (selectedPawn !== null ? activeDests.has(circle) : allTargets.has(circle))

  const preview = useMemo(() => {
    if (state.stage !== 'play' || !canAct) return null

    if (state.phase === 'move') {
      let to: number | null = null
      let pawn: number | null = null
      if (coarse) {
        if (pendingMove) { to = pendingMove.to; pawn = pendingMove.pawn }
      } else if (hover !== null && isDestination(hover)) {
        to = hover
        pawn = resolvePawn(hover)
      }
      if (to === null || pawn === null) return null
      const mover = state.pieces[pawn]
      if (!mover) return null
      const dest = to
      return {
        kind: 'move' as const,
        pawn,
        from: mover.circle,
        to: dest,
        seat: mover.seat,
        captures: state.pieces
          .map((pc, i) => ({ pc, i }))
          .filter(({ pc, i }) => i !== pawn && pc.circle === dest && pc.seat !== mover.seat)
          .map(({ pc, i }) => ({
            idx: i,
            home: map.circles.find(c => c.start === pc.seat)?.id ?? dest,
            seat: pc.seat,
          })),
        takesStone: state.stones.includes(dest),
        wins: !!map.circles[dest]?.finish,
      }
    }

    if (state.phase === 'place') {
      const to = coarse
        ? pendingPlace
        : (hover !== null && placementCells.has(hover) ? hover : null)
      if (to === null) return null
      return {
        kind: 'place' as const,
        pawn: null, from: null, to, seat: state.turn,
        captures: [] as { idx: number; home: number; seat: number }[],
        takesStone: false, wins: false,
      }
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, canAct, coarse, hover, pendingMove, pendingPlace, allTargets, placementCells, map, selectedPawn])

  const moveLabel = (() => {
    if (!pendingMove) return 'MOVE PAWN'
    const target = pendingMove.to
    if (state.stones.includes(target)) return 'TAKE BARRICADE'
    // any enemy on the square is a capture, regardless of piece ordering
    if (state.pieces.some(p => p.circle === target && p.seat !== state.turn)) return 'CAPTURE PAWN'
    if (map.circles[target]?.finish) return 'CLAIM THE THRONE'
    return 'MOVE PAWN'
  })()

  // Plain-language description of the action being replayed.
  const echoText = (() => {
    if (!echo) return ''
    if (!echo.movers.length) {
      return echo.stonePlaced !== null ? 'BARRICADE PLACED' : ''
    }
    const m = echo.movers[0]
    const who = nameOf(state.participants[m.seat] ?? '')
    if (echo.victims.length) {
      const v = echo.victims[0]
      return `${who} TOOK ${nameOf(state.participants[v.seat] ?? '')}'S PAWN`
    }
    if (echo.stoneTaken !== null) return `${who} TOOK A BARRICADE`
    if (map.circles[m.to]?.finish) return `${who} REACHED THE THRONE`
    return `${who} MOVED`
  })()

  const over = state.stage === 'over'
  const winnerP = state.winner !== null ? players.find(p => p.id === state.participants[state.winner!]) : null
  const iLost = outcomeFor('barricade', state, myId) === 'lost'

  const PAD = 1.1
  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
      {/* rail */}
      <div className="order-2 flex min-w-0 flex-col gap-2 lg:order-1 lg:w-60 lg:shrink-0">
        {state.participants.map((id, seat) => {
          const pl = players.find(p => p.id === id)
          if (!pl) return null
          const active = state.turn === seat && !over
          return (
            <motion.div
              key={id}
              layout
              className={`flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-2 p-2.5 ${active ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}
            >
              <Avatar color={pl.color} name={pl.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold tracking-wider">{pl.name}</div>
                <div className="f-mono text-[0.58rem] font-bold tracking-[0.16em] text-[var(--muted)]">
                  {state.pieces.filter(p => p.seat === seat).length} PAWNS
                </div>
              </div>
              {active && <span className="vp-pulse h-2 w-2 bg-[var(--accent)]" />}
              {id === myId && <RoleTag tone="gold">YOU</RoleTag>}
            </motion.div>
          )
        })}

        {/* dice box (fixed height so nothing here can shift the board) */}
        <div className={`flex min-h-[86px] items-center gap-3 border-2 p-3 ${canAct && state.phase === 'roll' ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}>
          <DieFace
            value={state.dieRoll ?? state.lastRoll}
            spent={!state.dieRoll}
            awaiting={state.phase === 'roll' && !over}
            rollId={rollId}
            onSettled={() => {
              // re-render once the tumble ends so the gate re-evaluates
              settledAtRef.current = Date.now()
              forceSettle(n => n + 1)
            }}
          />
          {canAct && state.phase === 'roll' && !over ? (
            <Btn variant="accent" small className="flex-1" onClick={() => api.sendAction({ t: 'roll' }, actor)}>
              <Dices size={14} /> ROLL
            </Btn>
          ) : (
            <span className="f-mono flex-1 text-[0.6rem] font-bold tracking-[0.14em] text-[var(--muted)]">
              {over ? '...'
                : !dieSettled ? 'ROLLING...'
                : state.phase === 'place' ? 'PLACE THE BARRICADE'
                : state.phase === 'move'
                  ? (canAct
                      ? (selectedPawn !== null ? `MOVE ${state.dieRoll}: PICK A SQUARE` : `MOVE ${state.dieRoll} SPACES`)
                      : `${nameOf(cur)} IS MOVING`)
                  : `${nameOf(cur)} ROLLS...`}
            </span>
          )}
        </div>

        {/* reserved line: rendering it always means it can never reflow */}
        <div className="f-mono min-h-[1.1rem] overflow-hidden text-[0.55rem] font-bold tracking-[0.16em]">
          {echoText ? (
            <span key={echo?.id} className="vp-echo-in block truncate text-[var(--ink)]">{echoText}</span>
          ) : !over && state.phase === 'roll' && state.lastRoll === 6 ? (
            <span className="text-[var(--gold)]">ROLLED A 6: ROLL AGAIN</span>
          ) : '\u00A0'}
        </div>
        {/* always rendered so it can never reflow the board */}
        <div className="f-mono min-h-[2.2rem] text-[0.53rem] font-bold leading-relaxed tracking-[0.14em] text-[var(--muted)]">
          {canAct && state.phase === 'move'
            ? (selectedPawn !== null
                ? 'SHOWING THAT PAWN ONLY. TAP IT AGAIN, OR TAP EMPTY SPACE, TO CLEAR.'
                : 'TAP A PAWN FIRST TO CHOOSE WHICH ONE MOVES, OR TAP A HIGHLIGHTED SQUARE.')
            : '\u00A0'}
        </div>

        {!state.participants.includes(myId) && (
          <div className="label mt-1">SPECTATING FROM THE GALLERY</div>
        )}
      </div>

      {/* board */}
      <div className="order-1 min-w-0 flex-1 lg:order-2">
        <div className="panel-hard mx-auto w-full max-w-[640px] p-1.5 sm:p-2.5">
          <svg
            viewBox={`${-PAD} ${-PAD} ${map.w - 1 + PAD * 2} ${map.h - 1 + PAD * 2}`}
            className="block h-auto w-full select-none"
          >
            {/* edges */}
            {map.edges.map(([a, b], i) => (
              <line
                key={i}
                x1={map.circles[a].x} y1={map.circles[a].y}
                x2={map.circles[b].x} y2={map.circles[b].y}
                stroke="var(--line)" strokeWidth={0.09}
              />
            ))}

            {/* circles */}
            {map.circles.map(c => {
              // Selecting a pawn narrows the highlights to that pawn's moves.
              const isTargetDest = isDestination(c.id)
              const isActiveDest = activeDests.has(c.id)
              const isPlace = placementCells.has(c.id)
              const isPending = pendingPlace === c.id
              const isPendingMove = pendingMove?.to === c.id
              const stone = stoneAt(c.id)
              const startColor = c.start !== null ? seatColor(c.start) : null
              return (
                <g
                  key={c.id}
                  onClick={() => tapCircle(c.id)}
                  onMouseEnter={coarse ? undefined : () => setHover(c.id)}
                  onMouseLeave={coarse ? undefined : () => setHover(h => (h === c.id ? null : h))}
                  className={isTargetDest || isPlace ? 'cursor-pointer' : ''}
                >
                  {/* transparent fat hit area */}
                  <circle cx={c.x} cy={c.y} r={0.5} fill="transparent" />
                  {c.noBarricade ? (
                    <rect x={c.x - 0.3} y={c.y - 0.3} width={0.6} height={0.6}
                      fill="var(--panel2)" stroke="var(--line-strong)" strokeWidth={0.05} />
                  ) : (
                    <circle cx={c.x} cy={c.y} r={0.3}
                      fill={c.finish ? 'var(--accent)' : 'var(--panel)'}
                      stroke={c.start !== null ? startColor! : 'var(--line-strong)'}
                      strokeWidth={c.start !== null ? 0.12 : 0.05}
                      strokeDasharray={c.start !== null && !seatTaken(c.start) ? '0.12 0.09' : undefined}
                      opacity={c.start !== null && !seatTaken(c.start) ? 0.55 : 1}
                    />
                  )}
                  {c.finish && (
                    <path
                      d={`M ${c.x - 0.2} ${c.y + 0.14} L ${c.x - 0.2} ${c.y - 0.06} L ${c.x - 0.1} ${c.y + 0.02} L ${c.x} ${c.y - 0.14} L ${c.x + 0.1} ${c.y + 0.02} L ${c.x + 0.2} ${c.y - 0.06} L ${c.x + 0.2} ${c.y + 0.14} Z`}
                      fill="#ffffff"
                    />
                  )}
                  {stone !== -1 && (
                    <g>
                      <rect x={c.x - 0.24} y={c.y - 0.24} width={0.48} height={0.48}
                        fill="var(--muted)" stroke="var(--bg)" strokeWidth={0.05} />
                      <line x1={c.x - 0.17} y1={c.y - 0.17} x2={c.x + 0.17} y2={c.y + 0.17} stroke="var(--bg)" strokeWidth={0.07} />
                      <line x1={c.x + 0.17} y1={c.y - 0.17} x2={c.x - 0.17} y2={c.y + 0.17} stroke="var(--bg)" strokeWidth={0.07} />
                    </g>
                  )}

                  {/* highlights */}
                  {isTargetDest && !isPendingMove && (
                    <circle cx={c.x} cy={c.y} r={0.4}
                      fill="none"
                      stroke={isActiveDest ? 'var(--accent)' : 'var(--gold)'}
                      strokeWidth={0.08}
                      className="vp-pulse"
                    />
                  )}
                  {isPendingMove && (
                    <circle cx={c.x} cy={c.y} r={0.42}
                      fill="var(--gold)" fillOpacity={0.3}
                      stroke="var(--gold)" strokeWidth={0.1}
                    />
                  )}
                  {isPlace && (
                    <rect x={c.x - 0.42} y={c.y - 0.42} width={0.84} height={0.84}
                      fill={isPending ? 'var(--gold)' : 'none'}
                      fillOpacity={isPending ? 0.4 : 0}
                      stroke="var(--gold)" strokeWidth={0.06} strokeDasharray="0.14 0.1"
                      className={isPending ? '' : 'vp-pulse'}
                    />
                  )}


                </g>
              )
            })}

            {/* persistent pawn layer: same element survives every move */}
            {state.pieces.map((p, i) => {
              const pos = piecePositions.get(i)
              if (!pos) return null
              const isSel = selectedPawn === i
              const movable = canAct && state.phase === 'move' && (movesByPawn.get(i)?.length ?? 0) > 0
              const doomed = !!preview?.captures.some(v => v.idx === i)
              const departing = preview?.kind === 'move' && preview.pawn === i
              return (
                <g
                  key={`pawn-slot-${i}`}
                  // Pawns are drawn ABOVE the circles, so without these the
                  // pawn swallows the pointer and the circle underneath never
                  // sees it: the preview only appeared at the pawn's edges.
                  onMouseEnter={coarse ? undefined : () => setHover(p.circle)}
                  onMouseLeave={coarse ? undefined : () => setHover(h => (h === p.circle ? null : h))}
                >
                  {movable && selectedPawn === null && (
                    <motion.circle
                      initial={false}
                      animate={{ cx: pos.x, cy: pos.y, r: pos.size * 0.92 }}
                      transition={{ type: 'spring', stiffness: 150, damping: 20 }}
                      fill="none" stroke="var(--gold)" strokeWidth={0.035}
                      strokeDasharray="0.06 0.06" opacity={0.65}
                      pointerEvents="none"
                    />
                  )}
                  {isSel && (
                    <motion.circle
                      initial={false}
                      animate={{ cx: pos.x, cy: pos.y, r: pos.size * 1.05 }}
                      transition={{ type: 'spring', stiffness: 150, damping: 20 }}
                      fill="none" stroke="var(--gold)" strokeWidth={0.06}
                      className="vp-pulse" pointerEvents="none"
                    />
                  )}
                  <motion.rect
                    initial={false}
                    animate={{
                      x: pos.x - pos.size / 2,
                      y: pos.y - pos.size / 2,
                      width: pos.size,
                      height: pos.size,
                      opacity: departing ? 0.35 : 1,
                    }}
                    transition={{ type: 'spring', stiffness: 150, damping: 20 }}
                    fill={seatColor(p.seat)}
                    stroke={isSel ? 'var(--gold)' : 'var(--bg)'}
                    strokeWidth={doomed ? 0.08 : isSel ? 0.1 : 0.04}
                    onClick={e => {
                      e.stopPropagation()
                      if (movable) tapPawn(i)
                      else tapCircle(p.circle)
                    }}
                    // Clickable either as one of my pawns, or as an enemy
                    // standing on a square I can capture into.
                    className={`${movable || isDestination(p.circle) ? 'cursor-pointer' : ''} ${doomed ? 'vp-doomed' : ''}`}
                  />
                </g>
              )
            })}

            {/* preview overlay (drawn above everything) */}
            {/* echo of the action that just resolved, for everyone */}
            {echo && (
              <g key={`echo-${echo.id}`} pointerEvents="none">
                {echo.movers.map(m => {
                  const a = map.circles[m.from]
                  const b = map.circles[m.to]
                  if (!a || !b) return null
                  return (
                    <g key={`mv-${m.idx}`}>
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={seatColor(m.seat)} strokeWidth={0.1}
                        strokeLinecap="round" className="vp-trail"
                      />
                      <circle
                        cx={b.x} cy={b.y} r={0.3}
                        fill="none" stroke={seatColor(m.seat)} strokeWidth={0.08}
                        className="vp-landing"
                      />
                    </g>
                  )
                })}
                {echo.victims.map(v => {
                  const a = map.circles[v.from]
                  const b = map.circles[v.to]
                  if (!a || !b) return null
                  return (
                    <g key={`vc-${v.idx}`}>
                      <line
                        x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                        stroke={seatColor(v.seat)} strokeWidth={0.07}
                        strokeLinecap="round" className="vp-trail" opacity={0.85}
                      />
                      <circle
                        cx={a.x} cy={a.y} r={0.28}
                        fill="none" stroke={seatColor(v.seat)} strokeWidth={0.08}
                        className="vp-landing"
                      />
                    </g>
                  )
                })}
                {echo.stonePlaced !== null && map.circles[echo.stonePlaced] && (
                  <circle
                    cx={map.circles[echo.stonePlaced].x} cy={map.circles[echo.stonePlaced].y}
                    r={0.3} fill="none" stroke="var(--muted)" strokeWidth={0.08}
                    className="vp-landing"
                  />
                )}
              </g>
            )}

            {preview && (() => {
              const dest = map.circles[preview.to]
              if (!dest) return null
              const ghost = 0.34
              // The mover's own colour identifies whose move is being previewed.
              const moverColor = seatColor(preview.seat)
              return (
                <g pointerEvents="none">
                  {/* travel path, in the moving player's colour */}
                  {preview.kind === 'move' && preview.from !== null && (() => {
                    const from = map.circles[preview.from]
                    return from ? (
                      <line
                        x1={from.x} y1={from.y} x2={dest.x} y2={dest.y}
                        stroke={moverColor} strokeWidth={0.07}
                        strokeDasharray="0.12 0.1" className="vp-ghost"
                      />
                    ) : null
                  })()}

                  {/* halo on the destination */}
                  <circle
                    cx={dest.x} cy={dest.y} r={0.46}
                    fill={preview.wins ? 'var(--accent)' : moverColor}
                    fillOpacity={0.18}
                    stroke={preview.wins ? 'var(--accent)' : moverColor}
                    strokeWidth={0.07}
                    className="vp-ghost"
                  />

                  {/* victims: flash a marker, and show where they land */}
                  {preview.captures.map(v => {
                    const home = map.circles[v.home]
                    // Each victim is drawn in THEIR colour, so it is obvious
                    // whose pawn is being sent home.
                    const victimColor = seatColor(v.seat)
                    return (
                      <g key={`cap-${v.idx}`}>
                        <line
                          x1={dest.x - 0.13} y1={dest.y - 0.13}
                          x2={dest.x + 0.13} y2={dest.y + 0.13}
                          stroke={victimColor} strokeWidth={0.08} className="vp-doomed"
                        />
                        <line
                          x1={dest.x + 0.13} y1={dest.y - 0.13}
                          x2={dest.x - 0.13} y2={dest.y + 0.13}
                          stroke={victimColor} strokeWidth={0.08} className="vp-doomed"
                        />
                        {home && (
                          <>
                            <line
                              x1={dest.x} y1={dest.y} x2={home.x} y2={home.y}
                              stroke={victimColor} strokeWidth={0.055}
                              strokeDasharray="0.1 0.12" opacity={0.85}
                            />
                            <rect
                              x={home.x - 0.15} y={home.y - 0.15} width={0.3} height={0.3}
                              fill={victimColor} opacity={0.55}
                              stroke={victimColor} strokeWidth={0.05}
                              className="vp-ghost"
                            />
                          </>
                        )}
                      </g>
                    )
                  })}

                  {/* the outcome itself */}
                  {preview.kind === 'move' ? (
                    <rect
                      x={dest.x - ghost / 2} y={dest.y - ghost / 2}
                      width={ghost} height={ghost}
                      fill={moverColor}
                      stroke={moverColor} strokeWidth={0.07}
                      strokeDasharray="0.1 0.07"
                      className="vp-ghost"
                    />
                  ) : (
                    <g className="vp-ghost">
                      <rect
                        x={dest.x - 0.24} y={dest.y - 0.24} width={0.48} height={0.48}
                        fill="var(--muted)" stroke="var(--gold)" strokeWidth={0.06}
                      />
                      <line x1={dest.x - 0.17} y1={dest.y - 0.17} x2={dest.x + 0.17} y2={dest.y + 0.17} stroke="var(--bg)" strokeWidth={0.07} />
                      <line x1={dest.x + 0.17} y1={dest.y - 0.17} x2={dest.x - 0.17} y2={dest.y + 0.17} stroke="var(--bg)" strokeWidth={0.07} />
                    </g>
                  )}

                  {/* barricade being picked up */}
                  {preview.takesStone && (
                    <circle
                      cx={dest.x} cy={dest.y} r={0.3}
                      fill="none" stroke="var(--gold)" strokeWidth={0.05}
                      strokeDasharray="0.08 0.08" className="vp-doomed"
                    />
                  )}
                </g>
              )
            })()}
          </svg>
        </div>

      </div>

      <ConfirmBar
        show={coarse && !over && (pendingPlace !== null || pendingMove !== null)}
        label={pendingPlace !== null ? 'DROP BARRICADE' : moveLabel}
        onConfirm={() => {
          if (pendingPlace !== null) api.sendAction({ t: 'place', to: pendingPlace }, actor)
          else if (pendingMove) api.sendAction({ t: 'move', pawn: pendingMove.pawn, to: pendingMove.to }, actor)
          setPendingPlace(null)
          setPendingMove(null)
          setSelectedPawn(null)
        }}
        onCancel={() => { setPendingPlace(null); setPendingMove(null) }}
      />

      {/* game over */}
      <AnimatePresence>
        {over && (
          <motion.div
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
              {winnerP ? (
                <>
                  <Avatar color={winnerP.color} name={winnerP.name} size={52} />
                  <Stamp tone="gold" className="!text-lg sm:!text-2xl">{winnerP.name} TAKES THE THRONE</Stamp>
                </>
              ) : (
                <Stamp>SESSION ADJOURNED</Stamp>
              )}
              <ScoreStrip api={api} />
              {meAdmin ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Btn variant="accent" onClick={api.startGame}>RECONVENE <ArrowRight size={14} /></Btn>
                  <Btn variant="outline" onClick={api.toLobby}>LOBBY</Btn>
                </div>
              ) : (
                <span className="label vp-pulse">AWAITING THE CONSUL</span>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
