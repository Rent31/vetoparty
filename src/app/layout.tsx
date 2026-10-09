import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Cinzel, Space_Grotesk, IBM_Plex_Mono, Special_Elite } from 'next/font/google'
import './globals.css'
import { OfflineShell } from '@/components/offline-shell'

// Grungy, rough-edged display face used for the VETOED stamp. Only the
// weights we actually render are loaded.
const stampFont = Special_Elite({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-stamp',
})

const display = Cinzel({
  subsets: ['latin'],
  weight: ['500', '700', '900'],
  variable: '--font-display',
})
const body = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
})
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: 'VETO PARTY - Council of Games',
  description: 'Peer-to-peer party games. No servers, no accounts - just the council.',
}

export const viewport: Viewport = {
  themeColor: '#12100e',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

const themeBoot = `try{var t=localStorage.getItem('vp.theme');if(t!=='light')t='dark';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${display.variable} ${body.variable} ${mono.variable} ${stampFont.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className="antialiased">
        {children}
        <OfflineShell />
      </body>
    </html>
  )
}
