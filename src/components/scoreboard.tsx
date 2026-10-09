'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { RotateCcw } from 'lucide-react'
import { CouncilApi } from '@/lib/council'
import { GAME_META, GAME_ORDER, GameId, roman, totalWins } from '@/lib/core'
import { Avatar, Btn, RoleTag, SectionHead, Toggle } from '@/components/ui'

const SHORT: Record<GameId, string> = {
  spyfall: 'SPY',
  chameleon: 'CHAM',
  imposter: 'CHAM',
  quoridor: 'QUO',
  barricade: 'BAR',
  coup: 'COU',
  wavelength: 'WAVE',
}

export function Scoreboard({ api, meAdmin }: { api: CouncilApi; meAdmin: boolean }) {
  const st = api.state!
  const scores = st.scores ?? {}
  const show = st.showScores !== false

  const rows = st.players
    .map(p => ({
      player: p,
      row: scores[p.id] ?? {},
      total: totalWins(scores[p.id]),
    }))
    .sort((a, b) => b.total - a.total || a.player.joinedAt - b.player.joinedAt)

  const anyWins = rows.some(r => r.total > 0)
  const best = rows[0]?.total ?? 0

  return (
    <section className="panel p-4 sm:p-5">
      <SectionHead
        title="Scoreboard"
        right={
          <div className="flex items-center gap-2">
            {meAdmin && show && anyWins && (
              <button
                onClick={() => api.moderate({ op: 'resetScores' })}
                title="Reset all records"
                className="inline-flex h-7 w-7 items-center justify-center border border-[var(--line)] text-[var(--muted)] hover:border-[var(--bad)] hover:text-[var(--bad)]"
              >
                <RotateCcw size={12} />
              </button>
            )}
            <Toggle
              on={show}
              disabled={!meAdmin}
              onChange={v => api.moderate({ op: 'showScores', value: v })}
            />
          </div>
        }
      />

      <AnimatePresence initial={false}>
        {show ? (
          <motion.div
            key="board"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* column key */}
            <div className="mb-2 flex items-center justify-end gap-1.5">
              {GAME_ORDER.map((g, i) => (
                <span
                  key={g}
                  title={GAME_META[g].name}
                  className="f-mono w-7 text-center text-[0.5rem] font-bold tracking-[0.08em] text-[var(--muted)]"
                >
                  {roman(i + 1)}
                </span>
              ))}
              <span className="f-mono w-8 text-center text-[0.5rem] font-bold tracking-[0.12em] text-[var(--gold)]">
                ALL
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {rows.map(({ player, row, total }) => {
                const leader = total > 0 && total === best
                return (
                  <motion.div
                    layout
                    key={player.id}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    className={`flex min-w-0 items-center gap-2 border px-2 py-1.5 ${
                      leader ? 'border-[var(--gold)]' : 'border-[var(--line)]'
                    }`}
                  >
                    <Avatar color={player.color} name={player.name} size={22} />
                    <span className="min-w-0 flex-1 truncate text-[0.78rem] font-bold tracking-[0.04em]">
                      {player.name}
                    </span>
                    {player.id === api.myId && <RoleTag tone="gold">YOU</RoleTag>}

                    {GAME_ORDER.map(g => {
                      const n = row[g] ?? 0
                      return (
                        <span
                          key={g}
                          title={`${GAME_META[g].name}: ${n}`}
                          className={`f-mono w-7 shrink-0 text-center text-[0.72rem] font-bold tabular ${
                            n ? 'text-[var(--ink)]' : 'text-[var(--line-strong)]'
                          }`}
                        >
                          {n || '·'}
                        </span>
                      )
                    })}
                    <span
                      className={`f-display w-8 shrink-0 text-center text-base font-black tabular ${
                        total ? 'text-[var(--gold)]' : 'text-[var(--line-strong)]'
                      }`}
                    >
                      {total}
                    </span>
                  </motion.div>
                )
              })}
            </div>

            {!anyWins && (
              <p className="f-mono mt-2.5 text-[0.58rem] font-bold tracking-[0.16em] text-[var(--muted)]">
                NO VICTORIES RECORDED YET
              </p>
            )}
          </motion.div>
        ) : (
          <motion.p
            key="off"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="f-mono text-[0.58rem] font-bold tracking-[0.16em] text-[var(--muted)]"
          >
            HIDDEN{meAdmin ? '' : ' BY THE CONSUL'} · RECORDS STILL TALLY
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  )
}

/** Compact win tally for the end-of-game screens. */
export function ScoreStrip({ api, onRecord }: { api: CouncilApi; onRecord?: () => void }) {
  const st = api.state!
  const scores = st.scores ?? {}
  const rows =
    st.showScores === false
      ? []
      : st.players
          .map(p => ({ p, total: totalWins(scores[p.id]) }))
          .filter(r => r.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, 6)

  // With onRecord the "RECORD" text becomes the entry point to that game's
  // full Senate Record popup; without it it stays a plain column label.
  const recordLabel = onRecord ? (
    <button
      type="button"
      onClick={onRecord}
      title="Open the Senate Record"
      className="label !text-[0.5rem] cursor-pointer transition-colors hover:text-[var(--gold)]"
    >
      RECORD
    </button>
  ) : (
    <span className="label !text-[0.5rem]">RECORD</span>
  )

  if (!rows.length) {
    if (!onRecord) return null
    return (
      <div className="flex w-full flex-col items-center gap-1.5">
        {recordLabel}
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      {recordLabel}
      <div className="flex flex-wrap justify-center gap-1.5">
        {rows.map(({ p, total }) => (
          <span key={p.id} className="flex items-center gap-1.5 border border-[var(--line)] px-1.5 py-1">
            <span className="h-2.5 w-2.5 shrink-0" style={{ background: p.color }} />
            <span className="f-mono text-[0.6rem] font-bold">{p.name}</span>
            <span className="f-display text-[0.72rem] font-black text-[var(--gold)] tabular">{total}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
