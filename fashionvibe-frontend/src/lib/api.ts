/**
 * FashionVibe AI — Typed API Client
 * -----------------------------------
 * Single source of truth for all backend communication and shared types.
 * Persona strings are spelled exactly as the backend Python Enum values.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000'

// ---------------------------------------------------------------------------
// Persona type — 15 strings matching generator.py Persona enum exactly.
// Any mismatch here will surface as a compile-time error, not a runtime one.
// ---------------------------------------------------------------------------
export type Persona =
  // Women
  | 'Exquisite'
  | 'Ladylike'
  | 'Street Vibes'
  | 'Minimalist Chic'
  | 'Eco-Conscious'
  // Men
  | 'The Executive'
  | 'Hypebeast'
  | 'The Rugged'
  | 'Tailored Modern'
  | 'The Minimalist'
  // Children
  | 'Playful & Bright'
  | 'The Mini-Me'
  | 'Durable Adventure'
  | 'Whimsical Tale'
  | 'Soft & Pure'

// ---------------------------------------------------------------------------
// PERSONA_GROUPS
// ---------------------------------------------------------------------------
// `satisfies Record<string, Persona[]>` validates every value in the object
// is a Persona literal without widening the inferred type to `string`.
// This is what prevents "Type 'X' is not comparable to type 'Persona'" —
// TypeScript keeps the literal types narrow while still type-checking the shape.
//
// Do NOT use `as const` alone here — it makes keys and values readonly but
// does not validate that the values are members of the Persona union.
// Do NOT use `Record<string, Persona[]>` as a direct annotation — it widens.
// ---------------------------------------------------------------------------
export const PERSONA_GROUPS = {
  WOMEN: [
    'Exquisite',
    'Ladylike',
    'Street Vibes',
    'Minimalist Chic',
    'Eco-Conscious',
  ],
  MEN: [
    'The Executive',
    'Hypebeast',
    'The Rugged',
    'Tailored Modern',
    'The Minimalist',
  ],
  CHILDREN: [
    'Playful & Bright',
    'The Mini-Me',
    'Durable Adventure',
    'Whimsical Tale',
    'Soft & Pure',
  ],
} satisfies Record<string, Persona[]>

// Flat array — for cases where grouping isn't needed
export const PERSONAS: Persona[] = [
  ...PERSONA_GROUPS.WOMEN,
  ...PERSONA_GROUPS.MEN,
  ...PERSONA_GROUPS.CHILDREN,
]

// ---------------------------------------------------------------------------
// Domain types — mirror FastAPI Pydantic schemas exactly
// ---------------------------------------------------------------------------
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
export interface ScrapeResponse {
  success: boolean
  product: ProductData | null
  error: string | null
}

export interface GenerateResponse {
  success: boolean
  persona_used: string
  product_title: string
  copy: GeneratedCopy | null
  error: string | null
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
// Error class — carries HTTP status for branched error handling in components
// ---------------------------------------------------------------------------
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// ---------------------------------------------------------------------------
// Internal fetch wrapper
// ---------------------------------------------------------------------------
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    try {
      const body = await response.json()
      if (body?.detail) {
        message = typeof body.detail === 'string'
          ? body.detail
          : JSON.stringify(body.detail)
      }
    } catch { /* non-JSON body — use default message */ }
    throw new ApiError(response.status, message)
  }

  return response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function scrapeProduct(url: string): Promise<ProductData> {
  const data = await apiFetch<ScrapeResponse>('/scrape', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
  if (!data.success || !data.product) {
    throw new ApiError(500, data.error ?? 'Scrape returned no product data.')
  }
  return data.product
}

export async function generateCopy(
  product: ProductData,
  persona: Persona,
): Promise<GeneratedCopy> {
  const data = await apiFetch<GenerateResponse>('/generate', {
    method: 'POST',
    body: JSON.stringify({ product, persona }),
  })
  if (!data.success || !data.copy) {
    throw new ApiError(500, data.error ?? 'Generate returned no copy.')
  }
  return data.copy
}

/**
 * Publishes the website description to Shopify.
 * Accepts the current textarea value — not the original AI output —
 * so founder edits are preserved before going live.
 */
export async function publishDescription(
  productId: number,
  websiteDescription: string,
): Promise<PublishResponse> {
  const data = await apiFetch<PublishResponse>('/publish', {
    method: 'POST',
    body: JSON.stringify({
      product_id: productId,
      website_description: websiteDescription,
    }),
  })
  if (!data.success) {
    throw new ApiError(500, data.error ?? 'Publish failed with no error detail.')
  }
  return data
}
