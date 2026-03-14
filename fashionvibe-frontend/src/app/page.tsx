'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Copy, Check, ArrowRight, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'  // FIX 1: Removed hallucinated CardAction import
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  scrapeProduct,
  generateCopy,
  publishDescription,
  ApiError,
  PERSONAS,
  type ProductData,
  type GeneratedCopy,
  type Persona,
} from '@/lib/api'

export default function Home() {
  const [url, setUrl] = useState('')
  const [product, setProduct] = useState<ProductData | null>(null)
  const [generatedCopy, setGeneratedCopy] = useState<GeneratedCopy | null>(null)
  const [selectedPersona, setSelectedPersona] = useState<Persona>(PERSONAS[0])
  const [isScraping, setIsScraping] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [scrapeError, setScrapeError] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  async function handleScrape(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return

    setIsScraping(true)
    setScrapeError(null)
    setProduct(null)
    setGeneratedCopy(null)
    setPublishSuccess(false)
    setPublishError(null)

    try {
      const data = await scrapeProduct(url)
      setProduct(data)
    } catch (err) {
      // FIX 4: Branch on HTTP status for specific, actionable error messages
      if (err instanceof ApiError) {
        switch (err.status) {
          case 400:
            setScrapeError('That URL doesn\'t look like a Shopify product page. Make sure it contains /products/ in the path.')
            break
          case 403:
            setScrapeError('This store is password-protected and cannot be accessed.')
            break
          case 404:
            setScrapeError('Product not found. Check the URL is pointing to a live product.')
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

  async function handleGenerate() {
    if (!product) return

    setIsGenerating(true)
    setGenerateError(null)
    setPublishSuccess(false)
    setPublishError(null)

    try {
      const copy = await generateCopy(product, selectedPersona)
      setGeneratedCopy(copy)
    } catch (err) {
      // FIX 4: Status-aware generate errors
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

  async function handlePublish() {
    if (!product || !generatedCopy) return

    setIsPublishing(true)
    setPublishError(null)
    setPublishSuccess(false)

    try {
      await publishDescription(product.product_id, generatedCopy.website_description)
      setPublishSuccess(true)
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

  async function copyToClipboard(text: string, field: string) {
    await navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const primaryImage = product?.images?.[0]

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-20">

        {/* Header */}
        <header className="mb-16 text-center">
          <h1 className="text-4xl font-light tracking-tight text-foreground">
            NeboCollections
          </h1>
          <p className="mt-3 text-muted-foreground">
            AI-powered copy for the modern fashion house.
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
              {isScraping ? (
                // FIX 2: Replaced non-existent <Spinner> with an inline SVG spinner
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
              ) : (
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
                  {/* FIX 3: unoptimized bypasses the Next.js domain allowlist for Shopify CDN images.
                      Alternative: add hostname config to next.config.ts (see below). */}
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
                  <p className="mt-1 text-sm text-muted-foreground">
                    by {product.vendor}
                  </p>
                )}
                {product.product_type && (
                  <p className="mt-2 text-xs uppercase tracking-wider text-muted-foreground/70">
                    {product.product_type}
                  </p>
                )}
              </div>
            </div>

            {/* Persona Selector + Generate */}
            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Select
                value={selectedPersona}
                onValueChange={(value) => setSelectedPersona(value as Persona)}
              >
                <SelectTrigger className="h-12 w-full sm:w-[200px]">
                  <SelectValue placeholder="Select persona" />
                </SelectTrigger>
                <SelectContent>
                  {PERSONAS.map((persona) => (
                    <SelectItem key={persona} value={persona}>
                      {persona}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="h-12 w-full px-8 sm:w-auto"
              >
                {isGenerating ? (
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
                ) : (
                  <>
                    <Sparkles className="size-4" />
                    <span>Generate Copy</span>
                  </>
                )}
              </Button>
            </div>
            {generateError && (
              <p className="mt-4 text-center text-sm text-destructive">
                {generateError}
              </p>
            )}
          </section>
        )}

        {/* Generated Copy Cards */}
        {generatedCopy && (
          <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CopyCard
              title="Instagram Caption"
              content={generatedCopy.instagram_caption}
              hashtags={generatedCopy.instagram_hashtags}
              onCopy={() =>
                copyToClipboard(
                  `${generatedCopy.instagram_caption}\n\n${generatedCopy.instagram_hashtags.map((t) => `#${t}`).join(' ')}`,
                  'instagram'
                )
              }
              copied={copiedField === 'instagram'}
            />
            <CopyCard
              title="Website Description"
              content={generatedCopy.website_description}
              onCopy={() =>
                copyToClipboard(generatedCopy.website_description, 'website')
              }
              copied={copiedField === 'website'}
            />

            {/* Publish to Shopify */}
            <div className="flex flex-col items-center gap-3 pt-2">
              <Button
                onClick={handlePublish}
                disabled={isPublishing || publishSuccess}
                variant={publishSuccess ? 'outline' : 'default'}
                className="h-12 w-full max-w-sm gap-2"
              >
                {isPublishing ? (
                  <>
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
    </main>
  )
}

// FIX 1: CopyCard rebuilt without CardAction — copy button moved inline into CardHeader
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
        {/* FIX 1: Removed size="icon-sm" (invalid variant) — replaced with explicit sizing */}
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
        <p className="whitespace-pre-wrap text-foreground leading-relaxed">
          {content}
        </p>
        {hashtags && hashtags.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {hashtags.map((tag) => `#${tag}`).join(' ')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}