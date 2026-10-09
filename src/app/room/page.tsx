'use client'

import { useEffect, useState } from 'react'
import { CouncilRoom } from '@/components/council-room'
import { Btn, Veil } from '@/components/ui'

/**
 * Static room bootstrap.
 *
 * Vercel rewrites /room/CODE to this one pre-rendered CDN asset. We parse the
 * visible browser URL only after mount, keeping the server and first browser
 * render identical and avoiding both a serverless cold start and a hydration
 * mismatch.
 */
export default function StaticRoomPage() {
  const [code, setCode] = useState<string | null>(null)

  useEffect(() => {
    try {
      const pathMatch = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{4,8})\/?$/)
      const queryCode = new URLSearchParams(window.location.search).get('code')
      const raw = pathMatch?.[1] ?? queryCode ?? ''
      const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
      setCode(clean.length >= 4 ? clean : '')
    } catch {
      setCode('')
    }
  }, [])

  if (code === null) {
    return <Veil title="SUMMONING THE COUNCIL" sub="PREPARING THE SESSION" />
  }

  if (!code) {
    return (
      <Veil title="INVALID COUNCIL LINK" sub="NO VALID CODE WAS FOUND">
        <Btn variant="outline" onClick={() => { window.location.href = '/' }}>
          RETURN HOME
        </Btn>
      </Veil>
    )
  }

  return <CouncilRoom code={code} />
}
