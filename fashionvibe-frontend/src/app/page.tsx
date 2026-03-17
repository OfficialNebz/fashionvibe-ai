'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Copy, Check, ArrowRight, Sparkles } from 'lucide-react'
import posthog from 'posthog-js'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
// Constants
// ---------------------------------------------------------------------------
const IG_CAP        = 2200
const WEB_CAP       = 5000
const DEMO_LIMIT    = 3
const RESET_MS      = 24 * 60 * 60 * 1000   // 24 hours in milliseconds
const LS_COUNT_KEY  = 'fv_scrape_count'
const LS_RESET_KEY  = 'fv_scrape_reset_ts'

// ---------------------------------------------------------------------------
// localStorage scrape quota helpers
// ---------------------------------------------------------------------------
// These functions are safe to call only in browser context (inside useEffect
// or event handlers — never during SSR). Next.js server-renders this page,
// so any localStorage access at module scope would throw.

interface ScrapeQuota {
  count: number           // scrapes used in the current window
  remaining: number       // scrapes left
  isLimited: boolean      // true when count >= DEMO_LIMIT within 24h window
  resetTs: number         // epoch ms when the window started
}

function readQuota(): ScrapeQuota {
  try {
    const count   = parseInt(localStorage.getItem(LS_COUNT_KEY) ?? '0', 10)
    const resetTs = parseInt(localStorage.getItem(LS_RESET_KEY) ?? '0', 10)
    const now     = Date.now()

    // If 24 hours have elapsed since the window started, treat as fresh
    if (resetTs > 0 && now - resetTs >= RESET_MS) {
      localStorage.setItem(LS_COUNT_KEY, '0')
      localStorage.setItem(LS_RESET_KEY, String(now))
      return { count: 0, remaining: DEMO_LIMIT, isLimited: false, resetTs: now }
    }

    const remaining  = Math.max(0, DEMO_LIMIT - count)
    const isLimited  = count >= DEMO_LIMIT
    return { count, remaining, isLimited, resetTs }
  } catch {
    // localStorage unavailable (private browsing on some browsers, SSR guard)
    return { count: 0, remaining: DEMO_LIMIT, isLimited: false, resetTs: 0 }
  }
}

function incrementQuota(): ScrapeQuota {
  try {
    const now     = Date.now()
    const resetTs = parseInt(localStorage.getItem(LS_RESET_KEY) ?? '0', 10)

    // Initialise the window timestamp on the first scrape
    if (resetTs === 0) {
      localStorage.setItem(LS_RESET_KEY, String(now))
    }

    const prev  = parseInt(localStorage.getItem(LS_COUNT_KEY) ?? '0', 10)
    const next  = prev + 1
    localStorage.setItem(LS_COUNT_KEY, String(next))

    const remaining = Math.max(0, DEMO_LIMIT - next)
    return {
      count: next,
      remaining,
      isLimited: next >= DEMO_LIMIT,
      resetTs: resetTs === 0 ? now : resetTs,
    }
  } catch {
    return { count: 1, remaining: DEMO_LIMIT - 1, isLimited: false, resetTs: Date.now() }
  }
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
function Spinner() {
  return (
    <svg
      className="size-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12" cy="12" r="10"
        stroke="currentColor" strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// EditableCopyCard
// ---------------------------------------------------------------------------
function EditableCopyCard({
  title,
  value,
  onChange,
  maxLength,
  hashtags,
  onCopy,
  copied,
  rows = 6,
}: {
  title: string
  value: string
  onChange: (val: string) => void
  maxLength: number
  hashtags?: string[]
  onCopy: () => void
  copied: boolean
  rows?: number
}) {
  const remaining = maxLength - value.length
  const nearLimit = remaining < maxLength * 0.1

  return (
    <Card className="border-border/40">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={onCopy}
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          {copied
            ? <Check className="size-4 text-green-600" />
            : <Copy className="size-4" />}
          <span className="sr-only">Copy to clipboard</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          rows={rows}
          className="w-full resize-y rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-foreground leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between gap-2">
          {hashtags && hashtags.length > 0 && (
            <p className="text-xs text-muted-foreground truncate">
              {hashtags.map((tag) => `#${tag}`).join(' ')}
            </p>
          )}
          <p className={`ml-auto shrink-0 text-xs tabular-nums ${
            nearLimit ? 'text-destructive' : 'text-muted-foreground'
          }`}>
            {remaining.toLocaleString()} / {maxLength.toLocaleString()}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
export default function Home() {
  // ── Quota state — initialised from localStorage after hydration ──────────
  // Starts at full quota to avoid a flash of "0 remaining" during SSR.
  // useEffect corrects it immediately after mount.
  const [quota, setQuota] = useState<ScrapeQuota>({
    count: 0,
    remaining: DEMO_LIMIT,
    isLimited: false,
    resetTs: 0,
  })

  useEffect(() => {
    // Safe to read localStorage now that we are in the browser
    setQuota(readQuota())
  }, [])

  // ── Core pipeline state ──────────────────────────────────────────────────
  const [url, setUrl]                             = useState('')
  const [product, setProduct]                     = useState<ProductData | null>(null)
  const [generatedCopy, setGeneratedCopy]         = useState<GeneratedCopy | null>(null)
  const [editedCaption, setEditedCaption]         = useState('')
  const [editedDescription, setEditedDescription] = useState('')
  const [selectedPersona, setSelectedPersona]     = useState<Persona>('Exquisite')

  // ── Loading & error state ────────────────────────────────────────────────
  const [isScraping, setIsScraping]         = useState(false)
  const [isGenerating, setIsGenerating]     = useState(false)
  const [isPublishing, setIsPublishing]     = useState(false)
  const [scrapeError, setScrapeError]       = useState<string | null>(null)
  const [generateError, setGenerateError]   = useState<string | null>(null)
  const [publishError, setPublishError]     = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [copiedField, setCopiedField]       = useState<string | null>(null)

  // ── Scrape ────────────────────────────────────────────────────────────────
  async function handleScrape(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return

    // Client-side quota check — before any network call
    const currentQuota = readQuota()
    if (currentQuota.isLimited) {
      setScrapeError(
        'Daily demo limit reached. Contact us to unlock the full pipeline.'
      )
      setQuota(currentQuota)
      return
    }

    setIsScraping(true)
    setScrapeError(null)
    setProduct(null)
    setGeneratedCopy(null)
    setEditedCaption('')
    setEditedDescription('')
    setPublishSuccess(false)
    setPublishError(null)

    try {
      const data = await scrapeProduct(url)
      setProduct(data)

      // Increment only on success — failed scrapes don't cost a quota slot
      const newQuota = incrementQuota()
      setQuota(newQuota)

      posthog.capture('product_scraped', {
        persona: selectedPersona,
        product_title: data.title,
        vendor: data.vendor,
        scrapes_used: newQuota.count,
      })
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.status) {
          case 400:
            setScrapeError("That URL doesn't look like a Shopify product page. Make sure it contains /products/ in the path.")
            break
          case 403:
            setScrapeError('This store is password-protected and cannot be accessed.')
            break
          case 404:
            setScrapeError('Product not found. Check the URL is pointing to a live product.')
            break
          case 429:
            setScrapeError('Server limit reached. Contact us to unlock the full pipeline.')
            break
          case 504:
            setScrapeError('The store took too long to respond. Try again in a moment.')
            break
          default:
            setScrapeError(err.message)
        }
      } else {
        setScrapeError(err instanceof Error ? err.message : 'Failed to scrape product.')
      }
    } finally {
      setIsScraping(false)
    }
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!product) return

    setIsGenerating(true)
    setGenerateError(null)
    setPublishSuccess(false)
    setPublishError(null)
    setEditedCaption('')
    setEditedDescription('')

    try {
      const copy = await generateCopy(product, selectedPersona)
      setGeneratedCopy(copy)
      setEditedCaption(copy.instagram_caption)
      setEditedDescription(copy.website_description)
      posthog.capture('copy_generated', {
        persona: selectedPersona,
        product_title: product.title,
      })
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.status) {
          case 422:
            setGenerateError('Invalid persona selected. Please choose a valid option and try again.')
            break
          case 503:
            setGenerateError('The AI service is temporarily unavailable. Try again in a moment.')
            break
          default:
            setGenerateError(err.message)
        }
      } else {
        setGenerateError(err instanceof Error ? err.message : 'Failed to generate copy.')
      }
    } finally {
      setIsGenerating(false)
    }
  }

  // ── Publish ───────────────────────────────────────────────────────────────
  async function handlePublish() {
    if (!product || !editedDescription.trim()) return

    setIsPublishing(true)
    setPublishError(null)
    setPublishSuccess(false)

    try {
      await publishDescription(product.product_id, editedDescription)
      setPublishSuccess(true)
      posthog.capture('description_published', {
        product_id: product.product_id,
        product_title: product.title,
        persona: selectedPersona,
        was_edited: editedDescription !== generatedCopy?.website_description,
      })
    } catch (err) {
      if (err instanceof ApiError) {
        switch (err.status) {
          case 401:
            setPublishError('Shopify rejected the access token. Check SHOPIFY_ACCESS_TOKEN in your .env.')
            break
          case 403:
            setPublishError('Your Shopify token is missing write_products permission.')
            break
          case 404:
            setPublishError('Product not found in your configured store. Verify SHOPIFY_STORE_NAME matches.')
            break
          case 429:
            setPublishError('Shopify rate limit hit. Wait a moment and try again.')
            break
          default:
            setPublishError(err.message)
        }
      } else {
        setPublishError(err instanceof Error ? err.message : 'Publish failed.')
      }
    } finally {
      setIsPublishing(false)
    }
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────
  async function copyToClipboard(text: string, field: string) {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const primaryImage = product?.images?.[0]

  // ── Derived scrape button state ───────────────────────────────────────────
  const scrapeButtonDisabled = isScraping || !url.trim() || quota.isLimited
  const scrapeButtonLabel    = quota.isLimited
    ? 'Limit Reached'
    : isScraping
    ? null           // shows spinner
    : 'Scrape'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-background font-sans">
      <div className="mx-auto max-w-3xl px-6 py-20">

        {/* Header */}
        <header className="mb-16 text-center">
          <h1 className="text-4xl font-extralight uppercase tracking-[0.2em] text-foreground">
            NeboCollections
          </h1>
          <p className="mt-3 text-sm tracking-wide text-muted-foreground/60">
            AI-powered copy for your fashion brand
          </p>
        </header>

        {/* URL Input */}
        <form onSubmit={handleScrape} className="mb-4">
          <div className="flex gap-3">
            <Input
              type="url"
              placeholder="Paste your Shopify product URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-12 flex-1 border-border/60 bg-background text-base"
              disabled={isScraping || quota.isLimited}
            />
            <Button
              type="submit"
              disabled={scrapeButtonDisabled}
              variant={quota.isLimited ? 'outline' : 'default'}
              className="h-12 px-6"
            >
              {isScraping ? (
                <Spinner />
              ) : quota.isLimited ? (
                <span>{scrapeButtonLabel}</span>
              ) : (
                <>
                  <span>{scrapeButtonLabel}</span>
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>

          {/* Quota indicator — always visible, updates after each scrape */}
          <div className="mt-2 flex items-center justify-between">
            <p className={`text-xs tabular-nums ${
              quota.isLimited
                ? 'text-destructive'
                : quota.remaining === 1
                ? 'text-amber-500'
                : 'text-muted-foreground'
            }`}>
              {quota.isLimited
                ? 'Daily demo limit reached — contact us to unlock the full pipeline.'
                : `Demo Mode: ${quota.remaining} of ${DEMO_LIMIT} scrapes remaining today`
              }
            </p>
          </div>

          {/* Error below the quota indicator */}
          {scrapeError && (
            <p className="mt-2 text-sm text-destructive">{scrapeError}</p>
          )}
        </form>

        {/* mb-16 spacer only when no error / quota message is showing */}
        <div className="mb-12" />

        {/* Product Display */}
        {product && (
          <section className="mb-16 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-start">
              {primaryImage && (
                <div className="relative aspect-square w-full max-w-[200px] shrink-0 overflow-hidden rounded-lg border border-border/40 bg-muted/30">
                  <Image
                    src={primaryImage.src}
                    alt={primaryImage.alt || product.title}
                    fill
                    unoptimized
                    className="object-cover"
                    sizes="200px"
                  />
                </div>
              )}
              <div className="flex-1 text-center sm:text-left">
                <h2 className="text-2xl font-medium tracking-tight text-foreground">
                  {product.title}
                </h2>
                {product.vendor && (
                  <p className="mt-1 text-sm text-muted-foreground">by {product.vendor}</p>
                )}
                {product.product_type && (
                  <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground/70">
                    {product.product_type}
                  </p>
                )}
              </div>
            </div>

            {/* Persona Selector */}
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Select
                value={selectedPersona}
                onValueChange={(value) => setSelectedPersona(value as Persona)}
              >
                <SelectTrigger className="h-12 w-full sm:w-[220px]">
                  <SelectValue placeholder="Select persona" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(PERSONA_GROUPS) as [string, Persona[]][]).map(
                    ([group, personas]) => (
                      <SelectGroup key={group}>
                        <SelectLabel className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-2 py-1.5">
                          {group}
                        </SelectLabel>
                        {personas.map((persona) => (
                          <SelectItem key={persona} value={persona}>
                            {persona}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )
                  )}
                </SelectContent>
              </Select>

              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="h-12 w-full px-8 sm:w-auto"
              >
                {isGenerating ? <Spinner /> : (
                  <>
                    <Sparkles className="size-4" />
                    <span>Generate Copy</span>
                  </>
                )}
              </Button>
            </div>

            {generateError && (
              <p className="mt-4 text-center text-sm text-destructive">{generateError}</p>
            )}
          </section>
        )}

        {/* Generated Copy — Editable Cards */}
        {generatedCopy && (
          <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <p className="text-center text-xs text-muted-foreground tracking-wide uppercase">
              Edit before publishing — changes are yours
            </p>

            <EditableCopyCard
              title="Instagram Caption"
              value={editedCaption}
              onChange={setEditedCaption}
              maxLength={IG_CAP}
              rows={8}
              hashtags={generatedCopy.instagram_hashtags}
              onCopy={() =>
                copyToClipboard(
                  `${editedCaption}\n\n${generatedCopy.instagram_hashtags.map((t) => `#${t}`).join(' ')}`,
                  'instagram',
                )
              }
              copied={copiedField === 'instagram'}
            />

            <EditableCopyCard
              title="Website Description"
              value={editedDescription}
              onChange={setEditedDescription}
              maxLength={WEB_CAP}
              rows={6}
              onCopy={() => copyToClipboard(editedDescription, 'website')}
              copied={copiedField === 'website'}
            />

            {/* Publish to Shopify */}
            <div className="flex flex-col items-center gap-3 pt-2">
              <Button
                onClick={handlePublish}
                disabled={isPublishing || publishSuccess || !editedDescription.trim()}
                variant={publishSuccess ? 'outline' : 'default'}
                className="h-12 w-full max-w-sm gap-2"
              >
                {isPublishing ? (
                  <>
                    <Spinner />
                    <span>Publishing...</span>
                  </>
                ) : publishSuccess ? (
                  <>
                    <Check className="size-4 text-green-600" />
                    <span className="text-green-600">Published to Shopify</span>
                  </>
                ) : (
                  <span>Publish to Shopify</span>
                )}
              </Button>

              {publishSuccess && (
                <p className="text-center text-sm text-muted-foreground animate-in fade-in duration-300">
                  Your product description is now live on your storefront.
                </p>
              )}
              {publishError && (
                <p className="text-center text-sm text-destructive animate-in fade-in duration-300">
                  {publishError}
                </p>
              )}
            </div>
          </section>
        )}

      </div>

      {/* Feedback Form */}
      <FeedbackForm />
    </main>
  )
}

// ---------------------------------------------------------------------------
// FeedbackForm — Formspree (xlgpwaby)
// ---------------------------------------------------------------------------
function FeedbackForm() {
  const [submitted, setSubmitted]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback]     = useState('')
  const [email, setEmail]           = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!feedback.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch('https://formspree.io/f/xlgpwaby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, message: feedback }),
      })
      if (res.ok) {
        setSubmitted(true)
        setFeedback('')
        setEmail('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-6 mt-20 pb-20 border-t border-border/40 pt-12">
      <div className="text-center mb-8">
        <h2 className="text-lg font-light tracking-tight text-foreground">
          Share your thoughts
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          What would make this tool essential for your brand?
        </p>
      </div>
      {submitted ? (
        <div className="flex flex-col items-center gap-2 py-6 animate-in fade-in duration-300">
          <Check className="size-5 text-green-600" />
          <p className="text-sm text-muted-foreground">
            Received — thank you. We read every response.
          </p>
        </div>
      ) : (
        <div className="space-y-3 max-w-lg mx-auto">
          <Input
            type="email"
            placeholder="Your email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11 border-border/60 bg-background"
            disabled={submitting}
          />
          <textarea
            placeholder="What's working? What's missing? What would you pay for?"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            disabled={submitting}
            className="w-full resize-none rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          />
          <Button
            onClick={handleSubmit}
            disabled={submitting || !feedback.trim()}
            variant="outline"
            className="w-full h-11"
          >
            {submitting ? 'Sending...' : 'Send Feedback'}
          </Button>
        </div>
      )}
    </div>
  )
}