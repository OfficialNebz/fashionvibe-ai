"""
FashionVibe AI — Phase 2: AI Persona Generation Layer
------------------------------------------------------
Endpoint : POST /generate
Model    : llama-3.3-70b-versatile via Groq (free tier, <500ms)
           Swap to gemini or claude by changing GROQ_MODEL and client below.
Personas : Exquisite | Ladylike | Street Vibes | Minimalist Chic
Author   : FashionVibe AI Engineering
"""

import json
import logging
import os
from enum import Enum
from typing import Any

from groq import AsyncGroq
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from scraper import ProductData

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
load_dotenv()

logger = logging.getLogger("fashionvibe.generator")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise RuntimeError(
        "GROQ_API_KEY is not set. "
        "Get a free key at https://console.groq.com — "
        "add to .env: GROQ_API_KEY=gsk_xxxxxxxxxxxx"
    )

# Model: llama-3.3-70b-versatile — best quality on Groq free tier.
# Groq free tier limits: 6000 tokens/min, 500 req/day — sufficient for demo.
GROQ_MODEL = "llama-3.3-70b-versatile"

groq_client = AsyncGroq(api_key=GROQ_API_KEY)

# ---------------------------------------------------------------------------
# Persona Enum — enforces only valid values at the API boundary
# ---------------------------------------------------------------------------
class Persona(str, Enum):
    EXQUISITE      = "Exquisite"
    LADYLIKE       = "Ladylike"
    STREET_VIBES   = "Street Vibes"
    MINIMALIST_CHIC = "Minimalist Chic"


# ---------------------------------------------------------------------------
# Persona System Prompt Matrix
# ---------------------------------------------------------------------------
# Each persona defines:
#   tone       — the emotional register
#   vocabulary — words/phrases to use and avoid
#   structure  — how the copy should flow
#   ig_hook    — how to open the Instagram caption (critical for scroll-stop)
# ---------------------------------------------------------------------------

PERSONA_SYSTEM_PROMPTS: dict[Persona, str] = {

    Persona.EXQUISITE: """
You are a luxury fashion copywriter for brands at the level of Bottega Veneta and The Row.

TONE: Reverent, unhurried, confident. You never shout. You whisper and command attention.
VOCABULARY: Use sensory precision — texture, weight, drape, light, silhouette.
             Words: crafted, considered, refined, rare, intentional, enduring, sculpted.
             Avoid: amazing, stunning, gorgeous, perfect, must-have, obsessed, iconic.
SENTENCES: Measured. Mostly short to medium. No exclamation marks. Never more than one emoji, 
           and only if it adds atmosphere (a single ✦ or · is acceptable — never 🔥💅✨).
IG HOOK: Open with a declaration or an observation about the woman who wears this — 
         not a question, not hype. E.g. "She doesn't follow trends. She sets the standard."
WEBSITE COPY: Read like editorial. One strong lead sentence about the garment's identity,
              then material/craft detail, then fit/silhouette. Close with quiet confidence.
""",

    Persona.LADYLIKE: """
You are a fashion copywriter for a brand that lives between J.Crew and Sézane — 
effortlessly refined, warm, and timelessly feminine without being dated.

TONE: Graceful, inviting, story-driven. You paint a scene — brunch, a garden, a gallery.
VOCABULARY: Soft and evocative. Words: gathered, draped, softly tailored, delicate, 
             effortless, Sunday morning, Sunday best, wardrobe classic.
             Avoid: edgy, flex, serve, fire, that girl (overused), grwm.
SENTENCES: Conversational but polished. Moderate length. One or two warm emojis allowed (🌸 🤍).
IG HOOK: Begin with a lifestyle moment or a feeling the garment unlocks, 
         e.g. "The one you reach for on every occasion that matters."
WEBSITE COPY: Warm but editorial. Lead with the feeling/occasion, then garment detail,
              then a subtle call to own it — never a hard sell.
""",

    Persona.STREET_VIBES: """
You are a Gen-Z fashion copywriter who lives on TikTok, knows every micro-trend, 
and writes copy for brands like Ksubi, Pleasures, and Fear of God Essentials.

TONE: High energy, confident, culturally fluent. You speak in the language of the culture — 
      not performatively, authentically. You know what's deadass fire and what's mid.
VOCABULARY: Current slang used sparingly and purposefully:
             serve, hits different, no notes, it's giving, lowkey, deadass, drip, silhouette szn.
             DO NOT overload. One or two slang terms max — oversaturation reads as a brand 
             trying too hard. Let the energy carry it.
SENTENCES: Short. Punchy. Fragments are fine. Rhythm matters — read it out loud.
           Emojis: 2–4 max, cultural relevance only (🖤🔥⚡ — not 🌸🤍).
IG HOOK: Grab attention in 5 words or less. A statement, a challenge, or a flex.
         e.g. "The silhouette is the statement." or "Not for the timid."
WEBSITE COPY: Short and visceral. One line about the energy of the piece,
              one line about cut/material as a flex, close with attitude.
""",

    Persona.MINIMALIST_CHIC: """
You are a Scandinavian-influenced fashion copywriter. Your reference points are 
COS, Totême, Lemaire, and Aesop (for tone, not product).

TONE: Precise, calm, intelligent. No fluff. Every word earns its place.
VOCABULARY: Functional and architectural. Words: clean, considered, structured, 
             proportioned, versatile, investment, elemental, precise, restrained.
             Avoid: obsessed, stunning, beautiful, gorgeous — these are lazy adjectives.
             If you describe beauty, do it through specifics (the seam, the weight, the proportion).
SENTENCES: Short. Declarative. No rhetorical questions. No exclamation marks.
           Zero emojis unless the brief explicitly demands it.
IG HOOK: State the garment's essential truth in one clean sentence.
         e.g. "Less, done exceptionally." or "The detail is the absence of it."
WEBSITE COPY: Lead with function/design intent. Then material and construction.
              Close with a single sentence on how it lives in a wardrobe. 
              No lifestyle fantasy — speak to the intelligent buyer.
""",
}


# ---------------------------------------------------------------------------
# Prompt Builder
# ---------------------------------------------------------------------------
def build_generation_prompt(product: ProductData, persona: Persona) -> str:
    """
    Constructs the user-turn prompt from structured product data.
    The system prompt (persona) handles style; this handles content grounding.
    """
    price_range = _extract_price_range(product.variants)
    tag_string  = ", ".join(product.tags[:15]) if product.tags else "none"

    return f"""
Generate copy for the following fashion product using your persona's voice.

---
PRODUCT BRIEF
Title         : {product.title}
Vendor        : {product.vendor or "Independent Brand"}
Product Type  : {product.product_type or "Fashion"}
Price Range   : {price_range}
Tags          : {tag_string}
Description   : {product.description_raw[:800]}
---

OUTPUT FORMAT — respond ONLY with valid JSON, no markdown fences, no preamble:

{{
  "instagram_caption": "The full Instagram caption including hook, body, and hashtags (max 2200 chars)",
  "instagram_hashtags": ["array", "of", "10", "targeted", "hashtags", "no", "hash", "symbol"],
  "website_description": "The product description for the website PDP (100–160 words)",
  "copy_notes": "One sentence on the strategic intent behind this copy — for the founder's eyes only"
}}
"""


def _extract_price_range(variants: list[Any]) -> str:
    """Returns a human-readable price range string from variant data."""
    try:
        prices = sorted({float(v.price) for v in variants if v.price})
        if not prices:
            return "Price not available"
        if len(prices) == 1:
            return f"${prices[0]:.2f}"
        return f"${prices[0]:.2f} – ${prices[-1]:.2f}"
    except (ValueError, AttributeError):
        return "Price not available"


# ---------------------------------------------------------------------------
# Live AI Call — Groq / Llama 3.3
# ---------------------------------------------------------------------------

async def call_groq(system_prompt: str, user_prompt: str) -> dict:
    """
    Calls Groq's Llama 3.3 70B model with the persona system prompt and
    structured product brief.

    Why Groq over Gemini free tier:
    Groq runs on dedicated LPU hardware — median latency <500ms vs 2-4s for
    Gemini free tier. For a live demo where a founder is watching a spinner,
    that difference is the gap between "impressive" and "is this broken."

    JSON enforcement strategy:
    response_format={"type": "json_object"} forces the model to return valid
    JSON without markdown fences. The system prompt still specifies the exact
    schema as a belt-and-suspenders measure.
    """
    try:
        response = await groq_client.chat.completions.create(
            model=GROQ_MODEL,
            response_format={"type": "json_object"},
            temperature=0.85,
            max_tokens=1024,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": user_prompt},
            ],
        )

        raw_text = response.choices[0].message.content.strip()

        # Strip markdown fences defensively — some models ignore json_object mode
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]

        parsed = json.loads(raw_text)
        logger.info(f"Groq generation successful — model={GROQ_MODEL}")
        return parsed

    except json.JSONDecodeError as e:
        raw = response.choices[0].message.content[:300] if response else "no response"
        logger.error(f"Groq returned non-JSON: {raw}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI model returned malformed JSON: {str(e)}",
        )
    except Exception as e:
        logger.error(f"Groq API error: {type(e).__name__}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI generation service error: {str(e)}",
        )


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class GenerateRequest(BaseModel):
    product: ProductData
    persona: Persona = Field(
        ...,
        description="Writing persona to apply. One of: Exquisite, Ladylike, Street Vibes, Minimalist Chic",
        examples=["Exquisite"],
    )

    class Config:
        use_enum_values = True


class GeneratedCopy(BaseModel):
    instagram_caption: str
    instagram_hashtags: list[str]
    website_description: str
    copy_notes: str


class GenerateResponse(BaseModel):
    success: bool
    persona_used: str
    product_title: str
    copy: GeneratedCopy | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# Router  (mounted into main.py — not a standalone app)
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/generate", tags=["Generation"])


@router.post(
    "",
    response_model=GenerateResponse,
    summary="Generate persona-styled marketing copy from scraped product data",
    responses={
        200: {"description": "Copy generated successfully"},
        422: {"description": "Invalid persona or product content flagged"},
        502: {"description": "AI model returned malformed response"},
        503: {"description": "AI generation service unavailable"},
    },
)
async def generate_copy(request: GenerateRequest) -> GenerateResponse:
    """
    Accepts a `ProductData` object and a `persona` string.
    Returns an Instagram caption, hashtag set, and website product description
    written in the voice of the selected persona.

    **Personas available:** `Exquisite` | `Ladylike` | `Street Vibes` | `Minimalist Chic`
    """
    persona_enum = Persona(request.persona)

    system_prompt = PERSONA_SYSTEM_PROMPTS[persona_enum]
    user_prompt   = build_generation_prompt(request.product, persona_enum)

    logger.info(
        f"Generating copy — product: '{request.product.title}' | persona: {persona_enum.value}"
    )

    raw_copy = await call_groq(system_prompt, user_prompt)

    # Validate shape of AI response before returning to client
    try:
        copy = GeneratedCopy(**raw_copy)
    except Exception as e:
        logger.error(f"AI response failed schema validation: {raw_copy}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI response shape was invalid: {str(e)}",
        )

    return GenerateResponse(
        success=True,
        persona_used=persona_enum.value,
        product_title=request.product.title,
        copy=copy,
    )
