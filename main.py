"""
FashionVibe AI — Main Application Entry Point
----------------------------------------------
Mounts:
  /scrape    → Phase 1: Shopify product data extraction
  /generate  → Phase 2: AI persona copy generation
  /publish   → Phase 3: Shopify Admin API write-back

Run locally : uvicorn main:app --reload
Run on Render: uvicorn main:app --host 0.0.0.0 --port $PORT
"""

import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from generator import router as generate_router
from publisher import router as publish_router
from scraper import app as scraper_app  # noqa: F401

load_dotenv()

# ---------------------------------------------------------------------------
# Rate Limiter
# ---------------------------------------------------------------------------
# Keyed on IP address. Limits are applied per-route with the @limiter.limit
# decorator on each endpoint. SlowAPIMiddleware injects the limiter into state.
limiter = Limiter(key_func=get_remote_address, default_limits=[])

# ---------------------------------------------------------------------------
# CORS — environment-aware
# ---------------------------------------------------------------------------
# ALLOWED_ORIGINS is a comma-separated string set in your environment:
#   Local .env  → ALLOWED_ORIGINS=http://localhost:3000
#   Render      → ALLOWED_ORIGINS=http://localhost:3000,https://your-app.vercel.app
#
# Falls back to localhost only if the variable is not set.
# Never use ["*"] in production — it allows any website to call your API.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS = [origin.strip() for origin in _raw_origins.split(",") if origin.strip()]

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="NeboCollections AI",
    description=(
        "Shopify-to-Social pipeline. "
        "Scrape any Shopify product → generate high-converting persona-styled copy "
        "→ publish directly back to your live Shopify storefront."
    ),
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Rate-limited scrape route
# ---------------------------------------------------------------------------
# Overrides the /scrape route from scraper.py with a rate-limited wrapper.
# 3 requests per IP per 12 hours — enough for a genuine demo evaluation,
# tight enough to prevent abuse before auth is implemented.

@app.post("/scrape", include_in_schema=False)
@limiter.limit("3/12hours")
async def scrape_limited(request: Request):
    """Rate-limited proxy to the scraper. Delegates to scraper logic after check."""
    from scraper import scrape_product, ScrapeRequest
    body = await request.json()
    scrape_request = ScrapeRequest(**body)
    return await scrape_product(scrape_request)


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "error": (
                "You have used all 3 demo scrapes for the next 12 hours. "
                "Contact support to unlock the full pipeline."
            ),
        },
    )


# ---------------------------------------------------------------------------
# Mount routers
# ---------------------------------------------------------------------------
# Scraper: re-register the /scrape route from scraper.py
for route in scraper_app.routes:
    app.routes.append(route)

# Generator and Publisher routers
app.include_router(generate_router)
app.include_router(publish_router)


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "FashionVibe AI",
        "version": "3.0.0",
        "pipeline": "scrape → generate → publish",
        "endpoints": {
            "scrape":   "POST /scrape   — Extract product data from a Shopify URL",
            "generate": "POST /generate — Generate persona-styled copy from product data",
            "publish":  "POST /publish  — Push generated description to live Shopify storefront",
            "docs":     "GET  /docs     — Interactive API documentation",
        },
    }

