// lib/image-generator.js
//
// AI image generation pipeline.
//
// What this does:
//   1. Takes a brief (description, style, dimensions)
//   2. Prompts Claude to produce SVG matching brand and style
//   3. Validates the SVG output (parse, check for malicious content)
//   4. Rasterises SVG to PNG via sharp (which Vercel supports natively)
//   5. Uploads the PNG to Vercel Blob with a stable URL
//   6. Returns { svgSource, pngUrl, dimensions, auditId }
//
// For refinement, takes an existing SVG + a refinement prompt and produces a
// modified SVG. Much cheaper than full regeneration because the AI only has
// to make a delta.
//
// Brand awareness: the prompt knows about Travelgenix colours (navy #1B2B5B,
// teal #00B4D8) and Inter typography. SVG generated will match the email
// design system.
//
// Author: Travelgenix
// Date:   18 May 2026

const Anthropic = require("@anthropic-ai/sdk").default;
const { put } = require("@vercel/blob");
const sharp = require("sharp");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

const IMAGE_MODEL = "claude-opus-4-7";
const IMAGE_MAX_TOKENS = 8000;

// Standard dimensions for email image slots. The renderer's sections expect
// specific aspect ratios. Mapping here so the composer can request "hero"
// and get the right shape.
const SLOT_DIMENSIONS = {
  "hero": { width: 600, height: 320 },         // hero-image full width
  "hero-square": { width: 600, height: 600 },  // product-mockup style
  "feature-story": { width: 600, height: 240 },// feature-story card image
  "card": { width: 280, height: 200 },         // destination-grid card
  "thumbnail": { width: 200, height: 200 },    // square smaller image
  "banner": { width: 600, height: 180 }        // slim banner
};

const DEFAULT_DIMENSIONS = SLOT_DIMENSIONS["hero"];

// ─────────────────────────────────────────────────────────────────────
// THE SYSTEM PROMPT — how Claude generates SVG
// ─────────────────────────────────────────────────────────────────────

const BRAND_TOKENS = `
TRAVELGENIX BRAND TOKENS (use these exact colours):
- Navy (primary): #1B2B5B
- Navy dark: #0A0F1F
- Navy light: #2A3F7A
- Teal (accent): #00B4D8
- Teal light: #48CAE4
- Teal dark: #0096B7
- Text primary: #0F172A
- Text secondary: #475569
- Background primary: #FFFFFF
- Background secondary: #F8FAFC
- Background tertiary: #F1F5F9
- Border: #E2E8F0

TYPOGRAPHY: Inter font family. Use Inter for any text in the SVG.
If text appears: use Inter (with fallback to system-ui, -apple-system).
`;

function buildImageSystemPrompt(style, brandColours) {
  const colourBlock = brandColours
    ? `\nTENANT BRAND COLOURS (override defaults):\n- Primary: ${brandColours.primary || "#1B2B5B"}\n- Secondary: ${brandColours.secondary || "#00B4D8"}\n`
    : "";

  let styleBlock = "";

  if (style === "product-mockup") {
    styleBlock = `
STYLE: APPLE-STYLE PRODUCT MOCKUP

This is the Apple/Linear/Vercel aesthetic. Think:
- Clean device frame (browser window with chrome dots, or phone with notch)
- Minimal UI inside (a chat widget, dashboard card, search result)
- Soft drop shadow for depth (use feGaussianBlur with low opacity)
- Plenty of whitespace
- One or two accent colours, no rainbow
- Sharp typography, never bitmap text
- No gradients on text (flat colour only)
- Background should be calm — light grey (#F8FAFC) or subtle gradient

If the brief mentions a Luna product:
- Luna Chat: show a chat window with a message thread, navy header, teal send button
- Luna Marketing: show a dashboard card with stats or a calendar grid
- Travelify: show a search interface or booking confirmation
- Quick Quote: show a quote form with supplier results

Do NOT include:
- Real photos (we're generating vector mockups)
- Specific real people (no faces)
- Specific real places (no recognisable buildings)
- Logos other than abstract placeholder marks
- Text that makes specific factual claims (use lorem-style placeholders)
`;
  } else if (style === "abstract") {
    styleBlock = `
STYLE: ABSTRACT BRAND HERO

Geometric, editorial, designed. Think:
- Bold geometric shapes (circles, rectangles, organic curves)
- Layered composition with depth
- Navy and teal palette dominant
- Subtle gradients allowed (radial or linear, low angle)
- Negative space is good — don't fill every pixel
- Could be a stylised representation of a concept (connection, journey, growth)

The goal is "magazine-worthy hero illustration." Editorial design quality.
`;
  } else if (style === "lifestyle") {
    // Lifestyle images should normally come from Pexels, but if we have to fall back
    // to AI generation, produce a stylised version, not a photorealistic attempt.
    styleBlock = `
STYLE: STYLISED LIFESTYLE ILLUSTRATION

Photorealistic illustration is hard in SVG. Instead produce:
- Stylised, flat, editorial illustration (think Stripe/Linear hero illustrations)
- Soft geometric people if needed (no realistic faces — silhouettes or simplified)
- Travel motifs: planes, mountains, beaches as abstract shapes
- Limited palette: navy, teal, warm accent
- Storybook quality, not photo-realistic

If the brief truly needs photographic lifestyle, the system should have used
Pexels instead. You're the fallback when Pexels failed.
`;
  } else {
    // Default: cleaner geometric/abstract
    styleBlock = `
STYLE: CLEAN EDITORIAL GRAPHIC

Default Travelgenix visual style. Geometric, clean, on-brand.
- Navy and teal palette
- Bold simple shapes
- Plenty of whitespace
- No clip-art aesthetic
`;
  }

  return `You are an expert SVG illustrator producing assets for Travelgenix email marketing. You output ONLY valid SVG markup.

${BRAND_TOKENS}
${colourBlock}
${styleBlock}

OUTPUT RULES (CRITICAL):

1. Output ONLY a valid SVG element. No markdown code fences. No explanation. No JSON wrapper.
2. The SVG MUST have explicit width and height attributes matching the brief's dimensions.
3. The SVG MUST have a viewBox attribute matching the dimensions.
4. Use only inline styles or attributes (no external CSS classes).
5. NO <script> tags. NO foreignObject with HTML. NO external resources (no <image href="https://...">).
6. NO em dashes, en dashes, or non-ASCII punctuation in any text content.
7. Text inside SVG must use font-family="Inter, system-ui, -apple-system, sans-serif".
8. Use proper SVG primitives: rect, circle, ellipse, path, line, polygon, polyline, text, g.
9. Use filter elements for shadows (feGaussianBlur, feOffset, feMerge) — keep them simple.
10. Keep total SVG size under 50KB.

VERY IMPORTANT: Begin your response with "<svg" and end with "</svg>". Nothing else.`;
}

// ─────────────────────────────────────────────────────────────────────
// SVG VALIDATION & SANITISATION
// ─────────────────────────────────────────────────────────────────────

function extractSvg(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { svg: null, error: "Empty response" };
  }

  let cleaned = rawText.trim();
  // Strip markdown fences if AI ignored instructions
  cleaned = cleaned.replace(/^```(?:svg|xml|html)?\s*/i, "").replace(/```\s*$/, "").trim();

  // Find the SVG tag
  const startMatch = cleaned.match(/<svg[\s>]/i);
  if (!startMatch) return { svg: null, error: "No <svg> tag found in response" };

  const startIdx = startMatch.index;
  const endIdx = cleaned.lastIndexOf("</svg>");
  if (endIdx === -1) return { svg: null, error: "No </svg> closing tag found" };

  let svg = cleaned.slice(startIdx, endIdx + 6);

  // Strip <script> tags defensively (system prompt forbids them but defence in depth)
  if (/<script[\s>]/i.test(svg)) {
    return { svg: null, error: "SVG contains forbidden <script> tag" };
  }
  // Strip foreignObject (can contain arbitrary HTML)
  if (/<foreignObject[\s>]/i.test(svg)) {
    return { svg: null, error: "SVG contains forbidden <foreignObject>" };
  }
  // Strip javascript: hrefs
  if (/href\s*=\s*["']?\s*javascript:/i.test(svg)) {
    return { svg: null, error: "SVG contains javascript: URL" };
  }
  // Em/en dash check
  if (/[\u2013\u2014]/.test(svg)) {
    // Auto-replace with commas/periods rather than fail (cheap fix)
    svg = svg.replace(/[\u2013\u2014]/g, ",");
  }

  // Size cap
  if (svg.length > 100000) {
    return { svg: null, error: `SVG too large (${svg.length} bytes, max 100KB)` };
  }

  return { svg, error: null };
}

// ─────────────────────────────────────────────────────────────────────
// SVG -> PNG RASTERISATION via sharp
// ─────────────────────────────────────────────────────────────────────

async function rasteriseSvg(svgString, width, height) {
  try {
    const buffer = Buffer.from(svgString, "utf8");
    const png = await sharp(buffer, { density: 144 })  // higher density for crispness
      .resize(width, height, { fit: "fill" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    return { png, error: null };
  } catch (e) {
    return { png: null, error: `Rasterisation failed: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────
// BLOB UPLOAD
// ─────────────────────────────────────────────────────────────────────

async function uploadToBlob(pngBuffer, filename) {
  if (!BLOB_TOKEN) {
    return { url: null, error: "BLOB_READ_WRITE_TOKEN not configured" };
  }
  try {
    const blob = await put(filename, pngBuffer, {
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
      token: BLOB_TOKEN
    });
    return { url: blob.url, error: null };
  } catch (e) {
    return { url: null, error: `Blob upload failed: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────
// MAIN GENERATE FUNCTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an image from a brief.
 *
 * @param {Object} input
 * @param {string} input.brief — Description of what to draw
 * @param {string} input.style — "product-mockup" | "abstract" | "lifestyle" | undefined
 * @param {string} input.slot — One of SLOT_DIMENSIONS keys, defaults to "hero"
 * @param {Object} [input.brandColours] — {primary, secondary} hex strings
 * @param {string} [input.tenantId] — for Blob path prefixing
 *
 * @returns {Promise<{ok, svg, pngUrl, width, height, dimensions, error}>}
 */
async function generateImage(input) {
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured" };
  }
  if (!input || !input.brief || typeof input.brief !== "string") {
    return { ok: false, error: "brief is required" };
  }

  const style = input.style || "product-mockup";
  const slotKey = input.slot && SLOT_DIMENSIONS[input.slot] ? input.slot : "hero";
  const dimensions = SLOT_DIMENSIONS[slotKey];
  const tenantId = input.tenantId || "shared";

  const systemPrompt = buildImageSystemPrompt(style, input.brandColours);
  const userMessage = `Generate an SVG with these specifications:

Width: ${dimensions.width}px
Height: ${dimensions.height}px
Style: ${style}

Brief:
${input.brief}

Output ONLY the SVG markup. Begin with <svg and end with </svg>. No code fences, no explanation.`;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const startedAt = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: IMAGE_MODEL,
      max_tokens: IMAGE_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    });
  } catch (e) {
    return { ok: false, error: `Anthropic API error: ${e.message}` };
  }

  let rawText = "";
  for (const block of response.content) {
    if (block.type === "text") rawText += block.text;
  }

  const { svg, error: parseError } = extractSvg(rawText);
  if (!svg) {
    return { ok: false, error: parseError, rawTextSnippet: rawText.slice(0, 300) };
  }

  const { png, error: rasterError } = await rasteriseSvg(svg, dimensions.width, dimensions.height);
  if (!png) {
    return { ok: false, error: rasterError, svg };
  }

  // Upload to Blob
  const filename = `luna-marketing/${tenantId}/images/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.png`;
  const { url, error: uploadError } = await uploadToBlob(png, filename);
  if (!url) {
    return { ok: false, error: uploadError, svg };
  }

  return {
    ok: true,
    svg,
    pngUrl: url,
    width: dimensions.width,
    height: dimensions.height,
    dimensions: slotKey,
    style,
    elapsedMs: Date.now() - startedAt,
    usage: response.usage
  };
}

/**
 * Refine an existing SVG with a delta prompt.
 *
 * Reuses the same model but conditions on the existing SVG + the refinement
 * instruction. Cheaper than full regeneration because the model has the
 * starting point.
 */
async function refineImage(input) {
  if (!ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY not configured" };
  }
  if (!input || !input.existingSvg) {
    return { ok: false, error: "existingSvg is required" };
  }
  if (!input.refinementPrompt) {
    return { ok: false, error: "refinementPrompt is required" };
  }

  const style = input.style || "product-mockup";
  const slotKey = input.slot && SLOT_DIMENSIONS[input.slot] ? input.slot : "hero";
  const dimensions = SLOT_DIMENSIONS[slotKey];
  const tenantId = input.tenantId || "shared";

  const systemPrompt = buildImageSystemPrompt(style, input.brandColours);
  const userMessage = `Here is the existing SVG:

\`\`\`
${input.existingSvg}
\`\`\`

REFINEMENT: ${input.refinementPrompt}

Produce the COMPLETE new SVG (not a diff). Same dimensions (${dimensions.width}x${dimensions.height}). Apply the refinement while keeping the rest of the design intact. Output ONLY the SVG markup. Begin with <svg and end with </svg>.`;

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const startedAt = Date.now();

  let response;
  try {
    response = await client.messages.create({
      model: IMAGE_MODEL,
      max_tokens: IMAGE_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    });
  } catch (e) {
    return { ok: false, error: `Anthropic API error: ${e.message}` };
  }

  let rawText = "";
  for (const block of response.content) {
    if (block.type === "text") rawText += block.text;
  }

  const { svg, error: parseError } = extractSvg(rawText);
  if (!svg) {
    return { ok: false, error: parseError, rawTextSnippet: rawText.slice(0, 300) };
  }

  const { png, error: rasterError } = await rasteriseSvg(svg, dimensions.width, dimensions.height);
  if (!png) {
    return { ok: false, error: rasterError, svg };
  }

  const filename = `luna-marketing/${tenantId}/images/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.png`;
  const { url, error: uploadError } = await uploadToBlob(png, filename);
  if (!url) {
    return { ok: false, error: uploadError, svg };
  }

  return {
    ok: true,
    svg,
    pngUrl: url,
    width: dimensions.width,
    height: dimensions.height,
    dimensions: slotKey,
    style,
    elapsedMs: Date.now() - startedAt,
    usage: response.usage
  };
}

module.exports = {
  generateImage,
  refineImage,
  SLOT_DIMENSIONS,
  // Exported for testing
  _internals: { extractSvg, rasteriseSvg, uploadToBlob, buildImageSystemPrompt }
};
