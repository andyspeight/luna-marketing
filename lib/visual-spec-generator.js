// lib/visual-spec-generator.js
//
// Drafts a Product Visuals spec for a product so the image engine can render a
// faithful mockup of it. A "visual spec" is the structured description that
// brief-generator.js injects into every mockup brief: dimensions/shape, header,
// body, interactive elements, footer, colour signatures, typography, variations,
// anti-patterns and aliases.
//
// Today only Luna Chat has a spec. This drafter produces a strong starting
// point for every other product from what the Product Brain already knows
// (canonical copy + Brain Summary), anchored to the real Travelgenix design
// tokens so it never invents brand colours. When a reference screenshot is
// available it reads it with vision for accuracy.
//
// Honesty rule: the drafter must NOT fabricate precise values it cannot know
// (exact pixel sizes, on-screen numbers, real hex codes outside the brand
// palette). Where a specific would be guesswork, it describes it generically
// and marks it "[confirm]" so a human (or a screenshot re-draft) can lock it.
//
// Output is a proposal. It is never auto-saved; the dashboard shows it for
// review and the owner saves it.
//
// Author: Travelgenix
// Date:   16 June 2026

const Anthropic = require("@anthropic-ai/sdk").default;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Specs feed every mockup of a product, so quality compounds — use the same
// strong model brief-generator uses. Override with VISUAL_SPEC_MODEL.
const SPEC_MODEL = process.env.VISUAL_SPEC_MODEL || "claude-opus-4-7";
const SPEC_MAX_TOKENS = 3500;

// The canonical Travelgenix design tokens (mirrored from lib/email-brand.js
// DESIGN_TOKENS + the Luna Chat spec's signatures). The drafter is told to use
// THESE for colour, not to invent any.
const BRAND_TOKENS = `TRAVELGENIX DESIGN TOKENS (use these exact values for colour; do not invent hex codes):
- Navy / primary text: #0F172A
- Secondary text: #475569
- Tertiary / muted text: #94A3B8
- Accent teal: #00B4D8  (deep teal #0096B7, light teal #48CAE4)
- Teal tint background (icon squares, highlights): #E0F7FA
- Borders / hairlines: #E2E8F0
- Surface / card background: #FFFFFF
- App background: #F8FAFC
- Success green: #10B981

TYPOGRAPHY ROLES:
- Inter — all body copy and UI (weights 400/500/600/700)
- Source Serif 4 italic — a single accent word inside otherwise-sans copy (a Travelgenix brand signature, e.g. one italic teal word in a heading)
- JetBrains Mono — technical metadata, eyebrow labels, small codes`;

// A compact style guide drawn from the gold-standard Luna Chat spec, so drafts
// match the house granularity and signatures without us pasting the whole spec.
const STYLE_GUIDE = `HOUSE STYLE (match this granularity and these signatures):
- Clean, modern SaaS UI on white. Generous padding (typically 20-24px). 12-16px corner radii on cards. Soft single-layer shadows, never heavy.
- Eyebrow labels in uppercase, ~10.5px, weight 600, letter-spacing ~0.8px, in tertiary grey.
- Icon squares: ~36x36px, ~10px radius, teal-tint (#E0F7FA) background, teal (#00B4D8) icon inside.
- The Source Serif 4 italic accent word (in teal) is a signature — use it in one heading where natural.
- Where the product shows a status or label, describe the EXACT text only if you actually know it; otherwise say "[confirm]".
- Pills/chips: full-radius, 1px #E2E8F0 border, white background, ~13px Inter weight 500.`;

// ─────────────────────────────────────────────────────────────────────
// PROMPT
// ─────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Travelgenix's product-visual spec writer. You produce the structured "visual spec" that an image engine uses to draw a faithful, on-brand mockup of a product (a UI screen, dashboard, widget, chat window, comparison card, etc).

${BRAND_TOKENS}

${STYLE_GUIDE}

RULES:
- Describe what the product LOOKS like, screen by screen, precisely enough that a designer could rebuild it. Lead with the default/welcome state in Body Spec.
- Use the Travelgenix tokens above for every colour. Never invent a hex code that is not in that list (a tasteful tint OF a brand colour is allowed if you say so).
- Do NOT fabricate exact pixel sizes, real on-screen numbers, prices, or status strings you cannot know. Approximate sizes are fine ("~36px"); for anything you would be guessing, write a short description plus "[confirm]".
- Anti Patterns must list concrete things the engine must NOT draw for this product (wrong icons, wrong labels, wrong colours), in "Do NOT ..." sentences.
- UK English. Plain, dense, technical. This is an internal spec, not marketing copy. No em dashes.

You return STRICT JSON only — no markdown fences, no preamble.`;

function buildUserMessage(product, brainSummary, hasScreenshot) {
  const f = product.fields || {};
  const lines = [];
  lines.push(`PRODUCT: ${f["Name"] || "(unnamed)"}`);
  lines.push("");
  lines.push("WHAT THE PRODUCT IS (from the marketing catalogue):");
  if (f["One-liner"]) lines.push(`- One-liner: ${f["One-liner"]}`);
  if (f["Problem solved"]) lines.push(`- Problem solved: ${f["Problem solved"]}`);
  if (f["Proof point"]) lines.push(`- Proof point: ${f["Proof point"]}`);
  if (f["Topics"]) lines.push(`- Topics: ${f["Topics"]}`);
  lines.push("");
  lines.push("LATEST KNOWLEDGE (Product Brain summary — use for current detail):");
  lines.push(brainSummary && brainSummary.trim() ? brainSummary.trim() : "(no brain summary yet — work from the catalogue copy above and flag specifics to confirm)");
  lines.push("");
  if (hasScreenshot) {
    lines.push("A REFERENCE SCREENSHOT of the real product is attached. Read it carefully and describe what you actually see — real colours, layout, labels and icons take priority over assumptions.");
  } else {
    lines.push("No screenshot is available. Infer a sensible, on-brand layout for this kind of product from the knowledge above. Mark any specific you are inferring with \"[confirm]\".");
  }
  lines.push("");
  lines.push(`Return this exact JSON shape (every value a plain string; "" if genuinely not applicable):
{
  "oneLiner": "One sentence: what this product is, so the engine knows what it is drawing.",
  "dimensions": "Overall shape, dimensions, position, corner radius, shadow. The container the product lives in.",
  "header": "Header band / top bar / chrome: avatar, logo, title, status, controls.",
  "body": "Main content area. Describe the DEFAULT/welcome state in full.",
  "interactive": "Buttons, inputs, pills, cards, links — anything clickable or typable.",
  "footer": "Footer / bottom area: branding lines, secondary links, input bar.",
  "colourSignatures": "Exact hex codes used, by role (background, accents, text, borders), drawn from the brand tokens.",
  "typographySignatures": "Which fonts appear where, at what sizes/weights, where italic-serif or mono is used.",
  "variations": "Other states/layouts this product can appear in (collapsed, mid-flow, results, error). Optional.",
  "antiPatterns": "Do NOT ... sentences listing specific mis-renders to forbid for THIS product.",
  "aliases": "Comma-separated lowercase names this product is known by, for matching briefs.",
  "confidence": "high | medium | low — your confidence given the inputs.",
  "needsConfirmation": ["short list of the specifics a human or screenshot should confirm"]
}
Output ONLY the JSON.`);
  return lines.join("\n");
}

function parseJsonObject(rawText) {
  if (!rawText || typeof rawText !== "string") return { error: "empty response" };
  let cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const first = cleaned.indexOf("{");
  if (first > 0) cleaned = cleaned.slice(first);
  let depth = 0, end = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end > 0) cleaned = cleaned.slice(0, end + 1);
  try { return { data: JSON.parse(cleaned) }; }
  catch (e) { return { error: `JSON parse error: ${e.message}` }; }
}

async function downloadImageAsBase64(url, mediaTypeHint) {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf || buf.length === 0) return null;
    const mediaType = mediaTypeHint || r.headers.get("content-type") || "image/png";
    // Anthropic accepts png/jpeg/gif/webp. Default unknowns to png.
    const safeType = /^image\/(png|jpeg|gif|webp)$/.test(mediaType) ? mediaType : "image/png";
    return { mediaType: safeType, data: buf.toString("base64") };
  } catch (e) {
    console.warn("[visual-spec] screenshot download failed:", e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC
// ─────────────────────────────────────────────────────────────────────

/**
 * Draft a visual spec for a product.
 *
 * @param {Object} opts
 * @param {Object} opts.product       — the Product Library record ({id, fields})
 * @param {string} [opts.brainSummary]— the product's Brain Summary text
 * @param {string} [opts.screenshotUrl] — optional reference image to read with vision
 * @param {string} [opts.screenshotMediaType]
 * @param {Anthropic} [opts.anthropic]
 * @returns {Promise<Object>} { ok, spec, confidence, needsConfirmation, usedScreenshot, error }
 */
async function draftVisualSpec(opts) {
  const { product } = opts;
  if (!product || !product.fields) throw new Error("product record is required");
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

  const anthropic = opts.anthropic || new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Optional vision input.
  let image = null;
  if (opts.screenshotUrl) {
    image = await downloadImageAsBase64(opts.screenshotUrl, opts.screenshotMediaType);
  }

  const text = buildUserMessage(product, opts.brainSummary || "", !!image);
  const content = image
    ? [
        { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
        { type: "text", text }
      ]
    : text;

  const response = await anthropic.messages.create({
    model: SPEC_MODEL,
    max_tokens: SPEC_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }]
  });

  let rawText = "";
  for (const block of response.content) if (block.type === "text") rawText += block.text;

  const { data, error } = parseJsonObject(rawText);
  if (error || !data) return { ok: false, error: error || "no spec returned" };

  // Normalise to the exact field set the dashboard + brief-generator use.
  const spec = {
    oneLiner: String(data.oneLiner || ""),
    dimensions: String(data.dimensions || ""),
    header: String(data.header || ""),
    body: String(data.body || ""),
    interactive: String(data.interactive || ""),
    footer: String(data.footer || ""),
    colourSignatures: String(data.colourSignatures || ""),
    typographySignatures: String(data.typographySignatures || ""),
    variations: String(data.variations || ""),
    antiPatterns: String(data.antiPatterns || ""),
    aliases: String(data.aliases || "")
  };

  return {
    ok: true,
    spec,
    confidence: data.confidence || "medium",
    needsConfirmation: Array.isArray(data.needsConfirmation) ? data.needsConfirmation : [],
    usedScreenshot: !!image,
    usage: response.usage
  };
}

module.exports = {
  draftVisualSpec,
  downloadImageAsBase64,
  _internals: { buildUserMessage, parseJsonObject, BRAND_TOKENS }
};
