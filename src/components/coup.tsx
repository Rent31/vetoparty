'use client'

import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowRight, Check, Clock, Coins, Crown, HelpCircle,
  Info, RefreshCw, RotateCcw, ScrollText, Shield, ShieldAlert, ShieldCheck, Sword, Swords, Users, X,
} from 'lucide-react'
import {
  GiAnchor,
  GiEyeTarget,
  GiHeartShield,
  GiLaurelCrown,
  GiSkullCrack,
  GiTiedScroll,
} from 'react-icons/gi'
import { Fragment, memo, useEffect, useMemo, useState } from 'react'
import { CouncilApi } from '@/lib/council'
import { CouncilPlayer, SettingsMap, canProxyFor, roman } from '@/lib/core'
import {
  ActionType, ChallengeRevealSwap, Character, CoupCard, CoupLogItem, CoupState, Faction, isFactionRestricted, outcomeFor,
} from '@/lib/games'
import { sfx } from '@/lib/sound'
import {
  Avatar, Btn, Countdown, IconBtn, RoleTag, SectionHead, Stamp, TimerBar,
  VetoedBanner,
} from '@/components/ui'
import { ScoreStrip } from '@/components/scoreboard'

// character themes

const CHAR_THEMES: Record<
  Character,
  {
    bg: string
    border: string
    text: string
    accent: string
    action: string
    block: string
  }
> = {
  Duke: {
    bg: 'bg-purple-950/70',
    border: 'border-purple-500/70',
    text: 'text-purple-200',
    accent: '#c084fc',
    action: 'TAX (+3c)',
    block: 'BLOCKS AID',
  },
  Assassin: {
    bg: 'bg-zinc-900',
    border: 'border-zinc-500/70',
    text: 'text-zinc-200',
    accent: '#cbd5e1',
    action: 'ASSASSINATE (-3c)',
    block: 'NO BLOCK',
  },
  Captain: {
    bg: 'bg-blue-950/70',
    border: 'border-blue-500/70',
    text: 'text-blue-200',
    accent: '#60a5fa',
    action: 'STEAL (+2c)',
    block: 'BLOCKS STEAL',
  },
  Ambassador: {
    bg: 'bg-emerald-950/70',
    border: 'border-emerald-500/70',
    text: 'text-emerald-200',
    accent: '#4ade80',
    action: 'EXCHANGE',
    block: 'BLOCKS STEAL',
  },
  Contessa: {
    bg: 'bg-red-950/70',
    border: 'border-red-500/70',
    text: 'text-red-200',
    accent: '#f87171',
    action: 'NO ACTION',
    block: 'BLOCKS ASSASSIN',
  },
  Inquisitor: {
    bg: 'bg-teal-950/70',
    border: 'border-teal-500/70',
    text: 'text-teal-200',
    accent: '#2dd4bf',
    action: 'EXCHANGE / EXAMINE',
    block: 'BLOCKS STEAL',
  },
}

// card face

export const CoupCardFace = memo(function CoupCardFace({
  character,
  revealed = false,
  size = 'md',
  className = '',
}: {
  character: Character
  revealed?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const theme = CHAR_THEMES[character]

  const sizeStyles = {
    xs: {
      box: 'w-10 aspect-[5/7] p-0.5',
      iconSize: 16,
    },
    sm: {
      box: 'w-12 sm:w-14 aspect-[5/7] p-1',
      iconSize: 20,
    },
    md: {
      box: 'w-20 sm:w-24 aspect-[5/7] p-1.5 sm:p-2',
      iconSize: 26,
    },
    lg: {
      box: 'w-28 sm:w-36 aspect-[5/7] p-2 sm:p-2.5',
      iconSize: 38,
    },
  }[size]

  return (
    <div
      className={`relative flex select-none flex-col items-center justify-between border-2 transition-all shrink-0 aspect-[5/7] ${sizeStyles.box} ${
        revealed ? 'border-red-900/60 bg-[#140b0b]' : `${theme.bg} ${theme.border} shadow-md`
      } ${className}`}
    >
      <div className={`w-full flex-1 flex flex-col items-center justify-between ${revealed ? 'opacity-30 grayscale contrast-125 ' + theme.text : theme.text}`}>
        {/* Top character name: consistently sized and dynamically fit */}
        {size !== 'xs' && (
          <div className="w-full px-0.5 pt-0.5 select-none">
            <svg viewBox="0 0 100 20" className="w-full h-auto overflow-visible block" preserveAspectRatio="xMidYMid meet">
              <text
                x="50"
                y="14"
                textAnchor="middle"
                className="f-display font-black fill-current uppercase"
                fontSize="13"
                letterSpacing="0.02em"
              >
                {character}
              </text>
            </svg>
          </div>
        )}

        {/* Center Icon */}
        <div className="my-auto flex items-center justify-center">
          {character === 'Duke' && <GiLaurelCrown size={sizeStyles.iconSize} className="shrink-0 drop-shadow" />}
          {character === 'Assassin' && <GiSkullCrack size={sizeStyles.iconSize} className="shrink-0 drop-shadow" />}
          {character === 'Captain' && <GiAnchor size={sizeStyles.iconSize} className="shrink-0 drop-shadow" />}
          {character === 'Ambassador' && <GiTiedScroll size={sizeStyles.iconSize} className="shrink-0 drop-shadow" />}
          {character === 'Contessa' && <GiHeartShield size={sizeStyles.iconSize} className="shrink-0 drop-shadow" />}
          {character === 'Inquisitor' && <GiEyeTarget size={sizeStyles.iconSize} className="shrink-0 drop-shadow" />}
        </div>

        {/* Bottom action & block labels: consistently sized and dynamically fit */}
        {size !== 'xs' && size !== 'sm' && (
          <div className="w-full px-1 pb-1 pt-0.5 border-t border-current/25 select-none">
            <svg viewBox="0 0 100 24" className="w-full h-auto overflow-visible block" preserveAspectRatio="xMidYMid meet">
              <text
                x="50"
                y="9.5"
                textAnchor="middle"
                className="f-mono font-black fill-current uppercase"
                fontSize="7.4"
                letterSpacing="0.01em"
              >
                {theme.action}
              </text>
              <text
                x="50"
                y="20.5"
                textAnchor="middle"
                className="f-mono font-bold fill-current opacity-80 uppercase"
                fontSize="7.2"
                letterSpacing="0.01em"
              >
                {theme.block}
              </text>
            </svg>
          </div>
        )}
      </div>

      {/* Red cross on lost cards */}
      {revealed && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <X
            size={size === 'xs' ? 20 : size === 'sm' ? 26 : size === 'md' ? 36 : 52}
            strokeWidth={4}
            className="text-red-600"
          />
        </div>
      )}
    </div>
  )
})

// card back

export const CoupCardBack = memo(function CoupCardBack({
  size = 'md',
  className = '',
}: {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizeStyles = {
    xs: { box: 'w-10 aspect-[5/7] p-0.5', inner: 'h-4 w-4 text-[0.5rem]' },
    sm: { box: 'w-12 sm:w-14 aspect-[5/7] p-1', inner: 'h-5 w-5 sm:h-6 sm:w-6 text-[0.6rem] sm:text-[0.65rem]' },
    md: { box: 'w-20 sm:w-24 aspect-[5/7] p-1.5 sm:p-2', inner: 'h-7 w-7 sm:h-8 sm:w-8 text-[0.75rem] sm:text-xs' },
    lg: { box: 'w-28 sm:w-36 aspect-[5/7] p-2 sm:p-3', inner: 'h-10 w-10 sm:h-12 sm:w-12 text-sm sm:text-base' },
  }[size]

  return (
    <div
      className={`relative flex select-none flex-col items-center justify-center border-2 border-[var(--line-strong)] bg-[#171410] text-[var(--gold)]/70 shrink-0 aspect-[5/7] shadow-md ${sizeStyles.box} ${className}`}
    >
      <div className={`flex items-center justify-center border border-[var(--gold)]/30 font-mono font-bold ${sizeStyles.inner}`}>
        ?
      </div>
    </div>
  )
})

// card view

export function CardView({
  card,
  isOwn = false,
  onClick,
  selected = false,
  disabled = false,
  size = 'md',
}: {
  card: CoupCard
  isOwn?: boolean
  onClick?: () => void
  selected?: boolean
  disabled?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}) {
  const isRevealed = card.revealed
  const faceVisible = isOwn || isRevealed

  return (
    <motion.button
      type="button"
      whileHover={onClick && !disabled ? { scale: 1.04, y: -2 } : undefined}
      whileTap={onClick && !disabled ? { scale: 0.96 } : undefined}
      onClick={disabled ? undefined : onClick}
      disabled={disabled || !onClick}
      className={`relative select-none transition-all duration-150 ${
        selected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]' : ''
      } ${onClick && !disabled ? 'cursor-pointer' : 'cursor-default'}`}
    >
      {faceVisible ? (
        <CoupCardFace character={card.character} revealed={isRevealed} size={size} />
      ) : (
        <CoupCardBack size={size} />
      )}
    </motion.button>
  )
}

// rules modal

type InfoTab = 'Actions Cheat Sheet' | 'Overview' | 'Characters' | 'Expansions'

export function CoupInfoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<InfoTab>('Actions Cheat Sheet')
  if (!open) return null

  const tabs: InfoTab[] = ['Actions Cheat Sheet', 'Overview', 'Characters', 'Expansions']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-xs">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="panel-hard brackets relative flex max-h-[88vh] w-full max-w-xl flex-col gap-4 p-4 sm:p-6"
      >
        <div className="flex items-center justify-between border-b-2 border-[var(--line-strong)] pb-3">
          <div className="flex items-center gap-2">
            <Crown size={18} className="text-[var(--gold)]" />
            <h2 className="f-display text-base font-black tracking-wider text-[var(--gold)]">
              COUP DECREE & REFERENCE
            </h2>
          </div>
          <IconBtn onClick={onClose} title="Close">
            <X size={16} />
          </IconBtn>
        </div>

        {/* Tab Header */}
        <div className="flex flex-wrap gap-1 border-b border-[var(--line)] pb-2 text-xs">
          {tabs.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => {
                sfx.tick()
                setTab(t)
              }}
              className={`px-3 py-1 font-bold transition-colors ${
                tab === t
                  ? 'border-b-2 border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/10'
                  : 'text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto pr-1 text-xs text-[var(--ink-dim)] leading-relaxed">
          {tab === 'Actions Cheat Sheet' && (
            <div className="flex flex-col gap-4">
              <span className="label !text-[0.6rem] text-[var(--gold)]">ACTIONS CHEAT SHEET</span>
              <div className="w-full overflow-x-auto border border-[var(--line)]">
                <table className="w-full min-w-[520px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--line)] bg-[var(--bg2)] text-[var(--gold)]">
                      <th className="p-2 sm:p-2.5 font-bold">Action</th>
                      <th className="p-2 sm:p-2.5 font-bold">Character</th>
                      <th className="p-2 sm:p-2.5 font-bold min-w-[170px]">Effect</th>
                      <th className="p-2 sm:p-2.5 font-bold">Blocked By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {[
                      { action: 'Income', character: '-', effect: 'Take 1 Coin from Bank.', blockedBy: ['X'] },
                      { action: 'Foreign Aid', character: '-', effect: 'Take 2 Coins from Bank.', blockedBy: ['Duke'] },
                      { action: 'Coup', character: '-', effect: 'Pay 7 Coins to Bank and choose player to lose influence. NB! Must Coup, if you have 10 or more coins.', blockedBy: ['X'] },
                      { action: 'Convert', character: '-', effect: 'Change your allegiance by paying 1 coin to Treasury. Change another player\'s allegiance by paying 2 coins to Treasury.', blockedBy: ['X'] },
                      { action: 'Embezzle', character: 'Non Duke', effect: 'Take all the coins from Treasury and claim that you do NOT have the Duke.', blockedBy: ['Challenge'] },
                      { action: 'Exchange', character: 'Ambassador', effect: 'Draw 2 cards from deck, put any 2 cards back to deck, shuffle.', blockedBy: ['Challenge'] },
                      {
                        action: 'Exchange',
                        character: 'Inquisitor',
                        effect: (
                          <>
                            Draw <strong className="font-bold">1</strong> card from deck, put any{' '}
                            <strong className="font-bold">1</strong> card back to deck, shuffle.
                          </>
                        ),
                        blockedBy: ['Challenge'],
                      },
                      { action: 'Examine', character: 'Inquisitor', effect: 'Examine another player\'s card (their choice). May force them to exchange with card from deck (then shuffle).', blockedBy: ['Challenge', 'Contessa', '(optional)'] },
                      { action: 'Steal', character: 'Captain', effect: 'Steal two coins from another player.', blockedBy: ['Challenge', 'Captain', 'Ambassador', 'Inquisitor'] },
                      { action: 'Tax', character: 'Duke', effect: 'Take 3 coins from Bank.', blockedBy: ['Challenge'] },
                      { action: 'Assassinate', character: 'Assassin', effect: 'Pay 3 coins to Bank and choose a player to lose influence.', blockedBy: ['Challenge', 'Contessa'] },
                    ].map((row, idx) => (
                      <tr key={idx} className="hover:bg-[var(--bg2)]/50 transition-colors">
                        <td className="p-2 sm:p-2.5 font-bold text-[var(--ink)] whitespace-nowrap">
                          {row.action}
                        </td>
                        <td className="p-2 sm:p-2.5 font-bold text-[var(--gold)] f-mono whitespace-nowrap">
                          {row.character}
                        </td>
                        <td className="p-2 sm:p-2.5 text-[var(--ink-dim)] text-[0.72rem] leading-normal">
                          {row.effect}
                        </td>
                        <td className="p-2 sm:p-2.5 font-bold text-[0.72rem] whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            {row.blockedBy.map((entry, bIdx) => (
                              <span
                                key={bIdx}
                                className={
                                  entry === 'X' || entry === '-'
                                    ? 'text-[var(--muted)]'
                                    : entry === '(optional)'
                                    ? 'text-[var(--muted)] text-[0.62rem] font-normal pl-0.5'
                                    : entry === 'Challenge'
                                    ? 'text-[var(--bad)]'
                                    : 'text-[var(--gold)]'
                                }
                              >
                                {entry}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col gap-3 border-t border-[var(--line)] pt-3 text-xs leading-relaxed text-[var(--ink-dim)]">
                <div>
                  <h4 className="f-display text-xs font-bold text-[var(--gold)]">Challenging</h4>
                  <p className="mt-1 text-[0.72rem]">
                    When a player claims a character to perform an action or block, any other player can challenge. If the claimed player actually has the card, the challenger loses an influence and the claimer swaps their revealed card for a new one. If the claimer was bluffing, they lose an influence instead.
                  </p>
                </div>

                <div>
                  <h4 className="f-display text-xs font-bold text-[var(--gold)]">Blocking</h4>
                  <p className="mt-1 text-[0.72rem]">
                    Some actions can be blocked by claiming a counter-character. Blocking is itself a claim and can be challenged. You don&apos;t need to actually hold the character you claim - you can bluff a block!
                  </p>
                </div>

                <div>
                  <h4 className="f-display text-xs font-bold text-[var(--gold)]">Forced Coup</h4>
                  <p className="mt-1 text-[0.72rem]">
                    If you have <strong className="text-[var(--ink)]">10 or more coins</strong> at the start of your turn, you <strong className="text-[var(--ink)]">must</strong> Coup. No other action is allowed.
                  </p>
                </div>
              </div>
            </div>
          )}

          {tab === 'Overview' && (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="f-display text-sm font-bold text-[var(--gold)]">WHAT IS COUP?</h3>
                <p className="mt-1">
                  Coup is a card game of bluffing, deduction, and deception for 2-6 players (up to 10 in Reformation).
                  Each player starts with 2 secret influence cards (face-down) and 2 coins.
                  The last player with unrevealed influence remaining wins the game.
                </p>
              </div>
              <div>
                <h3 className="f-display text-sm font-bold text-[var(--gold)]">OBJECTIVE</h3>
                <p className="mt-1">
                  Eliminate all other players&apos; influence cards. When you lose an influence, you must sacrifice
                  one of your cards. When both of your cards are lost, you are exiled from the court.
                </p>
              </div>
              <div>
                <h3 className="f-display text-sm font-bold text-[var(--gold)]">TURN SEQUENCE</h3>
                <ol className="mt-1.5 list-decimal list-inside space-y-1">
                  <li>On your turn, declare one action (some claim a character role).</li>
                  <li>Other players may <strong className="text-[var(--ink)]">CHALLENGE</strong> your character claim. If you were bluffing, you lose an influence. If you were truthful, your challenger loses an influence!</li>
                  <li>Certain actions may be <strong className="text-[var(--ink)]">BLOCKED</strong> by claiming a counter-character. The original actor may then challenge the block.</li>
                  <li>If no challenge or block succeeds, the action resolves.</li>
                </ol>
              </div>
              <div className="flex items-center gap-3 border border-[var(--line)] bg-[var(--bg2)] p-2.5">
                <div className="shrink-0">
                  <CoupCardBack size="sm" />
                </div>
                <div className="text-xs">
                  <h4 className="f-display font-bold text-[var(--gold)]">SECRET INFLUENCE</h4>
                  <p className="mt-0.5 text-[0.7rem] text-[var(--ink-dim)]">
                    Face-down cards represent your secret influence in the court. Only you know what cards you hold until they are revealed or sacrificed.
                  </p>
                </div>
              </div>
              <div className="border border-[var(--accent)] bg-[var(--accent)]/10 p-3">
                <h3 className="f-display text-xs font-bold text-[var(--accent)]">THE GOLDEN RULE OF COUP</h3>
                <p className="mt-1 text-[var(--ink)] italic">
                  You can claim ANY character action or block regardless of what cards you actually hold.
                  Bluffing is not only allowed - it is essential to victory!
                </p>
              </div>
              <div className="border-t border-[var(--line)] pt-3 flex flex-col gap-1 text-[0.62rem] text-[var(--muted)]">
                <p>Original game designed by Rikki Tahta, published by Indie Boards & Cards.</p>
                <p>
                  Card icons courtesy of <a href="https://game-icons.net" target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--ink)]">game-icons.net</a> under CC BY 3.0 license.
                </p>
              </div>
            </div>
          )}

          {tab === 'Characters' && (
            <div className="flex flex-col gap-3">
              {(['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa', 'Inquisitor'] as Character[]).map(char => {
                const theme = CHAR_THEMES[char]
                return (
                  <div
                    key={char}
                    className={`flex items-center gap-3 border p-2.5 ${theme.bg} ${theme.border}`}
                  >
                    <div className="shrink-0">
                      <CoupCardFace character={char} size="sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`f-display text-sm font-black tracking-wider ${theme.text}`}>
                          {char.toUpperCase()}
                        </span>
                      </div>
                      <p className="mt-1 text-[0.72rem] text-[var(--ink)]">
                        {char === 'Duke' && 'Tax: Collect 3 coins from the treasury. Counteraction: Blocks Foreign Aid.'}
                        {char === 'Assassin' && 'Assassinate: Pay 3 coins to force a target to lose an influence card.'}
                        {char === 'Captain' && 'Steal: Take 2 coins from another player. Counteraction: Blocks Steal.'}
                        {char === 'Ambassador' && 'Exchange: Draw 2 cards from court deck, choose which to keep and return the rest. Counteraction: Blocks Steal.'}
                        {char === 'Contessa' && 'Counteraction: Blocks Assassination attempts against you.'}
                        {char === 'Inquisitor' && 'Exchange: Draw 1 card from deck, swap or keep. Examine: Inspect an opponent face-down card and decide whether to force them to swap it. Counteraction: Blocks Steal.'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {tab === 'Expansions' && (
            <div className="flex flex-col gap-4">
              {/* Reformation */}
              <div className="border border-[var(--line)] bg-[var(--bg2)] p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                  <span className="label !text-[0.62rem] text-[var(--gold)] font-bold">REFORMATION</span>
                  <span className="f-mono text-[0.55rem] text-[var(--muted)]">FACTIONS & TREASURY RESERVE</span>
                </div>
                <p className="mt-0.5 text-[0.72rem] leading-relaxed">
                  Players belong to one of two factions: <strong className="text-[var(--accent)]">Loyalist</strong> or <strong className="text-[var(--gold)]">Reformist</strong>.
                  You cannot target players in your own faction with Coup, Assassinate, Steal, or Examine, unless ALL surviving players belong to the same faction!
                </p>
                <div className="mt-1 flex flex-col gap-2">
                  <div className="border border-[var(--line)] bg-[var(--bg)] p-2">
                    <span className="font-bold text-white">Convert:</span> Pay 1 coin to convert yourself to the other faction, or 2 coins to convert another player. These coins go directly to the Treasury Reserve. Cannot be blocked or challenged.
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--bg)] p-2">
                    <span className="font-bold text-white">Embezzle:</span> Take all coins from the Treasury Reserve. Claims you do NOT hold a Duke. Uses inverse challenge: challengers win if you hold Duke!
                  </div>
                </div>
              </div>

              {/* Inquisitor */}
              <div className="border border-[var(--line)] bg-[var(--bg2)] p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                  <span className="label !text-[0.62rem] text-teal-400 font-bold">INQUISITOR</span>
                  <span className="f-mono text-[0.55rem] text-[var(--muted)]">CHARACTER VARIANT</span>
                </div>
                <p className="mt-0.5 text-[0.72rem] leading-relaxed">
                  Replaces the Ambassador in the court deck with the Inquisitor, adding investigative interrogation to the court.
                </p>
                <div className="mt-1 flex flex-col gap-2">
                  <div className="border border-[var(--line)] bg-[var(--bg)] p-2">
                    <span className="font-bold text-teal-300">Examine:</span> Inspect one face-down card from a chosen player (their choice of which card to present). After secretly viewing it, you may force them to return it to the deck, shuffle, and draw a replacement, or allow them to keep it.
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--bg)] p-2">
                    <span className="font-bold text-teal-300">Exchange:</span> Draw 1 card from the deck, decide whether to swap it with one of your own cards, and shuffle the deck.
                  </div>
                  <div className="border border-[var(--line)] bg-[var(--bg)] p-2">
                    <span className="font-bold text-teal-300">Block Steal:</span> Claim Inquisitor to block a Captain from stealing coins from you.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

function CoupChallengeModal({
  swap,
  nameOf,
}: {
  swap: ChallengeRevealSwap
  nameOf: (id?: string) => string
}) {
  const isBluffLost = swap.outcome === 'succeeded' || swap.stage === 'bluff_lost'
  const challengedName = nameOf(swap.challengedId)
  const challengerName = nameOf(swap.challengerId)
  const lostChar = swap.cardLost || swap.revealedCharacter

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-3 sm:p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 16 }}
        className="panel relative w-full max-w-sm sm:max-w-md border-2 border-[var(--gold)] bg-[#171410] p-4 sm:p-6 shadow-2xl flex flex-col items-center gap-3.5 text-center max-h-[90vh] overflow-y-auto"
      >
        {isBluffLost ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center border border-red-500/60 bg-red-950/40 text-red-500 shrink-0">
                <Swords size={18} />
              </div>
              <div className="text-left">
                <h2 className="f-display text-xs sm:text-sm font-black tracking-[0.16em] text-red-500 uppercase">
                  BLUFF EXPOSED!
                </h2>
                <p className="f-mono text-[0.55rem] sm:text-[0.62rem] text-[var(--muted)]">
                  Challenge proved successful
                </p>
              </div>
            </div>

            <div className="rule-dash w-full" />

            {/* 3D Card Flip revealing the card the player chose to lose */}
            <div className="flex flex-col items-center py-2">
              <motion.div
                key="bluff-flip"
                initial={{ rotateY: 180, scale: 0.8 }}
                animate={{ rotateY: 0, scale: 1 }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
                className="relative flex flex-col items-center"
              >
                <CoupCardFace character={lostChar} size="md" />
                <motion.span
                  initial={{ opacity: 0, scale: 1.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.35, duration: 0.25 }}
                  className="stamp stamp-sm !border-red-600 !text-red-500 font-bold mt-2.5 tracking-wider uppercase"
                >
                  INFLUENCE EXILED
                </motion.span>
              </motion.div>
            </div>

            <div className="border border-[var(--line)] bg-[var(--bg2)]/80 p-2.5 w-full flex flex-col gap-1">
              <p className="f-mono text-xs text-[var(--ink)]">
                <span className="text-[var(--gold)] font-bold">{challengedName}</span> was caught bluffing by{' '}
                <span className="text-[var(--gold)] font-bold">{challengerName}</span>!
              </p>
              <p className="f-mono text-[0.65rem] text-red-400 font-semibold">
                {challengedName} exiled their {lostChar}.
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center border border-[var(--ok)]/60 bg-[var(--ok)]/15 text-[var(--ok)] shrink-0">
                {swap.stage === 'reveal' ? <ShieldCheck size={18} /> : <RotateCcw size={18} />}
              </div>
              <div className="text-left">
                <h2 className="f-display text-xs sm:text-sm font-black tracking-[0.16em] text-[var(--gold)] uppercase">
                  {swap.stage === 'reveal' ? 'TRUTH PROVEN!' : 'DRAWING NEW INFLUENCE...'}
                </h2>
                <p className="f-mono text-[0.55rem] sm:text-[0.62rem] text-[var(--muted)]">
                  {swap.stage === 'reveal'
                    ? 'Genuine influence revealed to the court'
                    : 'Shuffling card back into Court Deck'}
                </p>
              </div>
            </div>

            <div className="rule-dash w-full" />

            {/* Animation Stage: Reveal vs Swap */}
            {swap.stage === 'reveal' ? (
              <div className="flex flex-col items-center py-2">
                <motion.div
                  key="reveal-genuine"
                  initial={{ rotateY: 90, opacity: 0 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center gap-2"
                >
                  <CoupCardFace character={swap.revealedCharacter} size="md" />
                  <span className="stamp stamp-sm !border-[var(--ok)] !text-[var(--ok)] tracking-wider uppercase">
                    GENUINE INFLUENCE
                  </span>
                </motion.div>
              </div>
            ) : (
              <div className="flex flex-col items-center py-2">
                <motion.div
                  key="swap-deck"
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  className="flex flex-col items-center gap-2.5"
                >
                  <div className="flex items-center gap-3">
                    <div className="opacity-40">
                      <CoupCardFace character={swap.revealedCharacter} size="sm" />
                    </div>
                    <ArrowRight size={18} className="text-[var(--gold)] animate-pulse" />
                    <CoupCardBack size="sm" />
                  </div>
                  <span className="f-mono text-xs font-bold text-[var(--gold)]">
                    SHUFFLED INTO DECK &bull; REPLACED SECRETLY
                  </span>
                </motion.div>
              </div>
            )}

            <div className="border border-[var(--line)] bg-[var(--bg2)]/80 p-2.5 w-full flex flex-col gap-1">
              <p className="f-mono text-xs text-[var(--ink)]">
                <span className="text-[var(--gold)] font-bold">{challengedName}</span> proved they hold{' '}
                <span className="text-[var(--gold)] font-bold">{swap.revealedCharacter}</span>!
              </p>
              <p className="f-mono text-[0.65rem] text-red-500 font-bold">
                {challengerName} loses an influence for the false challenge!
              </p>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

// Senate Record sheet: shown INSIDE the game-over popup (the endscreen is
// already a popup - the record opens as a sheet over the verdict in it).

export function CoupSenateRecordSheet({ logs, onClose }: { logs: CoupLogItem[]; onClose: () => void }) {
  // state keeps the log newest-first; a record reads oldest-first
  const chronological = [...logs].reverse()

  return (
    <div className="absolute inset-0 z-[15] flex flex-col gap-3 bg-[var(--panel)] p-4 sm:p-5">
      <div className="flex items-center justify-between border-b-2 border-[var(--line-strong)] pb-2.5">
        <div className="flex items-center gap-2">
          <ScrollText size={16} className="text-[var(--gold)]" />
          <h2 className="f-display text-sm font-black tracking-wider text-[var(--gold)]">
            SENATE RECORD
          </h2>
        </div>
        <IconBtn onClick={onClose} title="Close the record">
          <X size={15} />
        </IconBtn>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1 text-left">
        {chronological.length === 0 ? (
          <span className="f-mono text-xs text-[var(--muted)]">
            NO DECREES WERE ENTERED INTO THE RECORD.
          </span>
        ) : (
          chronological.map((log: CoupLogItem) => (
            <div
              key={log.id}
              className="flex items-baseline gap-2 border-b border-dashed border-[var(--line)] pb-1"
            >
              <span className="f-mono shrink-0 text-[0.58rem] tabular text-[var(--muted)]">
                {new Date(log.at).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span className="f-mono text-[0.65rem] text-[var(--ink-dim)]">{log.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CoupDecisionModal({
  state,
  myId,
  players,
  sendAct,
  nameOf,
  colorOf,
  onPass,
  onMinimize,
}: {
  state: CoupState
  myId: string
  players: CouncilPlayer[]
  sendAct: (actorId: string, actionObj: Record<string, unknown>) => void
  nameOf: (id?: string) => string
  colorOf: (id?: string) => string
  onPass: () => void
  onMinimize: () => void
}) {
  const pa = state.pendingAction
  const pb = state.pendingBlock
  const cs = state.challengeState
  const myState = state.players[myId]
  const isAlive = !!myState && myState.alive
  const amSeated = state.seats.includes(myId)
  const alivePlayers = state.seats.filter(id => state.players[id]?.alive)
  const aliveCount = alivePlayers.length

  const isActor = pa?.actorId === myId
  const isBlocker = pb?.blockerId === myId
  const isTarget = pa?.targetId === myId

  const passedIds = state.stage === 'block' ? (state.blockPassedPlayerIds ?? []) : (cs?.passedPlayerIds ?? [])
  const hasPassed = passedIds.includes(myId)

  if (hasPassed) return null

  // Header Title & Icon
  let title = 'DECISION WINDOW'
  let subtitle = 'Deliberation in progress'
  let icon = <AlertTriangle size={18} className="text-[var(--gold)]" />

  if (state.stage === 'action_challenge') {
    title = 'ACTION CHALLENGE WINDOW'
    subtitle = 'A senator has declared an action by claiming authority'
    icon = <Swords size={18} className="text-[var(--accent)]" />
  } else if (state.stage === 'block') {
    title = 'COUNTERACTION (BLOCK) WINDOW'
    subtitle = 'An action may be countered before it resolves'
    icon = <Shield size={18} className="text-[var(--gold)]" />
  } else if (state.stage === 'block_challenge') {
    title = 'CHALLENGE COUNTERACTION'
    subtitle = 'A senator has claimed authority to block the action'
    icon = <ShieldAlert size={18} className="text-[var(--accent)]" />
  }

  // Claimed character preview
  const claimedChar: Character | undefined =
    state.stage === 'block_challenge' ? pb?.claimedCharacter : pa?.claimedCharacter

  const handlePass = () => {
    onPass()
    sendAct(myId, { t: 'pass' })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-2 sm:p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 12 }}
        className="panel relative w-full max-w-lg border-2 border-[var(--gold)] bg-[var(--bg)] p-3 sm:p-5 shadow-2xl flex flex-col gap-3 sm:gap-3.5 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center border border-[var(--line-strong)] bg-[var(--bg2)] shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <h2 className="f-display text-xs sm:text-sm font-black tracking-[0.12em] sm:tracking-[0.16em] text-[var(--gold)] truncate">
                {title}
              </h2>
              <p className="f-mono text-[0.52rem] sm:text-[0.6rem] text-[var(--muted)] truncate">
                {subtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {state.endsAt ? (
              <div className="flex items-center gap-1 border border-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 sm:px-2.5 sm:py-1 shrink-0">
                <Countdown endsAt={state.endsAt} warnAt={5000} />
              </div>
            ) : (
              <div className="flex items-center gap-1 border border-[var(--line)] bg-[var(--bg2)] px-2 py-0.5 sm:px-2.5 sm:py-1 shrink-0">
                <span className="f-mono text-[0.58rem] sm:text-[0.65rem] font-bold text-[var(--gold)]">∞ NO TIMER</span>
              </div>
            )}
            <button
              type="button"
              onClick={onMinimize}
              title="Minimize window"
              className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center border border-[var(--line-strong)] bg-[var(--bg2)] text-base font-bold text-[var(--ink)] hover:border-[var(--gold)] hover:text-[var(--gold)] transition-colors shrink-0 leading-none pb-0.5"
            >
              -
            </button>
          </div>
        </div>

        {state.endsAt && (
          <TimerBar
            endsAt={state.endsAt}
            totalMs={(state.actionTimer || 15) * 1000}
          />
        )}

        <div className="rule-dash" />

        {/* Event Details Card */}
        <div className="border border-[var(--line)] bg-[var(--bg2)]/60 p-3 flex flex-col gap-3">
          {/* Actor & Target Row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Actor */}
            {pa && (
              <div className="flex items-center gap-2">
                <Avatar name={nameOf(pa.actorId)} color={colorOf(pa.actorId)} size={30} />
                <div className="flex flex-col">
                  <span className="label !text-[0.52rem]">PERFORMED BY</span>
                  <div className="flex items-center gap-1.5">
                    <span className="f-mono text-xs font-bold text-[var(--ink)]">
                      {nameOf(pa.actorId)}
                    </span>
                    {state.players[pa.actorId]?.faction && (
                      <RoleTag tone={state.players[pa.actorId]?.faction === 'Loyalist' ? 'accent' : 'gold'}>
                        {state.players[pa.actorId]?.faction}
                      </RoleTag>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Target if present */}
            {pa?.targetId && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--muted)] text-sm">→</span>
                <Avatar name={nameOf(pa.targetId)} color={colorOf(pa.targetId)} size={30} />
                <div className="flex flex-col">
                  <span className="label !text-[0.52rem]">TARGET</span>
                  <div className="flex items-center gap-1.5">
                    <span className="f-mono text-xs font-bold text-[var(--ink)]">
                      {isTarget ? 'YOU' : nameOf(pa.targetId)}
                    </span>
                    {isTarget && (
                      <span className="bg-[var(--accent)] px-1.5 py-0.2 text-[0.58rem] font-bold text-white uppercase">
                        YOU
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action and Claim Summary */}
          <div className="flex flex-col sm:flex-row items-center gap-3 border-t border-[var(--line)] pt-3">
            {claimedChar && (
              <div className="shrink-0">
                <CoupCardFace character={claimedChar} size="sm" />
              </div>
            )}
            <div className="flex flex-col gap-1 w-full text-left">
              {state.stage === 'action_challenge' && pa && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="label !text-[0.55rem]">DECLARED ACTION:</span>
                    <span className="f-display text-sm font-black text-[var(--accent)] tracking-wider uppercase">
                      {pa.type}
                    </span>
                  </div>
                  <p className="f-mono text-xs leading-relaxed text-[var(--ink)]">
                    <span className="text-[var(--gold)] font-bold">{nameOf(pa.actorId)}</span> claims authority of the{' '}
                    <span className="text-[var(--gold)] font-bold">{pa.claimedCharacter}</span>
                    {pa.targetId ? ` against ${isTarget ? 'YOU' : nameOf(pa.targetId)}` : ''}.
                  </p>
                  <p className="f-mono text-[0.62rem] text-[var(--muted)]">
                    Any senator who suspects a bluff may challenge. A failed challenge costs an influence!
                  </p>
                </>
              )}

              {state.stage === 'block' && pa && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="label !text-[0.55rem]">ACTION TO COUNTER:</span>
                    <span className="f-display text-sm font-black text-[var(--gold)] tracking-wider uppercase">
                      {pa.type}
                    </span>
                  </div>
                  <p className="f-mono text-xs leading-relaxed text-[var(--ink)]">
                    <span className="text-[var(--gold)] font-bold">{nameOf(pa.actorId)}</span> is executing{' '}
                    <span className="text-[var(--gold)] font-bold">{pa.type}</span>
                    {pa.targetId ? ` targeting ${isTarget ? 'YOU' : nameOf(pa.targetId)}` : ''}.
                  </p>
                  <p className="f-mono text-[0.62rem] text-[var(--muted)]">
                    {pa.type === 'ForeignAid' && 'Foreign Aid may be blocked by any senator claiming Duke.'}
                    {pa.type === 'Steal' && `Steal may only be blocked by the target (${isTarget ? 'YOU' : nameOf(pa.targetId)}) claiming Captain or ${state.useInquisitor ? 'Inquisitor' : 'Ambassador'}.`}
                    {pa.type === 'Assassinate' && `Assassination may only be blocked by the target (${isTarget ? 'YOU' : nameOf(pa.targetId)}) claiming Contessa.`}
                    {pa.type === 'Examine' && `Examine may only be blocked by the target (${isTarget ? 'YOU' : nameOf(pa.targetId)}) claiming Contessa.`}
                  </p>
                </>
              )}

              {state.stage === 'block_challenge' && pb && pa && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="label !text-[0.55rem]">BLOCK CLAIMED BY:</span>
                    <span className="f-mono text-xs font-bold text-[var(--ink)]">
                      {nameOf(pb.blockerId)}
                    </span>
                    {state.players[pb.blockerId]?.faction && (
                      <RoleTag tone={state.players[pb.blockerId]?.faction === 'Loyalist' ? 'accent' : 'gold'}>
                        {state.players[pb.blockerId]?.faction}
                      </RoleTag>
                    )}
                  </div>
                  <p className="f-mono text-xs leading-relaxed text-[var(--ink)]">
                    <span className="text-[var(--gold)] font-bold">{nameOf(pb.blockerId)}</span> blocked{' '}
                    <span className="text-[var(--accent)] font-bold">{nameOf(pa.actorId)}&apos;s {pa.type}</span> claiming{' '}
                    <span className="text-[var(--gold)] font-bold">{pb.claimedCharacter}</span>!
                  </p>
                  <p className="f-mono text-[0.62rem] text-[var(--muted)]">
                    Any senator may challenge this block claim.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Court Passed Status */}
          <div className="flex items-center justify-between border-t border-[var(--line)] pt-2 text-[0.65rem] f-mono text-[var(--muted)]">
            <span>COURT PASSES:</span>
            <span className="font-bold text-[var(--ink)]">
              {passedIds.length} / {aliveCount} SENATORS PASSED
            </span>
          </div>
        </div>

        {/* Current User Decision / Actions */}
        <div className="flex flex-col gap-2">
          {!isAlive ? (
            <div className="p-3 border border-[var(--line)] bg-[var(--bg2)] text-center">
              <span className="f-mono text-xs text-[var(--muted)]">
                You are observing this deliberation.
              </span>
            </div>
          ) : isActor && state.stage === 'action_challenge' ? (
            <div className="p-3 border border-[var(--gold)] bg-[var(--gold)]/10 text-center">
              <span className="f-mono text-xs text-[var(--gold)] font-bold">
                You claimed {pa?.claimedCharacter}. Awaiting challenge decisions from the council...
              </span>
            </div>
          ) : isActor && state.stage === 'block' ? (
            <div className="p-3 border border-[var(--gold)] bg-[var(--gold)]/10 text-center">
              <span className="f-mono text-xs text-[var(--gold)] font-bold">
                Your action is pending. Awaiting counteractions from the court...
              </span>
            </div>
          ) : isBlocker && state.stage === 'block_challenge' ? (
            <div className="p-3 border border-[var(--gold)] bg-[var(--gold)]/10 text-center">
              <span className="f-mono text-xs text-[var(--gold)] font-bold">
                You blocked with {pb?.claimedCharacter}. Awaiting challenges from other senators...
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {/* ACTION CHALLENGE BUTTONS */}
              {state.stage === 'action_challenge' && pa && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Btn
                    variant="danger"
                    className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs font-bold shadow-md leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                    onClick={() => sendAct(myId, { t: 'challenge' })}
                  >
                    <span className="flex items-center justify-center gap-1.5 flex-wrap">
                      <Swords size={15} className="shrink-0" />
                      <span>CHALLENGE ({pa.claimedCharacter})</span>
                    </span>
                  </Btn>
                  <Btn
                    variant="ghost"
                    className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs border border-[var(--line)] hover:border-[var(--line-strong)] leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                    onClick={handlePass}
                  >
                    <span className="flex items-center justify-center gap-1.5 flex-wrap">
                      <Check size={15} className="shrink-0" />
                      <span>PASS</span>
                    </span>
                  </Btn>
                </div>
              )}

              {/* BLOCK BUTTONS */}
              {state.stage === 'block' && pa && (
                <div className="flex flex-col gap-2">
                  {pa.type === 'ForeignAid' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {isFactionRestricted(state, myId, pa.actorId) ? (
                        <div className="sm:col-span-2 p-2 border border-[var(--line)] bg-[var(--bg2)] text-center text-xs text-[var(--muted)]">
                          Cannot block: You share the same faction as {nameOf(pa.actorId)}.
                        </div>
                      ) : (
                        <Btn
                          variant="solid"
                          className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                          onClick={() => sendAct(myId, { t: 'block', character: 'Duke' })}
                        >
                          <span className="flex items-center justify-center gap-1.5 flex-wrap">
                            <Shield size={15} className="shrink-0" />
                            <span>BLOCK WITH DUKE</span>
                          </span>
                        </Btn>
                      )}
                      <Btn
                        variant="ghost"
                        className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs border border-[var(--line)] hover:border-[var(--line-strong)] leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                        onClick={handlePass}
                      >
                        <span className="flex items-center justify-center gap-1.5 flex-wrap">
                          <Check size={15} className="shrink-0" />
                          <span>PASS</span>
                        </span>
                      </Btn>
                    </div>
                  )}

                  {pa.type === 'Steal' && (
                    <>
                      {isTarget ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Btn
                            variant="solid"
                            className="w-full !whitespace-normal !px-2 !py-2.5 text-center text-[0.65rem] sm:text-xs leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                            onClick={() => sendAct(myId, { t: 'block', character: 'Captain' })}
                          >
                            <span className="flex items-center justify-center gap-1.5 flex-wrap">
                              <Shield size={14} className="shrink-0" />
                              <span>BLOCK (CAPTAIN)</span>
                            </span>
                          </Btn>
                          {state.useInquisitor ? (
                            <Btn
                              variant="solid"
                              className="w-full !whitespace-normal !px-2 !py-2.5 text-center text-[0.65rem] sm:text-xs leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                              onClick={() => sendAct(myId, { t: 'block', character: 'Inquisitor' })}
                            >
                              <span className="flex items-center justify-center gap-1.5 flex-wrap">
                                <Shield size={14} className="shrink-0" />
                                <span>BLOCK (INQUISITOR)</span>
                              </span>
                            </Btn>
                          ) : (
                            <Btn
                              variant="solid"
                              className="w-full !whitespace-normal !px-2 !py-2.5 text-center text-[0.65rem] sm:text-xs leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                              onClick={() => sendAct(myId, { t: 'block', character: 'Ambassador' })}
                            >
                              <span className="flex items-center justify-center gap-1.5 flex-wrap">
                                <Shield size={14} className="shrink-0" />
                                <span>BLOCK (AMBASSADOR)</span>
                              </span>
                            </Btn>
                          )}
                          <Btn
                            variant="ghost"
                            className="w-full !whitespace-normal !px-2 !py-2.5 text-center text-[0.65rem] sm:text-xs border border-[var(--line)] hover:border-[var(--line-strong)] leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                            onClick={handlePass}
                          >
                            <span className="flex items-center justify-center gap-1.5 flex-wrap">
                              <Check size={14} className="shrink-0" />
                              <span>ALLOW (PASS)</span>
                            </span>
                          </Btn>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="p-2 border border-[var(--line)] bg-[var(--bg2)] text-center text-xs text-[var(--muted)]">
                            Only the targeted senator ({nameOf(pa.targetId)}) may block this theft.
                          </div>
                          <Btn
                            variant="ghost"
                            className="w-full !whitespace-normal !px-2 !py-2.5 text-center text-[0.68rem] sm:text-xs border border-[var(--line)]"
                            onClick={handlePass}
                          >
                            PASS
                          </Btn>
                        </div>
                      )}
                    </>
                  )}

                  {pa.type === 'Examine' && state.contessaBlocksExamine && (
                    <>
                      {isTarget ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Btn
                            variant="danger"
                            className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs font-bold leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                            onClick={() => sendAct(myId, { t: 'block', character: 'Contessa' })}
                          >
                            <span className="flex items-center justify-center gap-1.5 flex-wrap">
                              <Shield size={15} className="shrink-0" />
                              <span>BLOCK WITH CONTESSA</span>
                            </span>
                          </Btn>
                          <Btn
                            variant="ghost"
                            className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs border border-[var(--line)] hover:border-[var(--line-strong)] leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                            onClick={handlePass}
                          >
                            <span className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span>ALLOW (PASS)</span>
                            </span>
                          </Btn>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="p-2 border border-[var(--line)] bg-[var(--bg2)] text-center text-xs text-[var(--muted)]">
                            Only the targeted senator ({nameOf(pa.targetId)}) may block this examination.
                          </div>
                          <Btn
                            variant="ghost"
                            className="w-full !whitespace-normal !px-2 !py-2.5 text-center text-[0.68rem] sm:text-xs border border-[var(--line)]"
                            onClick={handlePass}
                          >
                            PASS
                          </Btn>
                        </div>
                      )}
                    </>
                  )}

                  {pa.type === 'Assassinate' && (
                    <>
                      {isTarget ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <Btn
                            variant="danger"
                            className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs font-bold leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                            onClick={() => sendAct(myId, { t: 'block', character: 'Contessa' })}
                          >
                            <span className="flex items-center justify-center gap-1.5 flex-wrap">
                              <Shield size={15} className="shrink-0" />
                              <span>BLOCK WITH CONTESSA</span>
                            </span>
                          </Btn>
                          <Btn
                            variant="ghost"
                            className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.68rem] sm:text-xs border border-[var(--line)] hover:border-[var(--line-strong)] leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                            onClick={handlePass}
                          >
                            <span className="flex items-center justify-center gap-1.5 flex-wrap">
                              <span>ACCEPT FATE (PASS)</span>
                            </span>
                          </Btn>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <div className="p-2 border border-[var(--line)] bg-[var(--bg2)] text-center text-xs text-[var(--muted)]">
                            Only the targeted senator ({nameOf(pa.targetId)}) may block assassination.
                          </div>
                          <Btn
                            variant="ghost"
                            className="w-full !whitespace-normal !px-2 !py-2.5 text-center text-[0.68rem] sm:text-xs border border-[var(--line)]"
                            onClick={handlePass}
                          >
                            PASS
                          </Btn>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* BLOCK CHALLENGE BUTTONS */}
              {state.stage === 'block_challenge' && pb && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Btn
                    variant="danger"
                    className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.65rem] sm:text-xs font-bold shadow-md leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                    onClick={() => sendAct(myId, { t: 'challenge' })}
                  >
                    <span className="flex items-center justify-center gap-1.5 flex-wrap">
                      <Swords size={15} className="shrink-0" />
                      <span>CHALLENGE BLOCK ({pb.claimedCharacter})</span>
                    </span>
                  </Btn>
                  <Btn
                    variant="ghost"
                    className="w-full !whitespace-normal !px-2 !py-3 text-center text-[0.65rem] sm:text-xs border border-[var(--line)] hover:border-[var(--line-strong)] leading-tight tracking-[0.03em] sm:tracking-[0.08em]"
                    onClick={handlePass}
                  >
                    <span className="flex items-center justify-center gap-1.5 flex-wrap">
                      <Check size={15} className="shrink-0" />
                      <span>ACCEPT BLOCK (PASS)</span>
                    </span>
                  </Btn>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Player Influences & Coins Summary at Bottom of Modal */}
        {amSeated && myState && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <Coins size={13} className="text-[var(--gold)] shrink-0" />
              <span className="f-mono text-[0.65rem] font-bold text-[var(--gold)]">
                {myState.coins}
              </span>
              {myState.faction && (
                <span className="ml-2 f-mono text-[0.6rem] font-bold text-[var(--muted)]">
                  FACTION:{' '}
                  <span className={myState.faction === 'Loyalist' ? 'text-[var(--accent)]' : 'text-[var(--gold)]'}>
                    {myState.faction.toUpperCase()}
                  </span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="f-mono text-[0.6rem] text-[var(--muted)]">YOUR INFLUENCES:</span>
              {myState.influences.map((inf: CoupCard, i: number) => (
                <span
                  key={i}
                  className={`f-mono text-[0.65rem] font-bold px-1.5 py-0.5 border ${
                    inf.revealed
                      ? 'border-transparent text-[var(--muted)] line-through opacity-40'
                      : 'border-[var(--line-strong)] text-[var(--ink)] bg-[var(--bg2)]'
                  }`}
                >
                  {inf.character}
                </span>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

// coup game component

export function CoupGame({
  api,
  state,
  settings,
}: {
  api: CouncilApi
  state: CoupState
  settings: SettingsMap
}) {
  const [showRules, setShowRules] = useState(false)
  const [showRecord, setShowRecord] = useState(false)
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null)
  const [selectedExchange, setSelectedExchange] = useState<number[]>([])

  const st = api.state!
  const players = st.players
  const myId = api.myId
  const me = players.find(p => p.id === myId)
  const meAdmin = !!me && (me.isAdmin || me.isOwner)
  const myState = state.players[myId]

  const curId = state.seats[state.turn]
  const isMyTurn = curId === myId
  const curP = players.find(p => p.id === curId)
  const proxyingCur = meAdmin && !!curP && canProxyFor(curP)
  const canActTurn = (isMyTurn || proxyingCur) && state.stage === 'action'

  // Reset selected targets on turn / stage changes
  useEffect(() => {
    setSelectedTarget(null)
    setSelectedExchange([])
  }, [state.turn, state.stage])

  // Helper names and colors
  const nameOf = (id?: string) => (id ? (players.find(p => p.id === id)?.name ?? id) : '')
  const colorOf = (id?: string) => (id ? (players.find(p => p.id === id)?.color ?? '#888') : '#888')

  // Spectator or seated check
  const amSeated = state.seats.includes(myId)
  const iLost = outcomeFor('coup', state, myId) === 'lost'
  const iWon = outcomeFor('coup', state, myId) === 'won'
  const winnerP = state.winner ? players.find(p => p.id === state.winner) : null

  // Full seated alive turn sequence in cyclic order starting from the current turn player
  const aliveOrder = useMemo(() => {
    const alive: string[] = []
    const n = state.seats.length
    if (n === 0) return alive
    const curIdx = state.seats.indexOf(curId)
    const startIdx = curIdx >= 0 ? curIdx : state.turn
    for (let i = 0; i < n; i++) {
      const pid = state.seats[(startIdx + i) % n]
      if (state.players[pid]?.alive && !alive.includes(pid)) {
        alive.push(pid)
      }
    }
    return alive
  }, [state.seats, state.players, curId, state.turn])

  const myAliveIdx = aliveOrder.indexOf(myId)
  const isMeAlive = myAliveIdx >= 0
  const turnsUntilMe = isMeAlive ? myAliveIdx : null

  // All alive opponents that can be selected (for attacks or converting)
  const aliveOpponents = useMemo(() => {
    return state.seats.filter((id: string) => id !== curId && !!state.players[id]?.alive)
  }, [state.seats, state.players, curId])

  // Is the currently selected target restricted from being attacked due to faction?
  const isTargetRestrictedFromAttack = useMemo(() => {
    if (!selectedTarget) return false
    return isFactionRestricted(state, curId, selectedTarget)
  }, [state, curId, selectedTarget])

  // Send move intent
  const sendAct = (actorId: string, actionObj: Record<string, unknown>) => {
    api.sendAction(actionObj, actorId)
  }

  // Active prompt info
  const pa = state.pendingAction
  const pb = state.pendingBlock
  const cs = state.challengeState

  const decisionKey = `${state.stage}_${state.turn}_${pa?.actorId}_${pa?.type}_${pb?.blockerId}_${state.actionCount || 0}`
  const [passedKey, setPassedKey] = useState<string | null>(null)
  const [modalDismissed, setModalDismissed] = useState(false)

  // Reset modal dismissal on new decision key
  useEffect(() => {
    setModalDismissed(false)
  }, [decisionKey])

  const isDecisionPhase =
    (state.stage === 'action_challenge' || state.stage === 'block' || state.stage === 'block_challenge') &&
    !state.challengeRevealSwap

  const passedIds = state.stage === 'block'
    ? (state.blockPassedPlayerIds ?? [])
    : (cs?.passedPlayerIds ?? [])
  const hasPassed = passedIds.includes(myId)

  // Player must make a decision if decision phase is active, player is alive, and hasn't passed yet
  const needsDecision = isDecisionPhase && !hasPassed && !!myState?.alive
  const shouldShowDecision = needsDecision && !modalDismissed && passedKey !== decisionKey

  const needsMyHandAtTop =
    isMyTurn ||
    (state.stage === 'influence_loss' && state.influenceLossRequest?.playerId === myId) ||
    (state.stage === 'exchange' && state.exchangeState?.playerId === myId) ||
    (state.stage === 'examine_selection' && state.examineSelectionState?.targetId === myId)

  // panels

  const yourSeatAndHandPanel = amSeated && myState ? (
    <div className="panel-hard brackets relative flex flex-col gap-3 p-3 sm:p-5">
      <SectionHead
        title="Your Seat & Hand"
        right={
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            {isMyTurn && state.stage === 'action' && state.endsAt && (
              <div className="flex shrink-0 items-center gap-1 sm:gap-1.5 border border-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 sm:px-2.5 sm:py-1 text-[var(--gold)] animate-pulse">
                <Clock size={13} className="text-[var(--gold)] shrink-0" />
                <Countdown endsAt={state.endsAt} warnAt={5000} />
              </div>
            )}
            {myState.faction && (
              <RoleTag tone={myState.faction === 'Loyalist' ? 'accent' : 'gold'}>
                {myState.faction.toUpperCase()}
              </RoleTag>
            )}
            <div className="flex shrink-0 whitespace-nowrap items-center gap-1.5 border border-[var(--gold)] bg-[var(--gold)]/10 px-2.5 py-0.5 sm:px-3 sm:py-1">
              <Coins size={14} className="text-[var(--gold)] shrink-0" />
              <span className="f-mono text-xs sm:text-sm font-black tabular text-[var(--gold)] whitespace-nowrap shrink-0 inline-block">
                {myState.coins}
              </span>
            </div>
          </div>
        }
      />

      {/* Turn Timer Bar when it is player's turn */}
      {isMyTurn && state.stage === 'action' && state.endsAt && (
        <div className="flex flex-col gap-1 w-full -mt-1">
          <div className="flex items-center justify-between text-[0.62rem] text-[var(--gold)]">
            <span className="label !text-[0.55rem] text-[var(--gold)] font-bold">YOUR TURN TIMER</span>
            <div className="flex items-center gap-1 font-bold">
              <Clock size={11} />
              <Countdown endsAt={state.endsAt} warnAt={5000} />
            </div>
          </div>
          <TimerBar
            endsAt={state.endsAt}
            totalMs={(state.turnTimer || 15) * 1000}
          />
        </div>
      )}

      {/* Your Cards */}
      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
        {myState.influences.map((card: CoupCard, i: number) => {
          const isSelected = selectedExchange.includes(i)
          const canPickLoss = state.stage === 'influence_loss' &&
            state.influenceLossRequest?.playerId === myId &&
            !card.revealed

          return (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <CardView
                card={card}
                isOwn={true}
                size="lg"
                selected={isSelected}
                onClick={canPickLoss ? () => sendAct(myId, { t: 'lose_influence', influenceIndex: i }) : undefined}
              />
              {canPickLoss && (
                <Btn small variant="danger" onClick={() => sendAct(myId, { t: 'lose_influence', influenceIndex: i })}>
                  SACRIFICE
                </Btn>
              )}
            </div>
          )
        })}
      </div>

      {/* Action Panels depending on stage */}
      <div className="mt-2 border-t border-[var(--line)] pt-3">
        {/* 1. MY TURN ACTIONS */}
        {canActTurn && (
          <div className="flex flex-col gap-3">
            <span className="label">CHOOSE YOUR ACTION</span>

            {/* Forced coup notification */}
            {myState.coins >= 10 && (
              <div className="border border-[var(--bad)] bg-[var(--bad)]/15 p-2.5">
                <span className="text-xs font-bold text-[var(--bad)]">
                  YOU HOLD 10+ COINS: YOU MUST LAUNCH A COUP!
                </span>
              </div>
            )}

            {/* Target Picker if required */}
            {selectedTarget && (
              <div className="flex flex-col gap-1.5 border border-[var(--gold)] bg-[var(--gold)]/10 p-2 sm:p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="label !text-[0.55rem]">TARGET:</span>
                    <span className="f-display text-xs font-bold text-[var(--gold)]">{nameOf(selectedTarget)}</span>
                    {state.reformation && state.players[selectedTarget]?.faction && (
                      <RoleTag tone={state.players[selectedTarget]?.faction === 'Loyalist' ? 'accent' : 'gold'}>
                        {state.players[selectedTarget]?.faction.toUpperCase()}
                      </RoleTag>
                    )}
                  </div>
                  <Btn small variant="ghost" onClick={() => setSelectedTarget(null)}>CHANGE</Btn>
                </div>
                {state.reformation && isTargetRestrictedFromAttack && (
                  <p className="f-mono text-[0.6rem] text-[var(--gold)] leading-tight">
                    Same allegiance! Cannot attack with Coup, Steal, Assassinate, or Examine. You can convert them to {state.players[selectedTarget]?.faction === 'Loyalist' ? 'Reformist' : 'Loyalist'} for 2 coins.
                  </p>
                )}
              </div>
            )}

            {/* Target Selector Buttons */}
            {!selectedTarget && (
              <div className="flex flex-col gap-1.5">
                <span className="label !text-[0.55rem]">SELECT TARGET:</span>
                <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
                  {aliveOpponents.map((tid: string) => {
                    const pState = state.players[tid]
                    return (
                      <Btn
                        key={tid}
                        small
                        variant="outline"
                        className="!whitespace-normal truncate !px-2 !py-1.5 text-[0.65rem] sm:text-xs"
                        onClick={() => setSelectedTarget(tid)}
                      >
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span>{nameOf(tid)}</span>
                          <span className="opacity-70">({pState?.coins ?? 0}c)</span>
                          {state.reformation && pState?.faction && (
                            <span className={`text-[0.52rem] font-bold px-1 py-0.2 ${
                              pState.faction === 'Loyalist'
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-[var(--gold)] text-black'
                            }`}>
                              {pState.faction.slice(0, 3).toUpperCase()}
                            </span>
                          )}
                        </span>
                      </Btn>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Action Buttons Grid (Fully responsive on mobile) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {myState.coins < 10 && (
                <>
                  <Btn
                    variant="outline"
                    onClick={() => sendAct(curId, { t: 'action', action: 'Income' })}
                    title="Take 1 coin from treasury"
                    className="!whitespace-normal !px-1.5 !py-2.5 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    INCOME (+1)
                  </Btn>

                  <Btn
                    variant="outline"
                    onClick={() => sendAct(curId, { t: 'action', action: 'ForeignAid' })}
                    title="Take 2 coins (blockable by Duke)"
                    className="!whitespace-normal !px-1.5 !py-2.5 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    FOREIGN AID (+2)
                  </Btn>

                  <Btn
                    variant="solid"
                    onClick={() => sendAct(curId, { t: 'action', action: 'Tax' })}
                    title="Claim Duke: Take 3 coins"
                    className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    <span className="flex flex-col items-center justify-center">
                      <span>TAX (+3)</span>
                      <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">[DUKE]</span>
                    </span>
                  </Btn>

                  <Btn
                    variant="solid"
                    disabled={!selectedTarget || (state.players[selectedTarget]?.coins ?? 0) <= 0 || isTargetRestrictedFromAttack}
                    onClick={() => selectedTarget && sendAct(curId, { t: 'action', action: 'Steal', targetId: selectedTarget })}
                    title={isTargetRestrictedFromAttack ? "Cannot steal from senator of same allegiance" : "Claim Captain: Steal 2 coins"}
                    className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    <span className="flex flex-col items-center justify-center">
                      <span>STEAL (+2)</span>
                      <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">[CAPTAIN]</span>
                    </span>
                  </Btn>

                  <Btn
                    variant="danger"
                    disabled={myState.coins < 3 || !selectedTarget || isTargetRestrictedFromAttack}
                    onClick={() => selectedTarget && sendAct(curId, { t: 'action', action: 'Assassinate', targetId: selectedTarget })}
                    title={isTargetRestrictedFromAttack ? "Cannot assassinate senator of same allegiance" : "Pay 3 coins, Claim Assassin: Target loses card"}
                    className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    <span className="flex flex-col items-center justify-center">
                      <span>ASSASSINATE (-3)</span>
                      <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">[ASSASSIN]</span>
                    </span>
                  </Btn>

                  <Btn
                    variant="solid"
                    onClick={() => sendAct(curId, { t: 'action', action: 'Exchange' })}
                    title={state.useInquisitor ? "Claim Inquisitor: Draw 1 card and swap" : "Claim Ambassador: Draw cards and swap"}
                    className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    <span className="flex flex-col items-center justify-center">
                      <span>EXCHANGE</span>
                      <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">[{state.useInquisitor ? 'INQUISITOR' : 'AMBASSADOR'}]</span>
                    </span>
                  </Btn>

                  {state.useInquisitor && (
                    <Btn
                      variant="solid"
                      disabled={!selectedTarget || isTargetRestrictedFromAttack}
                      onClick={() => selectedTarget && sendAct(curId, { t: 'action', action: 'Examine', targetId: selectedTarget })}
                      title={isTargetRestrictedFromAttack ? "Cannot examine senator of same allegiance" : "Claim Inquisitor: Examine target player's card"}
                      className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                    >
                      <span className="flex flex-col items-center justify-center">
                        <span>EXAMINE</span>
                        <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">[INQUISITOR]</span>
                      </span>
                    </Btn>
                  )}
                </>
              )}

              {/* Coup Button */}
              <Btn
                variant="accent"
                disabled={myState.coins < 7 || !selectedTarget || isTargetRestrictedFromAttack}
                onClick={() => selectedTarget && sendAct(curId, { t: 'action', action: 'Coup', targetId: selectedTarget })}
                title={isTargetRestrictedFromAttack ? "Cannot Coup senator of same allegiance" : "Pay 7 coins: Target unconditionally loses 1 card"}
                className="!whitespace-normal !px-1.5 !py-2.5 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
              >
                <span className="flex items-center justify-center gap-1">
                  <Sword size={13} className="shrink-0" />
                  <span>COUP (-7)</span>
                </span>
              </Btn>

              {/* Reformation Actions */}
              {state.reformation && myState.coins < 10 && (
                <>
                  <Btn
                    variant="outline"
                    disabled={myState.coins < 1}
                    onClick={() => sendAct(curId, { t: 'action', action: 'Convert' })}
                    title="Pay 1 coin to Treasury Reserve: Switch your own allegiance"
                    className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    <span className="flex flex-col items-center justify-center">
                      <span>CONVERT SELF (-1)</span>
                      <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">
                        [TO {myState.faction === 'Loyalist' ? 'REFORMIST' : 'LOYALIST'}]
                      </span>
                    </span>
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={myState.coins < 2 || !selectedTarget}
                    onClick={() => selectedTarget && sendAct(curId, { t: 'action', action: 'Convert', targetId: selectedTarget })}
                    title="Pay 2 coins to Treasury Reserve: Switch target player's allegiance"
                    className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    <span className="flex flex-col items-center justify-center">
                      <span>CONVERT OTHER (-2)</span>
                      <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">
                        {selectedTarget ? `[${nameOf(selectedTarget).toUpperCase()}]` : '[SELECT TARGET]'}
                      </span>
                    </span>
                  </Btn>
                  <Btn
                    variant="solid"
                    disabled={state.treasuryReserve <= 0}
                    onClick={() => sendAct(curId, { t: 'action', action: 'Embezzle' })}
                    title="Take all coins from Treasury Reserve. Claim you do not hold a Duke."
                    className="!whitespace-normal !px-1.5 !py-2 text-center text-[0.62rem] sm:text-[0.7rem] leading-tight tracking-[0.04em] sm:tracking-[0.12em] min-h-[46px]"
                  >
                    <span className="flex flex-col items-center justify-center">
                      <span>EMBEZZLE (+{state.treasuryReserve})</span>
                      <span className="text-[0.52rem] sm:text-[0.6rem] opacity-80">[NOT DUKE]</span>
                    </span>
                  </Btn>
                </>
              )}
            </div>
          </div>
        )}

        {/* Challenge or Block active indicator with REOPEN button */}
        {needsDecision ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-[var(--gold)] bg-[var(--gold)]/15 p-2.5 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--gold)] animate-pulse shrink-0" />
              <span className="text-xs font-bold text-white">
                YOUR DECISION IS REQUIRED: {state.stage.replace('_', ' ').toUpperCase()}!
              </span>
            </div>
            <Btn
              variant="solid"
              small
              onClick={() => {
                setModalDismissed(false)
                setPassedKey(null)
              }}
              className="!px-3 !py-1.5 text-xs font-bold shadow-md"
            >
              OPEN DECISION WINDOW
            </Btn>
          </div>
        ) : (
          (state.stage === 'action_challenge' || state.stage === 'block' || state.stage === 'block_challenge') && (
            <div className="border border-dashed border-[var(--gold)]/40 bg-[var(--gold)]/5 p-2.5 text-center">
              <span className="f-mono text-xs text-[var(--gold)]">
                AWAITING DECISIONS FROM OTHER SENATORS...
              </span>
            </div>
          )
        )}

        {/* 5. EXCHANGE VIEW */}
        {state.stage === 'exchange' && state.exchangeState && state.exchangeState.playerId === myId && (
          <div className="flex flex-col gap-3">
            <span className="label">
              SELECT CARDS TO KEEP (EXACTLY {myState.influences.filter((c: CoupCard) => !c.revealed).length} CARDS)
            </span>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
              {[
                ...myState.influences.filter((c: CoupCard) => !c.revealed).map((c: CoupCard) => c.character),
                ...state.exchangeState.drawnCards,
              ].map((char: Character, idx: number) => {
                const isSelected = selectedExchange.includes(idx)
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      sfx.tick()
                      if (isSelected) {
                        setSelectedExchange(selectedExchange.filter(i => i !== idx))
                      } else {
                        const needed = myState.influences.filter((c: CoupCard) => !c.revealed).length
                        if (selectedExchange.length < needed) {
                          setSelectedExchange([...selectedExchange, idx])
                        }
                      }
                    }}
                    className={`relative transition-all ${
                      isSelected ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]' : ''
                    }`}
                  >
                    <CoupCardFace character={char} size="md" />
                  </button>
                )
              })}
            </div>
            <Btn
              variant="accent"
              className="w-full sm:w-auto self-center !whitespace-normal !px-4 !py-2.5 text-center text-[0.68rem] sm:text-xs leading-tight tracking-normal sm:tracking-[0.1em]"
              disabled={selectedExchange.length !== myState.influences.filter((c: CoupCard) => !c.revealed).length}
              onClick={() => sendAct(myId, { t: 'exchange', keepIndices: selectedExchange })}
            >
              CONFIRM EXCHANGE
            </Btn>
          </div>
        )}

        {/* 6. EXAMINE SELECTION (Target) */}
        {state.stage === 'examine_selection' && state.examineSelectionState && state.examineSelectionState.targetId === myId && (
          <div className="flex flex-col gap-2">
            <span className="label">THE INQUISITOR DEMANDS TO EXAMINE A CARD:</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {myState.influences.map((inf: CoupCard, i: number) => {
                if (inf.revealed) return null
                return (
                  <Btn
                    key={i}
                    variant="outline"
                    className="!whitespace-normal !px-3 !py-2 text-center text-[0.68rem] sm:text-xs leading-tight tracking-normal sm:tracking-[0.1em]"
                    onClick={() => sendAct(myId, { t: 'examine_select', cardIndex: i })}
                  >
                    PRESENT CARD #{i + 1}
                  </Btn>
                )
              })}
            </div>
          </div>
        )}

        {/* 7. EXAMINE DECISION (Examiner) */}
        {state.stage === 'examine_decision' && state.examineState && state.examineState.examinerId === myId && (
          <div className="flex flex-col gap-3">
            <span className="label">
              EXAMINING {nameOf(state.examineState.targetId).toUpperCase()}&apos;S CARD:
            </span>
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="shrink-0">
                <CoupCardFace character={state.examineState.character} size="md" />
              </div>
              <div className="flex flex-col gap-2 w-full">
                <span className="f-display text-sm font-bold text-[var(--gold)]">
                  {state.examineState.character}
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Btn
                    variant="solid"
                    className="!whitespace-normal !px-2 !py-2.5 text-center text-[0.68rem] sm:text-xs leading-tight tracking-normal sm:tracking-[0.1em]"
                    onClick={() => sendAct(myId, { t: 'examine_decision', forceSwap: false })}
                  >
                    ALLOW KEEP
                  </Btn>
                  <Btn
                    variant="danger"
                    className="!whitespace-normal !px-2 !py-2.5 text-center text-[0.68rem] sm:text-xs leading-tight tracking-normal sm:tracking-[0.1em]"
                    onClick={() => sendAct(myId, { t: 'examine_decision', forceSwap: true })}
                  >
                    FORCE SWAP WITH DECK
                  </Btn>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null

  const arenaCenterPanel = (
    <div className="panel-hard brackets relative flex flex-col gap-3 p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2">
        <div className="flex items-center gap-2">
          <span className="f-display text-base sm:text-lg font-black text-[var(--accent)]">
            {roman(state.turn + 1)}
          </span>
          <div className="flex flex-col">
            <span className="label !text-[0.52rem]">CURRENT TURN</span>
            <span className="f-display text-xs font-bold tracking-wider text-[var(--ink)]">
              {nameOf(curId)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {state.endsAt && (!isMyTurn || state.stage !== 'action') && (
            <div className="flex items-center gap-1 border border-[var(--line)] px-2 py-0.5">
              <Countdown endsAt={state.endsAt} warnAt={5000} />
            </div>
          )}
          <RoleTag tone="gold">{state.stage.replace('_', ' ').toUpperCase()}</RoleTag>
        </div>
      </div>

      {/* Timer Bar (displayed here when not in active player's turn; during player's turn it displays in Your Seat & Hand panel) */}
      {state.endsAt && (!isMyTurn || state.stage !== 'action') && (
        <TimerBar
          endsAt={state.endsAt}
          totalMs={((state.stage === 'action' ? state.turnTimer : state.actionTimer) || 15) * 1000}
        />
      )}

      {/* Turn Order & Your Seat Info */}
      <div className="flex flex-col gap-2 rounded-none border border-[var(--line)] bg-[var(--bg2)]/60 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Player's Own Status */}
          {isMeAlive ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="label !text-[0.52rem]">YOUR TURN:</span>
              {isMyTurn ? (
                <span className="bg-[var(--accent)] px-2 py-0.5 text-[0.62rem] font-black text-white tracking-wider animate-pulse uppercase">
                  IT IS YOUR TURN NOW
                </span>
              ) : (
                <span className="f-mono text-xs font-bold text-[var(--gold)]">
                  {turnsUntilMe === 1 ? 'You play next (in 1 turn)' : `In ${turnsUntilMe} turns`}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="label !text-[0.52rem]">STATUS:</span>
              <span className="f-mono text-[0.65rem] text-[var(--muted)]">
                {myState ? 'Exiled from court' : 'Spectating'}
              </span>
            </div>
          )}

          <span className="label !text-[0.5rem] text-[var(--muted)]">
            TURN SEQUENCE ({aliveOrder.length} ALIVE)
          </span>
        </div>

        {/* Full seated alive turn sequence breadcrumb strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 scrollbar-none">
          {aliveOrder.map((pid, idx) => {
            const isCurrent = pid === curId
            const isMe = pid === myId
            const pObj = players.find(p => p.id === pid)
            const pColor = pObj?.color ?? '#888'
            const pName = pObj?.name ?? pid
            return (
              <Fragment key={pid}>
                {idx > 0 && (
                  <ArrowRight size={11} className="text-[var(--line-strong)] shrink-0" />
                )}
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs shrink-0 border transition-all ${
                    isCurrent
                      ? 'border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)] font-bold shadow-xs'
                      : isMe
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-semibold'
                      : 'border-[var(--line)] bg-[var(--bg)] text-[var(--ink-dim)]'
                  }`}
                >
                  <Avatar name={pName} color={pColor} size={16} />
                  <span className="f-mono text-[0.65rem] max-w-[85px] sm:max-w-[110px] truncate">
                    {pName}
                  </span>
                  {isCurrent && (
                    <span className="bg-[var(--gold)] text-black px-1 py-0.2 text-[0.5rem] font-black uppercase">
                      TURN
                    </span>
                  )}
                  {isMe && !isCurrent && (
                    <span className="bg-[var(--accent)] text-white px-1 py-0.2 text-[0.5rem] font-bold uppercase">
                      YOU
                    </span>
                  )}
                </div>
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* Stage Announcements & Prompts */}
      <div className="flex flex-col gap-2">
        {state.stage === 'action' && !state.challengeRevealSwap && (
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--ink)]">
            <span className="f-mono tracking-wider">
              {isMyTurn ? 'IT IS YOUR TURN - DECLARE AN ACTION' : `AWAITING MOVE FROM ${nameOf(curId).toUpperCase()}`}
            </span>
          </div>
        )}

        {state.stage === 'action_challenge' && pa && !state.challengeRevealSwap && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-none border border-[var(--accent)] bg-[var(--accent)]/10 p-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--accent)] shrink-0" />
              <span className="text-xs font-bold text-white">
                {nameOf(pa.actorId)} claims <span className="text-[var(--gold)]">{pa.claimedCharacter}</span> to {pa.type}
                {pa.targetId ? ` targeting ${nameOf(pa.targetId)}` : ''}!
              </span>
            </div>
            <span className="f-mono text-[0.62rem] text-[var(--muted)]">
              Passed: {cs?.passedPlayerIds.length ?? 0}/{state.seats.filter((id: string) => state.players[id]?.alive).length}
            </span>
          </div>
        )}

        {state.stage === 'block' && pa && !state.challengeRevealSwap && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--gold)] bg-[var(--gold)]/10 p-2.5">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-[var(--gold)] shrink-0" />
              <span className="text-xs font-bold text-white">
                {nameOf(pa.actorId)} is taking {pa.type}
                {pa.targetId ? ` targeting ${nameOf(pa.targetId)}` : ''}. Any eligible player may block!
              </span>
            </div>
            <span className="f-mono text-[0.62rem] text-[var(--muted)]">
              Passed: {state.blockPassedPlayerIds.length}/{state.seats.filter((id: string) => state.players[id]?.alive).length}
            </span>
          </div>
        )}

        {state.stage === 'block_challenge' && pb && pa && !state.challengeRevealSwap && (
          <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--accent)] bg-[var(--accent)]/10 p-2.5">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-[var(--accent)] shrink-0" />
              <span className="text-xs font-bold text-white">
                {nameOf(pb.blockerId)} claims <span className="text-[var(--gold)]">{pb.claimedCharacter}</span> to block {pa.type}! Challenge the block?
              </span>
            </div>
            <span className="f-mono text-[0.62rem] text-[var(--muted)]">
              Passed: {cs?.passedPlayerIds.length ?? 0}/{state.seats.filter((id: string) => state.players[id]?.alive).length}
            </span>
          </div>
        )}

        {state.stage === 'influence_loss' && state.influenceLossRequest && (
          <div className="border border-[var(--bad)] bg-[var(--bad)]/10 p-2.5">
            <span className="text-xs font-bold text-red-500">
              {nameOf(state.influenceLossRequest.playerId)} must sacrifice an influence!
            </span>
          </div>
        )}
      </div>

      {/* Other Players Grid */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {state.seats.map((seatId: string) => {
          if (seatId === myId) return null
          const pl = state.players[seatId]
          const pMeta = players.find(p => p.id === seatId)
          if (!pl || !pMeta) return null

          const isTurn = curId === seatId
          const isAlive = pl.alive

          return (
            <div
              key={seatId}
              className={`flex flex-col gap-2 border p-2.5 transition-colors ${
                isTurn
                  ? 'border-[var(--gold)] bg-[var(--gold)]/5'
                  : isAlive
                    ? 'border-[var(--line)] bg-[var(--bg2)]'
                    : 'border-[var(--line-strong)] opacity-40'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar color={pMeta.color} name={pMeta.name} size={22} />
                  <span className="truncate text-xs font-bold tracking-wider">{pMeta.name}</span>
                  {pMeta.isBot && <RoleTag tone="line">BOT</RoleTag>}
                  {pl.faction && (
                    <RoleTag tone={pl.faction === 'Loyalist' ? 'accent' : 'gold'}>
                      {pl.faction.slice(0, 3)}
                    </RoleTag>
                  )}
                </div>
                <div className="flex shrink-0 whitespace-nowrap items-center gap-1 border border-[var(--line)] px-2 py-0.5">
                  <Coins size={12} className="text-[var(--gold)] shrink-0" />
                  <span className="f-mono text-xs font-bold tabular text-[var(--gold)] whitespace-nowrap shrink-0 inline-block">{pl.coins}</span>
                </div>
              </div>

              {/* Player Cards: smaller preview with icons only */}
              <div className="flex items-center gap-2">
                {pl.influences.map((card: CoupCard, i: number) => (
                  <CardView key={i} card={card} isOwn={false} size="sm" />
                ))}
                {!isAlive && <span className="stamp stamp-sm !border-red-600 !text-red-500 font-bold">EXILED</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Action Log / Senate Decrees */}
      <div className="mt-1 flex flex-col gap-1 border border-[var(--line)] bg-[var(--panel)] p-2">
        <span className="label !text-[0.5rem]">SENATE RECORD</span>
        <div className="flex max-h-20 sm:max-h-24 flex-col gap-1 overflow-y-auto pr-1">
          {state.logs.slice(0, 8).map((log: CoupLogItem) => (
            <span key={log.id} className="f-mono text-[0.62rem] text-[var(--ink-dim)]">
              - {log.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-2 py-2 sm:px-4">
      {/* Modals */}
      <CoupInfoModal open={showRules} onClose={() => setShowRules(false)} />

      {/* Counteraction / Challenge Popup Modal */}
      <AnimatePresence>
        {shouldShowDecision && (
          <CoupDecisionModal
            key="decision"
            state={state}
            myId={myId}
            players={players}
            sendAct={sendAct}
            nameOf={nameOf}
            colorOf={colorOf}
            onPass={() => setPassedKey(decisionKey)}
            onMinimize={() => setModalDismissed(true)}
          />
        )}
      </AnimatePresence>

      {/* Challenge Outcome Reveal & Swap Popup Modal */}
      <AnimatePresence>
        {state.challengeRevealSwap && (
          <CoupChallengeModal
            key="challenge-swap-modal"
            swap={state.challengeRevealSwap}
            nameOf={nameOf}
          />
        )}
      </AnimatePresence>

      {/* Top Banner: Arena Header */}
      <div className="panel flex flex-wrap items-center justify-between gap-2 p-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <Crown size={18} className="text-[var(--gold)] shrink-0" />
          <div>
            <h1 className="f-display text-xs sm:text-sm font-black tracking-[0.2em] text-[var(--gold)]">
              COURT OF COUP
            </h1>
            <span className="f-mono text-[0.52rem] sm:text-[0.55rem] font-bold tracking-[0.16em] text-[var(--muted)]">
              {state.reformation ? 'REFORMATION EXPANSION' : 'CLASSIC SENATE'}
            </span>
          </div>
        </div>

        {/* Global tokens / coins in treasury */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
          <div className="flex items-center gap-1.5 border border-[var(--line)] bg-[var(--bg2)] px-2 py-1">
            <div className="h-4 w-3 shrink-0 overflow-hidden">
              <CoupCardBack size="xs" />
            </div>
            <span className="label !text-[0.52rem]">DECK:</span>
            <span className="f-mono text-xs font-bold tabular text-[var(--ink)]">{state.deck.length}</span>
          </div>
          <div className="flex items-center gap-1.5 border border-[var(--line)] bg-[var(--bg2)] px-2 py-1">
            <Coins size={13} className="text-[var(--gold)]" />
            <span className="label !text-[0.52rem]">TREASURY:</span>
            <span className="f-mono text-xs font-bold text-[var(--gold)] tabular">{state.treasury}</span>
          </div>
          {state.reformation && (
            <div className="flex items-center gap-1.5 border border-[var(--line)] bg-[var(--bg2)] px-2 py-1">
              <span className="label !text-[0.52rem]">RESERVE:</span>
              <span className="f-mono text-xs font-bold text-[var(--accent)] tabular">{state.treasuryReserve}</span>
            </div>
          )}
          <Btn small variant="outline" onClick={() => setShowRules(true)} title="View full Coup rules">
            <Info size={12} /> RULES
          </Btn>
        </div>
      </div>

      {/* Hand panel goes to the top when it's the player's turn or when choosing influence */}
      {needsMyHandAtTop && yourSeatAndHandPanel}
      {arenaCenterPanel}
      {!needsMyHandAtTop && yourSeatAndHandPanel}

      {/* Spectator Notice */}
      {!amSeated && (
        <div className="panel border border-[var(--line)] bg-[var(--bg2)] p-3 text-center">
          <span className="f-mono text-xs text-[var(--muted)]">
            YOU ARE OBSERVING THIS SESSION AS A SPECTATOR
          </span>
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
              {/* Senate Record sheet pops over the verdict inside this same popup */}
              {showRecord && (
                <CoupSenateRecordSheet logs={state.logs} onClose={() => setShowRecord(false)} />
              )}

              {iLost && <VetoedBanner />}

              {winnerP ? (
                <>
                  <Avatar color={winnerP.color} name={winnerP.name} size={52} />
                  <Stamp tone="gold" className="!text-lg sm:!text-2xl">
                    {winnerP.name} PREVAILS
                  </Stamp>
                  <span className="f-mono text-[0.62rem] font-bold tracking-[0.2em] text-[var(--muted)]">
                    SOLE SURVIVOR OF THE COURT
                  </span>
                </>
              ) : (
                <Stamp className="!text-white">SESSION ADJOURNED</Stamp>
              )}

              {/* Final court influences */}
              <div className="flex w-full flex-col gap-1.5 border border-[var(--line)] bg-[var(--bg2)]/60 p-2 sm:p-2.5">
                <span className="label !text-[0.5rem]">FINAL COURT INFLUENCES</span>
                <div className="flex flex-wrap justify-center gap-2">
                  {state.seats.map((sid: string) => {
                    const pl = state.players[sid]
                    if (!pl) return null
                    return (
                      <div key={sid} className="flex flex-col items-center gap-1 border border-[var(--line)] bg-[var(--bg)]/50 px-2 py-1">
                        <span className="f-mono text-[0.65rem] font-bold text-[var(--ink)]">{nameOf(sid)}</span>
                        <div className="flex gap-1">
                          {pl.influences.map((inf: CoupCard, i: number) => (
                            <div key={i} className="shrink-0">
                              <CoupCardFace character={inf.character} revealed={inf.revealed} size="xs" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <ScoreStrip
                api={api}
                onRecord={() => {
                  setShowRecord(true)
                  sfx.tick()
                }}
              />

              {meAdmin ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Btn variant="accent" onClick={api.startGame}>
                    RECONVENE <ArrowRight size={14} />
                  </Btn>
                  <Btn variant="outline" onClick={api.toLobby}>
                    LOBBY
                  </Btn>
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
