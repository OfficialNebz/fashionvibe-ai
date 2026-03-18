import type { Metadata } from 'next'
import { Syne, Outfit } from 'next/font/google'
import './globals.css'
import { PostHogProvider } from '@/components/PostHogProvider'

const syne = Syne({
  variable: '--font-syne',
  subsets: ['latin'],
  weight: ['800'],
  display: 'swap',
})

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['400', '700', '900'],
  display: 'swap',
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
        {/*
          Top bar — solid black bg with z-50 so it always sits above the
          animated background paths. White text, Outfit Black weight.
        */}
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
              href="mailto:brendannebolisa@gmail.com"
              className="text-white underline underline-offset-2 hover:text-white/80 transition-colors"
            >
              Get in touch
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