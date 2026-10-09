'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Check, Minus, Moon, Palette, Plus, Sun, Volume2, VolumeX, X } from 'lucide-react'
import { memo, ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { loadTheme, saveTheme, fmtTime, PLAYER_COLORS } from '@/lib/core'
import { isSoundOn, setSoundOn, sfx } from '@/lib/sound'

// ─── hooks ───────────────────────────────────────────────────────────────────

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState('dark')
  useEffect(() => { setTheme(loadTheme()) }, [])
  const toggle = useCallback(() => {
    const next = loadTheme() === 'dark' ? 'light' : 'dark'
    saveTheme(next)
    document.documentElement.dataset.theme = next
    setTheme(next)
    sfx.click()
  }, [])
  return [theme, toggle]
}

export function useSoundPref(): [boolean, () => void] {
  const [on, setOn] = useState(true)
  useEffect(() => { setOn(isSoundOn()) }, [])
  const toggle = useCallback(() => {
    const next = !isSoundOn()
    setSoundOn(next)
    setOn(next)
    if (next) sfx.join(); else sfx.click()
  }, [])
  return [on, toggle]
}

export function useNow(step = 250): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setN(Date.now()), step)
    return () => clearInterval(id)
  }, [step])
  return n
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const upd = () => setCoarse(mq.matches || window.innerWidth < 768)
    upd()
    mq.addEventListener('change', upd)
    window.addEventListener('resize', upd)
    return () => { mq.removeEventListener('change', upd); window.removeEventListener('resize', upd) }
  }, [])
  return coarse
}

// ─── buttons ─────────────────────────────────────────────────────────────────

type BtnVariant = 'solid' | 'accent' | 'outline' | 'ghost' | 'danger' | 'ok'

export function Btn({
  children, onClick, variant = 'outline', disabled, className = '', title, small,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: BtnVariant
  disabled?: boolean
  className?: string
  title?: string
  small?: boolean
}) {
  const base = `inline-flex max-w-full items-center justify-center gap-2 font-bold uppercase ${className.includes('tracking-') ? '' : 'tracking-[0.06em] sm:tracking-[0.14em]'} select-none transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none ${className.includes('whitespace-') ? '' : 'whitespace-nowrap'} ${small ? 'text-[0.62rem] sm:text-[0.65rem] px-2.5 py-1.5 sm:px-3 sm:py-2' : 'text-[0.68rem] sm:text-[0.7rem] px-3 py-2.5 sm:px-4 sm:py-3'}`
  const styles: Record<BtnVariant, string> = {
    solid: 'bg-[var(--ink)] text-[var(--bg)] border-2 border-[var(--ink)] hover:bg-transparent hover:text-[var(--ink)]',
    accent: 'bg-[var(--accent)] text-white border-2 border-[var(--accent)] hover:bg-transparent hover:text-[var(--accent)]',
    outline: 'bg-transparent text-[var(--ink)] border-2 border-[var(--line-strong)] hover:border-[var(--ink)]',
    ghost: 'bg-transparent text-[var(--muted)] border-2 border-transparent hover:text-[var(--ink)]',
    danger: 'bg-transparent text-[var(--bad)] border-2 border-[var(--bad)] hover:bg-[var(--bad)] hover:text-white',
    ok: 'bg-transparent text-[var(--ok)] border-2 border-[var(--ok)] hover:bg-[var(--ok)] hover:text-white',
  }
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      className={`${base} ${styles[variant]} ${className}`}
      disabled={disabled}
      title={title}
      onClick={() => { if (!disabled) { sfx.click(); onClick?.() } }}
    >
      {children}
    </motion.button>
  )
}

export function IconBtn({
  children, onClick, title, disabled, danger, active, className = '',
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
  disabled?: boolean
  danger?: boolean
  active?: boolean
  className?: string
}) {
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.9 }}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={() => { if (!disabled) { sfx.click(); onClick?.() } }}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center border transition-colors disabled:opacity-30 disabled:pointer-events-none ${
        danger
          ? 'border-[var(--bad)] text-[var(--bad)] hover:bg-[var(--bad)] hover:text-white'
          : active
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
            : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]'
      } ${className}`}
    >
      {children}
    </motion.button>
  )
}

// ─── form controls ───────────────────────────────────────────────────────────

export function Field({ label, children, right }: { label: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="label">{label}</span>
        {right}
      </div>
      {children}
    </div>
  )
}

export const inputCls =
  'w-full bg-[var(--bg2)] border border-[var(--line)] px-3 py-2.5 text-sm font-bold tracking-[0.08em] uppercase placeholder:text-[var(--muted)] placeholder:font-normal focus:border-[var(--line-strong)]'

export function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { sfx.tick(); onChange(!on) }}
      className={`relative h-6 w-12 shrink-0 border-2 transition-colors disabled:opacity-30 disabled:pointer-events-none ${on ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--line-strong)] bg-transparent'}`}
      aria-pressed={on}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] transition-all duration-150 ${on ? 'left-[26px] bg-white' : 'left-[2px] bg-[var(--muted)]'}`}
      />
    </button>
  )
}

export function Stepper({ value, onChange, min, max, disabled }: {
  value: number; onChange: (v: number) => void; min: number; max: number; disabled?: boolean
}) {
  return (
    <div className="inline-flex items-stretch border border-[var(--line)]">
      <IconBtn disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} className="border-0 border-r border-[var(--line)]" title="Less">
        <Minus size={14} />
      </IconBtn>
      <span className="f-mono flex w-12 items-center justify-center text-sm font-bold tabular">{value}</span>
      <IconBtn disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} className="border-0 border-l border-[var(--line)]" title="More">
        <Plus size={14} />
      </IconBtn>
    </div>
  )
}

export function ChipRow<T extends number | string>({ options, value, onChange, suffix }: {
  options: T[]; value: T; onChange: (v: T) => void; suffix?: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <button
          key={String(o)}
          type="button"
          onClick={() => { sfx.tick(); onChange(o) }}
          className={`f-mono border px-2.5 py-1.5 text-[0.7rem] font-bold transition-colors ${o === value ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]'}`}
        >
          {String(o)}{suffix ?? ''}
        </button>
      ))}
    </div>
  )
}

// ─── duration ────────────────────────────────────────────────────────────────

/** "7:30" / "45s" / "NO LIMIT" for any second count. */
export function spellDuration(sec: number): string {
  if (!sec || sec <= 0) return 'NO LIMIT'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (!m) return `${s}s`
  if (!s) return `${m}m`
  return `${m}m ${s}s`
}

export function DurationField({
  label, value, onChange, presets, min = 5, max = 7200, allowNone,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  presets: number[]
  min?: number
  max?: number
  allowNone?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  const commit = (raw: string) => {
    const n = Math.round(Number(raw))
    if (!isFinite(n)) { setDraft(String(value)); sfx.deny(); return }
    if (allowNone && n === 0) { onChange(0); return }
    if (n < min || n > max) { setDraft(String(value)); sfx.deny(); return }
    sfx.tick()
    onChange(n)
  }

  const custom = !presets.includes(value)

  return (
    <Field
      label={label}
      right={
        <span className={`f-mono text-[0.62rem] font-bold tabular ${value ? 'text-[var(--gold)]' : 'text-[var(--muted)]'}`}>
          {spellDuration(value)}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">
          {presets.map(o => (
            <button
              key={o}
              type="button"
              onClick={() => { sfx.tick(); onChange(o) }}
              className={`f-mono border px-2.5 py-1.5 text-[0.7rem] font-bold transition-colors ${
                o === value
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--line)] text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]'
              }`}
            >
              {o === 0 ? '∞' : spellDuration(o)}
            </button>
          ))}
          {custom && (
            <span className="f-mono border border-[var(--accent)] bg-[var(--accent)] px-2.5 py-1.5 text-[0.7rem] font-bold text-white">
              {spellDuration(value)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label shrink-0 !text-[0.55rem]">CUSTOM</span>
          <input
            type="number"
            inputMode="numeric"
            min={allowNone ? 0 : min}
            max={max}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={e => commit(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value) }}
            className="f-mono w-20 min-w-0 border border-[var(--line)] bg-[var(--bg2)] px-2 py-1.5 text-[0.72rem] font-bold tabular focus:border-[var(--line-strong)]"
          />
          <span className="label shrink-0 !text-[0.55rem]">SEC</span>
          <Btn
            small
            variant={Number(draft) === value ? 'ghost' : 'accent'}
            disabled={Number(draft) === value}
            onClick={() => commit(draft)}
          >
            <Check size={12} />
          </Btn>
        </div>
      </div>
    </Field>
  )
}

// ─── identity bits ───────────────────────────────────────────────────────────

/** Readable ink for any background color (WCAG relative luminance). */
export function inkOn(bg: string): string {
  const hex = (bg || '').trim().replace('#', '')
  if (hex.length !== 6) return '#12100e'
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const lum = 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4)
  return lum > 0.42 ? '#12100e' : '#ffffff'
}

export const Avatar = memo(function Avatar({ color, name, size = 34, dim }: { color: string; name: string; size?: number; dim?: boolean }) {
  return (
    <span
      className={`f-display inline-flex shrink-0 select-none items-center justify-center font-black ${dim ? 'opacity-40' : ''}`}
      style={{ width: size, height: size, background: color, fontSize: size * 0.42, color: inkOn(color) }}
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  )
})

export function ColorGrid({ value, onPick, taken, compact }: {
  value: string
  onPick: (c: string) => void
  taken?: Set<string>
  compact?: boolean
}) {
  const norm = (c: string) => c.trim().toLowerCase()
  const isUsed = (c: string) => !!taken && taken.has(norm(c)) && norm(c) !== norm(value)
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  const commit = (c: string) => {
    const hex = norm(c)
    if (!/^#[0-9a-f]{6}$/.test(hex) || isUsed(hex)) { sfx.deny(); return }
    sfx.tick()
    onPick(hex)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {PLAYER_COLORS.map(c => {
          const used = isUsed(c)
          const sel = norm(c) === norm(value)
          return (
            <motion.button
              key={c}
              type="button"
              whileTap={{ scale: 0.85 }}
              onClick={() => { if (!used) { sfx.tick(); onPick(norm(c)) } }}
              disabled={used}
              aria-label={c}
              className={`relative aspect-square w-full transition-transform ${used ? 'opacity-20' : 'hover:scale-110'}`}
              style={{ background: c }}
            >
              {sel && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Check size={16} strokeWidth={4} style={{ color: '#fff', filter: 'drop-shadow(0 0 2px #000)' }} />
                </span>
              )}
              {used && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <X size={14} strokeWidth={3} style={{ color: '#fff', filter: 'drop-shadow(0 0 2px #000)' }} />
                </span>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* any custom color */}
      <div className="flex flex-wrap items-center gap-1.5">
        <label
          className="relative h-8 w-8 shrink-0 cursor-pointer border-2 border-[var(--line-strong)]"
          style={{ background: draft }}
          title="Pick any color"
        >
          <Palette size={13} className="absolute inset-0 m-auto mix-blend-difference text-white" />
          <input
            type="color"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={/^#[0-9a-f]{6}$/i.test(draft) ? draft : '#888888'}
            onChange={e => setDraft(e.target.value)}
            onBlur={e => commit(e.target.value)}
          />
        </label>
        <input
          className="f-mono min-w-0 flex-1 border border-[var(--line)] bg-[var(--bg2)] px-2 py-1.5 text-[0.7rem] font-bold uppercase tracking-[0.12em] focus:border-[var(--line-strong)]"
          value={draft}
          maxLength={7}
          spellCheck={false}
          placeholder="#RRGGBB"
          onChange={e => {
            let v = e.target.value.replace(/[^#0-9a-fA-F]/g, '')
            if (!v.startsWith('#')) v = '#' + v.replace(/#/g, '')
            setDraft(v.slice(0, 7))
          }}
          onKeyDown={e => { if (e.key === 'Enter') commit(draft) }}
        />
        <Btn
          small
          variant={norm(draft) === norm(value) ? 'ghost' : 'accent'}
          disabled={!/^#[0-9a-f]{6}$/i.test(draft) || isUsed(draft) || norm(draft) === norm(value)}
          onClick={() => commit(draft)}
        >
          {compact ? <Check size={12} /> : <>APPLY</>}
        </Btn>
      </div>
      {isUsed(draft) && (
        <span className="f-mono text-[0.58rem] font-bold tracking-[0.14em] text-[var(--bad)]">COLOR ALREADY CLAIMED</span>
      )}
    </div>
  )
}

// ─── section header ──────────────────────────────────────────────────────────

export function SectionHead({ numeral, title, right }: { numeral?: string; title: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-2 border-b-2 border-[var(--line-strong)] pb-2">
      <div className="flex min-w-0 items-baseline gap-2">
        {numeral && <span className="f-display text-xl font-black text-[var(--accent)] shrink-0">{numeral}</span>}
        <h2 className="f-display text-xs sm:text-sm font-bold tracking-[0.16em] sm:tracking-[0.22em] uppercase truncate">{title}</h2>
      </div>
      {right}
    </div>
  )
}

// ─── timer ───────────────────────────────────────────────────────────────────

export const Countdown = memo(function Countdown({ endsAt, warnAt = 15000 }: { endsAt: number | null; warnAt?: number }) {
  const nowMs = useNow(200)
  if (!endsAt) return null
  const left = endsAt - nowMs
  const low = left <= warnAt
  return (
    <span className={`f-mono text-sm font-bold tabular ${low ? 'text-[var(--accent)] vp-blink' : ''}`}>
      {fmtTime(left)}
    </span>
  )
})

export const TimerBar = memo(function TimerBar({ endsAt, totalMs }: { endsAt: number | null; totalMs: number }) {
  const nowMs = useNow(100)
  if (!endsAt || totalMs <= 0) return null
  const pct = Math.max(0, Math.min(1, (endsAt - nowMs) / totalMs))
  // scaleX runs on the compositor - animating width forced a layout on every
  // tick, which is exactly what stutters on low-end phones. Same pixels.
  return (
    <div className="h-1.5 w-full border border-[var(--line)] bg-[var(--bg2)]">
      <div
        className="h-full w-full origin-left transition-transform duration-100 ease-linear"
        style={{ transform: `scaleX(${pct})`, background: pct < 0.2 ? 'var(--accent)' : 'var(--gold)' }}
      />
    </div>
  )
})

// ─── mobile confirm bar ──────────────────────────────────────────────────────

export function ConfirmBar({ show, label, onConfirm, onCancel }: {
  show: boolean
  label: string
  onConfirm: () => void
  onCancel: () => void
}) {
  // Desktop players confirm too, so keep it fast: Enter commits, Esc aborts.
  useEffect(() => {
    if (!show) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
      if (typing) return
      if (e.key === 'Enter') { e.preventDefault(); onConfirm() }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, onConfirm, onCancel])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 90 }}
          animate={{ y: 0 }}
          exit={{ y: 90 }}
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-[var(--line-strong)] bg-[var(--panel)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="mx-auto flex max-w-md flex-wrap items-center gap-2">
            <span className="label min-w-0 flex-1 truncate">{label}</span>
            <Btn variant="accent" small onClick={onConfirm}><Check size={14} /> Confirm</Btn>
            <Btn variant="ghost" small onClick={onCancel}><X size={14} /> Cancel</Btn>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── header toggles ──────────────────────────────────────────────────────────

export function ThemeToggle() {
  const [theme, toggle] = useTheme()
  return (
    <IconBtn onClick={toggle} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </IconBtn>
  )
}

export function SoundToggle() {
  const [on, toggle] = useSoundPref()
  return (
    <IconBtn onClick={toggle} title={on ? 'Mute sound' : 'Enable sound'} active={on}>
      {on ? <Volume2 size={15} /> : <VolumeX size={15} />}
    </IconBtn>
  )
}

// ─── stamp ───────────────────────────────────────────────────────────────────

export function Stamp({ children, tone = 'default', className = '' }: {
  children: ReactNode
  tone?: 'default' | 'accent' | 'gold' | 'bad' | 'ok'
  className?: string
}) {
  const color = {
    default: 'text-[var(--ink)]',
    accent: 'text-[var(--accent)]',
    gold: 'text-[var(--gold)]',
    bad: 'text-[var(--bad)]',
    ok: 'text-[var(--ok)]',
  }[tone]
  return <span className={`stamp ${color} ${className}`}>{children}</span>
}

/**
 * Shown on the LOSING player's screen only. The winner is still displayed
 * alongside it by each results screen.
 */
export function VetoedBanner() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex flex-col items-center gap-2 py-1"
    >
      <span className="relative inline-flex items-center justify-center">
        {/* dust knocked loose by the impact */}
        <span
          aria-hidden
          className="vp-puff pointer-events-none absolute h-[120%] w-[125%] rounded-none border-2 border-[var(--bad)]/25"
        />
        <span
          data-ink="VETOED!"
          className="ink-stamp vp-press text-[2.4rem] leading-tight sm:text-[4rem]"
        >
          VETOED!
        </span>
      </span>
      <span className="f-mono text-[0.55rem] font-bold tracking-[0.28em] text-[var(--muted)]">
        YOU LOSE THIS ROUND
      </span>
    </motion.div>
  )
}

// ─── veil loader ─────────────────────────────────────────────────────────────

export function Veil({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-[var(--bg)] px-6 text-center">
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="vp-tickring absolute inset-0 border-2 border-[var(--accent)]" />
        <span className="vp-tickring absolute inset-0 border-2 border-[var(--gold)]" style={{ animationDelay: '0.6s' }} />
        <span className="f-display text-2xl font-black text-[var(--accent)]">V</span>
      </div>
      <div>
        <div className="f-display text-sm font-bold tracking-[0.3em] uppercase">{title}</div>
        {sub && <div className="label mt-2">{sub}</div>}
      </div>
      {children}
    </div>
  )
}

// ─── misc ────────────────────────────────────────────────────────────────────

export const RoleTag = memo(function RoleTag({ children, tone = 'line' }: { children: ReactNode; tone?: 'line' | 'accent' | 'gold' }) {
  const cls = {
    line: 'border-[var(--line-strong)] text-[var(--muted)]',
    accent: 'border-[var(--accent)] text-[var(--accent)]',
    gold: 'border-[var(--gold)] text-[var(--gold)]',
  }[tone]
  return (
    <span className={`f-mono inline-flex items-center gap-1 whitespace-nowrap border px-1.5 py-0.5 text-[0.55rem] font-bold tracking-[0.18em] uppercase ${cls}`}>
      {children}
    </span>
  )
})

export { sfx }
