import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { PostHogProvider } from '@/components/PostHogProvider'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>

        {/* Demo Mode Banner */}
        <div className="w-full bg-foreground text-background py-2 px-4 text-center text-xs tracking-widest uppercase">
          <span className="font-semibold">Demo Mode</span>
          <span className="mx-2 opacity-40">·</span>
          <span className="opacity-80">3 scrapes per session</span>
          <span className="mx-2 opacity-40">·</span>
          <span className="opacity-80">
            Interested in full access?{' '}
            <a
              href="mailto:brendannebolisa@gmail.com"
              className="underline underline-offset-2 hover:opacity-100 transition-opacity"
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
