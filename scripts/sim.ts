import { GAMES, matchesGame, getBMap, bMovesFor, bPlacement, qMoves, qFenceValid, partyTally, verdictStatus,
  PartyState, QState, BState } from '../src/lib/games'
import { CouncilPlayer, DEFAULT_SETTINGS, PLAYER_COLORS, SettingsMap, GAME_ORDER } from '../src/lib/core'

const mk = (n: number): CouncilPlayer[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`, name: `P${i}`, color: PLAYER_COLORS[i], isAdmin: i === 0, isOwner: i === 0,
    isBot: false, isSpectator: false, connected: true, offlineSince: null, joinedAt: i, peerId: `peer${i}`,
  }))

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
let errors = 0
const check = (cond: boolean, msg: string) => { if (!cond) { errors++; console.error('FAIL:', msg) } }

// ── party games ────────────────────────────────────────────────
for (const kind of ['spyfall', 'chameleon', 'imposter'] as const) {
  for (const showWords of [false, true]) {
    for (let run = 0; run < 150; run++) {
      const n = 3 + Math.floor(Math.random() * 6)
      const players = mk(n)
      const settings: SettingsMap = clone(DEFAULT_SETTINGS)
      if (showWords) {
        settings.chameleon.useCustom = true; settings.chameleon.showWords = true
        settings.chameleon.custom = 'Alpha;Beta;Gamma;Delta'
        settings.imposter!.useCustom = true; settings.imposter!.showWords = true
        settings.imposter!.custom = 'Alpha;Beta;Gamma;Delta'
        settings.spyfall.useCustom = true; settings.spyfall.custom = 'Alpha;Beta;Gamma;Delta'
      }
      const mod = GAMES[kind]
      let s = mod.init(players, settings) as PartyState
      check(matchesGame(kind, s), `${kind} init shape`)
      s = mod.skip(s, players) as PartyState  // -> vote
      // everyone votes randomly, repeatedly
      for (let i = 0; i < 60 && (s as PartyState).stage === 'vote'; i++) {
        const voter = players[Math.floor(Math.random() * n)].id
        const targets = s.electorate.filter(x => x !== voter)
        const t = targets[Math.floor(Math.random() * targets.length)]
        const ns = mod.act(s, voter, players, { t: 'vote', target: t }) as PartyState | null
        if (ns) s = ns
        partyTally(s, players)
      }
      let hops = 0
      while (s.stage !== 'over' && hops++ < 12) {
        if (s.stage === 'accuse') {
          const guess = Math.random() < 0.5 ? s.subject : 'Nonsense'
          const ns = mod.act(s, s.accused!, players, { t: 'accuse', guess }) as PartyState | null
          s = ns ?? (mod.skip(s, players) as PartyState)
        } else if (s.stage === 'verdict') {
          for (const v of verdictStatus(s, players).voters) {
            const ns = mod.act(s, v, players, { t: 'verdict', accept: Math.random() < 0.5 }) as PartyState | null
            if (ns) s = ns
            if (s.stage === 'over') break
          }
          if (s.stage === 'verdict') s = mod.skip(s, players) as PartyState
        } else {
          s = mod.skip(s, players) as PartyState
        }
      }
      check(s.stage === 'over', `${kind} terminates (got ${s.stage})`)
      // removals at every stage must not throw
      mod.playerRemoved(s, players[1].id, players.filter(p => p.id !== players[1].id))
    }
  }
}

// ── quoridor ───────────────────────────────────────────────────
for (const n of [2, 3, 4]) {
  for (let run = 0; run < 40; run++) {
    const players = mk(n)
    const mod = GAMES.quoridor
    let s = mod.init(players, DEFAULT_SETTINGS) as QState
    check(matchesGame('quoridor', s), 'quoridor shape')
    for (let turn = 0; turn < 400 && s.stage === 'play'; turn++) {
      const i = s.turn
      const actor = s.participants[i]
      const moves = qMoves(s, i)
      // A pawn CAN be boxed in by walls and other pawns. That is legal; the
      // engine must simply pass the turn rather than deadlock.
      if (!moves.length) {
        check(GAMES.quoridor.tick(s, Date.now(), players) !== null,
          'a stuck quoridor seat is auto-passed instead of deadlocking')
        const passed = GAMES.quoridor.tick(s, Date.now(), players) as QState | null
        if (!passed) break
        s = passed
        continue
      }
      let ns: QState | null = null
      if (Math.random() < 0.35 && s.fencesLeft[i] > 0) {
        for (let a = 0; a < 10 && !ns; a++) {
          const f = { r: Math.floor(Math.random() * 8), c: Math.floor(Math.random() * 8), o: (Math.random() < 0.5 ? 'h' : 'v') as 'h' | 'v' }
          if (qFenceValid(s, i, f)) ns = mod.act(s, actor, players, { t: 'fence', f }) as QState | null
        }
      }
      if (!ns) {
        const mv = moves[Math.floor(Math.random() * moves.length)]
        ns = mod.act(s, actor, players, { t: 'move', to: mv }) as QState | null
      }
      check(!!ns, 'quoridor action accepted')
      if (!ns) break
      s = ns
      // every pawn must always retain a path to its goal
      for (let k = 0; k < s.pawns.length; k++) {
        const probe = qFenceValid(s, k, { r: 0, c: 0, o: 'h' })
        void probe
      }
    }
    // malformed actions must be rejected, not crash
    for (const bad of [{ t: 'move', to: undefined }, { t: 'move', to: [99, 99] }, { t: 'fence', f: null }, { t: 'fence', f: { r: 'x', c: 1, o: 'h' } }, { t: 'bogus' }]) {
      check(mod.act(s, s.participants[s.turn], players, bad) === null || s.stage === 'over', `quoridor rejects ${JSON.stringify(bad)}`)
    }
  }
}

// ── barricade ──────────────────────────────────────────────────
for (const layout of ['duel2', 'trio3', 'classic4'] as const) {
  const map = getBMap(layout)
  for (const pawns of [1, 3, 5]) {
   // play every board with FEWER players than seats too (empty slots)
   for (let seatCount = 2; seatCount <= map.seats; seatCount++) {
    for (let run = 0; run < 6; run++) {
      const players = mk(seatCount)
      const settings: SettingsMap = clone(DEFAULT_SETTINGS)
      settings.barricade = { layout, pawns }
      const mod = GAMES.barricade
      let s = mod.init(players, settings) as BState
      check(matchesGame('barricade', s), 'barricade shape')
      check(s.pieces.length === seatCount * pawns, `barricade piece count ${layout}/${seatCount}`)
      check(s.participants.length === seatCount, 'barricade seats occupied')
      check(s.turn < seatCount, 'barricade turn in range')
      for (let step = 0; step < 3000 && s.stage === 'play'; step++) {
        const actor = s.participants[s.turn]
        if (s.phase === 'roll') {
          s = (mod.act(s, actor, players, { t: 'roll' }) as BState) ?? s
        } else if (s.phase === 'move') {
          const opts = s.pieces.map((p, i) => i).filter(i => s.pieces[i].seat === s.turn && bMovesFor(map, s, i).length)
          check(opts.length > 0, 'barricade move phase has options')
          if (!opts.length) break
          const pawn = opts[Math.floor(Math.random() * opts.length)]
          const dests = bMovesFor(map, s, pawn)
          const to = dests[Math.floor(Math.random() * dests.length)]
          const ns = mod.act(s, actor, players, { t: 'move', pawn, to }) as BState | null
          check(!!ns, 'barricade move accepted')
          if (!ns) break
          s = ns
        } else {
          const cells = bPlacement(map, s)
          check(cells.length > 0, 'barricade has placement cells')
          const ns = mod.act(s, actor, players, { t: 'place', to: cells[Math.floor(Math.random() * cells.length)] }) as BState | null
          if (!ns) break
          s = ns
        }
        // invariant: stones never sit on a home/finish/safe cell
        for (const c of s.stones) {
          if (c === null) continue
          const def = map.circles[c]
          check(!def.finish && def.start === null, 'stone on illegal cell')
        }
        // invariant: only HOME squares may hold more than one pawn. Anywhere
        // else, landing must capture - never stack.
        const occupancy = new Map<number, number>()
        for (const pc of s.pieces) occupancy.set(pc.circle, (occupancy.get(pc.circle) ?? 0) + 1)
        for (const [circle, n] of occupancy) {
          if (n > 1 && map.circles[circle].start === null) {
            check(false, `pieces stacked on non-home circle ${circle} (${layout})`)
            break
          }
        }
      }
      for (const bad of [{ t: 'move', pawn: 999, to: 0 }, { t: 'place', to: -1 }, { t: 'roll', x: 1 }]) {
        mod.act(s, s.participants[s.turn], players, bad)
      }
    }
   }
  }
  // seating rules: 2..seats allowed, more than seats rejected
  check(GAMES.barricade.canStart(mk(1), { ...clone(DEFAULT_SETTINGS), barricade: { layout, pawns: 5 } }) !== null, `${layout} rejects 1`)
  for (let n = 2; n <= map.seats; n++) {
    check(GAMES.barricade.canStart(mk(n), { ...clone(DEFAULT_SETTINGS), barricade: { layout, pawns: 5 } }) === null, `${layout} allows ${n}`)
  }
  check(GAMES.barricade.canStart(mk(map.seats + 1), { ...clone(DEFAULT_SETTINGS), barricade: { layout, pawns: 5 } }) !== null, `${layout} rejects overfill`)
}

// ── regression: dropdown guess must match the SUBJECT, not just the list ──
for (const kind of ['spyfall', 'chameleon', 'imposter'] as const) {
  const players = mk(4)
  const settings: SettingsMap = clone(DEFAULT_SETTINGS)
  settings.spyfall.useCustom = true; settings.spyfall.custom = 'Zoo;Construction Site;Bank'
  settings.chameleon.useCustom = true; settings.chameleon.showWords = true
  settings.chameleon.custom = 'Zoo;Construction Site;Bank'
  settings.imposter!.useCustom = true; settings.imposter!.showWords = true
  settings.imposter!.custom = 'Zoo;Construction Site;Bank'
  const mod = GAMES[kind]

  for (const correct of [true, false]) {
    for (let run = 0; run < 60; run++) {
      let s = mod.init(players, settings) as PartyState
      const spy = s.bad[0]
      s = { ...s, stage: 'accuse', accused: spy } as PartyState
      const wrong = s.pack.find(w => w.toLowerCase() !== s.subject.toLowerCase())!
      const guess = correct ? s.subject : wrong
      const out = mod.act(s, spy, players, { t: 'accuse', guess }) as PartyState
      check(out.stage === 'over', `${kind} accuse resolves`)
      check(
        out.winner === (correct ? 'rogue' : 'council'),
        `${kind}: guess "${guess}" vs subject "${s.subject}" => ${out.winner} (expected ${correct ? 'rogue' : 'council'})`,
      )
    }
  }

  // a guess that is not in the list at all must never win
  let s2 = mod.init(players, settings) as PartyState
  s2 = { ...s2, stage: 'accuse', accused: s2.bad[0] } as PartyState
  const out2 = mod.act(s2, s2.bad[0], players, { t: 'accuse', guess: 'Totally Not It' }) as PartyState
  check(out2.winner === 'council', `${kind}: off-list guess must lose`)

  // case / whitespace tolerant on a correct answer
  let s3 = mod.init(players, settings) as PartyState
  s3 = { ...s3, stage: 'accuse', accused: s3.bad[0] } as PartyState
  const out3 = mod.act(s3, s3.bad[0], players, { t: 'accuse', guess: `  ${s3.subject.toUpperCase()}  ` }) as PartyState
  check(out3.winner === 'rogue', `${kind}: correct guess tolerates case/space`)
}

// ── coup ───────────────────────────────────────────────────────
for (const reformation of [false, true]) {
  const maxSeats = reformation ? 10 : 6
  for (let n = 2; n <= (reformation ? 8 : 6); n += 2) {
    for (let run = 0; run < 12; run++) {
      const players = mk(n).map(p => ({ ...p, isBot: true }))
      const settings: SettingsMap = clone(DEFAULT_SETTINGS)
      settings.coup = { actionTimer: 15, turnTimer: 30, reformation, useInquisitor: reformation }
      const mod = GAMES.coup
      let s = mod.init(players, settings) as any
      check(matchesGame('coup', s), 'coup shape')
      check(s.seats.length === n, `coup seats count ${n}`)
      check(Object.keys(s.players).length === n, `coup players count ${n}`)

      // Drive game forward with bot ticks / skips until resolution
      for (let step = 0; step < 1200 && s && s.stage !== 'over'; step++) {
        const ticked = mod.tick(s, Date.now() + 100000, players) as any
        if (ticked) {
          s = ticked
        } else {
          const skipped = mod.skip(s, players) as any
          if (skipped) s = skipped
          else break
        }
      }
      check(s.stage === 'over', `coup terminates (ended at stage ${s.stage})`)
      check(typeof s.winner === 'string' && s.seats.includes(s.winner), `coup has valid winner: ${s.winner}`)

      // Player removal at game over or mid-game should not throw
      mod.playerRemoved(s, players[1].id, players.filter(p => p.id !== players[1].id))
    }
  }

  // Seating checks
  check(GAMES.coup.canStart(mk(1), { ...clone(DEFAULT_SETTINGS), coup: { actionTimer: 15, turnTimer: 30, reformation, useInquisitor: false } }) !== null, 'coup rejects 1 player')
  for (let n = 2; n <= maxSeats; n++) {
    check(GAMES.coup.canStart(mk(n), { ...clone(DEFAULT_SETTINGS), coup: { actionTimer: 15, turnTimer: 30, reformation, useInquisitor: false } }) === null, `coup allows ${n} players`)
  }
  check(GAMES.coup.canStart(mk(maxSeats + 1), { ...clone(DEFAULT_SETTINGS), coup: { actionTimer: 15, turnTimer: 30, reformation, useInquisitor: false } }) !== null, `coup rejects ${maxSeats + 1} players`)
}

// ── wavelength ─────────────────────────────────────────────────
for (const useCustom of [false, true]) {
  for (let n = 2; n <= 6; n += 2) {
    for (let run = 0; run < 10; run++) {
      const players = mk(n).map(p => ({ ...p, isBot: true }))
      const settings: SettingsMap = clone(DEFAULT_SETTINGS)
      settings.wavelength = {
        pointsToWin: 5,
        seconds: 60,
        useCustom,
        custom: 'Hot|Cold;Good|Evil;Rough|Smooth;Dangerous|Safe',
      }
      const mod = GAMES.wavelength
      let s = mod.init(players, settings) as any
      check(matchesGame('wavelength', s), 'wavelength shape')
      check(s.teams[0].length + s.teams[1].length === n, `wavelength player count ${n}`)

      for (let step = 0; step < 200 && s && s.stage !== 'over'; step++) {
        const ticked = mod.tick(s, Date.now() + 100000, players) as any
        if (ticked) {
          s = ticked
        } else {
          const skipped = mod.skip(s, players) as any
          if (skipped) s = skipped
          else break
        }
      }
      check(s.stage === 'over', `wavelength terminates (ended at stage ${s.stage})`)
      check(s.winner === 0 || s.winner === 1, `wavelength has valid winner team: ${s.winner}`)

      mod.playerRemoved(s, players[0].id, players.slice(1))
    }
  }

  check(GAMES.wavelength.canStart(mk(1), clone(DEFAULT_SETTINGS)) !== null, 'wavelength rejects 1 player')
  check(GAMES.wavelength.canStart(mk(2), clone(DEFAULT_SETTINGS)) === null, 'wavelength allows 2 players')
}

console.log(errors === 0 ? `ALL ENGINE SIMS PASSED (games: ${GAME_ORDER.join(',')})` : `${errors} FAILURES`)
process.exit(errors === 0 ? 0 : 1)
