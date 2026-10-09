'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Eye, Gavel, LogOut, RotateCcw, SkipForward, Users, X, OctagonX } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CouncilApi, useCouncil } from '@/lib/council'
import { GAME_META, GAME_ORDER, hasChosenName, roman } from '@/lib/core'
import { BState, CoupState, PartyState, QState, matchesGame } from '@/lib/games'
import { initSound, sfx } from '@/lib/sound'
import { Btn, IconBtn, RoleTag, SoundToggle, ThemeToggle, Veil } from '@/components/ui'
import { Lobby } from '@/components/lobby'
import { ProfileGate } from '@/components/profile-gate'
// Game screens are code-split. Only the selected game's UI is downloaded.
const loadPartyScreen = () => import('@/components/party-games')
const loadQuoridorScreen = () => import('@/components/quoridor')
const loadBarricadeScreen = () => import('@/components/barricade')
const loadCoupScreen = () => import('@/components/coup')
const loadWavelengthScreen = () => import('@/components/wavelength')

const PartyGame = dynamic(() => loadPartyScreen().then(m => m.PartyGame), {
  // Normally never visible: the selected game is preloaded in the lobby.
  loading: () => <Veil title="OPENING THE SESSION" sub="PREPARING THE GAME" />,
})
const QuoridorGame = dynamic(() => loadQuoridorScreen().then(m => m.QuoridorGame), {
  loading: () => <Veil title="OPENING THE SESSION" sub="PREPARING THE BOARD" />,
})
const BarricadeGame = dynamic(() => loadBarricadeScreen().then(m => m.BarricadeGame), {
  loading: () => <Veil title="OPENING THE SESSION" sub="PREPARING THE BOARD" />,
})
const CoupGame = dynamic(() => loadCoupScreen().then(m => m.CoupGame), {
  loading: () => <Veil title="OPENING THE SESSION" sub="PREPARING THE COURT" />,
})
const WavelengthGame = dynamic(() => loadWavelengthScreen().then(m => m.WavelengthGame), {
  loading: () => <Veil title="OPENING THE SESSION" sub="TUNING THE WAVELENGTH" />,
})

// ─── sound choreography ──────────────────────────────────────────────────────

function useCouncilSounds(api: CouncilApi) {
  const prev = useRef<Record<string, unknown>>({})

  useEffect(() => {
    const st = api.state
    if (!st) return
    const p = prev.current
    const myId = api.myId
    const first = p.inited !== true

    // roster changes
    const ids = st.players.map(x => x.id).join('|')
    if (!first && p.ids !== ids) {
      const prevSet = new Set(String(p.ids ?? '').split('|'))
      const nextSet = new Set(st.players.map(x => x.id))
      if (nextSet.size > prevSet.size) sfx.join()
      else if (nextSet.size < prevSet.size) sfx.leave()
    }
    p.ids = ids

    // phase transitions
    if (!first && p.phase !== st.phase) {
      if (st.phase === 'game') sfx.start()
    }
    p.phase = st.phase

    // game selection change in lobby
    if (!first && p.selectedGame !== st.selectedGame && p.selectedGame !== undefined) {
      sfx.select()
    }
    p.selectedGame = st.selectedGame

    const gs = st.gameState
    if (st.phase === 'game' && gs) {
      if (st.game === 'spyfall' || st.game === 'chameleon' || st.game === 'imposter') {
        const g = gs as PartyState
        if (p.stage !== g.stage && p.stage !== undefined) {
          if (g.stage === 'vote') sfx.alert()
          else if (g.stage === 'accuse' || g.stage === 'verdict') sfx.turn()
        }
        p.stage = g.stage
        const vc = Object.keys(g.votes).length
        if (!first && vc !== (p.vc as number)) sfx.vote()
        p.vc = vc
        const gc = Object.keys(g.verdicts).length
        if (!first && gc !== (p.gc as number)) sfx.vote()
        p.gc = gc
        if (g.stage === 'over' && p.overPlayed !== g.winner + g.subject) {
          p.overPlayed = g.winner + g.subject
          const meBad = g.bad.includes(myId)
          const iWon = g.winner === null ? false : (g.winner === 'rogue') === meBad
          if (g.winner === null) sfx.alert()
          else if (iWon) sfx.win()
          else if (g.electorate.includes(myId)) sfx.lose()
          else sfx.win()
        }
        if (g.stage !== 'over') p.overPlayed = undefined
      }
      if (st.game === 'quoridor') {
        const g = gs as QState
        if (!first && p.turn !== undefined && p.turn !== g.turn) {
          sfx.turn()
        }
        p.turn = g.turn
        if (!first && (p.fences as number) !== undefined && g.fences.length > (p.fences as number)) sfx.wall()
        p.fences = g.fences.length
        const pawKey = g.pawns.map(x => `${x.r}${x.c}`).join(',')
        if (!first && p.pawKey && p.pawKey !== pawKey) sfx.step()
        p.pawKey = pawKey
        if (g.stage === 'over' && p.qOver !== g.winner) {
          p.qOver = g.winner
          if (g.winner !== null) {
            const winnerId = g.participants[g.winner]
            if (winnerId === myId) sfx.win()
            else if (g.participants.includes(myId)) sfx.lose()
            else sfx.win()
          } else sfx.alert()
        }
        if (g.stage !== 'over') p.qOver = undefined
      }
      if (st.game === 'barricade') {
        const g = gs as BState
        if (!first && p.die !== g.dieRoll && g.dieRoll !== null) sfx.dice()
        p.die = g.dieRoll
        if (!first && p.turn !== undefined && p.turn !== g.turn) sfx.turn()
        p.turn = g.turn
        const stones = g.stones.join(',')
        if (!first && p.stones && p.stones !== stones) sfx.place()
        p.stones = stones
        const pieces = g.pieces.map(x => x.circle).join(',')
        if (!first && p.pieces && p.pieces !== pieces) sfx.step()
        p.pieces = pieces
        if (g.stage === 'over' && p.bOver !== g.winner) {
          p.bOver = g.winner
          if (g.winner !== null) {
            const winnerId = g.participants[g.winner]
            if (winnerId === myId) sfx.win()
            else if (g.participants.includes(myId)) sfx.lose()
            else sfx.win()
          } else sfx.alert()
        }
        if (g.stage !== 'over') p.bOver = undefined
      }
      if (st.game === 'coup') {
        const g = gs as CoupState
        if (!first && p.coupTurn !== undefined && p.coupTurn !== g.turn) {
          sfx.turn()
        }
        p.coupTurn = g.turn
        if (!first && p.coupStage !== g.stage) {
          if (g.stage === 'action_challenge' || g.stage === 'block_challenge') sfx.alert()
          else if (g.stage === 'block') sfx.alert()
          else if (g.stage === 'influence_loss') sfx.capture()
        }
        p.coupStage = g.stage
        if (g.stage === 'over' && p.coupOver !== g.winner) {
          p.coupOver = g.winner
          if (g.winner !== null) {
            if (g.winner === myId) sfx.win()
            else if (g.seats.includes(myId)) sfx.lose()
            else sfx.win()
          } else sfx.alert()
        }
        if (g.stage !== 'over') p.coupOver = undefined
      }
    }
    p.inited = true
  }, [api.state, api.myId])
}

function Connecting({ code, api, onHome }: { code: string; api: CouncilApi; onHome: () => void }) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const stage = api.peerCount > 0
    ? `LINKED TO ${api.peerCount} PEER${api.peerCount > 1 ? 'S' : ''} · SYNCING`
    : api.state
      ? 'RESTORING YOUR SEAT'
      : 'SEARCHING FOR THE HOST'

  return (
    <Veil title="SUMMONING THE COUNCIL" sub={`DECREE ${code}`}>
      <div className="flex flex-col items-center gap-3">
        <span className="f-mono text-[0.6rem] font-bold tracking-[0.18em] text-[var(--muted)]">
          {stage}{secs > 3 ? ` · ${secs}s` : ''}
        </span>
        <span className={`f-mono text-[0.55rem] font-bold tracking-[0.22em] ${api.relayReady ? 'text-[var(--ok)]' : 'text-[var(--bad)]'}`}>
          MESH {api.relayReady}/5 · DIRECT {api.peerCount}
        </span>
        {secs > 8 && (
          <div className="flex flex-wrap justify-center gap-2">
            <Btn small variant="outline" onClick={api.retry}>
              <RotateCcw size={12} /> RETRY
            </Btn>
            <Btn small variant="ghost" onClick={onHome}>HOME</Btn>
          </div>
        )}
      </div>
    </Veil>
  )
}

function getRequestedCreate(code: string): { code: string; useSaved: boolean } | null {
  if (typeof window === 'undefined') return null
  try {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('create') === '1') {
      return { code, useSaved: sp.get('saved') !== '0' }
    }
  } catch { /* noop */ }
  return null
}

// ─── room shell ──────────────────────────────────────────────────────────────

export function CouncilRoom({ code }: { code: string }) {
  const requestedCreate = useMemo(() => getRequestedCreate(code), [code])
  const api = useCouncil(code, requestedCreate)
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)
  // null = still reading localStorage (avoids a flash of the prompt)
  const [needsProfile, setNeedsProfile] = useState<boolean | null>(null)
  useCouncilSounds(api)

  useEffect(() => { initSound() }, [])
  useEffect(() => { setNeedsProfile(!hasChosenName()) }, [])

  const st = api.state

  // Warm ONLY the currently selected game while everyone is still in the
  // lobby. CONVENE stays visually instantaneous, but the other game screens
  // never enter this browser's cache until someone actually selects them.
  useEffect(() => {
    if (!st || st.phase !== 'lobby') return
    if (st.selectedGame === 'spyfall' || st.selectedGame === 'chameleon' || st.selectedGame === 'imposter') void loadPartyScreen()
    else if (st.selectedGame === 'quoridor') void loadQuoridorScreen()
    else if (st.selectedGame === 'barricade') void loadBarricadeScreen()
    else if (st.selectedGame === 'coup') void loadCoupScreen()
    else if (st.selectedGame === 'wavelength') void loadWavelengthScreen()
  }, [st?.phase, st?.selectedGame])

  if (needsProfile === null) return null

  // First visit on this device (e.g. opening an invite link): ask who they are
  // and whether they want to play or watch, then join automatically.
  if (needsProfile) {
    return (
      <ProfileGate
        code={code}
        askRole
        onDone={({ spectator }) => {
          api.applyProfile({ spectator })
          setNeedsProfile(false)
        }}
      />
    )
  }

  if (leaving) {
    return (
      <Veil title="WITHDRAWING" sub="YOUR SEAT IS VACATED">
        <Btn variant="outline" onClick={() => { window.location.href = '/' }}>GO NOW</Btn>
      </Veil>
    )
  }

  if (api.status === 'gone') {
    return (
      <Veil title="NO COUNCIL FOUND" sub={`THE CODE ${code} CALLS NO SESSION`}>
        <p className="f-mono max-w-xs text-[0.58rem] font-bold leading-relaxed tracking-[0.12em] text-[var(--muted)]">
          THE HOST MUST HAVE THIS PAGE OPEN. IF THEY DO, THEIR NETWORK MAY BE
          BLOCKING DIRECT CONNECTIONS.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Btn variant="accent" onClick={api.retry}>
            <RotateCcw size={14} /> SEARCH AGAIN
          </Btn>
          <Btn variant="outline" onClick={() => router.push('/')}>RETURN HOME</Btn>
        </div>
      </Veil>
    )
  }

  if (api.status === 'full') {
    return (
      <Veil title="COUNCIL AT CAPACITY" sub="THE SENATE SEATS TEN, NO MORE">
        <span className="stamp text-[var(--gold)]">FULL</span>
        <Btn variant="outline" onClick={() => router.push('/')}>RETURN HOME</Btn>
      </Veil>
    )
  }

  if (api.status === 'expelled') {
    return (
      <Veil title="KICKED FROM THE COUNCIL" sub="YOUR SEAT WAS REMOVED">
        <span className="stamp text-[var(--bad)]">KICKED</span>
        <Btn variant="outline" onClick={() => { window.location.href = '/' }}>RETURN HOME</Btn>
      </Veil>
    )
  }

  if (!st || api.status === 'boot' || api.status === 'connecting' || !api.acked) {
    return <Connecting code={code} api={api} onHome={() => router.push('/')} />
  }

  const me = st.players.find(p => p.id === api.myId)

  // our seat vanished (left / expelled / roster reset) - never render past this
  if (!me) {
    return <Veil title="SEAT VACATED" sub="YOU ARE NO LONGER AT THIS TABLE">
      <Btn variant="outline" onClick={() => router.push('/')}>RETURN HOME</Btn>
    </Veil>
  }

  const isAdmin = me.isAdmin || me.isOwner
  const inGame = !!(st.phase === 'game' && st.game && st.gameState && matchesGame(st.game, st.gameState))
  const gameOver = inGame && (st.gameState as { stage?: string }).stage === 'over'

  return (
    <div className="flex min-h-dvh flex-col">
      {/* header */}
      <header className="sticky top-0 z-40 border-b-2 border-[var(--line-strong)] bg-[var(--bg)]">
        <div className="flex items-center gap-1.5 overflow-hidden px-2 py-2.5 sm:gap-3 sm:px-5">
          <button
            onClick={() => { sfx.click(); router.push('/') }}
            className="flex h-8 w-8 shrink-0 items-center justify-center bg-[var(--accent)] f-display text-sm font-black text-white"
            aria-label="Home"
          >
            V
          </button>
          <span className="f-mono min-w-0 truncate text-sm font-bold tracking-[0.28em]">{st.code}</span>

          <div className="flex-1" />

          <span
            title={`Encrypted relay endpoints live: ${api.relayReady}/5`}
            className={`f-mono text-[0.55rem] font-bold tracking-[0.18em] ${api.relayReady ? 'text-[var(--ok)]' : 'text-[var(--bad)]'}`}
          >
            {api.relayReady ? `MESH ${api.relayReady}` : 'NO MESH'}
          </span>
          {api.isHost && <RoleTag tone="gold">HOST</RoleTag>}
          <span className="f-mono flex items-center gap-1 text-[0.65rem] text-[var(--muted)]">
            <Users size={13} /> {st.players.length}
          </span>
          <SoundToggle />
          <ThemeToggle />
          <IconBtn
            title="Leave council"
            danger
            onClick={() => {
              setLeaving(true)
              try { api.leave() } catch { /* leaving regardless */ }
              // full navigation guarantees the P2P engine is torn down cleanly
              setTimeout(() => { window.location.href = '/' }, 260)
            }}
          >
            <LogOut size={15} />
          </IconBtn>
        </div>

        {/* in-game command strip */}
        {inGame && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[var(--line)] bg-[var(--bg2)] px-2 py-2 sm:px-5">
            <span className="f-display text-base font-black text-[var(--accent)]">
              {roman(GAME_ORDER.indexOf(st.game!) + 1)}
            </span>
            <span className="f-display text-xs font-bold tracking-[0.25em]">{GAME_META[st.game!].name}</span>
            <div className="flex-1" />
            {isAdmin && !gameOver && (
              <>
                <Btn small variant="ghost" onClick={api.skipStage} title="Skip current stage / turn">
                  <SkipForward size={13} /> SKIP
                </Btn>
                <Btn small variant="danger" onClick={api.endGame} title="End the game">
                  <OctagonX size={13} /> END
                </Btn>
              </>
            )}
            {isAdmin && gameOver && (
              <Btn small variant="ghost" onClick={api.toLobby} title="Return to lobby">
                <X size={13} /> LOBBY
              </Btn>
            )}
          </div>
        )}
      </header>

      {me.isSpectator && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--line)] bg-[var(--panel)] px-3 py-2 sm:px-5">
          <Eye size={13} className="shrink-0 text-[var(--gold)]" />
          <span className="f-mono text-[0.6rem] font-bold tracking-[0.18em] text-[var(--muted)]">
            SPECTATING · YOU ARE NOT DEALT INTO THIS GAME
          </span>
          <div className="flex-1" />
          <Btn small variant="outline" onClick={() => api.setSpectating(false)}>
            <Gavel size={12} /> TAKE A SEAT
          </Btn>
        </div>
      )}

      {/* body */}
      <div className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-5 sm:py-6">
        <AnimatePresence mode="wait">
          {!inGame ? (
            <motion.div
              key="lobby"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
            >
              <Lobby api={api} me={me} />
            </motion.div>
          ) : (
            <motion.div
              key={`game-${st.game}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22 }}
            >
              {st.game === 'spyfall' || st.game === 'chameleon' || st.game === 'imposter' ? (
                <PartyGame api={api} state={st.gameState as never} settings={st.settings} />
              ) : st.game === 'quoridor' ? (
                <QuoridorGame api={api} state={st.gameState as never} />
              ) : st.game === 'barricade' ? (
                <BarricadeGame api={api} state={st.gameState as never} />
              ) : st.game === 'coup' ? (
                <CoupGame api={api} state={st.gameState as never} settings={st.settings} />
              ) : (
                <WavelengthGame api={api} state={st.gameState as never} settings={st.settings} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
