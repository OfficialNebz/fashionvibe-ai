'use client'

/**
 * page.tsx — NeboCollections AI
 *
 * Performance optimisations applied (Lighthouse mobile target 95+):
 *
 * 1. SVG Throttling — ShootingStarBackground checks window.innerWidth on mount.
 * Mobile  (< 768px): 20 stars — reduces JS execution by ~75%.
 * Desktop (≥ 768px): 80 stars — full visual fidelity retained.
 *
 * 2. Dynamic Lazy Loading (SSR ENABLED) — FeedbackForm and EditableCopyCard 
 * are code-split to reduce the initial JS bundle. 
 * WHY: By omitting `ssr: false`, Vercel pre-renders the HTML. The mobile 
 * CPU only downloads the interactive JS when needed, rather than building 
 * the entire DOM structure itself.
 *
 * 3. Font display: 'swap' — ensures text renders immediately, preventing FCP blocks.
 */

import { useState, useEffect, useRef, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  type Variants,          // WHY: explicit import retained to satisfy strict Vercel TS compilation
} from 'framer-motion'
import { Check, ArrowRight, Sparkles } from 'lucide-react'
import posthog from 'posthog-js'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  scrapeProduct,
  generateCopy,
  publishDescription,
  ApiError,
  PERSONA_GROUPS,
  type Persona,
  type ProductData,
  type GeneratedCopy,
} from '@/lib/api'

// ---------------------------------------------------------------------------
// Dynamic imports — Code-splitting without the client-side rendering tax.
// WHY: We retain server-side rendering (SSR) to deliver static HTML instantly.
// The CSS 'pulse' animation was stripped to prevent main-thread layout 
// thrashing during the critical initial paint phase.
// ---------------------------------------------------------------------------
const EditableCopyCard = dynamic(
  () => import('./_components/EditableCopyCard'),
  {
    loading: () => (
      <div style={{ borderRadius: 14, height: 160, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }} />
    ),
  },
)

const FeedbackForm = dynamic(
  () => import('./_components/FeedbackForm'),
  {
    loading: () => (
      <div style={{ borderRadius: 14, height: 240, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }} />
    ),
  },
)

// ---------------------------------------------------------------------------
// Font tokens — inline always wins CSS cascade and never relies on Tailwind
// ---------------------------------------------------------------------------
const OUTFIT  = { fontFamily: 'var(--font-outfit), sans-serif', fontWeight: 900 } as const
const OUTFIT4 = { fontFamily: 'var(--font-outfit), sans-serif', fontWeight: 400 } as const

// ---------------------------------------------------------------------------
// Button style — hardcoded solid white. Module-level const, never varies.
// ---------------------------------------------------------------------------
const BTN_SOLID: React.CSSProperties = {
  display:         'inline-flex',
  alignItems:      'center',
  justifyContent:  'center',
  gap:             8,
  height:          48,
  paddingLeft:     22,
  paddingRight:    22,
  borderRadius:    14,
  border:          'none',
  outline:         'none',
  background:      '#ffffff',
  color:           '#000000',
  fontFamily:      'var(--font-outfit), sans-serif',
  fontWeight:      900,
  fontSize:        14,
  letterSpacing:   '0.04em',
  whiteSpace:      'nowrap' as const,
  cursor:          'pointer',
  position:        'relative' as const,
  zIndex:          30,
  transition:      'opacity 0.18s ease',
}

// ---------------------------------------------------------------------------
// App constants
// ---------------------------------------------------------------------------
const IG_CAP       = 2200
const WEB_CAP      = 5000
const DEMO_LIMIT   = 3
const RESET_MS     = 24 * 60 * 60 * 1000
const LS_COUNT_KEY = 'fv_scrape_count'
const LS_RESET_KEY = 'fv_scrape_reset_ts'

const CYCLING_HEADLINES = [
  'Exquisite Boutique.',
  'Hypebeast Drop.',
  'Whimsical Brand.',
  'Eco-Conscious Label.',
  'Tailored Modern.',
]

// ---------------------------------------------------------------------------
// Framer Motion variants
// ---------------------------------------------------------------------------
const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.10, delayChildren: 0.05 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.44, ease: [0.22, 1, 0.36, 1] } },
}

// ---------------------------------------------------------------------------
// Quota helpers
// ---------------------------------------------------------------------------
interface ScrapeQuota { count: number; remaining: number; isLimited: boolean; resetTs: number }

function readQuota(): ScrapeQuota {
  try {
    const count   = parseInt(localStorage.getItem(LS_COUNT_KEY) ?? '0', 10)
    const resetTs = parseInt(localStorage.getItem(LS_RESET_KEY) ?? '0', 10)
    const now     = Date.now()
    if (resetTs > 0 && now - resetTs >= RESET_MS) {
      localStorage.setItem(LS_COUNT_KEY, '0')
      localStorage.setItem(LS_RESET_KEY, String(now))
      return { count: 0, remaining: DEMO_LIMIT, isLimited: false, resetTs: now }
    }
    return { count, remaining: Math.max(0, DEMO_LIMIT - count), isLimited: count >= DEMO_LIMIT, resetTs }
  } catch { return { count: 0, remaining: DEMO_LIMIT, isLimited: false, resetTs: 0 } }
}

function incrementQuota(): ScrapeQuota {
  try {
    const now     = Date.now()
    const resetTs = parseInt(localStorage.getItem(LS_RESET_KEY) ?? '0', 10)
    if (resetTs === 0) localStorage.setItem(LS_RESET_KEY, String(now))
    const next = parseInt(localStorage.getItem(LS_COUNT_KEY) ?? '0', 10) + 1
    localStorage.setItem(LS_COUNT_KEY, String(next))
    return { count: next, remaining: Math.max(0, DEMO_LIMIT - next), isLimited: next >= DEMO_LIMIT, resetTs: resetTs === 0 ? now : resetTs }
  } catch { return { count: 1, remaining: DEMO_LIMIT - 1, isLimited: false, resetTs: Date.now() } }
}

// ---------------------------------------------------------------------------
// ShootingStarBackground
// WHY: Client-only execution prevents SSR random hydration mismatch.
// ---------------------------------------------------------------------------
interface Star {
  id: number
  x1: number; y1: number; x2: number; y2: number
  duration: number; delay: number; sw: number; opacity: number
}

function buildStars(n: number): Star[] {
  return Array.from({ length: n }, (_, i) => {
    const top = Math.random() > 0.4
    const x1  = top ? Math.random() * 1600 : -50
    const y1  = top ? -50 : Math.random() * 900
    const len = 160 + Math.random() * 260
    const ang = (38 + Math.random() * 18) * Math.PI / 180
    const rng = Math.random()
    const sw  = rng > 0.95 ? 2.4 : rng > 0.80 ? 1.3 : 0.55
    return {
      id: i, x1, y1,
      x2: x1 + Math.cos(ang) * len,
      y2: y1 + Math.sin(ang) * len,
      duration: 0.5 + Math.random() * 0.9,
      delay: -(Math.random() * 9),
      sw,
      opacity: sw > 2 ? 0.92 : sw > 1 ? 0.65 : 0.40,
    }
  })
}

function ShootingStarBackground({ isScraping }: { isScraping: boolean }) {
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  const starsRef = useRef<Star[]>([])

  useEffect(() => {
    const isMobile = window.innerWidth < 768
    starsRef.current = buildStars(isMobile ? 20 : 80)
    setMounted(true)
  }, [])

  if (!mounted) return null
  const stars = starsRef.current

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="white" stopOpacity="0" />
            <stop offset="25%"  stopColor="white" stopOpacity="0.08" />
            <stop offset="65%"  stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="sga" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#e0e7ff" stopOpacity="0" />
            <stop offset="25%"  stopColor="#c7d2fe" stopOpacity="0.15" />
            <stop offset="65%"  stopColor="white"   stopOpacity="1" />
            <stop offset="100%" stopColor="#c7d2fe" stopOpacity="0" />
          </linearGradient>
        </defs>

        {stars.map((s) => {
          const grad = `url(#${isScraping ? 'sga' : 'sg'})`
          if (reduced) return (
            <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke={grad} strokeWidth={s.sw} opacity={s.opacity * 0.35} />
          )
          const dx = s.x2 - s.x1
          const dy = s.y2 - s.y1
          return (
            <motion.line
              key={s.id}
              x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              stroke={grad}
              strokeWidth={isScraping ? s.sw * 1.5 : s.sw}
              strokeLinecap="round"
              animate={{ x: [0, dx * 1.9], y: [0, dy * 1.9], opacity: [0, s.opacity, s.opacity, 0] }}
              transition={{
                duration: isScraping ? s.duration * 0.4 : s.duration,
                delay: s.delay,
                repeat: Infinity,
                ease: 'linear',
                times: [0, 0.12, 0.72, 1],
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CyclingHeadline
// ---------------------------------------------------------------------------
function CyclingHeadline() {
  const [idx, setIdx]     = useState(0)
  const [text, setText]   = useState('')
  const [blink, setBlink] = useState(true)
  const reduced           = useReducedMotion()

  useEffect(() => {
    const target = CYCLING_HEADLINES[idx]
    if (reduced) { setText(target); return }
    setText(''); setBlink(true)
    let i = 0
    const id = setInterval(() => {
      i++; setText(target.slice(0, i))
      if (i >= target.length) {
        clearInterval(id); setBlink(false)
        setTimeout(() => setIdx((p) => (p + 1) % CYCLING_HEADLINES.length), 1700)
      }
    }, 36)
    return () => clearInterval(id)
  }, [idx, reduced])

  return (
    <span style={{ ...OUTFIT, color: 'rgba(255,255,255,0.9)', fontSize: 'inherit' }}>
      {text}
      {blink && (
        <span style={{ display: 'inline-block', width: 2, height: '0.8em', background: 'white', marginLeft: 2, verticalAlign: 'middle', opacity: 0.8 }} />
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// GlassBox
// ---------------------------------------------------------------------------
function GlassBox({ children, focused = false, style = {} }: {
  children: React.ReactNode; focused?: boolean; style?: React.CSSProperties
}) {
  return (
    <div style={{
      borderRadius: 14,
      backdropFilter: 'blur(10px)',
      background: focused ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${focused ? 'rgba(255,255,255,0.80)' : 'rgba(255,255,255,0.20)'}`,
      boxShadow: focused ? '0 0 0 3px rgba(255,255,255,0.07), 0 0 28px rgba(255,255,255,0.07)' : 'none',
      transition: 'all 0.2s ease',
      ...style,
    }}>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SolidButton
// ---------------------------------------------------------------------------
function SolidButton({
  onClick, disabled = false, type = 'button', children, fullWidth = false,
}: {
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  children: React.ReactNode
  fullWidth?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{ ...BTN_SOLID, width: fullWidth ? '100%' : 'auto', opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
function Spinner() {
  return (
    <svg className="size-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// GlowPublishButton
// ---------------------------------------------------------------------------
function GlowPublishButton({ onClick, disabled, isPublishing, publishSuccess }: {
  onClick: () => void; disabled: boolean; isPublishing: boolean; publishSuccess: boolean
}) {
  const active = !disabled && !publishSuccess && !isPublishing
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 300 }}>
      <AnimatePresence>
        {active && (
          <motion.div
            style={{ position: 'absolute', inset: -1.5, borderRadius: 14, zIndex: 0, overflow: 'hidden' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <motion.div
              style={{ position: 'absolute', inset: 0, background: 'conic-gradient(from 0deg, transparent, rgba(255,255,255,0.65), transparent)' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'linear' }}
            />
            <div style={{ position: 'absolute', inset: 1.5, borderRadius: 13, background: '#000' }} />
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          ...OUTFIT,
          position: 'relative', zIndex: 10,
          width: '100%', height: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          borderRadius: 14,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.18)',
          color: publishSuccess ? '#4ade80' : 'rgba(255,255,255,0.85)',
          opacity: disabled ? 0.3 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 13, letterSpacing: '0.06em',
          transition: 'all 0.18s ease',
        }}
      >
        {isPublishing   ? <><Spinner /><span>Publishing…</span></> :
         publishSuccess ? <><Check style={{ width: 16, height: 16 }} /><span style={{ color: '#4ade80' }}>Published</span></> :
                          <span>Publish to Shopify</span>}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
export default function Home() {
  const [quota, setQuota] = useState<ScrapeQuota>({ count: 0, remaining: DEMO_LIMIT, isLimited: false, resetTs: 0 })
  useEffect(() => { setQuota(readQuota()) }, [])

  const [url, setUrl]                             = useState('')
  const [urlFocused, setUrlFocused]               = useState(false)
  const [product, setProduct]                     = useState<ProductData | null>(null)
  const [generatedCopy, setGeneratedCopy]         = useState<GeneratedCopy | null>(null)
  const [editedCaption, setEditedCaption]         = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [selectedPersona, setSelectedPersona]     = useState<Persona>('Exquisite')
  const [isScraping, setIsScraping]               = useState(false)
  const [isGenerating, setIsGenerating]           = useState(false)
  const [isPublishing, setIsPublishing]           = useState(false)
  const [scrapeError, setScrapeError]             = useState<string | null>(null)
  const [generateError, setGenerateError]         = useState<string | null>(null)
  const [publishError, setPublishError]           = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess]       = useState(false)
  const [copiedField, setCopiedField]             = useState<string | null>(null)

  async function handleScrape(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    const cq = readQuota()
    if (cq.isLimited) { setScrapeError('Demo limit reached. Contact us.'); setQuota(cq); return }
    setIsScraping(true); setScrapeError(null); setProduct(null); setGeneratedCopy(null)
    setEditedCaption(''); setEditedDescription(''); setPublishSuccess(false); setPublishError(null)
    try {
      const data = await scrapeProduct(url); setProduct(data)
      const nq = incrementQuota(); setQuota(nq)
      posthog.capture('product_scraped', { persona: selectedPersona, product_title: data.title, vendor: data.vendor, scrapes_used: nq.count })
    } catch (err) {
      const m: Record<number, string> = { 400: 'Not a Shopify product URL.', 403: 'Store is password-protected.', 404: 'Product not found.', 429: 'Server limit reached.', 504: 'Store timed out.' }
      setScrapeError(err instanceof ApiError ? (m[err.status] ?? err.message) : (err instanceof Error ? err.message : 'Scrape failed.'))
    } finally { setIsScraping(false) }
  }

  async function handleGenerate() {
    if (!product) return
    setIsGenerating(true); setGenerateError(null); setPublishSuccess(false); setPublishError(null)
    setEditedCaption(''); setEditedDescription('')
    try {
      const copy = await generateCopy(product, selectedPersona)
      setGeneratedCopy(copy); setEditedCaption(copy.instagram_caption); setEditedDescription(copy.website_description)
      posthog.capture('copy_generated', { persona: selectedPersona, product_title: product.title })
    } catch (err) { setGenerateError(err instanceof ApiError ? err.message : 'Generation failed.') }
    finally { setIsGenerating(false) }
  }

  async function handlePublish() {
    if (!product || !editedDescription.trim()) return
    setIsPublishing(true); setPublishError(null); setPublishSuccess(false)
    try {
      await publishDescription(product.product_id, editedDescription); setPublishSuccess(true)
      posthog.capture('description_published', { product_id: product.product_id, product_title: product.title, persona: selectedPersona, was_edited: editedDescription !== generatedCopy?.website_description })
    } catch (err) {
      const m: Record<number, string> = { 401: 'Token rejected.', 403: 'Missing write_products.', 404: 'Product not found.', 429: 'Rate limited.' }
      setPublishError(err instanceof ApiError ? (m[err.status] ?? err.message) : 'Publish failed.')
    } finally { setIsPublishing(false) }
  }

  async function clipCopy(text: string, field: string) {
    await navigator.clipboard.writeText(text); setCopiedField(field); setTimeout(() => setCopiedField(null), 2000)
  }

  const primaryImage   = product?.images?.[0]
  const scrapeDisabled = isScraping || !url.trim() || quota.isLimited

  return (
    <div className="relative min-h-screen w-full bg-black" style={OUTFIT4}>
      <ShootingStarBackground isScraping={isScraping} />

      <motion.div
        className="relative z-50 mx-auto max-w-xl px-6 pt-16 pb-24"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >

        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <motion.div variants={itemVariants} style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ ...OUTFIT, fontSize: '2.5rem', lineHeight: 1.05, letterSpacing: '0em', color: '#ffffff', margin: '0 0 6px 0' }}>
            NeboCollections
          </h1>
          <p style={{ ...OUTFIT4, fontSize: 17, color: 'rgba(255,255,255,0.58)', lineHeight: 1.45, margin: 0 }}>
            Copy engine for <CyclingHeadline />
          </p>
        </motion.div>

        {/* ── URL Input + Scrape ─────────────────────────────────────────── */}
        <motion.div variants={itemVariants} style={{ marginBottom: 10 }}>
          <form onSubmit={handleScrape}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <GlassBox focused={urlFocused} style={{ flex: 1 }}>
                <Input
                  type="url"
                  placeholder="Paste your Shopify product URL…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onFocus={() => setUrlFocused(true)}
                  onBlur={() => setUrlFocused(false)}
                  disabled={isScraping || quota.isLimited}
                  style={{ ...OUTFIT4, height: 48, border: 'none', background: 'transparent', color: '#fff', fontSize: 14, padding: '0 16px', width: '100%', outline: 'none', boxShadow: 'none' }}
                  className="placeholder:text-white/30 focus-visible:ring-0"
                />
              </GlassBox>

              <SolidButton type="submit" disabled={scrapeDisabled}>
                {isScraping
                  ? <><Spinner /><span style={{ color: '#000' }}>Wait…</span></>
                  : quota.isLimited
                  ? <span style={{ color: '#000' }}>Limit</span>
                  : <><span style={{ color: '#000' }}>Scrape</span><ArrowRight style={{ width: 16, height: 16, color: '#000' }} /></>
                }
              </SolidButton>
            </div>

            <p style={{ ...OUTFIT4, fontSize: 11, marginTop: 8, color: quota.isLimited ? '#f87171' : quota.remaining === 1 ? '#fbbf24' : 'rgba(255,255,255,0.30)' }}>
              {quota.isLimited ? 'Demo limit reached — contact us to unlock.' : `${quota.remaining} of ${DEMO_LIMIT} demo scrapes remaining`}
            </p>
            {scrapeError && <p style={{ ...OUTFIT4, fontSize: 12, color: '#f87171', marginTop: 4 }}>{scrapeError}</p>}
          </form>
        </motion.div>

        {/* ── Product card ───────────────────────────────────────────────── */}
        <AnimatePresence>
          {product && (
            <motion.div key="product"
              variants={itemVariants} initial="hidden" animate="show"
              style={{ marginTop: 40, marginBottom: 36 }}
            >
              <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                {primaryImage && (
                  <div style={{ width: 72, height: 72, flexShrink: 0, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.14)', position: 'relative' }}>
                    <Image src={primaryImage.src} alt={primaryImage.alt || product.title} fill unoptimized className="object-cover" sizes="72px" />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                  <p style={{ ...OUTFIT, fontSize: 15, color: '#fff', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.title}</p>
                  {product.vendor && <p style={{ ...OUTFIT4, fontSize: 12, color: 'rgba(255,255,255,0.40)', marginTop: 4 }}>by {product.vendor}</p>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
                <Select value={selectedPersona} onValueChange={(v) => setSelectedPersona(v as Persona)}>
                  <SelectTrigger
                    style={{ ...OUTFIT4, height: 48, flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 14, color: 'rgba(255,255,255,0.80)', fontSize: 13, paddingLeft: 14 }}
                    className="focus:ring-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }}>
                    {(Object.entries(PERSONA_GROUPS) as [string, Persona[]][]).map(([group, personas]) => (
                      <SelectGroup key={group}>
                        <SelectLabel style={{ ...OUTFIT, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.30)', padding: '6px 8px' }}>
                          {group}
                        </SelectLabel>
                        {personas.map((p) => (
                          <SelectItem key={p} value={p} style={{ ...OUTFIT4, fontSize: 13, color: 'rgba(255,255,255,0.75)' }} className="focus:bg-white/[0.08] focus:text-white">
                            {p}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>

                <SolidButton onClick={handleGenerate} disabled={isGenerating}>
                  {isGenerating
                    ? <><Spinner /><span style={{ color: '#000' }}>Working…</span></>
                    : <><Sparkles style={{ width: 15, height: 15, color: '#000' }} /><span style={{ color: '#000' }}>Generate</span></>
                  }
                </SolidButton>
              </div>
              {generateError && <p style={{ ...OUTFIT4, fontSize: 12, color: '#f87171', marginTop: 8 }}>{generateError}</p>}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Generated copy ─────────────────────────────────────────────── */}
        <AnimatePresence>
          {generatedCopy && (
            <motion.div key="copy"
              variants={itemVariants} initial="hidden" animate="show"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <p style={{ ...OUTFIT, fontSize: 10, letterSpacing: '0.20em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginBottom: 4 }}>
                Edit before publishing
              </p>

              <Suspense fallback={<div style={{ borderRadius: 14, height: 200, background: 'rgba(255,255,255,0.04)' }} />}>
                <EditableCopyCard
                  title="Instagram Caption"
                  value={editedCaption}
                  onChange={setEditedCaption}
                  maxLength={IG_CAP}
                  rows={7}
                  hashtags={generatedCopy.instagram_hashtags}
                  onCopy={() => clipCopy(`${editedCaption}\n\n${generatedCopy.instagram_hashtags.map((t) => `#${t}`).join(' ')}`, 'ig')}
                  copied={copiedField === 'ig'}
                />
              </Suspense>

              <Suspense fallback={<div style={{ borderRadius: 14, height: 160, background: 'rgba(255,255,255,0.04)' }} />}>
                <EditableCopyCard
                  title="Website Description"
                  value={editedDescription}
                  onChange={setEditedDescription}
                  maxLength={WEB_CAP}
                  rows={5}
                  onCopy={() => clipCopy(editedDescription, 'web')}
                  copied={copiedField === 'web'}
                />
              </Suspense>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 4 }}>
                <GlowPublishButton
                  onClick={handlePublish}
                  disabled={isPublishing || publishSuccess || !editedDescription.trim()}
                  isPublishing={isPublishing}
                  publishSuccess={publishSuccess}
                />
                <AnimatePresence>
                  {publishSuccess && (
                    <motion.p style={{ ...OUTFIT, fontSize: 12, color: '#4ade80' }}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      Live on your storefront.
                    </motion.p>
                  )}
                  {publishError && (
                    <motion.p style={{ ...OUTFIT4, fontSize: 12, color: '#f87171', textAlign: 'center' }}
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {publishError}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Feedback section ───────────────────────────────────────────── */}
        <motion.div
          variants={itemVariants}
          style={{ borderTop: '1px solid rgba(255,255,255,0.07)', marginTop: 64, paddingTop: 48 }}
        >
          <Suspense fallback={<div style={{ borderRadius: 14, height: 260, background: 'rgba(255,255,255,0.02)' }} />}>
            <FeedbackForm />
          </Suspense>
        </motion.div>

      </motion.div>
    </div>
  )
}