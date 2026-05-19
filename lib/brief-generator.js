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
const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 1500;

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

  // Build the user-message input for the brief generator. We pass the
  // section content as readable structured text so Opus can reason about
  // it naturally rather than parsing JSON.
  const userMessage = buildUserMessage(input);

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

function buildUserMessage(input) {
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

  lines.push("");
  lines.push("Write the brief.");

  return lines.join("\n");
}

module.exports = {
  generateBrief,
  _internals: { buildUserMessage, BRIEF_GENERATOR_SYSTEM_PROMPT }
};
