'use client'

import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error('[veto party:fatal]', error) }, [error])

  return (
    <html lang="en" data-theme="dark">
      <body
        style={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24,
          background: '#12100e', color: '#ece5d5', textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{
          border: '3px solid #d0563f', color: '#d0563f', padding: '10px 18px',
          fontWeight: 900, letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>
          SESSION DISRUPTED
        </div>
        <button
          onClick={reset}
          style={{
            border: '2px solid #d0563f', background: '#d0563f', color: '#fff',
            padding: '12px 22px', fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', cursor: 'pointer', fontSize: 12,
          }}
        >
          RESUME
        </button>
      </body>
    </html>
  )
}
