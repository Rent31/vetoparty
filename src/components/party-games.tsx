'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Crown, Gavel, TriangleAlert, UserCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CouncilApi } from '@/lib/council'
import { CouncilPlayer, SettingsMap, canProxyFor, roman } from '@/lib/core'
import { PartyState, outcomeFor, partyTally, verdictStatus } from '@/lib/games'
import { sfx } from '@/lib/sound'
import { Avatar, Btn, Countdown, RoleTag, SectionHead, Stamp, TimerBar, VetoedBanner, inputCls } from '@/components/ui'
import { ScoreStrip } from '@/components/scoreboard'

const rise = (d = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.25, delay: d },
})

function stageIndex(s: PartyState) {
  return s.stage === 'play' ? 1 : s.stage === 'vote' ? 2 : s.stage === 'accuse' ? 3 : s.stage === 'verdict' ? 4 : 5
}

export function PartyGame({ api, state, settings }: { api: CouncilApi; state: PartyState; settings: SettingsMap }) {
  const st = api.state!
  const players = st.players
  const myId = api.myId
  const me = players.find(p => p.id === myId)
  const meAdmin = !!me && (me.isAdmin || me.isOwner)
  const seated = state.electorate.includes(myId)
  const meBad = state.bad.includes(myId)
  const tally = partyTally(state, players)
  // Only the losing side sees the VETOED stamp. Spectators and an adjourned
  // game resolve to null, so neither is ever told they lost.
  const iLost = outcomeFor(state.kind, state, myId) === 'lost'
  const totalMs = (state.kind === 'spyfall' ? settings.spyfall.seconds : (settings.chameleon?.seconds ?? settings.imposter?.seconds ?? 300)) * 1000
  const badNames = state.bad.map(id => players.find(p => p.id === id)?.name ?? '?')

  const p = (id: string) => players.find(x => x.id === id)
  const nameOf = (id: string) => p(id)?.name ?? 'SENATOR'

  // Fall back for games already in flight when the rotation shipped, and drop
  // anyone who has since been kicked or moved to the gallery.
  const speakingOrder = (state.order?.length ? state.order : [state.first, ...state.electorate])
    .filter((id, i, arr) => arr.indexOf(id) === i)
    .filter(id => state.electorate.includes(id))
    .filter(id => { const pl = p(id); return !!pl && !pl.isSpectator })
  const word = state.kind === 'spyfall' ? 'LOCATION' : 'WORD'
  const foe = state.kind === 'spyfall' ? 'SPY' : 'CHAMELEON'

  // admin proxies (bots / absent members)
  const proxyables = meAdmin
    ? state.electorate.filter(id => {
        const pl = p(id)
        return pl && canProxyFor(pl) && !state.votes[id]
      })
    : []

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-4">
      {/* stage rail */}
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4].map(n => (
          <div key={n} className={`h-1 flex-1 transition-colors ${stageIndex(state) >= n ? 'bg-[var(--accent)]' : 'bg-[var(--line)]'}`} />
        ))}
        <Countdown endsAt={state.endsAt} />
      </div>
      <TimerBar endsAt={state.endsAt} totalMs={totalMs} />

      <AnimatePresence mode="wait">
        {/* ── STAGE I · PLAY ─────────────────────────────────────────── */}
        {state.stage === 'play' && (
          <motion.div key="play" {...rise()} className="flex flex-col gap-4">
            <div className="panel brackets flex flex-col items-center gap-3 p-6 text-center">
              {seated ? (
                meBad ? (
                  <>
                    <span className="label">YOUR DECREE</span>
                    <Stamp tone="accent" className="!text-lg sm:!text-3xl">YOU ARE THE {foe}</Stamp>
                    <span className="f-mono text-[0.65rem] font-bold tracking-[0.2em] text-[var(--muted)]">
                      BLEND IN · ANSWER TRUE · LEARN THE {word}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="label">THE {word} IS</span>
                    <span className="f-display break-words text-2xl font-black uppercase leading-tight text-[var(--gold)] sm:text-4xl">
                      {state.subject}
                    </span>
                    <span className="f-mono text-[0.65rem] font-bold tracking-[0.2em] text-[var(--muted)]">
                      ROOT OUT THE {foe}{state.bad.length > 1 ? 'S' : ''} · {state.bad.length} AMONG {state.electorate.length}
                    </span>
                  </>
                )
              ) : (
                <Stamp tone="gold">SPECTATING</Stamp>
              )}
            </div>

            <div className="panel p-3">
              <div className="flex items-center gap-3">
                <Avatar color={p(state.first)?.color ?? '#666'} name={nameOf(state.first)} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="label">{state.kind === 'spyfall' ? 'FIRST TO ASK' : 'SPEAKS FIRST'}</div>
                  <div className="truncate text-sm font-bold tracking-wider">{nameOf(state.first)}</div>
                </div>
                <UserCheck size={16} className="shrink-0 text-[var(--gold)]" />
              </div>

              {speakingOrder.length > 1 && (
                <>
                  <div className="rule-dash my-3" />
                  <div className="label mb-2">SUGGESTED ORDER</div>
                  <ol className="flex flex-wrap items-center gap-1.5">
                    {speakingOrder.map((id, i) => (
                      <li
                        key={id}
                        className={`flex items-center gap-1.5 border px-1.5 py-1 ${
                          id === state.first ? 'border-[var(--gold)]' : 'border-[var(--line)]'
                        }`}
                      >
                        <span className="f-mono text-[0.55rem] font-bold text-[var(--muted)]">{i + 1}</span>
                        <span className="h-2.5 w-2.5 shrink-0" style={{ background: p(id)?.color ?? '#666' }} />
                        <span className="f-mono whitespace-nowrap text-[0.62rem] font-bold">{nameOf(id)}</span>
                      </li>
                    ))}
                  </ol>
                  {state.kind === 'spyfall' && (
                    <p className="f-mono mt-2 text-[0.55rem] font-bold leading-relaxed tracking-[0.14em] text-[var(--muted)]">
                      FOLLOW THIS ORDER, OR LET WHOEVER WAS ASKED ASK NEXT - AGREE BEFORE YOU BEGIN
                    </p>
                  )}
                </>
              )}
            </div>

            {state.pack.length > 0 && (
              <div className="panel p-4">
                <div className="label mb-3">ALL POSSIBLE {word}S · {state.pack.length}</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {state.pack.map(loc => (
                    <div
                      key={loc}
                      className={`f-mono border px-2 py-1.5 text-[0.6rem] font-bold tracking-[0.08em] uppercase ${
                        !meBad && seated && loc === state.subject
                          ? 'border-[var(--gold)] text-[var(--gold)]'
                          : 'border-[var(--line)] text-[var(--ink-dim)]'
                      }`}
                    >
                      {loc}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── STAGE II · VOTE ────────────────────────────────────────── */}
        {state.stage === 'vote' && (
          <motion.div key="vote" {...rise()} className="flex flex-col gap-4">
            <div className="panel brackets p-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <Gavel size={16} className="text-[var(--accent)]" />
                <span className="f-display text-sm font-bold tracking-[0.25em]">THE TRIBUNAL</span>
              </div>
              <p className="f-mono mt-2 text-[0.62rem] font-bold tracking-[0.16em] text-[var(--muted)]">
                NAME THE {foe} · BALLOTS ARE LIVE · TIES DEADLOCK
              </p>
            </div>

            {tally.tie && (
              <motion.div
                {...rise()}
                className="flex items-center gap-3 border-2 border-[var(--accent)] bg-[var(--panel)] p-3 text-[var(--accent)]"
              >
                <TriangleAlert size={18} className="shrink-0" />
                <span className="f-mono text-[0.65rem] font-bold tracking-[0.14em]">
                  TIED BALLOTS - ALTER VOTES TO BREAK THE DEADLOCK
                </span>
              </motion.div>
            )}

            <div className="flex flex-col gap-1.5">
              {state.electorate.map(id => {
                const pl = p(id)
                if (!pl) return null
                const count = tally.counts[id] ?? 0
                const mine = state.votes[myId] === id
                const voters = state.electorate.filter(v => state.votes[v] === id)
                const canVote = seated && id !== myId && (me?.connected || me?.isBot)
                return (
                  <motion.button
                    layout
                    key={id}
                    whileTap={canVote ? { scale: 0.98 } : undefined}
                    onClick={() => canVote && api.sendAction({ t: 'vote', target: mine ? null : id })}
                    className={`relative flex items-center gap-2.5 border-2 px-2.5 py-2 text-left transition-colors ${
                      mine ? 'border-[var(--accent)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]'
                    } ${!canVote || id === myId ? 'cursor-default' : ''}`}
                  >
                    <Avatar color={pl.color} name={pl.name} size={30} dim={!pl.connected && !pl.isBot} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-sm font-bold tracking-wider">{pl.name}</span>
                        {id === myId && <RoleTag tone="gold">YOU</RoleTag>}
                        {mine && <RoleTag tone="accent">YOUR BALLOT</RoleTag>}
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        {voters.map(v => (
                          <span key={v} className="h-2.5 w-2.5 border border-[var(--bg)]" style={{ background: p(v)?.color ?? '#666' }} />
                        ))}
                      </div>
                    </div>
                    <span className={`f-display text-2xl font-black tabular ${count ? 'text-[var(--accent)]' : 'text-[var(--line)]'}`}>
                      {count}
                    </span>
                  </motion.button>
                )
              })}
            </div>

            {proxyables.length > 0 && (
              <div className="panel p-3">
                <div className="label mb-2">PROXY BALLOTS (CONSUL)</div>
                <div className="flex flex-col gap-1.5">
                  {proxyables.map(botId => (
                    <div key={botId} className="flex min-w-0 flex-wrap items-center gap-2">
                      <Avatar color={p(botId)?.color ?? '#666'} name={nameOf(botId)} size={22} />
                      <span className="f-mono flex-1 text-[0.65rem] font-bold">{nameOf(botId)}</span>
                      <select
                        className={`${inputCls} !w-auto !py-1 !text-[0.65rem]`}
                        value=""
                        onChange={e => e.target.value && api.sendAction({ t: 'vote', target: e.target.value }, botId)}
                      >
                        <option value="">BALLOT…</option>
                        {state.electorate.filter(x => x !== botId).map(x => (
                          <option key={x} value={x}>{nameOf(x)}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── STAGE III · ACCUSE ─────────────────────────────────────── */}
        {state.stage === 'accuse' && state.accused && (
          <AccuseStage key="accuse" api={api} state={state} word={word} foe={foe} meAdmin={meAdmin} />
        )}

        {/* ── STAGE IV · VERDICT ─────────────────────────────────────── */}
        {state.stage === 'verdict' && (
          <VerdictStage key="verdict" api={api} state={state} players={players} meAdmin={meAdmin} />
        )}

        {/* ── STAGE V · OVER ─────────────────────────────────────────── */}
        {state.stage === 'over' && (
          <motion.div key="over" {...rise()} className="flex flex-col items-center gap-4">
            <div className="panel-hard brackets flex w-full flex-col items-center gap-4 p-6 text-center">
              {iLost && <VetoedBanner />}
              {state.winner === null ? (
                <Stamp>SESSION ADJOURNED</Stamp>
              ) : state.winner === 'rogue' ? (
                <Stamp tone="accent" className="!text-lg sm:!text-3xl">
                  THE {state.kind === 'spyfall' ? (state.bad.length > 1 ? 'SPIES' : 'SPY') : (state.bad.length > 1 ? 'CHAMELEONS' : 'CHAMELEON')} PREVAIL{state.bad.length > 1 ? '' : 'S'}
                </Stamp>
              ) : (
                <Stamp tone="gold" className="!text-lg sm:!text-3xl">THE COUNCIL PREVAILS</Stamp>
              )}
              <div className="f-mono text-[0.65rem] font-bold tracking-[0.18em] text-[var(--muted)]">
                THE {word} WAS <span className="text-[var(--gold)]">{state.subject.toUpperCase()}</span>
                {state.guess ? <> · GUESS: <span className="text-[var(--accent)]">{state.guess.toUpperCase()}</span></> : null}
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {state.electorate.map(id => {
                  const pl = p(id)
                  if (!pl) return null
                  const bad = state.bad.includes(id)
                  return (
                    <div key={id} className={`flex items-center gap-2 border px-2 py-1.5 ${bad ? 'border-[var(--accent)]' : 'border-[var(--line)]'}`}>
                      <span className="h-3 w-3" style={{ background: pl.color }} />
                      <span className="f-mono text-[0.62rem] font-bold">{pl.name}</span>
                      {bad && <RoleTag tone="accent">{foe}</RoleTag>}
                    </div>
                  )
                })}
              </div>
            </div>
            <ScoreStrip api={api} />
            {meAdmin ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Btn variant="accent" onClick={api.startGame}>RECONVENE <ArrowRight size={14} /></Btn>
                <Btn variant="outline" onClick={api.toLobby}>RETURN TO LOBBY</Btn>
              </div>
            ) : (
              <span className="label vp-pulse">AWAITING THE CONSUL</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function AccuseStage({ api, state, word, foe, meAdmin }: {
  api: CouncilApi
  state: PartyState
  word: string
  foe: string
  meAdmin: boolean
}) {
  const st = api.state!
  const players = st.players
  const accused = players.find(p => p.id === state.accused)
  const myId = api.myId
  const mine = state.accused === myId
  const proxy = meAdmin && !!accused && canProxyFor(accused)
  const active = mine || proxy
  const [guess, setGuess] = useState('')
  const [choice, setChoice] = useState(state.pack[0] ?? '')

  if (!accused) return null

  return (
    <motion.div {...rise()} className="flex flex-col items-center gap-4">
      <div className="panel brackets flex w-full flex-col items-center gap-3 p-6 text-center">
        <div className="flex items-center gap-2">
          <Avatar color={accused.color} name={accused.name} size={30} />
          <span className="f-display text-sm font-bold tracking-[0.15em]">{accused.name}</span>
          <RoleTag tone="accent">BANISHED - THE {foe}</RoleTag>
        </div>
        <div className="rule-dash w-full" />
        {active ? (
          <>
            <span className="label">FINAL MOVE · NAME THE {word}</span>
            {state.freeGuess ? (
              <form
                className="flex w-full max-w-sm gap-1.5"
                onSubmit={e => { e.preventDefault(); guess.trim() && api.sendAction({ t: 'accuse', guess }, state.accused!) }}
              >
                <input
                  autoFocus
                  className={`${inputCls} flex-1 !text-base`}
                  placeholder="TYPE YOUR GUESS"
                  value={guess}
                  onChange={e => setGuess(e.target.value)}
                />
                <Btn variant="accent" disabled={!guess.trim()} onClick={() => guess.trim() && api.sendAction({ t: 'accuse', guess }, state.accused!)}>
                  ACCUSE
                </Btn>
              </form>
            ) : (
              <div className="flex w-full max-w-sm flex-col gap-2">
                <select
                  className={inputCls}
                  value={choice}
                  onChange={e => setChoice(e.target.value)}
                >
                  {state.pack.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <Btn variant="accent" onClick={() => api.sendAction({ t: 'accuse', guess: choice }, state.accused!)}>
                  DECLARE <ArrowRight size={14} />
                </Btn>
              </div>
            )}
            {state.freeGuess && (
              <span className="f-mono text-[0.6rem] font-bold tracking-[0.14em] text-[var(--muted)]">
                THE COUNCIL SHALL JUDGE YOUR ANSWER
              </span>
            )}
          </>
        ) : (
          <span className="f-mono text-[0.7rem] font-bold tracking-[0.2em] text-[var(--muted)] vp-pulse">
            {accused.name} IS NAMING THE {word}…
          </span>
        )}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function VerdictStage({ api, state, players, meAdmin }: {
  api: CouncilApi
  state: PartyState
  players: CouncilPlayer[]
  meAdmin: boolean
}) {
  const myId = api.myId
  const iVote = state.electorate.includes(myId) && !state.bad.includes(myId)
  const v = verdictStatus(state, players)
  const myVerdict = state.verdicts[myId]
  const p = (id: string) => players.find(x => x.id === id)

  const proxyables = meAdmin
    ? v.voters.filter(id => {
        const pl = p(id)
        return pl && canProxyFor(pl) && state.verdicts[id] === undefined
      })
    : []

  return (
    <motion.div {...rise()} className="mx-auto flex w-full max-w-xl flex-col items-center gap-4">
      <div className="panel brackets flex w-full flex-col items-center gap-3 p-6 text-center">
        <span className="label">THE {state.kind === 'spyfall' ? 'SPY' : 'CHAMELEON'} CLAIMS</span>
        <Stamp tone="gold" className="!text-xl sm:!text-2xl">“{state.guess}”</Stamp>
        <span className="f-mono text-[0.62rem] font-bold tracking-[0.16em] text-[var(--muted)]">
          SHALL THE COUNCIL ACCEPT THIS ANSWER?
        </span>

        <div className="mt-1 flex w-full max-w-xs items-stretch gap-2">
          <div className={`flex flex-1 flex-col items-center border-2 p-3 ${myVerdict === true ? 'border-[var(--ok)]' : 'border-[var(--line)]'}`}>
            <span className="f-display text-2xl font-black text-[var(--ok)]">{v.yea}</span>
            <span className="label !text-[0.55rem]">YEA</span>
          </div>
          <div className={`flex flex-1 flex-col items-center border-2 p-3 ${myVerdict === false ? 'border-[var(--bad)]' : 'border-[var(--line)]'}`}>
            <span className="f-display text-2xl font-black text-[var(--bad)]">{v.nay}</span>
            <span className="label !text-[0.55rem]">NAY</span>
          </div>
        </div>

        {v.tie && (
          <div className="flex items-center gap-2 text-[var(--accent)]">
            <TriangleAlert size={15} />
            <span className="f-mono text-[0.62rem] font-bold tracking-[0.14em]">DEADLOCKED - CHANGE A VERDICT</span>
          </div>
        )}

        {iVote ? (
          <div className="flex gap-2">
            <Btn variant="ok" onClick={() => api.sendAction({ t: 'verdict', accept: true })}>
              <Crown size={14} /> YEA
            </Btn>
            <Btn variant="danger" onClick={() => api.sendAction({ t: 'verdict', accept: false })}>
              NAY
            </Btn>
          </div>
        ) : (
          <span className="label vp-pulse">THE COUNCIL DELIBERATES</span>
        )}
      </div>

      {proxyables.length > 0 && (
        <div className="panel w-full p-3">
          <div className="label mb-2">PROXY VERDICTS (CONSUL)</div>
          <div className="flex flex-col gap-1.5">
            {proxyables.map(id => (
              <div key={id} className="flex min-w-0 flex-wrap items-center gap-2">
                <Avatar color={p(id)?.color ?? '#666'} name={p(id)?.name ?? '?'} size={22} />
                <span className="f-mono flex-1 text-[0.65rem] font-bold">{p(id)?.name}</span>
                <Btn small variant="ok" onClick={() => api.sendAction({ t: 'verdict', accept: true }, id)}>YEA</Btn>
                <Btn small variant="danger" onClick={() => api.sendAction({ t: 'verdict', accept: false }, id)}>NAY</Btn>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}
