'use client'

import { motion } from 'framer-motion'
import { ArrowRight, Eye, Gavel } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  cleanName, ensureIdentity, saveIdentityColor, saveIdentityName,
} from '@/lib/core'
import { sfx } from '@/lib/sound'
import { Btn, ColorGrid, Field, inputCls } from '@/components/ui'

/**
 * First-run prompt. Shown only when the player has never chosen a name -
 * afterwards the saved profile is reused and joining is automatic.
 */
export function ProfileGate({
  code,
  askRole,
  onDone,
}: {
  code?: string
  askRole?: boolean
  onDone: (opts: { spectator: boolean }) => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#888888')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const id = ensureIdentity()
    setName(id.name)
    setColor(id.color)
  }, [])

  const valid = cleanName(name).trim().length > 0

  const submit = (spectator: boolean) => {
    if (!valid) { setTouched(true); sfx.deny(); return }
    saveIdentityName(name)
    saveIdentityColor(color)
    sfx.start()
    onDone({ spectator })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-[var(--bg)] px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        className="panel-hard brackets w-full max-w-md p-5 sm:p-6"
      >
        <div className="mb-4">
          <div className="label">{code ? `COUNCIL ${code}` : 'BEFORE YOU BEGIN'}</div>
          <h1 className="f-display mt-1 text-xl font-black uppercase tracking-[0.12em] sm:text-2xl">
            Name yourself
          </h1>
          <p className="f-mono mt-2 text-[0.6rem] font-bold leading-relaxed tracking-[0.14em] text-[var(--muted)]">
            SAVED ON THIS DEVICE · YOU WILL NOT BE ASKED AGAIN
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Field label="Your name">
            <input
              autoFocus
              className={inputCls}
              value={name}
              maxLength={14}
              placeholder="ENTER A NAME"
              onChange={e => { setName(cleanName(e.target.value)); setTouched(true) }}
              onKeyDown={e => { if (e.key === 'Enter' && valid) submit(false) }}
            />
            {touched && !valid && (
              <span className="f-mono text-[0.58rem] font-bold tracking-[0.14em] text-[var(--bad)]">
                A NAME IS REQUIRED
              </span>
            )}
          </Field>

          <Field label="Sigil colour">
            <ColorGrid value={color} onPick={setColor} />
          </Field>

          <div className="rule-dash" />

          {askRole ? (
            <div className="flex flex-col gap-2">
              <Btn variant="accent" disabled={!valid} className="w-full !py-4 !text-sm" onClick={() => submit(false)}>
                <Gavel size={15} /> JOIN AS MEMBER
              </Btn>
              <Btn variant="outline" disabled={!valid} className="w-full" onClick={() => submit(true)}>
                <Eye size={14} /> JOIN AS SPECTATOR
              </Btn>
            </div>
          ) : (
            <Btn variant="accent" disabled={!valid} className="w-full !py-4 !text-sm" onClick={() => submit(false)}>
              CONTINUE <ArrowRight size={16} />
            </Btn>
          )}
        </div>
      </motion.div>
    </div>
  )
}
