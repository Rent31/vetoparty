'use client'

import { useEffect } from 'react'

/** Registers the static-shell fallback in production only. */
export function OfflineShell() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return

    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
        // A blocked service worker must never affect the game itself.
        console.warn('[offline shell] service worker unavailable', err)
      })
    }

    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })

    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
