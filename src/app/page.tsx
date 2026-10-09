'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Landmark, KeyRound, RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  Identity, ROMAN_NAMES, cleanName, ensureIdentity, loadLastRoom,
  pickOne, saveIdentityColor, saveIdentityName,
} from '@/lib/core'
import { newCouncilCode, stageCreate } from '@/lib/council'
import { sfx } from '@/lib/sound'
import { parseInvite } from '@/components/invite'
import { Btn, ColorGrid, Field, SoundToggle, ThemeToggle, Toggle, inputCls } from '@/components/ui'

const spring = { type: 'spring' as const, stiffness: 170, damping: 22 }

export default function Home() {
  const router = useRouter()
  // Keep the server and first browser render identical. Reading localStorage
  // inside the useState initializer caused a React hydration mismatch (#418):
  // the server rendered an empty profile while the browser rendered saved
  // values. Load after mount instead.
  const [id, setId] = useState<Identity | null>(null)
  const [code, setCode] = useState('')
  const [useSaved, setUseSaved] = useState(true)
  const [last, setLast] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)
  const nameRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setId(ensureIdentity())
    setLast(loadLastRoom()?.code ?? null)
  }, [])

  useEffect(() => {
    import('@/lib/sound').then(m => m.initSound())
  }, [])

  useEffect(() => {
    // warm the room route so OPEN SESSION and JOIN fire without a compile pause
    router.prefetch('/room/prefetch')
  }, [router])

  const named = !!id && cleanName(id.name).trim().length > 0

  const requireName = () => {
    setNameTouched(true)
    sfx.deny()
    nameRef.current?.focus()
    nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const create = () => {
    let currentId = id ?? ensureIdentity()
    let currentName = cleanName(currentId.name).trim()
    if (!currentName) {
      currentName = pickOne(ROMAN_NAMES)
      currentId = { ...currentId, name: currentName }
      setId(currentId)
    }
    saveIdentityName(currentName)
    if (currentId.color) saveIdentityColor(currentId.color)
    const c = newCouncilCode()
    stageCreate(c, useSaved)
    sfx.start()
    const targetUrl = `/room/${c}?create=1&saved=${useSaved ? '1' : '0'}`
    try {
      router.push(targetUrl)
    } catch {
      window.location.href = targetUrl
    }
  }

  const parsed = parseInvite(code)

  const join = () => {
    let currentId = id ?? ensureIdentity()
    let currentName = cleanName(currentId.name).trim()
    if (!currentName) {
      currentName = pickOne(ROMAN_NAMES)
      currentId = { ...currentId, name: currentName }
      setId(currentId)
    }
    saveIdentityName(currentName)
    if (currentId.color) saveIdentityColor(currentId.color)
    if (parsed.length < 4) return
    sfx.start()
    const targetUrl = `/room/${parsed}`
    try {
      router.push(targetUrl)
    } catch {
      window.location.href = targetUrl
    }
  }

  return (
    <main className="relative flex min-h-dvh w-full flex-col overflow-x-hidden">
      {/* top bar */}
      <header className="flex items-center justify-between border-b-2 border-[var(--line-strong)] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center bg-[var(--accent)] f-display text-sm font-black text-white">V</span>
          <span className="f-display text-xs font-bold tracking-[0.3em]">VETO PARTY</span>
        </div>
        <div className="flex items-center gap-2">
          <SoundToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="relative mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col justify-center gap-8 px-4 py-10 sm:px-6">
        {/* hero */}
        <motion.section
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="relative min-w-0"
        >
          <h1 className="f-display font-black uppercase leading-[0.86] tracking-tight break-words">
            <span className="block text-[clamp(2.75rem,13vw,7.5rem)]">VETO</span>
            <span className="block text-[clamp(2.75rem,13vw,7.5rem)] text-[var(--accent)]">
              PARTY
              <span className="ml-3 inline-block h-[0.55em] w-[0.55em] border-[3px] border-[var(--gold)] align-baseline" />
            </span>
          </h1>
          <div className="mt-5 flex items-center gap-3">
            <span className="hatch inline-block h-3 w-24" />
            <p className="label !text-[0.68rem]">ONE COUNCIL</p>
          </div>
        </motion.section>

        {/* identity */}
        <motion.section
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.08 }}
          className="panel brackets p-4 sm:p-6"
        >
          <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Field label="Your name, senator">
              {id ? (
                <input
                  ref={nameRef}
                  className={inputCls}
                  value={id.name}
                  maxLength={14}
                  placeholder="ENTER A NAME"
                  onChange={e => {
                    const name = cleanName(e.target.value)
                    setId({ ...id, name })
                    saveIdentityName(name)
                    setNameTouched(true)
                  }}
                />
              ) : <div className="h-[46px] border border-[var(--line)] bg-[var(--bg2)]" />}
              {nameTouched && !named && (
                <span className="f-mono text-[0.58rem] font-bold tracking-[0.14em] text-[var(--bad)]">
                  A NAME IS REQUIRED
                </span>
              )}
            </Field>
            <div className="flex items-center gap-3">
              <span
                className="h-[46px] w-[46px] shrink-0 border-2 border-[var(--line-strong)]"
                style={{ background: id?.color ?? 'transparent' }}
              />
              <div className="label leading-relaxed">
                SIGIL<br />COLOR
              </div>
            </div>
          </div>
          <div className="mt-4">
            {id && (
              <ColorGrid
                value={id.color}
                onPick={c => { setId({ ...id, color: c }); saveIdentityColor(c) }}
              />
            )}
          </div>
        </motion.section>

        {/* actions */}
        <div className="grid gap-4 md:grid-cols-2">
          <motion.section
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.16 }}
            className="panel flex flex-col gap-4 p-4 sm:p-6"
          >
            <div className="flex items-center gap-3">
              <Landmark size={18} className="text-[var(--gold)]" />
              <span className="f-display text-sm font-bold tracking-[0.22em]">CONVENE A COUNCIL</span>
            </div>
            <div className="rule-dash" />
            <div className="flex items-center justify-between gap-3">
              <span className="label">USE MY SAVED SETTINGS</span>
              <Toggle on={useSaved} onChange={setUseSaved} />
            </div>
            <Btn variant="accent" onClick={create} className="w-full !py-4 !text-sm">
              OPEN SESSION <ArrowRight size={16} />
            </Btn>
            {last && (
              <Btn variant="ghost" small onClick={() => router.push(`/room/${last}`)} className="mx-auto">
                <RefreshCw size={12} /> RESUME COUNCIL {last}
              </Btn>
            )}
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.24 }}
            className="panel flex flex-col gap-4 p-4 sm:p-6"
          >
            <div className="flex items-center gap-3">
              <KeyRound size={18} className="text-[var(--gold)]" />
              <span className="f-display text-sm font-bold tracking-[0.22em]">JOIN BY CODE</span>
            </div>
            <div className="rule-dash" />
            <input
              className={`${inputCls} f-mono !text-xl !tracking-[0.42em] text-center`}
              placeholder="CODE OR INVITE LINK"
              value={code}
              spellCheck={false}
              autoCapitalize="characters"
              onChange={e => setCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') join() }}
            />
            {parsed && parsed !== code.trim().toUpperCase() && (
              <span className="f-mono text-center text-[0.6rem] font-bold tracking-[0.2em] text-[var(--ok)]">
                DETECTED CODE · {parsed}
              </span>
            )}
            <Btn variant="outline" onClick={join} disabled={parsed.length < 4} className="w-full !py-4 !text-sm">
              TAKE YOUR SEAT <ArrowRight size={16} />
            </Btn>
          </motion.section>
        </div>
      </div>

      {/* bottom marquee */}
      <footer className="overflow-hidden border-t-2 border-[var(--line-strong)] py-2.5">
        <div className="vp-marquee flex w-max whitespace-nowrap">
          {[0, 1].map(n => (
            <span key={n} className="f-mono flex text-[0.62rem] font-bold tracking-[0.3em] text-[var(--muted)]">
              {['CONVENE', 'DELIBERATE', 'ACCUSE', 'VETO'].map(w => (
                <span key={w} className="mx-6 flex items-center gap-3">
                  <span className="text-[var(--accent)]">◆</span> {w} <span className="text-[var(--line-strong)]">·</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </footer>
    </main>
  )
}
