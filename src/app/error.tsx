'use client'

import { useEffect } from 'react'
import { RotateCcw, Home } from 'lucide-react'

export default function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error('[veto party]', error) }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="stamp text-[var(--bad)] !text-2xl">SESSION DISRUPTED</span>
      <p className="f-mono max-w-sm text-[0.65rem] font-bold leading-relaxed tracking-[0.14em] text-[var(--muted)]">
        THE COUNCIL RECORD WAS INTERRUPTED. RESUME TO REJOIN WHERE YOU LEFT OFF.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 border-2 border-[var(--accent)] bg-[var(--accent)] px-5 py-3 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-white hover:bg-transparent hover:text-[var(--accent)]"
        >
          <RotateCcw size={14} /> RESUME
        </button>
        <a
          href="/"
          className="inline-flex items-center gap-2 border-2 border-[var(--line-strong)] px-5 py-3 text-[0.7rem] font-bold uppercase tracking-[0.14em] hover:border-[var(--ink)]"
        >
          <Home size={14} /> HOME
        </a>
      </div>
    </main>
  )
}
