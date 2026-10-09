'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CouncilApi } from '@/lib/council'
import { canProxyFor } from '@/lib/core'
import { QFence, QState, outcomeFor, qFenceValid, qMoves } from '@/lib/games'
import { sfx } from '@/lib/sound'
import { Avatar, Btn, ConfirmBar, Countdown, RoleTag, Stamp, TimerBar, VetoedBanner, inkOn, useCoarsePointer } from '@/components/ui'
import { ScoreStrip } from '@/components/scoreboard'

const CELL = 100 / 9
const snapT = { type: 'spring' as const, stiffness: 420, damping: 32 }

/*
 * Per-player board orientation.
 *
 * The authoritative state is ALWAYS canonical (seat 0 at the bottom). Each
 * client merely rotates the presentation so its own pawn starts at the bottom
 * and advances upward. Every click is converted straight back to canonical
 * before it is sent, so all boards stay in sync: nothing rotated is ever
 * transmitted or stored.
 *
 * One quarter turn maps cell (r,c) -> (c, 8-r).
 */
type Turn = 0 | 1 | 2 | 3

/** Quarter turns needed so a given seat sits at the bottom of the screen. */
const SEAT_TURNS: Turn[] = [0, 2, 1, 3]

const toView = (r: number, c: number, k: Turn): [number, number] => {
  let R = r, C = c
  for (let i = 0; i < k; i++) { const nr = C, nc = 8 - R; R = nr; C = nc }
  return [R, C]
}

const fromView = (R: number, C: number, k: Turn): [number, number] => {
  let r = R, c = C
  for (let i = 0; i < k; i++) { const pr = 8 - c, pc = r; r = pr; c = pc }
  return [r, c]
}

const flip = (o: 'h' | 'v'): 'h' | 'v' => (o === 'h' ? 'v' : 'h')

/** Fence centres live on the 8x8 gap grid, so they rotate about 7, not 8. */
const fenceToView = (f: QFence, k: Turn): QFence => {
  let r = f.r, c = f.c, o = f.o
  for (let i = 0; i < k; i++) { const nr = c, nc = 7 - r; r = nr; c = nc; o = flip(o) }
  return { ...f, r, c, o }
}

const fenceFromView = (f: QFence, k: Turn): QFence => {
  let r = f.r, c = f.c, o = f.o
  for (let i = 0; i < k; i++) { const pr = 7 - c, pc = r; r = pr; c = pc; o = flip(o) }
  return { ...f, r, c, o }
}

/** Canonical goal edge: 0 top, 1 right, 2 bottom, 3 left. */
const goalEdge = (g: { t: 'r' | 'c'; v: number }) =>
  g.t === 'r' ? (g.v === 0 ? 0 : 2) : (g.v === 0 ? 3 : 1)

export function QuoridorGame({ api, state }: { api: CouncilApi; state: QState }) {
  const st = api.state!
  const players = st.players
  const myId = api.myId
  const me = players.find(p => p.id === myId)
  const meAdmin = !!me && (me.isAdmin || me.isOwner)
  const coarse = useCoarsePointer()
  const [pending, setPending] = useState<{ kind: 'move'; to: [number, number] } | { kind: 'fence'; f: QFence } | null>(null)
  useEffect(() => { setPending(null) }, [state.turn, state.stage])

  const cur = state.participants[state.turn]
  const curP = players.find(p => p.id === cur)
  const mine = cur === myId
  const proxy = meAdmin && !!curP && canProxyFor(curP)
  const canAct = state.stage === 'play' && (mine || proxy)
  const actor = cur

  const moves = useMemo(() => (state.stage === 'play' && canAct ? qMoves(state, state.turn) : []), [state, canAct])
  const moveSet = useMemo(() => new Set(moves.map(([r, c]) => `${r},${c}`)), [moves])

  // Rotate the view so MY pawn is at the bottom. Spectators keep canonical.
  const mySeat = state.participants.indexOf(myId)
  const k: Turn = mySeat >= 0 ? SEAT_TURNS[mySeat] ?? 0 : 0
  const view = (r: number, c: number) => toView(r, c, k)

  const nameOf = (id: string) => players.find(p => p.id === id)?.name ?? '?'
  const colorOf = (id: string) => players.find(p => p.id === id)?.color ?? 'var(--muted)'
  const fenceColor = (f: QFence) =>
    f.by === undefined ? 'var(--line-strong)' : colorOf(state.participants[f.by] ?? '')

  const exec = (action: { t: 'move'; to: [number, number] } | { t: 'fence'; f: QFence }) => {
    api.sendAction(action, actor)
    setPending(null)
  }

  const tapCell = (r: number, c: number) => {
    if (!canAct || !moveSet.has(`${r},${c}`)) return
    if (coarse) { sfx.tick(); setPending({ kind: 'move', to: [r, c] }) }
    else exec({ t: 'move', to: [r, c] })
  }

  const validFences = useMemo(() => {
    const set = new Set<string>()
    if (!canAct || state.fencesLeft[state.turn] <= 0) return set
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (qFenceValid(state, state.turn, { r, c, o: 'h' })) set.add(`h${r},${c}`)
        if (qFenceValid(state, state.turn, { r, c, o: 'v' })) set.add(`v${r},${c}`)
      }
    }
    return set
  }, [state, canAct])

  const fenceValid = (f: QFence) => validFences.has(`${f.o}${f.r},${f.c}`)

  const tapFence = (f: QFence) => {
    if (!canAct || !fenceValid(f)) return
    if (coarse) { sfx.tick(); setPending({ kind: 'fence', f }) }
    else exec({ t: 'fence', f })
  }

  const over = state.stage === 'over'
  const winnerP = state.winner !== null ? players.find(p => p.id === state.participants[state.winner!]) : null
  const iLost = outcomeFor('quoridor', state, myId) === 'lost'

  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
      {/* rail */}
      <div className="order-2 flex min-w-0 flex-col gap-2 lg:order-1 lg:w-60 lg:shrink-0">
        {state.participants.map((id, i) => {
          const pl = players.find(p => p.id === id)
          if (!pl) return null
          const active = state.turn === i && !over
          return (
            <motion.div
              key={id}
              layout
              className={`flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-2 p-2.5 transition-colors ${active ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}
            >
              <Avatar color={pl.color} name={pl.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold tracking-wider">{pl.name}</div>
                <div className="f-mono text-[0.58rem] font-bold tracking-[0.16em] text-[var(--muted)]">
                  {state.fencesLeft[i]} WALLS
                </div>
              </div>
              {active && <span className="vp-pulse h-2 w-2 bg-[var(--accent)]" />}
              {id === myId && <RoleTag tone="gold">YOU</RoleTag>}
              {pl.isBot && <RoleTag>BOT</RoleTag>}
            </motion.div>
          )
        })}
        {state.endsAt && (
          <div className="flex flex-col gap-1.5 border border-[var(--line)] p-2.5">
            <div className="flex items-center justify-between">
              <span className="label">Turn clock</span>
              <Countdown endsAt={state.endsAt} warnAt={5000} />
            </div>
            <TimerBar endsAt={state.endsAt} totalMs={state.seconds * 1000} />
          </div>
        )}
        {!state.participants.includes(myId) && (
          <div className="label mt-1">SPECTATING FROM THE GALLERY</div>
        )}
      </div>

      {/* board */}
      <div className="order-1 min-w-0 flex-1 lg:order-2">
        <div className="relative mx-auto aspect-square w-full max-w-[560px] select-none border-2 border-[var(--line-strong)] bg-[var(--bg2)]">
          {/* cells */}
          {Array.from({ length: 81 }, (_, n) => {
            const vr = Math.floor(n / 9)
            const vc = n % 9
            const [r, c] = fromView(vr, vc, k)   // canonical, for game logic
            const isMove = moveSet.has(`${r},${c}`)
            const isPending = pending?.kind === 'move' && pending.to[0] === r && pending.to[1] === c
            return (
              <div
                key={n}
                onClick={() => tapCell(r, c)}
                className={`absolute border border-[var(--line)] ${(r + c) % 2 ? 'bg-[var(--panel)]' : 'bg-[var(--panel2)]'} ${isMove ? 'cursor-pointer' : ''}`}
                style={{ left: `${vc * CELL}%`, top: `${vr * CELL}%`, width: `${CELL}%`, height: `${CELL}%` }}
              >
                {isMove && (
                  <span
                    className={`vp-pulse absolute left-1/2 top-1/2 block h-[36%] w-[36%] -translate-x-1/2 -translate-y-1/2 ${isPending ? 'bg-[var(--gold)]' : 'bg-[var(--accent)]'}`}
                    style={{ opacity: isPending ? 1 : 0.85 }}
                  />
                )}
              </div>
            )
          })}

          {/* fence slots (hit areas) */}
          {canAct && Array.from({ length: 64 }, (_, n) => {
            // Slots are laid out in VIEW space; each maps back to a canonical
            // fence before it is validated or sent.
            const vr = Math.floor(n / 8)
            const vc = n % 8
            const hCanon = fenceFromView({ r: vr, c: vc, o: 'h' }, k)
            const vCanon = fenceFromView({ r: vr, c: vc, o: 'v' }, k)
            const okH = fenceValid(hCanon)
            const okV = fenceValid(vCanon)
            const slotCls = 'absolute z-10 cursor-pointer transition-colors hover:bg-[var(--gold)]/40'
            return (
              <div key={n}>
                {okH && (
                  <div
                    onClick={() => tapFence(hCanon)}
                    className={slotCls}
                    style={{
                      left: `${vc * CELL}%`, width: `${2 * CELL}%`,
                      top: `calc(${(vr + 1) * CELL}% - 1.4%)`, height: '2.8%',
                    }}
                  />
                )}
                {okV && (
                  <div
                    onClick={() => tapFence(vCanon)}
                    className={slotCls}
                    style={{
                      top: `${vr * CELL}%`, height: `${2 * CELL}%`,
                      left: `calc(${(vc + 1) * CELL}% - 1.4%)`, width: '2.8%',
                    }}
                  />
                )}
              </div>
            )
          })}

          {/* placed fences */}
          {state.fences.map((f, i) => {
            const v = fenceToView(f, k)
            return (
              <motion.div
                key={`${f.r}-${f.c}-${f.o}-${i}`}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={snapT}
                className="absolute z-20 border border-[var(--bg)]"
                style={
                  v.o === 'h'
                    ? { left: `${v.c * CELL + 0.4}%`, width: `${2 * CELL - 0.8}%`, top: `calc(${(v.r + 1) * CELL}% - 0.9%)`, height: '1.8%', background: fenceColor(f) }
                    : { top: `${v.r * CELL + 0.4}%`, height: `${2 * CELL - 0.8}%`, left: `calc(${(v.c + 1) * CELL}% - 0.9%)`, width: '1.8%', background: fenceColor(f) }
                }
              />
            )
          })}

          {/* pending ghost fence */}
          {pending?.kind === 'fence' && (() => {
            const v = fenceToView(pending.f, k)
            return (
              <div
                className="absolute z-30 vp-pulse border border-dashed border-[var(--gold)] bg-[var(--gold)]/50"
                style={
                  v.o === 'h'
                    ? { left: `${v.c * CELL + 0.4}%`, width: `${2 * CELL - 0.8}%`, top: `calc(${(v.r + 1) * CELL}% - 0.9%)`, height: '1.8%' }
                    : { top: `${v.r * CELL + 0.4}%`, height: `${2 * CELL - 0.8}%`, left: `calc(${(v.c + 1) * CELL}% - 0.9%)`, width: '1.8%' }
                }
              />
            )
          })()}

          {/* pawns */}
          {state.pawns.map((p, i) => {
            const id = state.participants[i]
            const active = state.turn === i && !over
            return (
              <motion.div
                key={id}
                initial={false}
                animate={{ left: `${view(p.r, p.c)[1] * CELL}%`, top: `${view(p.r, p.c)[0] * CELL}%` }}
                transition={snapT}
                className="pointer-events-none absolute z-30 flex items-center justify-center"
                style={{ width: `${CELL}%`, height: `${CELL}%` }}
              >
                <motion.div
                  animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={active ? { repeat: Infinity, duration: 1.4 } : {}}
                  className="flex h-[68%] w-[68%] items-center justify-center border-2 border-[var(--bg)] shadow-[3px_3px_0_var(--shadow)]"
                  style={{ background: colorOf(id) }}
                >
                  <span
                    className="f-display text-[clamp(10px,2.4vmin,16px)] font-black"
                    style={{ color: inkOn(colorOf(id)) }}
                  >
                    {nameOf(id).charAt(0)}
                  </span>
                </motion.div>
              </motion.div>
            )
          })}

          {/* goal-edge tints */}
          {state.goals.map((g, i) => {
            // 0 top, 1 right, 2 bottom, 3 left - rotated into view space, so
            // every player sees their own goal along the top edge.
            const edge = (goalEdge(g) + k) % 4
            const style =
              edge === 0 ? { left: 0, top: '-4px', width: '100%', height: 4 }
              : edge === 2 ? { left: 0, bottom: '-4px', width: '100%', height: 4 }
              : edge === 3 ? { top: 0, left: '-4px', height: '100%', width: 4 }
              : { top: 0, right: '-4px', height: '100%', width: 4 }
            return <div key={i} className="absolute z-40" style={{ ...style, background: colorOf(state.participants[i]) }} />
          })}
        </div>
      </div>

      <ConfirmBar
        show={coarse && !!pending && !over}
        label={pending?.kind === 'fence' ? 'RAISE WALL' : 'MOVE PAWN'}
        onConfirm={() => {
          if (!pending) return
          if (pending.kind === 'move') exec({ t: 'move', to: pending.to })
          else exec({ t: 'fence', f: pending.f })
        }}
        onCancel={() => setPending(null)}
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
              transition={snapT}
              className="panel-hard brackets flex w-full max-w-md flex-col items-center gap-4 p-5 text-center sm:p-6"
            >
              {iLost && <VetoedBanner />}
              {winnerP ? (
                <>
                  <Avatar color={winnerP.color} name={winnerP.name} size={52} />
                  <Stamp tone="gold" className="!text-lg sm:!text-2xl">{winnerP.name} PREVAILS</Stamp>
                  <span className="f-mono text-[0.62rem] font-bold tracking-[0.2em] text-[var(--muted)]">
                    THE FAR SIDE IS REACHED
                  </span>
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
