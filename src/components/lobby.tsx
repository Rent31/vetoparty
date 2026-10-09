'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  Bot, Check, Crown, Eye, HatGlasses, Info, Landmark, Pencil, Play, Radio, Save, Shield,
  ShieldPlus, ShieldMinus, Shuffle, Trash2, UserMinus, WifiOff, X, Grid3x3, Gavel,
  createLucideIcon,
} from 'lucide-react'
import { chameleon } from '@lucide/lab'
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { CouncilApi } from '@/lib/council'
import {
  CouncilPlayer, GAME_META, GAME_ORDER, GameId, ChameleonSettings, ImposterSettings, QuoridorSettings,
  BarricadeSettings, CoupSettings, SpyfallSettings, WavelengthSettings, activeSeated, isTeamGame,
  MAX_PLAYERS, roman,
} from '@/lib/core'
import { GAMES, getBMap, parseList, parseSpectrumCards } from '@/lib/games'
import { sfx } from '@/lib/sound'
import { loadPresets, savePreset, deletePreset, ListPreset } from '@/lib/core'
import {
  Avatar, Btn, ColorGrid, DurationField, Field, IconBtn, RoleTag, SectionHead,
  Stepper, Toggle, inputCls,
} from '@/components/ui'
import { InvitePanel } from '@/components/invite'
import { Scoreboard } from '@/components/scoreboard'
import { CoupInfoModal } from '@/components/coup'

const ChameleonIcon = createLucideIcon('chameleon', chameleon)

const GAME_ICONS: Record<GameId, ReactNode> = {
  spyfall: <HatGlasses size={22} />,
  chameleon: <ChameleonIcon size={22} />,
  imposter: <ChameleonIcon size={22} />,
  quoridor: <Grid3x3 size={22} />,
  barricade: <Landmark size={22} />,
  coup: <Crown size={22} />,
  wavelength: <Radio size={22} />,
}

// ─── member row ──────────────────────────────────────────────────────────────

function MemberRow({
  api,
  player,
  me,
  teamActive = false,
  teamCount = 2,
  freeMovement = false,
}: {
  api: CouncilApi
  player: CouncilPlayer
  me: CouncilPlayer
  teamActive?: boolean
  teamCount?: number
  freeMovement?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(player.name)
  const [picking, setPicking] = useState(false)
  const st = api.state!

  const meAdmin = me.isAdmin || me.isOwner
  const canRename = me.id === player.id || me.isOwner || (meAdmin && !player.isAdmin && !player.isOwner)
  const canKick = meAdmin && player.id !== me.id && !player.isOwner && (me.isOwner || !player.isAdmin)
  // admins may bench/seat others; nobody may bench the owner but the owner
  const canSeat = meAdmin && !player.isOwner && (me.isOwner || !player.isAdmin)
  const canPromote = me.isOwner && !player.isOwner && !player.isAdmin
  const canDemote = me.isOwner && player.isAdmin && !player.isOwner
  const canChangeTeam = meAdmin || (freeMovement && player.id === me.id)
  const taken = useMemo(() => new Set(st.players.map(p => p.color.toLowerCase())), [st.players])

  useEffect(() => { setName(player.name) }, [player.name])

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`relative flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border border-[var(--line)] bg-[var(--bg2)] px-2.5 py-2 ${player.isBot ? 'border-dashed' : ''}`}
    >
      <Avatar color={player.color} name={player.name} dim={!player.connected && !player.isBot} />
      <div className="min-w-0 flex-1 basis-[7rem]">
        {editing ? (
          <form
            className="flex min-w-0 items-center gap-1.5"
            onSubmit={e => {
              e.preventDefault()
              api.moderate({ op: 'rename', target: player.id, value: name })
              setEditing(false)
            }}
          >
            <input
              autoFocus
              className="w-full min-w-0 max-w-[150px] border-b-2 border-[var(--accent)] bg-transparent py-0.5 text-sm font-bold uppercase tracking-wider focus:outline-none"
              value={name}
              maxLength={14}
              onChange={e => setName(e.target.value.toUpperCase())}
            />
            <IconBtn title="Apply" className="!h-7 !w-7" onClick={() => {
              api.moderate({ op: 'rename', target: player.id, value: name })
              setEditing(false)
            }}>
              <Check size={12} />
            </IconBtn>
            <IconBtn title="Cancel" className="!h-7 !w-7" onClick={() => { setEditing(false); setName(player.name) }}>
              <X size={12} />
            </IconBtn>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`truncate text-sm font-bold tracking-[0.06em] ${!player.connected && !player.isBot ? 'opacity-40' : ''}`}>
              {player.name || 'SENATOR'}
            </span>
            {player.id === me.id && <RoleTag tone="gold">YOU</RoleTag>}
            {player.isOwner && <RoleTag tone="gold"><Crown size={10} /> FIRST CONSUL</RoleTag>}
            {player.isAdmin && !player.isOwner && <RoleTag tone="accent"><Shield size={10} /> CONSUL</RoleTag>}
            {player.isBot && <RoleTag><Bot size={10} /> BOT</RoleTag>}
            {player.isSpectator && <RoleTag><Eye size={10} /> SPECTATOR</RoleTag>}
            {!player.connected && !player.isBot && <WifiOff size={12} className="text-[var(--bad)]" />}
          </div>
        )}
      </div>

      {/* team assignment selector */}
      {teamActive && !player.isSpectator && (
        <div className="flex items-center gap-1">
          {canChangeTeam ? (
            <select
              aria-label="Assign Team"
              className="border border-[var(--line-strong)] bg-[var(--bg)] px-1.5 py-0.5 f-mono text-[0.62rem] font-bold text-[var(--gold)] focus:outline-none"
              value={player.team ?? 0}
              onChange={e => api.moderate({ op: 'setTeam', target: player.id, team: Number(e.target.value) })}
            >
              {Array.from({ length: teamCount }, (_, t) => (
                <option key={t} value={t} className="bg-[#1b1813] text-white">
                  TEAM {roman(t + 1)}
                </option>
              ))}
            </select>
          ) : (
            <RoleTag tone={(player.team ?? 0) % 2 === 0 ? 'accent' : 'gold'}>
              TEAM {roman((player.team ?? 0) + 1)}
            </RoleTag>
          )}
        </div>
      )}

      {/* moderation */}
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
        {canRename && !editing && (
          <IconBtn title="Rename" className="!h-7 !w-7" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </IconBtn>
        )}
        {canRename && (
          <IconBtn title="Recolor" className="!h-7 !w-7" active={picking} onClick={() => setPicking(v => !v)}>
            <span className="h-3 w-3" style={{ background: player.color }} />
          </IconBtn>
        )}
        {canPromote && (
          <IconBtn title="Grant consul (admin)" className="!h-7 !w-7" onClick={() => api.moderate({ op: 'promote', target: player.id })}>
            <ShieldPlus size={12} />
          </IconBtn>
        )}
        {canDemote && (
          <IconBtn title="Revoke consul (admin)" className="!h-7 !w-7" onClick={() => api.moderate({ op: 'demote', target: player.id })}>
            <ShieldMinus size={12} />
          </IconBtn>
        )}
        {!player.isBot && (canSeat || player.id === me.id) && (
          <IconBtn
            title={player.isSpectator ? 'Seat at the table' : 'Move to the gallery'}
            className="!h-7 !w-7"
            active={player.isSpectator}
            onClick={() => api.setSpectating(!player.isSpectator, player.id)}
          >
            {player.isSpectator ? <Gavel size={12} /> : <Eye size={12} />}
          </IconBtn>
        )}
        {player.isBot && meAdmin && (
          <IconBtn title="Remove bot" danger className="!h-7 !w-7" onClick={() => api.moderate({ op: 'removeBot', target: player.id })}>
            <Trash2 size={12} />
          </IconBtn>
        )}
        {!player.isBot && canKick && (
          <IconBtn title="Expel from council" danger className="!h-7 !w-7" onClick={() => api.moderate({ op: 'kick', target: player.id })}>
            <UserMinus size={12} />
          </IconBtn>
        )}
      </div>

      <AnimatePresence>
        {picking && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 top-full z-30 mt-1 w-[min(250px,calc(100vw-3.5rem))] border-2 border-[var(--line-strong)] bg-[var(--panel)] p-2.5 shadow-[6px_6px_0_var(--shadow)]"
          >
            <ColorGrid
              compact
              value={player.color}
              taken={taken}
              onPick={c => { api.moderate({ op: 'recolor', target: player.id, value: c }); setPicking(false) }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── settings forms ──────────────────────────────────────────────────────────

function PartySettingsForm({ api, me, game }: { api: CouncilApi; me: CouncilPlayer; game: 'spyfall' | 'chameleon' | 'imposter' }) {
  const st = api.state!
  const editable = me.isAdmin || me.isOwner
  const isSpy = game === 'spyfall'
  const settings = isSpy ? st.settings.spyfall : (st.settings.chameleon ?? st.settings.imposter)
  const active = st.players.filter(p => p.connected || p.isBot).length
  const [presets, setPresets] = useState<ListPreset[]>([])
  const [presetName, setPresetName] = useState('')
  useEffect(() => { setPresets(loadPresets(game)) }, [game])

  const maxBad = Math.max(1, active - 2)
  const send = (patch: Partial<SpyfallSettings & ChameleonSettings>) =>
    editable && api.sendSettings(game, { ...settings, ...patch })

  const parsed = parseList(settings.custom)

  const labelText = isSpy
    ? ((settings as SpyfallSettings).spies > 1 ? 'Spies' : 'Spy')
    : ((settings as ChameleonSettings).chameleons > 1 ? 'Chameleons' : 'Chameleon')

  return (
    <div className="flex flex-col gap-4">
      <Field label={labelText}>
        <Stepper
          value={isSpy ? (settings as SpyfallSettings).spies : ((settings as ChameleonSettings).chameleons ?? 1)}
          min={1} max={maxBad}
          disabled={!editable}
          onChange={v => send(isSpy ? { spies: v } : { chameleons: v, imposters: v })}
        />
      </Field>

      <DurationField
        label="Session clock"
        value={settings.seconds}
        presets={[180, 300, 480, 600, 0]}
        min={10}
        max={7200}
        allowNone
        onChange={v => editable && send({ seconds: v })}
      />

      <div className="rule-dash" />

      <div className="flex items-center justify-between gap-3">
        <span className="label">{game === 'spyfall' ? 'Custom location list' : 'Custom word list'}</span>
        <Toggle on={settings.useCustom} onChange={v => send({ useCustom: v })} disabled={!editable} />
      </div>

      <AnimatePresence>
        {settings.useCustom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col gap-3 overflow-hidden"
          >
            <textarea
              className={`${inputCls} h-20 resize-none !normal-case`}
              placeholder="Bank; Beach; Circus; Space Station"
              value={settings.custom}
              disabled={!editable}
              onChange={e => send({ custom: e.target.value })}
            />
            <div className="flex items-center justify-between">
              <span className={`f-mono text-[0.65rem] font-bold ${parsed.length >= 3 ? 'text-[var(--ok)]' : 'text-[var(--bad)]'}`}>
                {parsed.length} ENTRIES {parsed.length < 3 && '(MIN 3)'}
              </span>
              {!isSpy && (
                <div className="flex items-center gap-2">
                  <span className="label !text-[0.55rem]">SHOW LIST TO ALL</span>
                  <Toggle on={(settings as ChameleonSettings).showWords} onChange={v => send({ showWords: v })} disabled={!editable} />
                </div>
              )}
            </div>

            {editable && (
              <div className="flex gap-1.5">
                <input
                  className={`${inputCls} flex-1 !py-1.5 !text-[0.7rem]`}
                  placeholder="PRESET NAME"
                  value={presetName}
                  maxLength={16}
                  onChange={e => setPresetName(e.target.value.toUpperCase())}
                />
                <Btn small variant="outline" disabled={!presetName.trim() || parsed.length < 3} onClick={() => {
                  savePreset(game, { name: presetName.trim(), list: settings.custom })
                  setPresets(loadPresets(game))
                  setPresetName('')
                  sfx.vote()
                }}>
                  <Save size={12} /> SAVE
                </Btn>
              </div>
            )}

            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map(p => (
                  <span key={p.name} className="group flex items-center border border-[var(--line)]">
                    <button
                      className="f-mono px-2 py-1 text-[0.62rem] font-bold text-[var(--muted)] hover:text-[var(--ink)]"
                      onClick={() => editable && send({ custom: p.list, useCustom: true })}
                    >
                      {p.name}
                    </button>
                    <button
                      className="px-1.5 text-[var(--bad)] opacity-50 hover:opacity-100"
                      onClick={() => { deletePreset(game, p.name); setPresets(loadPresets(game)) }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function QuoridorSettingsForm({ api, me }: { api: CouncilApi; me: CouncilPlayer }) {
  const st = api.state!
  const editable = me.isAdmin || me.isOwner
  const s = st.settings.quoridor as QuoridorSettings
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="label">Turn clock</span>
        <Toggle on={s.timer} onChange={v => editable && api.sendSettings('quoridor', { ...s, timer: v })} disabled={!editable} />
      </div>
      {s.timer && (
        <DurationField
          label="Turn limit"
          value={s.seconds}
          presets={[15, 30, 45, 60, 120]}
          min={5}
          max={600}
          onChange={v => editable && api.sendSettings('quoridor', { ...s, seconds: v })}
        />
      )}

      <div className="rule-dash" />

      <div className="flex items-center justify-between gap-3">
        <span className="label">Custom number of walls</span>
        <Toggle
          on={!!s.useCustomWalls}
          onChange={v => editable && api.sendSettings('quoridor', { ...s, useCustomWalls: v })}
          disabled={!editable}
        />
      </div>
      {s.useCustomWalls && (
        <Field label="Walls per player">
          <Stepper
            value={s.customWalls ?? 10}
            min={0}
            max={30}
            disabled={!editable}
            onChange={v => editable && api.sendSettings('quoridor', { ...s, customWalls: v })}
          />
        </Field>
      )}
    </div>
  )
}

function BarricadeSettingsForm({ api, me }: { api: CouncilApi; me: CouncilPlayer }) {
  const st = api.state!
  const editable = me.isAdmin || me.isOwner
  const s = st.settings.barricade as BarricadeSettings
  const layouts: { key: BarricadeSettings['layout']; label: string; seats: number }[] = [
    { key: 'classic4', label: 'CLASSIC', seats: 4 },
    { key: 'trio3', label: 'TRIO', seats: 3 },
    { key: 'duel2', label: 'DUEL', seats: 2 },
  ]
  return (
    <div className="flex flex-col gap-4">
      <Field label="Board layout">
        <div className="grid grid-cols-3 gap-1.5">
          {layouts.map(l => (
            <button
              key={l.key}
              onClick={() => editable && api.sendSettings('barricade', { ...s, layout: l.key })}
              className={`flex flex-col items-center gap-1 border-2 px-2 py-2.5 transition-colors ${s.layout === l.key ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)]'}`}
            >
              <span className="f-display text-lg font-black leading-none">{roman(l.seats)}</span>
              <span className="f-mono text-[0.55rem] font-bold tracking-[0.2em]">{l.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="Pawns per player">
        <Stepper value={s.pawns} min={1} max={5} disabled={!editable} onChange={v => editable && api.sendSettings('barricade', { ...s, pawns: v })} />
      </Field>
    </div>
  )
}

function CoupSettingsForm({ api, me }: { api: CouncilApi; me: CouncilPlayer }) {
  const [showRules, setShowRules] = useState(false)
  const st = api.state!
  const editable = me.isAdmin || me.isOwner
  const s = st.settings.coup as CoupSettings

  return (
    <div className="flex flex-col gap-4">
      <CoupInfoModal open={showRules} onClose={() => setShowRules(false)} />

      <DurationField
        label="Response clock (Challenges & Blocks)"
        value={s.actionTimer}
        presets={[10, 15, 20, 30, 0]}
        min={5}
        max={120}
        allowNone
        onChange={v => editable && api.sendSettings('coup', { ...s, actionTimer: v })}
      />

      <DurationField
        label="Turn clock"
        value={s.turnTimer}
        presets={[15, 30, 45, 60, 0]}
        min={10}
        max={180}
        allowNone
        onChange={v => editable && api.sendSettings('coup', { ...s, turnTimer: v })}
      />

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <div>
          <span className="label">Reformation Expansion</span>
          <p className="f-mono text-[0.55rem] text-[var(--muted)]">Increases max players to 10 &bull; Factions, Convert, Embezzle, Treasury Reserve</p>
        </div>
        <Toggle
          on={s.reformation}
          onChange={v => editable && api.sendSettings('coup', { ...s, reformation: v })}
          disabled={!editable}
        />
      </div>

      {s.reformation && (
        <div className="flex items-center justify-between gap-3 border-l-2 border-[var(--gold)] pl-4">
          <div>
            <span className="label">Randomize Factions</span>
            <p className="f-mono text-[0.55rem] text-[var(--muted)]">Randomize factions each round regardless of lobby teams</p>
          </div>
          <Toggle
            on={s.randomizeFactions ?? false}
            onChange={v => editable && api.sendSettings('coup', { ...s, randomizeFactions: v })}
            disabled={!editable}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="label">Inquisitor Character</span>
          <p className="f-mono text-[0.55rem] text-[var(--muted)]">Replaces Ambassador with Inquisitor</p>
        </div>
        <Toggle
          on={s.useInquisitor}
          onChange={v => editable && api.sendSettings('coup', { ...s, useInquisitor: v })}
          disabled={!editable}
        />
      </div>

      {s.useInquisitor && (
        <div className="flex items-center justify-between gap-3 border-l-2 border-[var(--gold)] pl-4">
          <div>
            <span className="label">Contessa blocks Examine</span>
            <p className="f-mono text-[0.55rem] text-[var(--muted)]">Allow target of Examine to block by claiming Contessa</p>
          </div>
          <Toggle
            on={s.contessaBlocksExamine ?? false}
            onChange={v => editable && api.sendSettings('coup', { ...s, contessaBlocksExamine: v })}
            disabled={!editable}
          />
        </div>
      )}

      <div className="border-t border-[var(--line)] pt-2">
        <Btn small variant="outline" onClick={() => setShowRules(true)}>
          <Info size={13} /> HOW TO PLAY & RULES
        </Btn>
      </div>
    </div>
  )
}

function WavelengthSettingsForm({ api, me }: { api: CouncilApi; me: CouncilPlayer }) {
  const st = api.state!
  const editable = me.isAdmin || me.isOwner
  const s = st.settings.wavelength as WavelengthSettings
  const [presets, setPresets] = useState<ListPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [draftPoints, setDraftPoints] = useState(String(s.pointsToWin || 10))

  useEffect(() => {
    setPresets(loadPresets('wavelength'))
  }, [])

  useEffect(() => {
    setDraftPoints(String(s.pointsToWin || 10))
  }, [s.pointsToWin])

  const commitPoints = (raw: string) => {
    const n = Math.round(Number(raw))
    if (!isFinite(n) || n < 1 || n > 50) {
      setDraftPoints(String(s.pointsToWin || 10))
      return
    }
    send({ pointsToWin: n })
  }

  const parsed = parseSpectrumCards(s.custom)
  const send = (patch: Partial<WavelengthSettings>) =>
    editable && api.sendSettings('wavelength', { ...s, ...patch })

  return (
    <div className="flex flex-col gap-4">
      <Field label="Points to win">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          value={draftPoints}
          disabled={!editable}
          onChange={e => setDraftPoints(e.target.value)}
          onBlur={e => commitPoints(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commitPoints((e.target as HTMLInputElement).value) }}
          className="f-mono w-20 min-w-0 border border-[var(--line)] bg-[var(--bg2)] px-2 py-1.5 text-[0.72rem] font-bold tabular focus:border-[var(--line-strong)] text-center"
        />
      </Field>

      <DurationField
        label="Round clock"
        value={s.seconds}
        presets={[60, 90, 120, 180, 0]}
        min={10}
        max={7200}
        allowNone
        onChange={v => editable && send({ seconds: v })}
      />

      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <div>
          <span className="label">Co-op mode</span>
          <p className="f-mono text-[0.55rem] text-[var(--muted)]">Everyone plays together on the same team</p>
        </div>
        <Toggle
          on={s.coop ?? false}
          onChange={v => editable && send({ coop: v })}
          disabled={!editable}
        />
      </div>

      {!s.coop && (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
          <div>
            <span className="label">Randomize teams</span>
            <p className="f-mono text-[0.55rem] text-[var(--muted)]">Randomize teams each round regardless of lobby teams</p>
          </div>
          <Toggle
            on={s.randomizeTeams ?? false}
            onChange={v => editable && send({ randomizeTeams: v })}
            disabled={!editable}
          />
        </div>
      )}

      <div className="rule-dash" />

      <div className="flex items-center justify-between gap-3">
        <span className="label">Custom spectrum cards</span>
        <Toggle on={s.useCustom} onChange={v => send({ useCustom: v })} disabled={!editable} />
      </div>

      <AnimatePresence>
        {s.useCustom && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-col gap-3 overflow-hidden"
          >
            <textarea
              className={`${inputCls} h-24 resize-y !normal-case`}
              placeholder="Hot|Cold;Good|Evil;Rough|Smooth;Dangerous|Safe"
              value={s.custom}
              disabled={!editable}
              onChange={e => send({ custom: e.target.value })}
            />
            <div className="flex items-center justify-between">
              <span className={`f-mono text-[0.65rem] font-bold ${parsed.length >= 2 ? 'text-[var(--ok)]' : 'text-[var(--bad)]'}`}>
                {parsed.length} SPECTRUM CARDS {parsed.length < 2 && '(MIN 2)'}
              </span>
            </div>

            {editable && (
              <div className="flex gap-1.5">
                <input
                  className={`${inputCls} flex-1 !py-1.5 !text-[0.7rem]`}
                  placeholder="PRESET NAME"
                  value={presetName}
                  maxLength={16}
                  onChange={e => setPresetName(e.target.value.toUpperCase())}
                />
                <Btn
                  small
                  variant="outline"
                  disabled={!presetName.trim() || parsed.length < 2}
                  onClick={() => {
                    savePreset('wavelength', { name: presetName.trim(), list: s.custom })
                    setPresets(loadPresets('wavelength'))
                    setPresetName('')
                    sfx.vote()
                  }}
                >
                  <Save size={12} /> SAVE
                </Btn>
              </div>
            )}

            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map(p => (
                  <span key={p.name} className="group flex items-center border border-[var(--line)]">
                    <button
                      className="f-mono px-2 py-1 text-[0.62rem] font-bold text-[var(--muted)] hover:text-[var(--ink)]"
                      onClick={() => editable && send({ custom: p.list, useCustom: true })}
                    >
                      {p.name}
                    </button>
                    <button
                      className="px-1.5 text-[var(--bad)] opacity-50 hover:opacity-100"
                      onClick={() => {
                        deletePreset('wavelength', p.name)
                        setPresets(loadPresets('wavelength'))
                      }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── lobby ───────────────────────────────────────────────────────────────────

export function Lobby({ api, me }: { api: CouncilApi; me: CouncilPlayer }) {
  const st = api.state!
  const meAdmin = me.isAdmin || me.isOwner
  const seated = st.players.filter(p => !p.isSpectator)
  const spectators = st.players.filter(p => p.isSpectator)
  const active = activeSeated(st.players)
  const game = st.selectedGame
  const meta = GAME_META[game]
  const mod = GAMES[game]
  const reason = mod.canStart(active, st.settings)
  const isTeamActive = isTeamGame(game, st.settings)
  const teamCount = st.teams?.count ?? 2
  const freeMovement = st.teams?.freeMovement ?? false

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
      {/* invite */}
      <section className="panel p-4 sm:p-5">
        <SectionHead title="Summon members" />
        <InvitePanel code={st.code} />
      </section>

      {/* members */}
      <section className="panel brackets flex flex-col p-4 sm:p-5">
        <SectionHead numeral="I" title={`The Senate · ${seated.length}`} />

        {isTeamActive ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: teamCount }, (_, tIdx) => {
              const teamMembers = seated.filter(p => (p.team ?? 0) === tIdx)
              return (
                <div key={tIdx} className="flex flex-col gap-1.5 border border-[var(--line)] bg-[var(--bg2)]/50 p-2 sm:p-2.5">
                  <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                    <span className="f-display text-xs font-bold tracking-wider text-[var(--gold)]">
                      TEAM {roman(tIdx + 1)} · {teamMembers.length}
                    </span>
                    {(freeMovement || meAdmin) && (me.team ?? 0) !== tIdx && !me.isSpectator && (
                      <Btn
                        small
                        variant="ghost"
                        className="!py-0.5 !text-[0.6rem]"
                        onClick={() => api.moderate({ op: 'setTeam', target: me.id, team: tIdx })}
                      >
                        JOIN
                      </Btn>
                    )}
                  </div>
                  <AnimatePresence initial={false}>
                    {teamMembers.map(p => (
                      <MemberRow
                        key={p.id}
                        api={api}
                        player={p}
                        me={me}
                        teamActive={isTeamActive}
                        teamCount={teamCount}
                        freeMovement={freeMovement}
                      />
                    ))}
                  </AnimatePresence>
                  {!teamMembers.length && (
                    <span className="f-mono py-1 text-[0.58rem] italic text-[var(--muted)]">
                      NO SENATORS ASSIGNED
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <AnimatePresence initial={false}>
              {seated.map(p => (
                <MemberRow key={p.id} api={api} player={p} me={me} />
              ))}
            </AnimatePresence>
            {!seated.length && (
              <p className="f-mono py-2 text-[0.6rem] font-bold tracking-[0.16em] text-[var(--muted)]">
                NO ONE SEATED - EVERYONE IS WATCHING
              </p>
            )}
          </div>
        )}

        {spectators.length > 0 && (
          <>
            <div className="rule-dash my-3" />
            <div className="label mb-2 flex items-center gap-1.5">
              <Eye size={11} /> GALLERY · {spectators.length}
            </div>
            <div className="flex flex-col gap-1.5">
              <AnimatePresence initial={false}>
                {spectators.map(p => (
                  <MemberRow
                    key={p.id}
                    api={api}
                    player={p}
                    me={me}
                    teamActive={isTeamActive}
                    teamCount={teamCount}
                    freeMovement={freeMovement}
                  />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-[var(--line)] px-2.5 py-2">
          <span className="label min-w-0 flex-1">{me.isSpectator ? 'YOU ARE WATCHING' : 'YOU ARE PLAYING'}</span>
          <Btn
            small
            variant={me.isSpectator ? 'accent' : 'outline'}
            className="shrink-0"
            onClick={() => api.setSpectating(!me.isSpectator)}
          >
            {me.isSpectator ? <><Gavel size={12} /> TAKE A SEAT</> : <><Eye size={12} /> SPECTATE</>}
          </Btn>
        </div>
        {meAdmin && st.players.length < 10 && (
          <Btn small variant="ghost" className="mt-3 self-start" onClick={() => api.moderate({ op: 'addBot' })}>
            <Bot size={13} /> ADD BOT
          </Btn>
        )}

        {/* Team system controls (at the bottom of The Senate panel) */}
        {isTeamActive && (
          <div className="mt-3 flex flex-col gap-2.5 border-t border-[var(--line)] pt-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="label">FREE MOVEMENT</span>
                <p className="f-mono text-[0.55rem] text-[var(--muted)]">
                  Players may choose their own team
                </p>
              </div>
              <Toggle
                on={freeMovement}
                onChange={v => meAdmin && api.moderate({ op: 'setFreeMovement', value: v })}
                disabled={!meAdmin}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="label">TEAMS</span>
              <Stepper
                value={teamCount}
                min={2}
                max={MAX_PLAYERS}
                disabled={!meAdmin}
                onChange={v => meAdmin && api.moderate({ op: 'setTeamCount', count: v })}
              />
            </div>

            {meAdmin && (
              <Btn
                small
                variant="outline"
                className="w-full justify-center"
                onClick={() => api.moderate({ op: 'randomizeTeams' })}
              >
                <Shuffle size={12} /> RANDOMIZE TEAMS
              </Btn>
            )}
          </div>
        )}
      </section>

      <Scoreboard api={api} meAdmin={meAdmin} />
      </div>

      {/* game selection + settings */}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="panel p-4 sm:p-5">
          <SectionHead numeral="II" title="Choose the game" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {GAME_ORDER.map((g, i) => {
              const selected = game === g
              return (
                <motion.button
                  key={g}
                  whileTap={meAdmin ? { scale: 0.97 } : undefined}
                  onClick={() => {
                    if (meAdmin) {
                      api.selectGame(g)
                      sfx.select()
                    }
                  }}
                  className={`relative flex flex-col items-start gap-2 border-2 p-3 text-left transition-colors ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--line)] hover:border-[var(--line-strong)] ' + (meAdmin ? '' : 'cursor-default')
                  }`}
                >
                  <span className={`f-display text-lg font-black leading-none ${selected ? 'text-white/70' : 'text-[var(--accent)]'}`}>{roman(i + 1)}</span>
                  <span className={selected ? 'text-white' : 'text-[var(--ink)]'}>{GAME_ICONS[g]}</span>
                  <span className="f-display text-[0.72rem] font-bold tracking-[0.18em]">{GAME_META[g].name}</span>
                  <span className={`f-mono text-[0.52rem] font-bold tracking-[0.14em] ${selected ? 'text-white/70' : 'text-[var(--muted)]'}`}>
                    {g === 'wavelength' ? '2/4-10 SEATS' : g === 'coup' ? '2-6/10 SEATS' : `${GAME_META[g].min}-${GAME_META[g].max} SEATS`}
                  </span>
                </motion.button>
              )
            })}
          </div>
          <p className="f-mono mt-3 text-[0.6rem] font-bold tracking-[0.2em] text-[var(--muted)]">{meta.tag}</p>
        </div>

        <div className="panel p-4 sm:p-5">
          <SectionHead numeral="III" title="House rules" />
          <AnimatePresence mode="wait">
            <motion.div
              key={game}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.18 }}
            >
              {game === 'quoridor' ? <QuoridorSettingsForm api={api} me={me} />
                : game === 'barricade' ? <BarricadeSettingsForm api={api} me={me} />
                : game === 'coup' ? <CoupSettingsForm api={api} me={me} />
                : game === 'wavelength' ? <WavelengthSettingsForm api={api} me={me} />
                : <PartySettingsForm api={api} me={me} game={game} />}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="panel-hard flex min-w-0 flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="f-display text-sm font-bold tracking-[0.22em]">
              {meAdmin ? (reason ?? 'THE SENATE IS SEATED') : 'AWAITING THE CONSUL'}
            </div>
            {reason && (
              <div className="f-mono mt-1 text-[0.6rem] font-bold tracking-[0.14em] text-[var(--muted)]">
                {active.length} SEATED{meAdmin ? ' · ADD MEMBERS OR BOTS' : ''}
              </div>
            )}
          </div>
          {meAdmin && (
            <Btn variant="accent" className="!px-8 !py-4 !text-sm" disabled={!!reason} onClick={api.startGame}>
              <Play size={15} /> CONVENE
            </Btn>
          )}
        </div>
      </section>
    </div>
  )
}
