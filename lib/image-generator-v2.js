// lib/image-generator-v2.js
//
// Production image generator for the Luna Marketing engine.
//
// Pipeline:
//   1. Receive a section spec from the composer
//   2. Generate a brief via lib/brief-generator.js (Opus 4.7)
//   3. Render the brief into HTML via the HTML system prompt (Sonnet 4.6)
//   4. Send HTML to HCTI, get back PNG URL
//   5. Log every step into Airtable Generated Images table
//   6. Return PNG URL + metadata
//
// Why this exists separately from lib/image-generator.js (v1):
//   v1 is the existing SVG-based pipeline that the composer currently calls.
//   v2 is the HTML-via-Chrome pipeline we built and validated in the lab.
//   They live side-by-side during transition. Once v2 is verified in
//   production we promote v2 to the canonical name and retire v1.
//
// IMPORTANT: this module bakes in the HTML renderer system prompt. The
// composer NEVER writes the renderer prompt — only the section content.
// This is the locked-in design intelligence that produced the Santorini,
// Luna Chat, pricing, and feature-grid wins.
//
// Author: Travelgenix
// Date:   18 May 2026

const Anthropic = require("@anthropic-ai/sdk").default;
const { generateBrief } = require("./brief-generator");
const { generateHtmlImage } = require("./html-image-generator");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const GENERATED_IMAGES_TABLE = "tblov7qu0dSpQVExf";

// Model: Sonnet 4.6 for HTML. Verified in lab to produce magazine-quality
// output at 1/3 the speed of Opus. Opus is the brief-generator model only.
const HTML_MODEL = "claude-sonnet-4-6";
const HTML_MAX_TOKENS = 16000;

// Standard slot dimensions, matching the conventions the composer expects.
// All values are LOGICAL pixels — HCTI multiplies by deviceScale (default 2)
// to produce retina-quality PNGs.
const SLOT_DIMENSIONS = {
  "hero":            { width: 1200, height: 600 },
  "hero-square":     { width: 1200, height: 1200 },
  "hero-tall":       { width: 1200, height: 800 },
  "feature-story":   { width: 1200, height: 500 },
  "card":            { width: 600, height: 400 },
  "card-square":     { width: 600, height: 600 },
  "thumbnail":       { width: 400, height: 400 },
  "banner":          { width: 1200, height: 360 },
  "wide":            { width: 1600, height: 600 }
};
const DEFAULT_SLOT = "hero";
const DEFAULT_DEVICE_SCALE = 2;

// Airtable Generated Images field IDs (captured 18 May 2026)
const FIELDS = {
  name:           "fldAS8bPKyx21Z76g",
  tenant:         "fld2GL2E8qHaB6iLu",
  sectionType:    "fldq2c9Ex3SrEKEx9",
  brief:          "fldchV5w4cMz2jsKL",
  model:          "fld55Q6vEAIiinkYH",
  pngUrl:         "fldeqU6OosEE5aBsk",
  htmlSource:     "fldPFDF8TeccACbpZ",
  width:          "fld1FpzEYPbFm05Ew",
  height:         "fldgxpbwD3hRLPuol",
  generationTime: "fldtdrO4ls5YLpcam",
  status:         "fldrvVZdrDj2rthpi",
  source:         "fld6RWFYfTVQGUUnH",
  usedInEmail:    "fldqtJi5UfBWMafIO",
  notes:          "fld5YO7NKCM8cuWta"
};

// ─────────────────────────────────────────────────────────────────────
// HTML SYSTEM PROMPT (baked in, never user-editable)
// ─────────────────────────────────────────────────────────────────────
// This is the locked-in instruction that teaches Claude how to write
// production-quality Travelgenix HTML. Distilled from the lab tests that
// produced magazine-quality output on four different content types.
// Kept identical to public/image-lab.html HTML_DEFAULT_PROMPT to ensure
// production parity with the lab.

const HTML_RENDERER_SYSTEM_PROMPT = `You are a senior visual designer producing magazine-quality marketing imagery for Travelgenix. You write a complete HTML document with inline CSS, which is then rendered in real Google Chrome at retina resolution. The output is a single PNG image used in marketing emails, blog posts, and product pages.

QUALITY BAR

Reference: Linear product launch graphics, Stripe documentation illustrations, Vercel changelog imagery, Apple keynote graphics, Bloomberg / FT data cards, magazine editorial design. The output should look like a senior design studio made it. Not wireframes. Not generic templates. Content-rich, polished, intentional.

OUTPUT FORMAT

You write ONE complete HTML document. No markdown fences. No preamble. No explanation. Start with <!DOCTYPE html>, end with </html>. All CSS inline in a <style> tag in the <head>. Load Google Fonts via a <link> tag.

DESIGN SIZE

The brief specifies a canvas width and height in logical pixels. Your design fills that exact size, with proper internal padding inside the outer container.

Do not set body padding (it would show through transparent corners on screenshots). Set the body background to the SAME colour as the card's outermost background.

FONT STACK (load via Google Fonts)

In the <head>, include:
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600;8..60,700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

Use:
- Inter (sans) for UI, body, captions, labels, weights 400 to 700
- Source Serif 4 (serif) for major headlines, place names, weights 400 to 700, italic is supported
- JetBrains Mono (monospace) for technical metadata, timestamps, source attributions, IDs, weight 400

WHAT MAKES A GREAT IMAGE

1. Real, specific content. Real place names, real numbers, real metadata, specific dates and prices. Never "Lorem ipsum" or "[Placeholder]". When the brief gives you specific numbers, prices, names, or dates, reproduce them in the HTML EXACTLY as written. Do not round, paraphrase, or substitute different values.

2. Typography hierarchy. Serif for major headlines (40 to 72px, often italic). Sans for body and UI (Inter, 400 to 700). Monospace for technical details (small, 10 to 11px, letter-spaced). Eyebrows in uppercase, small, letter-spaced.

3. Real data visualisations using CSS. Bar charts via grid-template-columns and percentage heights. Progress bars via track + fill divs. Status pills with semantic colours.

4. Editorial polish. Source attributions in monospace. Status pills with subtle borders and tinted backgrounds. Multi-layer drop shadows for cards. Subtle radial-gradient glows on dark backgrounds. backdrop-filter:blur() for glassmorphic surfaces. Generous border-radius.

5. Composition. Grid layouts for structured zones. Asymmetric layouts where appropriate. Cards within cards. Generous internal padding (24 to 48px).

BRAND TOKENS (use as CSS variables in :root)

--tg-navy: #1B2B5B
--tg-navy-dark: #0A0F1F
--tg-navy-light: #2A3F7A
--tg-teal: #00B4D8
--tg-teal-light: #48CAE4
--tg-teal-dark: #0096B7
--tg-text-primary: #0F172A
--tg-text-secondary: #475569
--tg-text-tertiary: #94A3B8
--tg-bg-primary: #FFFFFF
--tg-bg-secondary: #F8FAFC
--tg-bg-tertiary: #F1F5F9
--tg-border: #E2E8F0
--tg-success: #10B981
--tg-warning: #F59E0B
--tg-error: #EF4444

Seasonal palette for charts: Spring #84CC16, Summer #F59E0B, Autumn #DC2626, Winter #3B82F6.

TECHNICAL RULES

1. Output ONE complete HTML document. No markdown fences.
2. All CSS inline in a <style> tag in the <head>.
3. NO <script> tags. The renderer rejects them.
4. NO external URLs except fonts.googleapis.com and inline SVG icons.
5. SVG icons OK inline.
6. Set body background to match outer card colour.
7. NO em dashes or en dashes anywhere. Use commas, full stops, or middle-dots (·).
8. UK English spelling (colour, favourite).

ANTI-PATTERNS

- Generic placeholder bars or "Lorem ipsum"
- Single-colour flat backgrounds with no depth
- Three identical cards with no differentiation
- No typography hierarchy (everything one size)
- Solid white throughout (no atmosphere)
- Missing brand colours
- Forgetting source attributions or metadata that real editorial cards always have

REFERENCE SCREENSHOT RULE

When the user message contains an attached image (a screenshot of an actual product), the screenshot is the visual source of truth for that product. Your HTML must visually match the screenshot — same colours, same text, same icons, same proportions, same spacing. Look at the screenshot carefully before writing any CSS:

- Sample the actual colours from what you see, not approximations
- Read text strings character-by-character off the screenshot — every label, every word, every placeholder
- Note the precise shape of icons (a paper-plane is not an arrow, a rounded square is not a circle)
- Match corner radii, shadow weight, border thickness, padding amounts
- Match font weight and relative size (you can judge these from the screenshot)
- If the screenshot shows a rounded-square avatar with a serif L, your HTML renders a rounded-square avatar with a serif L — not an icon, not a circle, not a different letter

The brief in the same message describes the COMPOSITION: canvas size, background treatment, where the product sits within the canvas, lighting and atmosphere around it. The screenshot describes the PRODUCT itself. Combine the two: render the product faithfully (from the screenshot) inside the composition (from the brief).

Even when the brief contains rich verbal descriptions of the product, the screenshot wins. The brief might say "teal Book button"; the screenshot tells you the exact teal hex and the exact padding. Trust your eyes.

Now read the brief carefully. Make it count.`;

// ─────────────────────────────────────────────────────────────────────
// HTML EXTRACTION (mirrors the lab endpoint logic)
// ─────────────────────────────────────────────────────────────────────

function extractHtml(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { html: null, error: "Empty response" };
  }
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:html|xml)?\s*/i, "").replace(/```\s*$/, "").trim();

  const startMatch = cleaned.match(/<(!DOCTYPE\s+html|html|head|body|style|div|section|article|main)[\s>]/i);
  if (!startMatch) {
    return { html: null, error: "No HTML tag found in response" };
  }
  let html = cleaned.slice(startMatch.index);

  if (/<script[\s>]/i.test(html)) {
    return { html: null, error: "HTML contains <script> tag (not allowed)" };
  }

  html = html.replace(/[\u2013\u2014]/g, ",");

  if (html.length < 100) {
    return { html: null, error: `HTML too short (${html.length} chars)` };
  }

  return { html, error: null };
}

// ─────────────────────────────────────────────────────────────────────
// AIRTABLE LOGGING
// ─────────────────────────────────────────────────────────────────────

/**
 * Log a generated image into the Airtable Generated Images table.
 * Best-effort: failure here does NOT fail the generation pipeline.
 */
async function logToAirtable(record) {
  if (!AIRTABLE_KEY) {
    console.warn("[image-generator-v2] AIRTABLE_KEY not set, skipping log");
    return { ok: false, error: "Airtable key missing" };
  }

  const fields = {};
  if (record.name) fields[FIELDS.name] = record.name;
  if (record.tenantId) fields[FIELDS.tenant] = [record.tenantId];
  if (record.sectionType) fields[FIELDS.sectionType] = record.sectionType;
  if (record.brief) fields[FIELDS.brief] = record.brief;
  if (record.model) fields[FIELDS.model] = record.model;
  if (record.pngUrl) fields[FIELDS.pngUrl] = record.pngUrl;
  if (record.htmlSource) fields[FIELDS.htmlSource] = record.htmlSource;
  if (record.width) fields[FIELDS.width] = record.width;
  if (record.height) fields[FIELDS.height] = record.height;
  if (record.generationTime) fields[FIELDS.generationTime] = record.generationTime;
  if (record.status) fields[FIELDS.status] = record.status;
  if (record.source) fields[FIELDS.source] = record.source;
  if (record.usedInEmail) fields[FIELDS.usedInEmail] = [record.usedInEmail];
  if (record.notes) fields[FIELDS.notes] = record.notes;

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${GENERATED_IMAGES_TABLE}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        records: [{ fields }],
        typecast: true // auto-create singleSelect options if they don't exist yet
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[image-generator-v2] Airtable log failed:", res.status, errText.slice(0, 300));
      return { ok: false, error: `Airtable ${res.status}` };
    }

    const data = await res.json();
    const recordId = data && data.records && data.records[0] && data.records[0].id;
    return { ok: true, recordId };
  } catch (e) {
    console.error("[image-generator-v2] Airtable log error:", e.message);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────
// MAIN — PRODUCTION IMAGE GENERATOR
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an image for the email composer.
 *
 * @param {Object} input
 * @param {string}  input.tenantId          Airtable record ID of the tenant (e.g. Travelgenix = recFXQY7be6gMr4In)
 * @param {string}  input.sectionType       Logical section: "hero", "feature-card", "pricing-card", etc.
 *                                          Matches Generated Images.Section Type singleSelect.
 * @param {Object}  input.sectionContent    Structured content (headline, subhead, bodyText, productContext, facts, cta).
 * @param {string}  [input.slot]            Dimension preset: "hero", "card", "banner", etc. Default "hero".
 * @param {Object}  [input.brandTokens]     Override brand tokens; defaults to Travelgenix.
 * @param {Object}  [input.styleReference]  Stage E placeholder.
 * @param {string}  [input.briefOverride]   Skip brief generation, use this text instead (for lab / manual).
 * @param {string}  [input.source]          "composer" (default), "lab", "manual", "api".
 * @param {string}  [input.emailQueueId]    Link to Email Queue record this image is for.
 * @param {string}  [input.name]            Human-readable identifier; auto-generated if absent.
 *
 * @returns {Promise<{ok, pngUrl, brief, html, width, height, model, briefMs, htmlMs, hctiMs, totalMs, airtableRecordId, error?}>}
 */
async function generateImage(input) {
  const startedAt = Date.now();

  if (!input || !input.tenantId) {
    return { ok: false, error: "tenantId is required" };
  }
  if (!input.sectionType) {
    return { ok: false, error: "sectionType is required" };
  }
  if (!input.briefOverride && (!input.sectionContent || typeof input.sectionContent !== "object")) {
    return { ok: false, error: "sectionContent (or briefOverride) is required" };
  }

  const slot = input.slot && SLOT_DIMENSIONS[input.slot] ? input.slot : DEFAULT_SLOT;
  const { width, height } = SLOT_DIMENSIONS[slot];
  const source = input.source || "composer";

  // ─── STEP 1: BRIEF ────────────────────────────────────────────
  let brief, briefMs = 0;
  // screenshotImage: when the matched product had a Reference Screenshot,
  // the brief generator already downloaded and base64-encoded it. We
  // reuse the same bytes here for the HTML renderer call so Sonnet sees
  // the same image Opus did. Null when no product matched or no
  // screenshot available — Sonnet then works from the text brief alone.
  let screenshotImage = null;
  let matchedProductName = null;
  if (input.briefOverride) {
    brief = input.briefOverride;
  } else {
    const briefStart = Date.now();
    const briefResult = await generateBrief({
      sectionType: input.sectionType,
      sectionContent: input.sectionContent,
      brandTokens: input.brandTokens,
      styleReference: input.styleReference,
      outputContext: input.outputContext
    });
    briefMs = Date.now() - briefStart;

    if (!briefResult.ok) {
      // Log the failure so we have a record of what went wrong.
      await logToAirtable({
        name: buildName(input, "failed-brief"),
        tenantId: input.tenantId,
        sectionType: input.sectionType,
        status: "rejected",
        source,
        notes: `Brief generation failed: ${briefResult.error}\nStage: ${briefResult.stage || "unknown"}`
      });
      return {
        ok: false,
        error: `Brief generation failed: ${briefResult.error}`,
        stage: "brief",
        briefMs
      };
    }
    brief = briefResult.brief;
    screenshotImage = briefResult.screenshotImage || null;
    matchedProductName = briefResult.matchedProductName || null;
  }

  // ─── STEP 2: HTML (Sonnet writes it) ───────────────────────────
  const htmlStart = Date.now();
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Build the user message for the HTML renderer (Sonnet). When the
  // brief generator matched a product and downloaded its reference
  // screenshot, we pass the screenshot here as multimodal input so
  // Sonnet renders HTML that visually matches the source rather than
  // imagining what the product looks like. The text body of the
  // message references the screenshot explicitly so Sonnet knows to
  // use it.
  const userMessageText = screenshotImage
    ? `Brief: ${brief}

Canvas: ${width}x${height}px (this is the design size, the renderer outputs at ${DEFAULT_DEVICE_SCALE}x for retina)

A REFERENCE SCREENSHOT OF THE ACTUAL PRODUCT (${matchedProductName || "the product"}) IS ATTACHED ABOVE THIS TEXT.
The screenshot is the source of truth for how the product looks. Match the HTML render to what you SEE in the screenshot:
- Exact colours sampled from the screenshot (not approximated)
- Exact text strings (read them character-by-character off the screenshot)
- Exact icon shapes, exact positions, exact spacing
- Exact corner radii, shadow weight, border thickness
- Exact font weights and sizes (judge them from the screenshot)
The brief above tells you the COMPOSITION (canvas size, background, positioning of the product within the canvas). The screenshot tells you the PRODUCT itself. Combine both.

Produce the complete HTML document. Output ONLY the HTML, starting with <!DOCTYPE html>. No preamble, no markdown fences, no explanation.`
    : `Brief: ${brief}

Canvas: ${width}x${height}px (this is the design size, the renderer outputs at ${DEFAULT_DEVICE_SCALE}x for retina)

Produce the complete HTML document. Output ONLY the HTML, starting with <!DOCTYPE html>. No preamble, no markdown fences, no explanation.`;

  const userContent = screenshotImage
    ? [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: screenshotImage.mediaType,
            data: screenshotImage.data
          }
        },
        { type: "text", text: userMessageText }
      ]
    : userMessageText;

  let response;
  try {
    response = await client.messages.create({
      model: HTML_MODEL,
      max_tokens: HTML_MAX_TOKENS,
      system: HTML_RENDERER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }]
    });
  } catch (e) {
    const detail = e && e.message ? e.message : String(e);
    await logToAirtable({
      name: buildName(input, "failed-html"),
      tenantId: input.tenantId,
      sectionType: input.sectionType,
      brief,
      model: "sonnet",
      status: "rejected",
      source,
      notes: `HTML generation failed: ${detail.slice(0, 500)}`
    });
    return {
      ok: false,
      error: `HTML generation failed: ${detail.slice(0, 300)}`,
      stage: "html",
      brief,
      briefMs,
      htmlMs: Date.now() - htmlStart
    };
  }

  const htmlMs = Date.now() - htmlStart;

  if (!response || !response.content || !Array.isArray(response.content)) {
    return { ok: false, error: "Claude returned unexpected response shape", stage: "html-shape", brief, briefMs, htmlMs };
  }

  let rawText = "";
  for (const block of response.content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      rawText += block.text;
    }
  }

  const { html, error: parseError } = extractHtml(rawText);
  if (!html) {
    await logToAirtable({
      name: buildName(input, "failed-extract"),
      tenantId: input.tenantId,
      sectionType: input.sectionType,
      brief,
      model: "sonnet",
      status: "rejected",
      source,
      notes: `HTML extract failed: ${parseError}\nRaw text snippet: ${rawText.slice(0, 800)}`
    });
    return { ok: false, error: parseError, stage: "extract", brief, briefMs, htmlMs };
  }

  // ─── STEP 3: HCTI renders the HTML ─────────────────────────────
  const hctiStart = Date.now();
  const hctiResult = await generateHtmlImage({
    html,
    tenantId: input.tenantId,
    viewportWidth: width,
    viewportHeight: height,
    deviceScale: DEFAULT_DEVICE_SCALE
  });
  const hctiMs = Date.now() - hctiStart;

  if (!hctiResult.ok) {
    await logToAirtable({
      name: buildName(input, "failed-hcti"),
      tenantId: input.tenantId,
      sectionType: input.sectionType,
      brief,
      model: "sonnet",
      htmlSource: html,
      status: "rejected",
      source,
      notes: `HCTI render failed: ${hctiResult.error}`
    });
    return {
      ok: false,
      error: `HCTI render failed: ${hctiResult.error}`,
      stage: "hcti",
      brief,
      html,
      briefMs,
      htmlMs,
      hctiMs
    };
  }

  const totalMs = Date.now() - startedAt;

  // ─── STEP 4: Log success to Airtable ───────────────────────────
  const airtableResult = await logToAirtable({
    name: buildName(input, "ok"),
    tenantId: input.tenantId,
    sectionType: input.sectionType,
    brief,
    model: "sonnet",
    pngUrl: hctiResult.pngUrl,
    htmlSource: html,
    width: hctiResult.width,
    height: hctiResult.height,
    generationTime: totalMs,
    status: "active",
    source,
    usedInEmail: input.emailQueueId
  });

  return {
    ok: true,
    pngUrl: hctiResult.pngUrl,
    brief,
    html,
    width: hctiResult.width,
    height: hctiResult.height,
    viewportWidth: width,
    viewportHeight: height,
    model: "sonnet",
    briefMs,
    htmlMs,
    hctiMs,
    totalMs,
    airtableRecordId: airtableResult.ok ? airtableResult.recordId : null,
    airtableError: airtableResult.ok ? null : airtableResult.error,
    htmlSize: html.length,
    htmlCharCount: html.length,
    hctiUrl: hctiResult.hctiUrl,
    hctiId: hctiResult.hctiId
  };
}

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

function buildName(input, suffix) {
  if (input.name) return input.name;
  // e.g. "hero-2026-05-18-1431-a3f9"
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
  const tail = Math.random().toString(36).slice(2, 6);
  return `${input.sectionType}-${stamp}-${tail}${suffix === "ok" ? "" : "-" + suffix}`;
}

module.exports = {
  generateImage,
  _internals: {
    extractHtml,
    logToAirtable,
    HTML_RENDERER_SYSTEM_PROMPT,
    SLOT_DIMENSIONS,
    FIELDS
  }
};
