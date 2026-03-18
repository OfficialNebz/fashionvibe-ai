"""
FashionVibe AI — Main Application Entry Point
----------------------------------------------
Mounts:
  /scrape    → Phase 1: Shopify product data extraction
  /generate  → Phase 2: AI persona copy generation
  /publish   → Phase 3: Shopify Admin API write-back

Rate limiting: handled client-side via localStorage in page.tsx.
               SlowAPI removed — was blocking demo IPs behind shared proxies.

Run locally : uvicorn main:app --reload
Run on Render: uvicorn main:app --host 0.0.0.0 --port $PORT
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from generator import router as generate_router
from publisher import router as publish_router
from scraper import app as scraper_app  # noqa: F401

load_dotenv()

# ---------------------------------------------------------------------------
# CORS — environment-aware
# ---------------------------------------------------------------------------
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS = [origin.strip() for origin in _raw_origins.split(",") if origin.strip()]

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="FashionVibe AI",
    description=(
        "Shopify-to-Social pipeline. "
        "Scrape any Shopify product → generate high-converting persona-styled copy "
        "→ publish directly back to your live Shopify storefront."
    ),
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Mount routers
# ---------------------------------------------------------------------------
for route in scraper_app.routes:
    app.routes.append(route)

app.include_router(generate_router)
app.include_router(publish_router)


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "NeboCollections AI",
        "version": "3.0.0",
        "pipeline": "scrape → generate → publish",
        "endpoints": {
            "scrape":   "POST /scrape   — Extract product data from a Shopify URL",
            "generate": "POST /generate — Generate persona-styled copy from product data",
            "publish":  "POST /publish  — Push generated description to live Shopify storefront",
            "docs":     "GET  /docs     — Interactive API documentation",
        },
    }