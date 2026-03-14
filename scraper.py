"""
FashionVibe AI — Phase 1: Shopify Product Scraper
--------------------------------------------------
Endpoint : POST /scrape
Strategy : Primary → Shopify /products.json
           Fallback → UCP /.well-known/ucp (future-ready, not load-bearing)
Author   : FashionVibe AI Engineering
"""

import os
import re
import html
import logging
from urllib.parse import urlparse, urlunparse

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl, field_validator

load_dotenv()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("fashionvibe.scraper")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="FashionVibe AI — Scraper",
    description="Transforms a Shopify product URL into clean, structured product data.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Lock this down to your frontend domain in production
    allow_methods=["POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
REQUEST_TIMEOUT_SECONDS = 10
MAX_IMAGES = 10          # Cap image extraction — we don't need 80 colour-swatch shots
MAX_VARIANTS = 50        # Sanity limit for large catalogues

# ---------------------------------------------------------------------------
# Owner store credentials — loaded from .env for Admin API fallback
# ---------------------------------------------------------------------------
# Used exclusively when the incoming URL belongs to the owner's own store
# (e.g. a password-protected development store). Never applied to third-party URLs.
SHOPIFY_STORE_NAME   = os.getenv("SHOPIFY_STORE_NAME")    # e.g. "nebocollective"
SHOPIFY_ACCESS_TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN")  # shpat_...
SHOPIFY_API_VERSION  = "2026-01"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ScrapeRequest(BaseModel):
    url: HttpUrl

    @field_validator("url", mode="before")
    @classmethod
    def must_be_shopify_compatible(cls, v: str) -> str:
        """
        Accepts:
          - https://brand.myshopify.com/products/silk-midi-dress
          - https://www.custombrand.com/products/silk-midi-dress
        Rejects:
          - Homepage URLs with no /products/ path
          - Non-HTTP(S) schemes
        """
        parsed = urlparse(str(v))
        if parsed.scheme not in ("http", "https"):
            raise ValueError("URL must use http or https.")
        if "/products/" not in parsed.path:
            raise ValueError(
                "URL must point to a specific product page "
                "(must contain '/products/' in the path)."
            )
        return str(v)


class VariantData(BaseModel):
    id: int
    title: str
    price: str
    sku: str | None
    available: bool
    inventory_quantity: int | None


class ImageData(BaseModel):
    position: int
    src: str
    alt: str | None
    width: int | None
    height: int | None


class ProductData(BaseModel):
    product_id: int              # Shopify's internal product ID — required for Admin API writes
    title: str
    description_raw: str        # Cleaned plain text — HTML stripped
    description_html: str       # Preserved for downstream rendering if needed
    product_type: str | None
    vendor: str | None
    tags: list[str]
    images: list[ImageData]
    variants: list[VariantData]
    source_url: str
    products_json_url: str      # The exact endpoint we hit — transparency for debugging


class ScrapeResponse(BaseModel):
    success: bool
    product: ProductData | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# HTML Cleaning Utility
# ---------------------------------------------------------------------------
def strip_html(raw_html: str) -> str:
    """
    Strips HTML tags and decodes HTML entities from a raw HTML string.

    Steps:
      1. Decode HTML entities (&amp; → &, &nbsp; → space, etc.)
      2. Strip all HTML tags via regex
      3. Collapse excess whitespace into single newlines
    """
    if not raw_html:
        return ""

    # Decode entities first so &amp;nbsp; doesn't survive the tag strip
    decoded = html.unescape(raw_html)

    # Replace block-level tags with newlines before stripping
    # so "Fabric<br>100% Silk" → "Fabric\n100% Silk" not "Fabric100% Silk"
    block_tags = re.compile(
        r"<(?:br\s*/?|/p|/div|/li|/h[1-6]|/tr|/td|/th)[^>]*>",
        re.IGNORECASE,
    )
    with_newlines = block_tags.sub("\n", decoded)

    # Strip all remaining HTML tags
    no_tags = re.sub(r"<[^>]+>", "", with_newlines)

    # Normalise whitespace — collapse multiple spaces/tabs, max 2 consecutive newlines
    cleaned = re.sub(r"[ \t]+", " ", no_tags)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# ---------------------------------------------------------------------------
# URL Builder
# ---------------------------------------------------------------------------
def build_products_json_url(product_url: str) -> str:
    """
    Derives the /products.json URL from a product page URL.

    /products/silk-midi-dress         →  /products/silk-midi-dress.json
    /products/silk-midi-dress?variant=123  →  /products/silk-midi-dress.json
    /collections/new/products/silk-midi-dress  →  /products/silk-midi-dress.json

    Shopify's .json suffix on the product path is the most reliable single-product
    endpoint. The store-level /products.json returns a paginated catalogue — we
    want the product-level .json.
    """
    parsed = urlparse(product_url)

    # Extract just the /products/handle portion — strip query params & fragments
    # and any collection prefix like /collections/summer/products/handle
    path = parsed.path.rstrip("/")
    products_index = path.rfind("/products/")
    if products_index == -1:
        raise ValueError("Cannot locate '/products/' segment in URL path.")

    product_path = path[products_index:]          # → /products/silk-midi-dress
    json_path = product_path + ".json"             # → /products/silk-midi-dress.json

    json_url = urlunparse((
        parsed.scheme,
        parsed.netloc,
        json_path,
        "",   # params
        "",   # query — intentionally stripped
        "",   # fragment
    ))
    return json_url


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------
def parse_shopify_product(raw: dict, source_url: str, json_url: str) -> ProductData:
    """
    Parses the raw Shopify product JSON into our clean ProductData schema.

    Shopify wraps the product under a top-level "product" key.
    """
    product = raw.get("product", {})

    if not product:
        raise ValueError("Response contained no 'product' key — may not be a Shopify store.")

    # --- Description ---
    body_html: str = product.get("body_html") or ""
    description_clean = strip_html(body_html)

    # --- Images (capped) ---
    raw_images: list[dict] = product.get("images", [])[:MAX_IMAGES]
    images = [
        ImageData(
            position=img.get("position", idx + 1),
            src=img.get("src", ""),
            alt=img.get("alt"),
            width=img.get("width"),
            height=img.get("height"),
        )
        for idx, img in enumerate(raw_images)
        if img.get("src")   # skip images with no src
    ]

    # --- Variants (capped) ---
    raw_variants: list[dict] = product.get("variants", [])[:MAX_VARIANTS]
    variants = [
        VariantData(
            id=v.get("id", 0),
            title=v.get("title", "Default"),
            price=v.get("price", "0.00"),
            sku=v.get("sku") or None,
            available=v.get("available", False),
            inventory_quantity=v.get("inventory_quantity"),
        )
        for v in raw_variants
    ]

    # --- Tags ---
    raw_tags = product.get("tags", "")
    tags = [t.strip() for t in raw_tags.split(",")] if isinstance(raw_tags, str) else raw_tags

    return ProductData(
        product_id=product.get("id", 0),   # Shopify's canonical integer product ID
        title=product.get("title", "Untitled Product"),
        description_raw=description_clean,
        description_html=body_html,
        product_type=product.get("product_type") or None,
        vendor=product.get("vendor") or None,
        tags=[t for t in tags if t],   # filter empty strings
        images=images,
        variants=variants,
        source_url=source_url,
        products_json_url=json_url,
    )


# ---------------------------------------------------------------------------
# Owner Store Detection
# ---------------------------------------------------------------------------

def is_owner_store(product_url: str) -> bool:
    """
    Returns True if the URL belongs to the owner's own configured store.

    Matches both:
      - https://nebocollective.myshopify.com/...
      - https://nebocollective.com/...  (custom domain — if SHOPIFY_STORE_NAME is set)

    Only activates the Admin API path when SHOPIFY_STORE_NAME and
    SHOPIFY_ACCESS_TOKEN are both configured. If either is missing,
    returns False and falls through to the public scraper as normal.
    """
    if not SHOPIFY_STORE_NAME or not SHOPIFY_ACCESS_TOKEN:
        return False

    parsed = urlparse(product_url)
    hostname = parsed.netloc.lower()

    # Match myshopify.com subdomain
    if f"{SHOPIFY_STORE_NAME.lower()}.myshopify.com" in hostname:
        return True

    # Match exact store name as custom domain prefix
    # e.g. nebocollective.com or www.nebocollective.com
    if hostname == f"{SHOPIFY_STORE_NAME.lower()}.com" or        hostname == f"www.{SHOPIFY_STORE_NAME.lower()}.com":
        return True

    return False


def extract_product_handle(product_url: str) -> str:
    """Extracts the product handle from a Shopify product URL path."""
    parsed = urlparse(product_url)
    path = parsed.path.rstrip("/")
    products_index = path.rfind("/products/")
    if products_index == -1:
        raise ValueError("Cannot locate '/products/' in URL path.")
    # e.g. /products/silk-midi-dress  →  silk-midi-dress
    handle = path[products_index + len("/products/"):]
    # Strip any trailing variant or query segments
    handle = handle.split("?")[0].split("#")[0]
    return handle


# ---------------------------------------------------------------------------
# Admin API Fetch (owner's password-protected store)
# ---------------------------------------------------------------------------

async def fetch_via_admin_api(product_url: str) -> ProductData:
    """
    Fetches product data via the Shopify Admin REST API.
    Used exclusively for the owner's own store when it is password-protected.

    Strategy: look up the product by its URL handle using the Admin API's
    handle filter: GET /admin/api/{version}/products.json?handle={handle}

    This returns the full product object identically to the public .json
    endpoint — same shape, same parser, zero code duplication.
    """
    handle = extract_product_handle(product_url)

    admin_url = (
        f"https://{SHOPIFY_STORE_NAME}.myshopify.com"
        f"/admin/api/{SHOPIFY_API_VERSION}"
        f"/products.json?handle={handle}&limit=1"
    )

    headers = {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Accept": "application/json",
    }

    logger.info(f"[Admin API] Fetching via Admin API for owner store — handle='{handle}'")

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        try:
            response = await client.get(admin_url, headers=headers)

            if response.status_code == 200:
                data = response.json()
                products = data.get("products", [])

                if not products:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"No product found with handle '{handle}' in store '{SHOPIFY_STORE_NAME}'.",
                    )

                # Admin API /products.json wraps in "products" array —
                # rewrap as {"product": ...} so parse_shopify_product works unchanged
                raw = {"product": products[0]}
                json_url = admin_url
                return parse_shopify_product(raw, product_url, json_url)

            elif response.status_code == 401:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Admin API token rejected. Verify SHOPIFY_ACCESS_TOKEN in your .env.",
                )

            elif response.status_code == 403:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admin API token lacks read_products scope.",
                )

            else:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Admin API returned unexpected status {response.status_code}.",
                )

        except httpx.TimeoutException:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Admin API request timed out.",
            )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Network error reaching Admin API: {str(exc)}",
            )


# ---------------------------------------------------------------------------
# Core Fetch Logic
# ---------------------------------------------------------------------------
async def fetch_shopify_product(product_url: str) -> ProductData:
    """
    Routing logic:
      1. Owner's own store (detected via SHOPIFY_STORE_NAME match)
         → Admin API fetch. Bypasses password protection entirely.
      2. All other public Shopify stores
         → Public /products/<handle>.json endpoint.
    """
    # ── Route: owner store → Admin API ──────────────────────────────────────
    if is_owner_store(product_url):
        logger.info("[Admin API] Owner store detected — routing to Admin API.")
        return await fetch_via_admin_api(product_url)

    # ── Route: public store → public .json endpoint ──────────────────────────
    logger.info("[Public] External store — using public scraper.")
    json_url = build_products_json_url(product_url)
    logger.info(f"Fetching: {json_url}")

    headers = {
        "User-Agent": "FashionVibe-AI/1.0 (product content extraction)",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=True) as client:

        # ── Primary: /products/<handle>.json ──────────────────────────────
        try:
            response = await client.get(json_url, headers=headers)

            if response.status_code == 200:
                raw = response.json()
                return parse_shopify_product(raw, product_url, json_url)

            elif response.status_code == 401:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This store is password-protected. FashionVibe AI cannot access private storefronts.",
                )

            elif response.status_code == 404:
                # Product handle not found — don't bother with UCP, it won't help
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Product not found at '{json_url}'. Check the URL is a live product page.",
                )

            else:
                logger.warning(
                    f"Unexpected status {response.status_code} from Shopify endpoint. "
                    "Attempting UCP fallback."
                )
                # ── Fallback: UCP /.well-known/ucp ────────────────────────
                # Phase 2 enhancement. For now, we surface the original error.
                # TODO: implement UCP parse when adoption reaches >10% of target stores.
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        f"Shopify endpoint returned {response.status_code}. "
                        "UCP fallback is a planned Phase 2 enhancement. "
                        "Please verify the URL and try again."
                    ),
                )

        except httpx.TimeoutException:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"Request to store timed out after {REQUEST_TIMEOUT_SECONDS}s. The store may be slow or offline.",
            )

        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Network error reaching store: {str(exc)}",
            )


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------
@app.post(
    "/scrape",
    response_model=ScrapeResponse,
    summary="Extract structured product data from a Shopify product URL",
    responses={
        200: {"description": "Product data extracted successfully"},
        400: {"description": "Invalid or non-product URL"},
        403: {"description": "Store is password-protected"},
        404: {"description": "Product not found"},
        502: {"description": "Could not reach or parse the store"},
        504: {"description": "Store request timed out"},
    },
)
async def scrape_product(request: ScrapeRequest) -> ScrapeResponse:
    """
    Accepts a Shopify product URL and returns structured product data.

    **Input:** `{ "url": "https://brand.myshopify.com/products/silk-midi-dress" }`

    **Returns:** Title, cleaned description, images, variants, tags, vendor.
    """
    product = await fetch_shopify_product(str(request.url))
    return ScrapeResponse(success=True, product=product)


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------
@app.get("/health", include_in_schema=False)
async def health() -> dict:
    return {"status": "ok", "service": "fashionvibe-scraper"}