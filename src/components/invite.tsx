'use client'

import { motion } from 'framer-motion'
import { Check, Copy, Link2, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { sfx } from '@/lib/sound'
import { Btn, IconBtn } from '@/components/ui'

export function roomUrl(code: string) {
  if (typeof window === 'undefined') return `/room/${code}`
  return `${window.location.origin}/room/${code}`
}

/** Pull a council code out of a raw code, a full invite URL, or a pasted path. */
export function parseInvite(raw: string): string {
  const t = (raw ?? '').trim()
  if (!t) return ''
  const fromPath = t.match(/\/room\/([A-Za-z0-9]{4,8})/)
  if (fromPath) return fromPath[1].toUpperCase()
  const fromQuery = t.match(/[?&](?:code|join)=([A-Za-z0-9]{4,8})/)
  if (fromQuery) return fromQuery[1].toUpperCase()
  return t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function InvitePanel({ code }: { code: string }) {
  const [url, setUrl] = useState(`/room/${code}`)
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const [canShare, setCanShare] = useState(false)

  useEffect(() => {
    setUrl(roomUrl(code))
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [code])

  const copy = async (what: 'link' | 'code') => {
    const text = what === 'link' ? roomUrl(code) : code
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
      else {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      sfx.vote()
      setCopied(what)
      setTimeout(() => setCopied(null), 1600)
    } catch { sfx.deny() }
  }

  const share = async () => {
    try {
      await navigator.share({
        title: 'VETO PARTY',
        text: `Join my council - code ${code}`,
        url: roomUrl(code),
      })
      sfx.vote()
    } catch { /* user dismissed */ }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-w-0 items-stretch gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 border border-[var(--line)] bg-[var(--bg2)] px-2.5 py-2">
          <Link2 size={13} className="shrink-0 text-[var(--muted)]" />
          <span className="f-mono truncate text-[0.68rem] font-bold tracking-[0.04em] text-[var(--ink-dim)]">
            {url.replace(/^https?:\/\//, '')}
          </span>
        </div>
        <IconBtn title="Copy invite link" onClick={() => copy('link')} active={copied === 'link'}>
          {copied === 'link' ? <Check size={14} /> : <Copy size={14} />}
        </IconBtn>
        {canShare && (
          <IconBtn title="Share invite" onClick={share}>
            <Share2 size={14} />
          </IconBtn>
        )}
      </div>

      <div className="flex min-w-0 items-stretch gap-1.5">
        <button
          onClick={() => copy('code')}
          className="group flex min-w-0 flex-1 items-center justify-center gap-2 border-2 border-[var(--line-strong)] px-2 py-2.5 hover:border-[var(--accent)] sm:gap-3 sm:px-3"
          title="Copy council code"
        >
          <span className="label hidden sm:inline">CODE</span>
          <span className="f-mono truncate text-base font-bold tracking-[0.3em] sm:text-lg sm:tracking-[0.42em]">{code}</span>
        </button>
        <Btn small variant={copied === 'code' ? 'accent' : 'outline'} onClick={() => copy('code')}>
          {copied === 'code' ? <><Check size={12} /> COPIED</> : <><Copy size={12} /> COPY</>}
        </Btn>
      </div>

      {copied && (
        <motion.span
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="f-mono text-[0.58rem] font-bold tracking-[0.18em] text-[var(--ok)]"
        >
          {copied === 'link' ? 'INVITE LINK COPIED' : 'CODE COPIED'}
        </motion.span>
      )}
    </div>
  )
}
