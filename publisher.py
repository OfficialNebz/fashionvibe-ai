"""
FashionVibe AI — Phase 3: Shopify Admin API Publisher
------------------------------------------------------
Endpoint : POST /publish
Purpose  : Writes generated website_description back to the live Shopify
           product listing via the Admin API (body_html field).

Security note
─────────────
store_name is NOT accepted as user input. It is resolved server-side from
the SHOPIFY_STORE_NAME environment variable. Accepting store identity from
a request body would allow any caller to target arbitrary third-party stores
with a stolen access token — a direct path to misuse.

Multi-tenant roadmap (Phase 4): store_name and access_token will be resolved
per authenticated user from encrypted Supabase records. The env-var approach
here is the correct single-tenant interim — not a shortcut.

Shopify API version: 2026-01 (stable)
Author   : FashionVibe AI Engineering
"""

import logging
import os

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
load_dotenv()

logger = logging.getLogger("fashionvibe.publisher")

# ── Credentials resolved server-side — never from request input ──────────
SHOPIFY_ACCESS_TOKEN: str | None = os.getenv("SHOPIFY_ACCESS_TOKEN")
SHOPIFY_STORE_NAME: str | None   = os.getenv("SHOPIFY_STORE_NAME")

# Validated at startup so misconfiguration fails loudly, not silently at runtime
if not SHOPIFY_ACCESS_TOKEN:
    raise RuntimeError(
        "SHOPIFY_ACCESS_TOKEN is not set. "
        "Add it to your .env: SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxx\n"
        "Generate one at: Shopify Admin → Settings → Apps → Develop apps"
    )
if not SHOPIFY_STORE_NAME:
    raise RuntimeError(
        "SHOPIFY_STORE_NAME is not set. "
        "Add it to your .env: SHOPIFY_STORE_NAME=your-store-handle\n"
        "This is the subdomain of your .myshopify.com URL — no spaces, no https://."
    )

SHOPIFY_API_VERSION = "2026-01"
PUBLISH_TIMEOUT_SECONDS = 15

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class PublishRequest(BaseModel):
    product_id: int = Field(
        ...,
        description="Shopify product ID extracted during /scrape. Found in ProductData.product_id.",
        examples=[8_142_903_246_123],
    )
    website_description: str = Field(
        ...,
        description="The AI-generated product description to write into the product's body_html.",
        min_length=10,
        max_length=5_000,
    )

    class Config:
        json_schema_extra = {
            "example": {
                "product_id": 8142903246123,
                "website_description": (
                    "The Silk Midi Dress is a study in restraint. "
                    "Conceived for the woman who has moved beyond trend cycles..."
                ),
            }
        }


class PublishResponse(BaseModel):
    success: bool
    product_id: int
    store: str                   # Returns store handle — never the token
    shopify_product_url: str     # Direct link to the product in Shopify Admin
    message: str
    error: str | None = None


# ---------------------------------------------------------------------------
# Admin API URL Builder
# ---------------------------------------------------------------------------
def build_admin_url(product_id: int) -> str:
    """
    Constructs the Shopify Admin REST API endpoint for a specific product.

    Pattern: https://{store}.myshopify.com/admin/api/{version}/products/{id}.json

    The store identity comes exclusively from the server-side env var —
    never from request input.
    """
    return (
        f"https://{SHOPIFY_STORE_NAME}.myshopify.com"
        f"/admin/api/{SHOPIFY_API_VERSION}"
        f"/products/{product_id}.json"
    )


def build_admin_dashboard_url(product_id: int) -> str:
    """Returns the Shopify Admin dashboard URL for the product (not the API URL)."""
    return (
        f"https://admin.shopify.com/store/{SHOPIFY_STORE_NAME}"
        f"/products/{product_id}"
    )


# ---------------------------------------------------------------------------
# Core Publish Logic
# ---------------------------------------------------------------------------
async def push_description_to_shopify(
    product_id: int,
    website_description: str,
) -> dict:
    """
    Sends a PUT request to the Shopify Admin API to update body_html.

    Why PUT and not PATCH:
    Shopify's REST Admin API uses PUT for product updates. It performs a
    partial update — only fields included in the payload are modified.
    Omitting variants, images, etc. does NOT delete them.

    Why body_html and not body:
    Shopify stores the description as HTML. We wrap plain text in <p> tags
    to preserve paragraph structure in the storefront renderer.
    Sending raw plain text causes the storefront to collapse all whitespace
    into a single unformatted block.
    """
    admin_url = build_admin_url(product_id)

    # ── Guard: catch unextracted product_id before hitting the API ───────────
    # product_id=0 means parse_shopify_product fell back to its default value.
    # The Admin API scrape may have returned an unexpected shape — surfacing
    # this here is far more useful than a cryptic 404 from Shopify.
    if product_id == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "product_id is 0 — the scraper did not extract a valid Shopify product ID. "
                "Re-scrape the product and check the FastAPI logs for [Admin API] output. "
                "The Admin API response may have returned an empty products array for that handle."
            ),
        )

    logger.info(
        f"Publishing — product_id={product_id} | store={SHOPIFY_STORE_NAME} | url={admin_url}"
    )

    # Wrap description in paragraph tags — preserves line breaks in storefront
    formatted_html = "".join(
        f"<p>{paragraph.strip()}</p>"
        for paragraph in website_description.split("\n")
        if paragraph.strip()
    )

    payload = {
        "product": {
            "id": product_id,
            "body_html": formatted_html,
        }
    }

    headers = {
        "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    logger.info(f"Publishing to Shopify Admin API — product_id={product_id} | store={SHOPIFY_STORE_NAME}")

    async with httpx.AsyncClient(timeout=PUBLISH_TIMEOUT_SECONDS) as client:
        try:
            response = await client.put(admin_url, json=payload, headers=headers)

            # ── Success ──────────────────────────────────────────────────
            if response.status_code == 200:
                logger.info(f"Shopify publish successful — product_id={product_id}")
                return response.json()

            # ── Auth failure ─────────────────────────────────────────────
            elif response.status_code == 401:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=(
                        "Shopify rejected the access token. "
                        "Verify SHOPIFY_ACCESS_TOKEN in your .env is current and has "
                        "'write_products' scope enabled."
                    ),
                )

            # ── Forbidden — token lacks write_products scope ──────────────
            elif response.status_code == 403:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Shopify denied the write request. "
                        "Your access token may be missing the 'write_products' permission. "
                        "In Shopify Admin → Apps → Your App → Configuration, "
                        "ensure 'write_products' is granted."
                    ),
                )

            # ── Product not found ─────────────────────────────────────────
            elif response.status_code == 404:
                # Capture Shopify's response body — it contains the exact reason.
                # Common causes:
                #   (a) product_id belongs to a different store than SHOPIFY_STORE_NAME
                #   (b) product was deleted after scraping
                #   (c) token has read_products but NOT write_products scope —
                #       Shopify returns 404 (not 403) for write attempts with read-only tokens
                #       on some API versions. Always ensure write_products is granted.
                try:
                    shopify_detail = response.json()
                except Exception:
                    shopify_detail = response.text[:200]

                logger.error(
                    f"Shopify 404 on PUT products/{product_id} — "
                    f"store={SHOPIFY_STORE_NAME} | shopify_response={shopify_detail}"
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=(
                        f"Shopify returned 404 for product_id={product_id} in store '{SHOPIFY_STORE_NAME}'. "
                        f"Shopify said: {shopify_detail}. "
                        "Most likely cause: your access token has read_products scope but is missing "
                        "write_products. Regenerate the token in Shopify Admin → Settings → "
                        "Apps → Develop apps → your app → API credentials, and ensure "
                        "write_products is checked under Admin API access scopes."
                    ),
                )

            # ── Rate limit (Shopify leaky bucket: 40 calls/sec) ───────────
            elif response.status_code == 429:
                retry_after = response.headers.get("Retry-After", "a few seconds")
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=(
                        f"Shopify API rate limit hit. "
                        f"Retry after {retry_after}. "
                        "Shopify's leaky bucket allows 40 requests/sec — this should be rare in single-user mode."
                    ),
                )

            # ── Shopify server error ──────────────────────────────────────
            elif response.status_code >= 500:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Shopify returned a server error ({response.status_code}). Try again in a moment.",
                )

            # ── Unexpected status ─────────────────────────────────────────
            else:
                logger.error(f"Unexpected Shopify status {response.status_code}: {response.text[:300]}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Unexpected response from Shopify ({response.status_code}). Check server logs.",
                )

        except httpx.TimeoutException:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=f"Shopify Admin API timed out after {PUBLISH_TIMEOUT_SECONDS}s.",
            )

        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Network error reaching Shopify Admin API: {str(exc)}",
            )


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/publish", tags=["Publishing"])


@router.post(
    "",
    response_model=PublishResponse,
    summary="Push AI-generated description directly to a live Shopify product listing",
    responses={
        200: {"description": "Description published successfully"},
        401: {"description": "Invalid or expired Shopify access token"},
        403: {"description": "Token lacks write_products permission"},
        404: {"description": "Product ID not found in configured store"},
        429: {"description": "Shopify API rate limit reached"},
        502: {"description": "Shopify returned an unexpected error"},
        504: {"description": "Shopify Admin API request timed out"},
    },
)
async def publish_description(request: PublishRequest) -> PublishResponse:
    """
    Writes the AI-generated `website_description` into the `body_html` field
    of the target Shopify product via the Admin REST API.

    **Prerequisites:**
    - `SHOPIFY_ACCESS_TOKEN` set in `.env` (requires `write_products` scope)
    - `SHOPIFY_STORE_NAME` set in `.env` (e.g. `my-brand` for my-brand.myshopify.com)
    - `product_id` must belong to the store configured server-side

    **Why `product_id` is not cross-referenced with store at request time:**
    The 404 response from Shopify itself is the authoritative check —
    adding a pre-flight lookup would double the API calls with no added safety.
    """
    await push_description_to_shopify(
        product_id=request.product_id,
        website_description=request.website_description,
    )

    dashboard_url = build_admin_dashboard_url(request.product_id)

    return PublishResponse(
        success=True,
        product_id=request.product_id,
        store=SHOPIFY_STORE_NAME,
        shopify_product_url=dashboard_url,
        message=(
            f"Description successfully published to product {request.product_id} "
            f"in store '{SHOPIFY_STORE_NAME}'. "
            f"Changes are live on your storefront immediately."
        ),
    )