/**
 * FashionVibe AI — Typed API Client
 * ----------------------------------
 * Single source of truth for all backend communication.
 * Types mirror the FastAPI Pydantic schemas exactly — keep them in sync.
 *
 * Usage in any component or page:
 *   import { scrapeProduct, generateCopy, publishDescription } from '@/lib/api'
 *
 * Usage when prompting v0 / Lovable:
 *   Paste this entire file into your prompt context so the AI builder
 *   generates components with correct data shapes from the start.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

// ---------------------------------------------------------------------------
// Types — mirroring FastAPI Pydantic schemas
// ---------------------------------------------------------------------------

export type Persona = 'Exquisite' | 'Ladylike' | 'Street Vibes' | 'Minimalist Chic'

export interface VariantData {
  id: number
  title: string
  price: string
  sku: string | null
  available: boolean
  inventory_quantity: number | null
}

export interface ImageData {
  position: number
  src: string
  alt: string | null
  width: number | null
  height: number | null
}

export interface ProductData {
  product_id: number
  title: string
  description_raw: string
  description_html: string
  product_type: string | null
  vendor: string | null
  tags: string[]
  images: ImageData[]
  variants: VariantData[]
  source_url: string
  products_json_url: string
}

export interface GeneratedCopy {
  instagram_caption: string
  instagram_hashtags: string[]
  website_description: string
  copy_notes: string
}

// ---------------------------------------------------------------------------
// Request / Response shapes
// ---------------------------------------------------------------------------

export interface ScrapeRequest {
  url: string
}

export interface ScrapeResponse {
  success: boolean
  product: ProductData | null
  error: string | null
}

export interface GenerateRequest {
  product: ProductData
  persona: Persona
}

export interface GenerateResponse {
  success: boolean
  persona_used: string
  product_title: string
  copy: GeneratedCopy | null
  error: string | null
}

export interface PublishRequest {
  product_id: number
  website_description: string
}

export interface PublishResponse {
  success: boolean
  product_id: number
  store: string
  shopify_product_url: string
  message: string
  error: string | null
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

/**
 * Structured error thrown by all API functions.
 * Carries the HTTP status so components can branch on 401, 404, 429 etc.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Internal fetch wrapper.
 * - Injects base URL
 * - Sets Content-Type header
 * - Throws ApiError on non-2xx with the backend's detail message
 */
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    // FastAPI returns { detail: "..." } on errors — surface that message directly
    let message = `Request failed with status ${response.status}`
    try {
      const body = await response.json()
      if (body?.detail) {
        message = typeof body.detail === 'string'
          ? body.detail
          : JSON.stringify(body.detail)
      }
    } catch {
      // Response body wasn't JSON — use the default message
    }
    throw new ApiError(response.status, message)
  }

  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// API Functions
// ---------------------------------------------------------------------------

/**
 * POST /scrape
 * Extracts structured product data from a Shopify product URL.
 *
 * @throws ApiError(400) — URL is not a valid Shopify product page
 * @throws ApiError(403) — Store is password-protected
 * @throws ApiError(404) — Product not found at that URL
 * @throws ApiError(504) — Store request timed out
 */
export async function scrapeProduct(url: string): Promise<ProductData> {
  const body: ScrapeRequest = { url }

  const data = await apiFetch<ScrapeResponse>('/scrape', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!data.success || !data.product) {
    throw new ApiError(500, data.error ?? 'Scrape returned no product data.')
  }

  return data.product
}

/**
 * POST /generate
 * Generates persona-styled Instagram caption and website description.
 * Currently runs against the mock — live Gemini when billing is resolved.
 *
 * @throws ApiError(422) — Invalid persona value
 * @throws ApiError(503) — AI service unavailable
 */
export async function generateCopy(
  product: ProductData,
  persona: Persona,
): Promise<GeneratedCopy> {
  const body: GenerateRequest = { product, persona }

  const data = await apiFetch<GenerateResponse>('/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!data.success || !data.copy) {
    throw new ApiError(500, data.error ?? 'Generate returned no copy.')
  }

  return data.copy
}

/**
 * POST /publish
 * Pushes the generated website_description to the live Shopify storefront.
 *
 * @throws ApiError(401) — Invalid or expired Shopify access token
 * @throws ApiError(403) — Token missing write_products scope
 * @throws ApiError(404) — product_id not found in configured store
 * @throws ApiError(429) — Shopify rate limit hit
 */
export async function publishDescription(
  productId: number,
  websiteDescription: string,
): Promise<PublishResponse> {
  const body: PublishRequest = {
    product_id: productId,
    website_description: websiteDescription,
  }

  const data = await apiFetch<PublishResponse>('/publish', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!data.success) {
    throw new ApiError(500, data.error ?? 'Publish failed with no error detail.')
  }

  return data
}

/**
 * All available personas as a typed array.
 * Use this to render the persona selector — guarantees UI stays in sync with
 * the backend enum without manual duplication.
 */
export const PERSONAS: Persona[] = [
  'Exquisite',
  'Ladylike',
  'Street Vibes',
  'Minimalist Chic',
]
