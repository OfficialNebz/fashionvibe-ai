'use client'

import { useState } from 'react'
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
  type ProductData,
  type GeneratedCopy,
  type Persona,
} from '@/lib/api'

// ---------------------------------------------------------------------------
// Persona groups — mirrors PERSONA_GROUPS in generator.py
// Defined here so the frontend has no runtime dependency on the backend enum.
// ---------------------------------------------------------------------------
const PERSONA_GROUPS: Record<string, Persona[]> = {
  WOMEN: ['Exquisite', 'Ladylike', 'Street Vibes', 'Minimalist Chic', 'Eco-Conscious'],
  MEN:   ['The Executive', 'Hypebeast', 'The Rugged', 'Tailored Modern', 'The Minimalist'],
  CHILDREN: [
    'Playful & Bright',
    'The Mini-Me',
    'Durable Adventure',
    'Whimsical Tale',
    'Soft & Pure',
  ],
} as Record<string, Persona[]>

const DEFAULT_PERSONA: Persona = 'Exquisite'

// Character limits matching Shopify and Instagram platform constraints
const INSTAGRAM_CAP = 2200
const WEBSITE_CAP   = 5000

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
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
export default function Home() {
  const [url, setUrl] = useState('')
  const [product, setProduct] = useState<ProductData | null>(null)
  const [generatedCopy, setGeneratedCopy] = useState<GeneratedCopy | null>(null)
  const [selectedPersona, setSelectedPersona] = useState<Persona>(DEFAULT_PERSONA)

  // Editable output state — seeded from AI response, user can modify before publishing
  const [editedCaption, setEditedCaption]     = useState('')
  const [editedWebsite, setEditedWebsite]     = useState('')

  const [isScraping, setIsScraping]   = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)

  const [scrapeError, setScrapeError]   = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [publishError, setPublishError]   = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)

  const [copiedField, setCopiedField] = useState<string | null>(null)

  // ── Scrape ──────────────────────────────────────────────────────────────
  async function handleScrape(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return

    setIsScraping(true)
    setScrapeError(null)
    setProduct(null)
    setGeneratedCopy(null)
    setEditedCaption('')
    setEditedWebsite('')
    setPublishSuccess(false)
    setPublishError(null)

    try {
      const data = await scrapeProduct(url)
      setProduct(data)
      posthog.capture('product_scraped', {
        persona: selectedPersona,
        product_title: data.title,
        vendor: data.vendor,
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
            setScrapeError('You have used all 3 demo scrapes for the next 12 hours. Contact support to unlock the full pipeline.')
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

  // ── Generate ────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!product) return

    setIsGenerating(true)
    setGenerateError(null)
    setPublishSuccess(false)
    setPublishError(null)

    try {
      const copy = await generateCopy(product, selectedPersona)
      setGeneratedCopy(copy)
      // Seed the editable fields with the AI output
      setEditedCaption(copy.instagram_caption)
      setEditedWebsite(copy.website_description)
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

  // ── Publish ─────────────────────────────────────────────────────────────
  // Sends editedWebsite — the current state of the editable textarea —
  // not the original AI output. This allows founders to tweak before publishing.
  async function handlePublish() {
    if (!product || !editedWebsite.trim()) return

    setIsPublishing(true)
    setPublishError(null)
    setPublishSuccess(false)

    try {
      await publishDescription(product.product_id, editedWebsite)
      setPublishSuccess(true)
      posthog.capture('description_published', {
        product_id: product.product_id,
        product_title: product.title,
        persona: selectedPersona,
        was_edited: editedWebsite !== generatedCopy?.website_description,
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

  // ── Clipboard ────────────────────────────────────────────────────────────
  async function copyToClipboard(text: string, field: string) {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const primaryImage = product?.images?.[0]

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-20">

        {/* Header */}
        <header className="mb-16 text-center">
          <h1 className="text-4xl font-light tracking-tight text-foreground">
            FashionVibe
          </h1>
          <p className="mt-3 text-muted-foreground">
            AI-powered copy for your fashion brand
          </p>
        </header>

        {/* URL Input */}
        <form onSubmit={handleScrape} className="mb-16">
          <div className="flex gap-3">
            <Input
              type="url"
              placeholder="Paste your Shopify product URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-12 flex-1 border-border/60 bg-background text-base"
              disabled={isScraping}
            />
            <Button
              type="submit"
              disabled={isScraping || !url.trim()}
              className="h-12 px-6"
            >
              {isScraping ? <Spinner /> : (
                <>
                  <span>Scrape</span>
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </div>
          {scrapeError && (
            <p className="mt-3 text-sm text-destructive">{scrapeError}</p>
          )}
        </form>

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

            {/* Persona Selector — grouped by Women / Men / Children */}
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Select
                value={selectedPersona}
                onValueChange={(value) => setSelectedPersona(value as Persona)}
              >
                <SelectTrigger className="h-12 w-full sm:w-[240px]">
                  <SelectValue placeholder="Select persona" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PERSONA_GROUPS).map(([group, personas]) => (
                    <SelectGroup key={group}>
                      <SelectLabel className="text-xs font-semibold tracking-widest text-muted-foreground/60 uppercase px-2 py-1.5">
                        {group}
                      </SelectLabel>
                      {personas.map((persona) => (
                        <SelectItem key={persona} value={persona}>
                          {persona}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
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

        {/* Generated Copy — Editable */}
        {generatedCopy && (
          <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Instagram Caption */}
            <EditableCard
              title="Instagram Caption"
              value={editedCaption}
              onChange={setEditedCaption}
              cap={INSTAGRAM_CAP}
              onCopy={() => copyToClipboard(
                `${editedCaption}\n\n${generatedCopy.instagram_hashtags.map((t) => `#${t}`).join(' ')}`,
                'instagram'
              )}
              copied={copiedField === 'instagram'}
              footer={
                <p className="text-sm text-muted-foreground">
                  {generatedCopy.instagram_hashtags.map((tag) => `#${tag}`).join(' ')}
                </p>
              }
            />

            {/* Website Description */}
            <EditableCard
              title="Website Description"
              value={editedWebsite}
              onChange={(val) => {
                setEditedWebsite(val)
                // Reset publish success if the founder edits after publishing
                if (publishSuccess) setPublishSuccess(false)
              }}
              cap={WEBSITE_CAP}
              onCopy={() => copyToClipboard(editedWebsite, 'website')}
              copied={copiedField === 'website'}
            />

            {/* Publish to Shopify */}
            <div className="flex flex-col items-center gap-3 pt-2">
              <Button
                onClick={handlePublish}
                disabled={isPublishing || publishSuccess || !editedWebsite.trim()}
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
                  Your edited description is now live on your storefront.
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
// EditableCard
// ---------------------------------------------------------------------------
function EditableCard({
  title,
  value,
  onChange,
  cap,
  onCopy,
  copied,
  footer,
}: {
  title: string
  value: string
  onChange: (val: string) => void
  cap: number
  onCopy: () => void
  copied: boolean
  footer?: React.ReactNode
}) {
  const remaining = cap - value.length
  const overLimit = remaining < 0

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
          {copied ? (
            <Check className="size-4 text-green-600" />
          ) : (
            <Copy className="size-4" />
          )}
          <span className="sr-only">Copy to clipboard</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-md border border-border/60 bg-background px-3 py-2 text-sm text-foreground leading-relaxed placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <div className="flex items-center justify-between">
          {footer ?? <span />}
          <span className={`text-xs tabular-nums ${overLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
            {overLimit ? `${Math.abs(remaining)} over limit` : `${remaining} remaining`}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// CopyCard — kept for any future read-only display needs
// ---------------------------------------------------------------------------
function CopyCard({
  title,
  content,
  hashtags,
  onCopy,
  copied,
}: {
  title: string
  content: string
  hashtags?: string[]
  onCopy: () => void
  copied: boolean
}) {
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
          {copied ? (
            <Check className="size-4 text-green-600" />
          ) : (
            <Copy className="size-4" />
          )}
          <span className="sr-only">Copy to clipboard</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-foreground leading-relaxed">{content}</p>
        {hashtags && hashtags.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {hashtags.map((tag) => `#${tag}`).join(' ')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// FeedbackForm — Formspree (xlgpwaby)
// ---------------------------------------------------------------------------
function FeedbackForm() {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [email, setEmail] = useState('')

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
