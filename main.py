"""
FashionVibe AI — Main Application Entry Point
----------------------------------------------
Mounts:
  /scrape    → Phase 1: Shopify product data extraction
  /generate  → Phase 2: AI persona copy generation

Run with:
  uvicorn main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the router from generator (scraper exposes its app directly for now)
from generator import router as generate_router
from publisher import router as publisher_router

# ---------------------------------------------------------------------------
# Re-export scraper routes by importing and including them
# ---------------------------------------------------------------------------
from scraper import app as scraper_app  # noqa: F401 — we mount its routes below

app = FastAPI(
    title="FashionVibe AI",
    description=(
        "Shopify-to-Social pipeline. "
        "Scrape any Shopify product → generate high-converting "
        "persona-styled copy for Instagram and your product page."
    ),
    version="2.0.0",
    docs_url="/docs",      # Swagger UI at /docs
    redoc_url="/redoc",    # ReDoc at /redoc
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Lock to your frontend domain before production deploy
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# Mount routes
# Scraper: re-register the /scrape route from scraper.py
for route in scraper_app.routes:
    app.routes.append(route)

# Generator: include the router
app.include_router(generate_router)
app.include_router(publisher_router)


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------
@app.get("/", include_in_schema=False)
async def root():
    return {
        "service": "FashionVibe AI",
        "version": "2.0.0",
        "endpoints": {
            "scrape":   "POST /scrape   — Extract product data from a Shopify URL",
            "generate": "POST /generate — Generate persona-styled copy from product data",
            "docs":     "GET  /docs     — Interactive API documentation",
        },
    }
