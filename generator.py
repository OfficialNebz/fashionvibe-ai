"""
FashionVibe AI — Phase 2: AI Persona Generation Layer
------------------------------------------------------
Endpoint : POST /generate
Model    : gemini-2.0-flash  (Free/Plus tier)
           claude-sonnet-4-5 (Pro tier — Phase 3)
Personas : Exquisite | Ladylike | Street Vibes | Minimalist Chic
Author   : FashionVibe AI Engineering
"""

import json
import logging
import os
from enum import Enum
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from scraper import ProductData  # Re-use the schema we already defined

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
load_dotenv()  # Reads .env file in project root

logger = logging.getLogger("fashionvibe.generator")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY is not set. "
        "Add it to your .env file: GEMINI_API_KEY=your_key_here"
    )

genai.configure(api_key=GEMINI_API_KEY)

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
# Gemini Call — MOCK MODE
# ---------------------------------------------------------------------------
# ⚠️  MOCK ACTIVE: Real Gemini API call is bypassed due to billing quota (429).
#     To restore live calls:
#       1. Resolve billing at https://aistudio.google.com
#       2. Delete this function entirely
#       3. Restore the original call_gemini() from git history (or Phase 2 notes)
#       4. Remove the `title` and `vendor` params from the callsite in generate_copy()
# ---------------------------------------------------------------------------

async def call_gemini(
    system_prompt: str,   # kept in signature — drop-in restore when billing resolves
    user_prompt: str,     # kept in signature — drop-in restore when billing resolves
    title: str = "The Product",
    vendor: str = "The Brand",
) -> dict:
    """
    MOCK: Returns a hardcoded, persona-matched GeneratedCopy dictionary.
    Injects `title` and `vendor` via f-strings so frontend data feels real.
    Persona is extracted from `system_prompt` via a lookup against the
    PERSONA_SYSTEM_PROMPTS map — no extra argument needed.
    """

    # Identify which persona we're in by matching the system_prompt reference
    persona_key: Persona = Persona.EXQUISITE  # safe default
    for p, prompt_text in PERSONA_SYSTEM_PROMPTS.items():
        if prompt_text == system_prompt:
            persona_key = p
            break

    logger.info(f"[MOCK] Generating copy for persona={persona_key.value} | title='{title}'")

    templates: dict[Persona, dict] = {

        # ── EXQUISITE ────────────────────────────────────────────────────────
        Persona.EXQUISITE: {
            "instagram_caption": (
                f"She doesn't chase the season. She defines it.\n\n"
                f"The {title} by {vendor} — conceived for the woman who understands "
                f"that true elegance is never loud. Every seam is a considered decision. "
                f"Every silhouette, a quiet statement.\n\n"
                f"This is not fast fashion. This is fashion that endures.\n\n"
                f"Explore the collection. Link in bio."
            ),
            "instagram_hashtags": [
                "SlowFashion", "LuxuryFashion", "ConsideredDesign",
                "WomenWhoWear", "EditorialFashion", "QuietLuxury",
                "TimelessStyle", "IndependentDesigner", "FashionVibeAI",
                vendor.replace(" ", ""),
            ],
            "website_description": (
                f"The {title} is a study in restraint. Conceived for the woman "
                f"who has moved beyond trend cycles, this piece exists at the intersection "
                f"of craft and intention. The silhouette is architectural — precise where "
                f"it needs to be, generous where it matters. Wear it to the opening. "
                f"Wear it to dinner. Wear it when the occasion demands that you arrive "
                f"already dressed for the conversation. {vendor} presents this as a "
                f"wardrobe investment — not a purchase, but a decision."
            ),
            "copy_notes": (
                "Copy leans into authority over aspiration — targeting buyers who "
                "self-identify as beyond trend culture and respond to restraint as a luxury signal."
            ),
        },

        # ── LADYLIKE ─────────────────────────────────────────────────────────
        Persona.LADYLIKE: {
            "instagram_caption": (
                f"The one you reach for on every occasion that matters. 🤍\n\n"
                f"Meet the {title} from {vendor} — the kind of piece that feels like "
                f"it was made for Sunday mornings that turn into Saturday evenings. "
                f"Effortlessly refined, quietly feminine, and designed to feel as beautiful "
                f"as it looks.\n\n"
                f"Some things never go out of style. This is one of them.\n\n"
                f"Shop via the link in bio — you deserve something lovely."
            ),
            "instagram_hashtags": [
                "LadylikeFashion", "TimelessWardrobe", "FeminineStyle",
                "ClassicAndChic", "WardrobeClassics", "ElegantWomen",
                "StyleForWomen", "IndependentFashion", "FashionVibeAI",
                vendor.replace(" ", ""),
            ],
            "website_description": (
                f"Some pieces enter your wardrobe and never leave. The {title} by {vendor} "
                f"is one of them. Designed with the modern woman's life in mind — full days, "
                f"meaningful evenings, occasions that deserve to be remembered — this is "
                f"dressing with intention. The silhouette is graceful, the details deliberate, "
                f"and the feel instantly familiar. Pair it with everything. Reach for it always. "
                f"A {vendor} wardrobe essential that honours the art of dressing well."
            ),
            "copy_notes": (
                "Lifestyle-forward framing targets brand-loyal buyers who purchase on "
                "emotional resonance and longevity, not trend urgency."
            ),
        },

        # ── STREET VIBES ─────────────────────────────────────────────────────
        Persona.STREET_VIBES: {
            "instagram_caption": (
                f"The silhouette is the statement. 🖤\n\n"
                f"{title} just dropped and it's giving everything it's supposed to give. "
                f"{vendor} said no notes — and honestly? No notes. "
                f"The drip is intentional, the energy is locked, and your camera roll "
                f"is about to look very different.\n\n"
                f"Deadass limited. Don't sleep.\n\n"
                f"Link in bio. You already know. ⚡"
            ),
            "instagram_hashtags": [
                "StreetStyle", "FashionDrop", "OOTD",
                "Drip", "StyleAlert", "NewDrop",
                "UrbanFashion", "GenZFashion", "FashionVibeAI",
                vendor.replace(" ", ""),
            ],
            "website_description": (
                f"The {title} by {vendor} hits different. This isn't background noise — "
                f"this is a piece that changes the energy of the room the moment you walk in. "
                f"Cut with intention, built for movement, designed to be seen. "
                f"The details are deliberate. The attitude is built in. "
                f"Wear it like you already know you're the best-dressed person there. "
                f"Because you will be. {vendor}. No further questions."
            ),
            "copy_notes": (
                "Slang used sparingly and purposefully — two instances max — "
                "to signal cultural fluency without reading as performative."
            ),
        },

        # ── MINIMALIST CHIC ──────────────────────────────────────────────────
        Persona.MINIMALIST_CHIC: {
            "instagram_caption": (
                f"Less, done exceptionally.\n\n"
                f"The {title}. By {vendor}.\n\n"
                f"One piece. Every occasion. No compromises.\n\n"
                f"Available now. Link in bio."
            ),
            "instagram_hashtags": [
                "MinimalistFashion", "QuietLuxury", "ConsciousWardrobe",
                "LessIsMore", "CleanAesthetic", "MinimalistStyle",
                "InvestmentPiece", "SlowFashion", "FashionVibeAI",
                vendor.replace(" ", ""),
            ],
            "website_description": (
                f"The {title} by {vendor} is a precise thing. "
                f"The proportion is considered. The construction is clean. "
                f"There are no decorative elements that do not serve the garment. "
                f"It is made to be worn repeatedly, across contexts, without adjustment. "
                f"Dress it up. Dress it down. It will not falter. "
                f"This is what a wardrobe foundation looks like when craft is the priority. "
                f"A {vendor} investment that earns its place every time you reach for it."
            ),
            "copy_notes": (
                "Copy mirrors the product's design philosophy — no excess, "
                "no lifestyle fantasy, direct appeal to the intelligent minimal buyer."
            ),
        },
    }

    return templates[persona_key]


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

    raw_copy = await call_gemini(
        system_prompt,
        user_prompt,
        title=request.product.title,
        vendor=request.product.vendor or "Independent Brand",
    )

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