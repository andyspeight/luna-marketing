// lib/brief-generator.js
//
// Generates image briefs for the Luna Marketing image pipeline.
//
// Takes structured input from the composer (section type, headline, subhead,
// product context, optional style reference) and produces a written brief
// in the style of the four lab library briefs (Santorini, Luna Chat mockup,
// pricing comparison, feature grid).
//
// Output flows directly into the HTML pipeline as the brief input. The
// brief generator NEVER writes the HTML renderer prompt — that is baked
// into lib/image-generator-v2.js. This separation is deliberate:
//   - Renderer prompt = "how Travelgenix builds things" (locked, rarely edited)
//   - Brief          = "what to make this time" (varies per image)
//
// Model: Opus 4.7. Briefs are upstream of every image. Quality compounds.
// Five extra seconds once per image is nothing compared to the cost of
// a flat brief producing a flat image.
//
// Forward-looking note: the input shape accepts an optional `styleReference`
// for Stage E (upload-screenshot-to-template). When set, the brief generator
// will incorporate the extracted style (layout, typography, palette) into
// the brief without copying the original. Today this field is unused.
//
// Author: Travelgenix
// Date:   18 May 2026

const Anthropic = require("@anthropic-ai/sdk").default;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PRODUCT_VISUALS_TABLE = "tblZJzVjkh61ItPs8";
const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 1500;

// Field IDs for the Product Visuals table. Captured 19 May 2026.
// Keep in sync with the Airtable schema; renaming fields keeps the IDs.
const PV_FIELDS = {
  name:                 "fldRvOcD05yNCGyDV",
  status:               "fldl6qBVKmhnPcjtz",
  oneLiner:             "fldI1zCALelKpd869",
  dimensions:           "fldy4YQ3ErwnVRDxV",
  header:               "fldQsGP3xWxGEU39p",
  body:                 "fldWSBe5U1UkwRaLh",
  interactive:          "fldbUqMrWx78bZpnd",
  footer:               "fldM9Geh8JNDncqBB",
  colourSignatures:     "fldgDys9a7fYiucoI",
  typographySignatures: "fldcSSSTPbKro3O7k",
  variations:           "fld5vO31mApc4cubN",
  antiPatterns:         "fldRLWJY0U4cdDkKV",
  aliases:              "fld7dOkgGzIGFYqNc"
};

// In-memory cache for Product Visuals. Specs change rarely; 5-minute
// TTL keeps Airtable load low without serving truly stale specs after
// an update. Cache survives between invocations of the same Vercel
// lambda instance but resets on a cold start, which is fine.
const PV_CACHE_TTL_MS = 5 * 60 * 1000;
let pvCache = { fetchedAt: 0, records: null };

/**
 * Fetch all Active product visuals from Airtable. Cached.
 * Returns an array of normalised records. Each record has name (string),
 * aliases (array of lowercase strings), and the spec fields. On any
 * failure (Airtable down, no key, etc) returns an empty array — never
 * throws — so brief generation degrades gracefully to "no product spec".
 */
async function fetchProductVisuals() {
  const now = Date.now();
  if (pvCache.records && (now - pvCache.fetchedAt) < PV_CACHE_TTL_MS) {
    return pvCache.records;
  }
  if (!AIRTABLE_KEY) {
    // Without a key we can't fetch; behave as if there are no specs.
    pvCache = { fetchedAt: now, records: [] };
    return [];
  }
  try {
    // Filter to Status = "Active" only. Use the field ID, not the name,
    // so renames don't break this.
    const formula = encodeURIComponent(`{${PV_FIELDS.status}}='Active'`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCT_VISUALS_TABLE}?filterByFormula=${formula}&maxRecords=100`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_KEY}` }
    });
    if (!r.ok) {
      console.warn("[brief-generator] Product Visuals fetch failed:", r.status);
      pvCache = { fetchedAt: now, records: [] };
      return [];
    }
    const data = await r.json();
    const records = ((data && data.records) || []).map(rec => {
      const f = rec.fields || {};
      const aliasesRaw = f["Aliases"] || f[PV_FIELDS.aliases] || "";
      const aliases = String(aliasesRaw)
        .toLowerCase()
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      return {
        id: rec.id,
        name: f["Name"] || f[PV_FIELDS.name] || "",
        aliases,
        oneLiner: f["One Liner"] || f[PV_FIELDS.oneLiner] || "",
        dimensions: f["Dimensions And Shape"] || f[PV_FIELDS.dimensions] || "",
        header: f["Header Spec"] || f[PV_FIELDS.header] || "",
        body: f["Body Spec"] || f[PV_FIELDS.body] || "",
        interactive: f["Interactive Elements Spec"] || f[PV_FIELDS.interactive] || "",
        footer: f["Footer Spec"] || f[PV_FIELDS.footer] || "",
        colourSignatures: f["Colour Signatures"] || f[PV_FIELDS.colourSignatures] || "",
        typographySignatures: f["Typography Signatures"] || f[PV_FIELDS.typographySignatures] || "",
        variations: f["Variations"] || f[PV_FIELDS.variations] || "",
        antiPatterns: f["Anti Patterns"] || f[PV_FIELDS.antiPatterns] || ""
      };
    });
    pvCache = { fetchedAt: now, records };
    return records;
  } catch (e) {
    console.warn("[brief-generator] Product Visuals fetch error:", e.message);
    pvCache = { fetchedAt: now, records: [] };
    return [];
  }
}

/**
 * Match brief input text against known product visuals. Returns the
 * matched record or null. Matching is case-insensitive substring on the
 * combined headline + subhead + bodyText + productContext, against each
 * product's name and aliases. First match wins; products are scanned in
 * Airtable order so put canonical products first if a brief might match
 * multiple.
 */
function matchProductVisual(input, records) {
  if (!records || records.length === 0) return null;
  const sc = input.sectionContent || {};
  const haystack = [
    sc.headline, sc.subhead, sc.bodyText,
    sc.productContext, input.sectionType
  ].filter(Boolean).join(" ").toLowerCase();
  if (!haystack) return null;
  for (const rec of records) {
    const candidates = [rec.name.toLowerCase(), ...rec.aliases].filter(Boolean);
    for (const c of candidates) {
      if (c.length < 3) continue; // avoid noise matches on short aliases
      if (haystack.includes(c)) return rec;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────
// The brief generator's intelligence lives here. Distilled from the four
// lab briefs that produced magazine-quality output: Santorini destination
// spotlight, Luna Chat product mockup, Pricing comparison, Why Travelgenix
// feature grid. Plus the Travelgenix brand voice.

const BRIEF_GENERATOR_SYSTEM_PROMPT = `You are a senior creative director writing image briefs for the Luna Marketing engine. Your briefs are read by a downstream AI that writes magazine-quality HTML/CSS, which is then rendered as a PNG in Google Chrome and used in marketing emails, blog posts, and landing pages.

YOUR JOB

Read the structured section content provided. Output ONE detailed image brief, 150 to 400 words, that describes exactly what to render. The brief should be specific enough that two different designers would produce visually similar work from it.

NEVER output anything except the brief. No preamble. No explanation. No markdown. No headings. Just the brief text.

WHAT MAKES A GREAT BRIEF

1. Specific subject and composition
   Open with the subject and the overall composition (single card, three-column comparison, hero with floating widget, 2x3 feature grid, etc).

2. Use provided facts EXACTLY. Invent only what is missing.
   This is the most important rule in this prompt. The input has two parts: structured content (headline, subhead, body) and a "key facts" list. Read both carefully before writing.

   If the input provides a number, price, date, percentage, statistic, name, or quote: reproduce it word for word in the brief. Do NOT round, paraphrase, "improve", substitute, or rewrite it. If the input says "£159/mo", the brief says "£159/mo", not "£149" or "from £159" or "£159+". If the input says "setup £2,995", the brief says "setup £2,995", not "Setup · £499 one-off".

   If a category of detail is genuinely missing from the input (no price was provided, no date was provided, no proof-point was provided), THEN you may invent plausible specifics. For Travelgenix, plausible looks like "247 verified properties", "12,847 trips analysed", "Last analysed 3h ago", "Powered by Travelgenix Luna AI", "Trusted by 300+ UK agencies". Mark invented details as supporting flavour, never as core pricing or product claims.

   Never override input data with your own intuition. If the input data looks wrong to you, still use it. The user owns the facts.

3. Typography direction
   Specify which elements should be italic serif (major headlines), which sans (body, UI labels), which monospace (technical metadata, source attributions, timestamps, ref IDs). Travelgenix uses Source Serif 4 italic for editorial headlines, Inter for everything else, JetBrains Mono for metadata.

4. Brand colour direction
   Brief should reinforce Travelgenix navy (#1B2B5B) and teal (#00B4D8) as primary palette. Mention specific colours where useful (e.g. "navy header", "teal CTA button"). The downstream system already knows the full token set, so do not list every CSS variable.

5. Editorial polish anchors
   Great Travelgenix imagery always has: source attributions (e.g. "open-meteo.com · Live"), status pills with subtle borders, multi-layer card shadows, and small monospace metadata strips. Mention these where they would land.

6. Composition cues
   Use spatial language ("top-left", "anchored to the top edge of the navy card", "floating in the bottom-right corner"). The downstream system needs concrete spatial reasoning to lay things out.

7. Quality bar reference
   End with a one-line aspirational reference. Examples: "Linear product launch quality", "Bloomberg data card editorial", "Stripe documentation polish", "Notion marketing site quality". Pick the one that fits the section type.

UNIVERSAL COMPOSITION RULES — APPLY TO EVERY BRIEF

A. EVERY ELEMENT IN SHARP FOCUS.
   Never write a brief that asks for "soft", "blurred", "out of focus", "muted background", "faded", "depth of field", "background blur", "bokeh", "hazy", or any variant. Marketing imagery renders at small sizes (600px for email, smaller for mobile and social) and any deliberately blurred area looks broken, not deliberate, at that scale.

   Achieve focal hierarchy through other means: scale (make the subject bigger), elevation (multi-layer shadow), colour contrast (saturated subject against muted surroundings of the SAME sharpness), or positioning (centred with generous breathing room). Never through blur or softening.

   If a brief calls for a product mockup over a website background, the website background must be clearly drawn, in focus, with simplified shapes if needed — just less visually weighty than the focal subject. Reduce visual weight by drawing fewer elements, not by blurring the ones you draw.

B. CENTRE-HALF SUBJECT PLACEMENT (STRONG PREFERENCE).
   Prefer compositions where the single most important element sits horizontally between 25% and 75% of the canvas width. Side-anchored compositions (chat widget pinned to the right edge, headline pinned to the left) tend to fail on mobile because the focal subject either crops out or shrinks to near-invisibility when the image is scaled to ~380px wide.

   Three-column layouts (like pricing comparisons) are an exception: each column is itself a focal element and the eye is meant to scan all three. The rule applies to single-focal compositions.

   If the brief genuinely demands an asymmetric composition for editorial reasons, you may break this rule — but bias toward centring. If in doubt, centre.

EMAIL OUTPUT RULES — APPLY ONLY WHEN OUTPUT CONTEXT IS "email"

When the input declares OUTPUT CONTEXT: email, design for legibility at 600px (desktop inbox) and 380px (mobile inbox). The downstream PNG is generated at 2x for retina sharpness, but the displayed size in the inbox is small. Briefs that work at 1200×600 on a landing page do NOT survive scaling to 600px in an inbox unless they obey these rules:

E1. Minimum on-canvas type sizes:
    - Body text: 16px or larger
    - Eyebrows and captions: 13px or larger
    - Chart labels and pill text: 11px or larger
    - Metadata strips ("Last analysed 3h ago", "ref: a3f9b1", source attributions): OMIT ENTIRELY for email output. They vanish at email display size and add visual noise.

E2. Single-layer shadows only.
    Multi-layer shadow stacks (a Travelgenix editorial signature) are a landing-page treatment. For email, one clean shadow per card is enough. Anything more disappears at downscale and just adds file weight.

E3. Bolder shapes, less density.
    A landing-page pricing card has 6 to 8 features per column. An email pricing card has 3 to 4. A landing-page feature grid is 3x3. An email feature grid is 2x2 or even 1x4. Reduce element count by 30 to 50% versus what you would put on a landing page. Density that reads as "considered editorial" at large size reads as "cluttered postage stamp" at email size.

E4. No micro-detail.
    Skip the small "live" pulse dots, tiny status indicators under 8px, hairline 1px borders that anti-alias to nothing. These reward close-reading on a landing page and disappear in email.

PRODUCT VISUAL RULE — APPLY WHEN A PRODUCT VISUAL SPEC IS INJECTED

If the input contains a "PRODUCT VISUAL SPEC" block, the brief MUST follow that spec exactly when describing how the product looks. The spec is the source of truth, not your memory or imagination, and not the brief generator's reference briefs.

P1. Reproduce visual details from the spec verbatim. Hex codes, font sizes, weights, padding values, corner radii, icon shapes, exact wording on UI labels — all of these come from the spec, not from inference. If the spec says the avatar is a teal rounded square with a serif "L", do not write a brief that calls for a sparkle icon, a circular avatar, or a different letter.

P2. The spec's "Anti Patterns" section is non-negotiable. Every "Do NOT" in there is a hard prohibition. Read the anti-patterns BEFORE writing the brief and avoid every one of them.

P3. The spec contains multiple states (welcome, mid-conversation, collapsed). Pick the right state based on the brief's intent:
    - If the brief is about "the product" or "introducing the product" with no scenario, render the welcome / default state.
    - If the brief explicitly mentions a customer asking, a conversation happening, a search in progress, or showing a result — render the mid-conversation state.
    - If the brief calls for the product as a small element on a host site (a website mockup with the widget pinned in the corner), render the collapsed launcher OR the expanded welcome state per what the composition needs.

P4. When the spec specifies a position (e.g. "bottom-right corner of the host site"), respect it. Do not centre a corner widget. Do not full-screen a panel that is meant to float.

P5. Treat the spec's "Colour Signatures" and "Typography Signatures" as a closed list. Do not invent additional brand colours or fonts for this product. If you need a colour that is not listed, fall back to the standard Travelgenix brand tokens — never invent.

P6. When you reference the product in the brief, write the visual instructions as if you are dictating to a designer who has the spec open in front of them. You are not paraphrasing the spec — you are using it. The brief should say "Render the Luna Chat widget as specified, in its welcome state, anchored to the bottom-right of the website mockup" and then describe the EXTERNAL composition (everything around the widget), trusting the spec to define the widget's internal anatomy.

P7. If the user input's facts contradict the spec (e.g. the brief says "Luna Chat with a sparkle icon" but the spec says "no sparkle icon"), the spec wins. Mention this in the brief if needed: "Render the Luna Chat widget per spec — note the spec calls for a serif L, not a sparkle icon."

ANTI-PATTERNS

- Substituting different numbers, prices, dates, or statistics for ones the input provides. This is a critical failure mode. If the input says "£159", the brief says "£159".
- Generic descriptions ("a nice card with some text"). Always specific.
- Brand voice violations. NO em dashes, NO en dashes, NO Oxford commas. Use commas, full stops, or middle-dots (·).
- Listing every element with bullet points. Brief should read as a paragraph, not a checklist.
- Mentioning the canvas size, output format, or technical rendering. The downstream pipeline handles all that.
- Copying any uploaded style reference exactly. If a style reference is provided, extract its structural pattern (layout, typographic feel, density) and apply it to the Travelgenix content. Never reproduce another brand's content, copy, or specific visual elements.
- UK English at all times (colour, favourite, organisation, recognise).
- ZERO banned words: leverage, utilise, synergy, game-changer, innovative, cutting-edge, delve, seamlessly, robust, best-in-class.
- ZERO competitor names: TProfile, Top Dog, Inspiretec, Dolphin Dynamics, Traveltek, Moonstride, Travelsoft, Juniper.

THE FOUR REFERENCE BRIEFS

When in doubt, your brief should sit alongside these four as a sibling:

(A) Destination spotlight card. Place name in italic serif. Live weather card with glassmorphic surface. 12-month climate chart with seasonal colours and BEST badges on the shoulder-season months. Rainfall strip. Luna AI recommendation card on the right with sparkle icon, italic serif "Late May to early June" headline, data bars, confidence line. Footer with italic serif CTA and two buttons. Thin monospace bottom strip with breadcrumbs and ref ID. Navy header with orange radial glow. Editorial magazine quality.

(B) Luna Chat product mockup. Browser frame with traffic-light dots and address bar. Travel agency homepage in the background with hero banner, search bar, destination cards. Luna Chat widget floating bottom-right, fully expanded. Sparkle icon, "Luna · Online" header. Customer message asking for trip help, Luna replying, inline recommendation card with price. Typing indicator. Input field and teal send button. Linear screenshot reveal polish.

(C) Pricing comparison, three columns. SPARK, BOOST, IGNITE. Middle column elevated with navy background, white text, "MOST POPULAR" pill anchored to top edge. Eyebrows in letter-spaced caps. Plan name in sans-serif. Price treatment with large numbers, setup fee in monospace. Feature list with teal tick icons. CTA buttons follow hierarchy. Monthly/Annual toggle above. Trust signal strip below. Linear or Vercel SaaS pricing quality.

(D) Why Travelgenix feature grid. Eyebrow "WHY TRAVELGENIX" in letter-spaced teal caps. Serif italic display headline. 3 column by 2 row grid of six feature tiles, each tile a white card with unique colour-coded icon and 2-line description. One tile elevated to suggest hover state. Below grid, social proof line in italic serif with gold star icons. Stripe product page editorial.

Now read the input and write the brief.`;

// ─────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an image brief.
 *
 * Behaviour: when the input mentions a known Travelgenix product (by name
 * or alias, matched in lib/brief-generator's product-visuals cache), the
 * full visual spec for that product is injected into the user message and
 * the system prompt's PRODUCT VISUAL RULE kicks in. The brief generator
 * then writes a brief that follows the spec verbatim (hex codes, type
 * sizes, exact UI labels, icon shapes) instead of inventing visual details
 * from imagination. The Airtable Product Visuals table is the source of
 * truth; specs are cached in-memory for 5 minutes.
 *
 * @param {Object} input
 * @param {string} input.sectionType       e.g. "hero", "feature-card", "pricing-card", "data-card", "product-mockup", "destination-spotlight"
 * @param {Object} input.sectionContent    Structured content from the composer
 * @param {string} [input.sectionContent.headline]
 * @param {string} [input.sectionContent.subhead]
 * @param {string} [input.sectionContent.bodyText]
 * @param {string} [input.sectionContent.productContext]
 * @param {Array}  [input.sectionContent.facts]              List of plausible specifics (prices, dates, stats)
 * @param {string} [input.sectionContent.cta]
 * @param {Object} [input.brandTokens]     Optional override; defaults to Travelgenix
 * @param {Object} [input.styleReference]  Stage E placeholder. Today: null
 * @param {string} [input.outputContext]   "email" | "web" | "social". Default "web".
 *                                         When "email", Opus applies the E1-E4 email rules in the
 *                                         system prompt (minimum on-canvas type sizes, single-layer
 *                                         shadows, lower density, no micro-detail). When "web" or
 *                                         "social", standard editorial density applies.
 *
 * @returns {Promise<{ok, brief, model, elapsedMs, usage, error?}>}
 */
async function generateBrief(input) {
  if (!input || !input.sectionType) {
    return { ok: false, error: "sectionType is required" };
  }
  if (!input.sectionContent || typeof input.sectionContent !== "object") {
    return { ok: false, error: "sectionContent object is required" };
  }
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured" };
  }

  const startedAt = Date.now();
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Try to match a known product against the brief input. Best-effort:
  // fetchProductVisuals never throws, returns [] on any failure, so
  // brief generation continues even if Airtable is unavailable.
  const productVisuals = await fetchProductVisuals();
  const matchedProduct = matchProductVisual(input, productVisuals);

  // Build the user-message input for the brief generator. We pass the
  // section content as readable structured text so Opus can reason about
  // it naturally rather than parsing JSON.
  const userMessage = buildUserMessage(input, matchedProduct);

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: BRIEF_GENERATOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }]
    });
  } catch (e) {
    const detail = e && e.message ? e.message : String(e);
    return {
      ok: false,
      error: "Brief generator failed: " + detail.slice(0, 300),
      stage: "claude"
    };
  }

  if (!response || !response.content || !Array.isArray(response.content)) {
    return { ok: false, error: "Brief generator returned unexpected response shape", stage: "shape" };
  }

  let brief = "";
  for (const block of response.content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      brief += block.text;
    }
  }
  brief = brief.trim();

  // Defensive cleanup: strip em/en dashes if Opus slipped any in despite
  // the prompt. The brief flows into the renderer prompt which also bans
  // them — but cleaning at this layer too is cheap defence in depth.
  brief = brief.replace(/[\u2013\u2014]/g, ",");

  // Strip any leading prefix Opus might add ("Brief:", "Here is the brief:", etc)
  brief = brief.replace(/^(brief|here is the brief|here's the brief|image brief)[:\s]+/i, "").trim();

  if (brief.length < 80) {
    return {
      ok: false,
      error: "Brief generator returned suspiciously short output (" + brief.length + " chars)",
      stage: "validate",
      brief
    };
  }

  return {
    ok: true,
    brief,
    model: MODEL,
    elapsedMs: Date.now() - startedAt,
    usage: response.usage
  };
}

// ─────────────────────────────────────────────────────────────────────
// USER MESSAGE BUILDER
// ─────────────────────────────────────────────────────────────────────

function buildUserMessage(input, matchedProduct) {
  const lines = [];

  // Output context up top — it gates rule application (the E1-E4 email
  // rules in the system prompt). Default "web" preserves existing
  // behaviour for any caller (e.g. the lab) that doesn't pass it.
  const outputContext = (input.outputContext === "email" || input.outputContext === "social")
    ? input.outputContext
    : "web";
  lines.push(`OUTPUT CONTEXT: ${outputContext}`);
  if (outputContext === "email") {
    lines.push("(This image will display at ~600px in an inbox, ~380px on mobile. Apply email rules E1-E4 from the system prompt.)");
  } else if (outputContext === "social") {
    lines.push("(Standard editorial density — same rules as web.)");
  }
  lines.push("");

  lines.push(`SECTION TYPE: ${input.sectionType}`);
  lines.push("");
  lines.push("SECTION CONTENT:");

  const sc = input.sectionContent;
  if (sc.headline) lines.push(`- Headline: "${sc.headline}"`);
  if (sc.subhead) lines.push(`- Subhead: "${sc.subhead}"`);
  if (sc.bodyText) lines.push(`- Body text: ${sc.bodyText}`);
  if (sc.productContext) lines.push(`- Product context: ${sc.productContext}`);
  if (sc.cta) lines.push(`- CTA: "${sc.cta}"`);

  if (Array.isArray(sc.facts) && sc.facts.length > 0) {
    lines.push("");
    lines.push("FACTS — USE EVERY ONE OF THESE EXACTLY AS WRITTEN.");
    lines.push("Reproduce numbers, prices, names, and dates verbatim. Do not paraphrase or substitute.");
    sc.facts.forEach(fact => {
      lines.push(`  - ${fact}`);
    });
  }

  // Brand tokens (default Travelgenix; pass explicit values for multi-tenant later)
  const tokens = input.brandTokens || {};
  lines.push("");
  lines.push("BRAND CONTEXT:");
  lines.push(`- Brand: ${tokens.brandName || "Travelgenix"}`);
  lines.push(`- Primary navy: ${tokens.navy || "#1B2B5B"}`);
  lines.push(`- Accent teal: ${tokens.teal || "#00B4D8"}`);
  if (tokens.audience) lines.push(`- Audience: ${tokens.audience}`);
  if (tokens.tone) lines.push(`- Tone: ${tokens.tone}`);

  // Stage E hook: style reference. Currently unused.
  if (input.styleReference) {
    lines.push("");
    lines.push("STYLE REFERENCE (apply structural pattern, do NOT copy content):");
    if (input.styleReference.layoutPattern) {
      lines.push(`- Layout pattern: ${input.styleReference.layoutPattern}`);
    }
    if (input.styleReference.typographyFeel) {
      lines.push(`- Typography feel: ${input.styleReference.typographyFeel}`);
    }
    if (input.styleReference.density) {
      lines.push(`- Density: ${input.styleReference.density}`);
    }
    if (input.styleReference.mood) {
      lines.push(`- Mood: ${input.styleReference.mood}`);
    }
  }

  // Inject the matched product visual spec, if any. This is the source
  // of truth for HOW the product looks — Opus must follow it verbatim
  // when describing the product in the brief. Without this block, Opus
  // renders the product from its own imagination, which produces
  // generic chat-widget / generic-card output instead of the actual
  // Travelgenix product.
  if (matchedProduct) {
    lines.push("");
    lines.push(`PRODUCT VISUAL SPEC — ${matchedProduct.name.toUpperCase()}`);
    lines.push("This spec describes EXACTLY how to render the product in the brief.");
    lines.push("Reproduce hex codes, type sizes, exact UI text, icon shapes, and corner radii verbatim.");
    lines.push("Read the Anti Patterns section before writing the brief. Every \"Do NOT\" is non-negotiable.");
    lines.push("");
    if (matchedProduct.oneLiner) {
      lines.push(`> ${matchedProduct.oneLiner}`);
      lines.push("");
    }
    if (matchedProduct.dimensions) {
      lines.push("## Dimensions and shape");
      lines.push(matchedProduct.dimensions);
      lines.push("");
    }
    if (matchedProduct.header) {
      lines.push("## Header");
      lines.push(matchedProduct.header);
      lines.push("");
    }
    if (matchedProduct.body) {
      lines.push("## Body (default / welcome state)");
      lines.push(matchedProduct.body);
      lines.push("");
    }
    if (matchedProduct.interactive) {
      lines.push("## Interactive elements");
      lines.push(matchedProduct.interactive);
      lines.push("");
    }
    if (matchedProduct.footer) {
      lines.push("## Footer / input bar");
      lines.push(matchedProduct.footer);
      lines.push("");
    }
    if (matchedProduct.colourSignatures) {
      lines.push("## Colour signatures");
      lines.push(matchedProduct.colourSignatures);
      lines.push("");
    }
    if (matchedProduct.typographySignatures) {
      lines.push("## Typography signatures");
      lines.push(matchedProduct.typographySignatures);
      lines.push("");
    }
    if (matchedProduct.variations) {
      lines.push("## Variations / alternate states");
      lines.push(matchedProduct.variations);
      lines.push("");
    }
    if (matchedProduct.antiPatterns) {
      lines.push("## Anti patterns — READ BEFORE WRITING");
      lines.push(matchedProduct.antiPatterns);
      lines.push("");
    }
  }

  lines.push("");
  lines.push("Write the brief.");

  return lines.join("\n");
}

module.exports = {
  generateBrief,
  fetchProductVisuals,
  matchProductVisual,
  _internals: { buildUserMessage, BRIEF_GENERATOR_SYSTEM_PROMPT, PV_FIELDS }
};
