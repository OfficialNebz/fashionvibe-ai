'use client'

/**
 * FeedbackForm — lazy-loaded below-fold component.
 * Extracted from page.tsx for next/dynamic code-splitting.
 * This component, its Formspree logic, and its Input/GlassBox dependencies
 * are only fetched after the above-fold hero + scrape UI has painted.
 */

import { useState } from 'react'
import { Check } from 'lucide-react'
import { Input } from '@/components/ui/input'

const OUTFIT  = { fontFamily: 'var(--font-outfit), sans-serif', fontWeight: 900 } as const
const OUTFIT4 = { fontFamily: 'var(--font-outfit), sans-serif', fontWeight: 400 } as const

const BTN_SOLID: React.CSSProperties = {
  display:        'inline-flex',
  alignItems:     'center',
  justifyContent: 'center',
  gap:            8,
  height:         48,
  paddingLeft:    22,
  paddingRight:   22,
  borderRadius:   14,
  border:         'none',
  outline:        'none',
  background:     '#ffffff',
  color:          '#000000',
  fontFamily:     'var(--font-outfit), sans-serif',
  fontWeight:     900,
  fontSize:       14,
  letterSpacing:  '0.04em',
  whiteSpace:     'nowrap' as const,
  cursor:         'pointer',
  width:          '100%',
  transition:     'opacity 0.18s ease',
}

function GlassBox({ children, focused = false }: { children: React.ReactNode; focused?: boolean }) {
  return (
    <div style={{
      borderRadius: 14,
      backdropFilter: 'blur(10px)',
      background: focused ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${focused ? 'rgba(255,255,255,0.80)' : 'rgba(255,255,255,0.20)'}`,
      boxShadow: focused ? '0 0 0 3px rgba(255,255,255,0.07), 0 0 28px rgba(255,255,255,0.07)' : 'none',
      transition: 'all 0.2s ease',
    }}>
      {children}
    </div>
  )
}

export default function FeedbackForm() {
  const [submitted, setSubmitted]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback]     = useState('')
  const [email, setEmail]           = useState('')
  const [emailF, setEmailF]         = useState(false)
  const [textF, setTextF]           = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    
    // CLINICAL FIX: Waitlist requires an email, not feedback. 
    if (!email.trim()) return
    
    setSubmitting(true)
    try {
      const res = await fetch('https://formspree.io/f/xlgpwaby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ 
          email, 
          message: feedback.trim() ? feedback : 'Waitlist Join (No extra message)' 
        }),
      })
      if (res.ok) { setSubmitted(true); setFeedback(''); setEmail('') }
    } finally { setSubmitting(false) }
  }

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h2 style={{ ...OUTFIT, fontSize: 22, color: '#fff', letterSpacing: '-0.01em', margin: 0 }}>
          Join the Beta Waitlist
        </h2>
        <p style={{ ...OUTFIT4, fontSize: 14, color: 'rgba(255,255,255,0.40)', marginTop: 6, lineHeight: 1.5 }}>
          Drop your email to get early access when we lift the demo limits.
        </p>
      </div>

      {submitted ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '28px 0' }}>
          <Check style={{ width: 18, height: 18, color: '#4ade80' }} />
          <p style={{ ...OUTFIT4, fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>You are on the list, Sir.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <GlassBox focused={emailF}>
            <Input
              type="email"
              placeholder="Your best email address..."
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setEmailF(true)}
              onBlur={() => setEmailF(false)}
              disabled={submitting}
              required
              style={{ ...OUTFIT4, height: 48, border: 'none', background: 'transparent', color: '#fff', fontSize: 14, padding: '0 16px', width: '100%', outline: 'none', boxShadow: 'none' }}
              className="placeholder:text-white/30 focus-visible:ring-0"
            />
          </GlassBox>

          <GlassBox focused={textF}>
            <textarea
              placeholder="Any specific features you'd like to see? (Optional)"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onFocus={() => setTextF(true)}
              onBlur={() => setTextF(false)}
              rows={3}
              disabled={submitting}
              style={{ ...OUTFIT4, width: '100%', resize: 'none', background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 14, padding: '14px 16px', lineHeight: 1.6, borderRadius: 14 }}
              className="placeholder:text-white/30 disabled:opacity-50"
            />
          </GlassBox>

          {/* Solid white — hardcoded BTN_SOLID, Outfit 900, #ffffff bg, #000 text */}
          <div style={{ marginTop: 20 }}>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              style={{ ...BTN_SOLID, opacity: (submitting || !email.trim()) ? 0.35 : 1, cursor: (submitting || !email.trim()) ? 'not-allowed' : 'pointer' }}
            >
              <span style={{ color: '#000', fontFamily: 'var(--font-outfit)', fontWeight: 900, fontSize: 14 }}>
                {submitting ? 'Joining…' : 'Join Waitlist'}
              </span>
            </button>
          </div>
        </form>
      )}
    </div>
  )
}