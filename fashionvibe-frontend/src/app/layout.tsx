/**
 * layout.tsx — NeboCollections AI
 *
 * Performance notes (Lighthouse mobile audit — score 83):
 *
 * Font strategy: `display: 'swap'` on both Syne and Outfit ensures the browser
 * renders fallback text immediately then swaps in the web font when loaded.
 * This is the primary lever for reducing FCP on slower mobile connections.
 * Without it, the browser stalls text paint until the font file downloads.
 *
 * `preload: true` (Next.js default when weight is specified) causes Next.js to
 * inject a <link rel="preload"> in <head> for the font files, starting the
 * download in parallel with HTML parsing rather than waiting for CSS evaluation.
 */

import type { Metadata } from 'next'
import { Syne, Outfit } from 'next/font/google'
import './globals.css'
import { PostHogProvider } from '@/components/PostHogProvider'

// Syne: headings only. Weight 800 = ExtraBold (heaviest available).
// display: 'swap' — critical for LCP. Fallback text paints immediately.
const syne = Syne({
  variable: '--font-syne',
  subsets: ['latin'],
  weight: ['800'],
  display: 'swap',   // explicit — prevents render-blocking FCP delay
})

// Outfit: all body text, inputs, buttons, labels.
// Weights 400 / 700 / 900 — only the three in use, minimising download size.
// display: 'swap' — same rationale as Syne above.
const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  display: 'swap',   // explicit — prevents render-blocking FCP delay
})

export const metadata: Metadata = {
  title: 'NeboCollections AI',
  description: 'AI-powered copy for your fashion brand',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${syne.variable} ${outfit.variable} antialiased bg-black text-white overflow-x-hidden`}
        style={{ fontFamily: 'var(--font-outfit), sans-serif' }}
      >
        {/* Demo Mode Banner — solid black background, z-50, Outfit 900 */}
        <div
          className="relative w-full py-2 px-6 text-center"
          style={{
            zIndex: 50,
            background: '#000000',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            fontFamily: 'var(--font-outfit), sans-serif',
          }}
        >
          <span className="text-[11px] font-black tracking-[0.22em] uppercase text-white">
            Demo Mode
          </span>
          <span className="mx-2 text-white/30">·</span>
          <span className="text-[11px] font-black tracking-[0.12em] uppercase text-white/70">
            3 scrapes per session
          </span>
          <span className="mx-2 text-white/30">·</span>
          <span className="text-[11px] font-black tracking-[0.12em] uppercase text-white/70">
            Full access?{' '}
            <a
              href="#waitlist"
              className="text-white underline underline-offset-2 hover:text-white/80 transition-colors"
            >
              Join the Waitlist
            </a>
          </span>
        </div>

        <PostHogProvider>
          {children}
        </PostHogProvider>
      </body>
    </html>
  )
}