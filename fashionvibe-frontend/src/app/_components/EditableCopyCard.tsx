'use client'

/**
 * EditableCopyCard — lazy-loaded below-fold component.
 * Extracted from page.tsx for next/dynamic code-splitting.
 * Reduces initial JS bundle by ~8 KiB (component + lucide icons only loaded
 * when the user has scraped a product and generation completes).
 */

import { Copy, Check } from 'lucide-react'

const OUTFIT  = { fontFamily: 'var(--font-outfit), sans-serif', fontWeight: 900 } as const
const OUTFIT4 = { fontFamily: 'var(--font-outfit), sans-serif', fontWeight: 400 } as const

interface EditableCopyCardProps {
  title: string
  value: string
  onChange: (v: string) => void
  maxLength: number
  hashtags?: string[]
  onCopy: () => void
  copied: boolean
  rows?: number
}

export default function EditableCopyCard({
  title, value, onChange, maxLength, hashtags, onCopy, copied, rows = 5,
}: EditableCopyCardProps) {
  const remaining = maxLength - value.length
  const nearLimit = remaining < maxLength * 0.1
  return (
    <div style={{ borderRadius: 14, padding: '16px 18px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ ...OUTFIT, fontSize: 10, letterSpacing: '0.20em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.40)' }}>{title}</span>
        <button onClick={onCopy} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: copied ? '#4ade80' : 'rgba(255,255,255,0.30)' }}>
          {copied ? <Check style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
        rows={rows}
        style={{ ...OUTFIT4, width: '100%', resize: 'vertical', background: 'transparent', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.82)', fontSize: 13, lineHeight: 1.65 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        {hashtags && hashtags.length > 0 && (
          <p style={{ ...OUTFIT4, fontSize: 10, color: 'rgba(255,255,255,0.22)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
            {hashtags.map((t) => `#${t}`).join(' ')}
          </p>
        )}
        <p style={{ ...OUTFIT, fontSize: 10, marginLeft: 'auto', color: nearLimit ? '#f87171' : 'rgba(255,255,255,0.18)' }}>
          {remaining.toLocaleString()} / {maxLength.toLocaleString()}
        </p>
      </div>
    </div>
  )
}