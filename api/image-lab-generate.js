// api/image-lab-generate.js
//
// Test harness endpoint. Owner-only.
//
// Accepts a user-supplied system prompt and brief, generates SVG via Claude,
// rasterises to PNG, uploads to Blob. Returns SVG source, PNG URL, and timing.
//
// Used by /image-lab.html to iterate on prompt quality without redeploying.
//
// POST /api/image-lab-generate
// Body: {
//   systemPrompt: "full system prompt to use",
//   userBrief: "the brief for what to draw",
//   width: 1200,
//   height: 800,
//   maxTokens: 16000,
//   useReasoning: false  // if true, two-step: plan → SVG
// }
//
// Returns: { ok, svg, pngUrl, width, height, elapsedMs, usage, planText? }
//
// Auth: cookie session + must be owner (Travelgenix client ID).
//
// Author: Travelgenix
// Date:   18 May 2026
//
// NOTE: Vercel function timeout is set via vercel.json at the project root,
// not via export config. See vercel.json for the maxDuration setting.

const Anthropic = require("@anthropic-ai/sdk").default;
const { put } = require("@vercel/blob");
const sharp = require("sharp");
const { convertTextToPaths } = require("../lib/svg-text-to-path");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const MODEL = "claude-opus-4-7";
const DEFAULT_MAX_TOKENS = 16000;
const MAX_PROMPT_LEN = 30000;
const MAX_BRIEF_LEN = 2000;

// ─────────────────────────────────────────────────────────────────────
// AUTH — owner only
// ─────────────────────────────────────────────────────────────────────

async function validateOwnerSession(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  try {
    const meRes = await fetch(`${ID_HOST}/api/auth/me`, {
      method: "GET",
      headers: { cookie: cookie }
    });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    const data = await meRes.json();
    if (!data || !data.ok || !data.user || !data.user.email) {
      return { ok: false, status: 401, error: "Invalid session" };
    }

    // Verify owner
    const email = String(data.user.email).trim().toLowerCase();
    const formula = encodeURIComponent(`LOWER({Monthly Report Email})='${email.replace(/'/g, "\\'")}'`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=10&fields[]=Business Name`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
    if (!r.ok) return { ok: false, status: 502, error: "Tenant lookup failed" };
    const d = await r.json();
    const tenantIds = ((d && d.records) || []).map(rec => rec.id);
    if (!tenantIds.includes(OWNER_CLIENT_ID)) {
      return { ok: false, status: 403, error: "Owner only" };
    }
    return { ok: true, email };
  } catch (err) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// SVG EXTRACTION & SANITISATION
// ─────────────────────────────────────────────────────────────────────

function extractSvg(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { svg: null, error: "Empty response" };
  }
  let cleaned = rawText.trim();
  cleaned = cleaned.replace(/^```(?:svg|xml|html)?\s*/i, "").replace(/```\s*$/, "").trim();
  const startMatch = cleaned.match(/<svg[\s>]/i);
  if (!startMatch) return { svg: null, error: "No <svg> tag in response" };
  const startIdx = startMatch.index;
  const endIdx = cleaned.lastIndexOf("</svg>");
  if (endIdx === -1) return { svg: null, error: "No </svg> closing tag" };
  let svg = cleaned.slice(startIdx, endIdx + 6);

  // Security defence-in-depth
  if (/<script[\s>]/i.test(svg)) return { svg: null, error: "SVG contains <script>" };
  if (/<foreignObject[\s>]/i.test(svg)) return { svg: null, error: "SVG contains <foreignObject>" };
  if (/href\s*=\s*["']?\s*javascript:/i.test(svg)) return { svg: null, error: "SVG contains javascript: URL" };

  // Auto-replace em/en dashes (cheap)
  svg = svg.replace(/[\u2013\u2014]/g, ",");

  if (svg.length > 500000) return { svg: null, error: `SVG too large (${svg.length} bytes)` };
  return { svg, error: null };
}

async function rasteriseSvg(svgString, width, height) {
  try {
    const buffer = Buffer.from(svgString, "utf8");
    const png = await sharp(buffer, { density: 192 })
      .resize(width, height, { fit: "fill" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toBuffer();
    return { png, error: null };
  } catch (e) {
    return { png: null, error: `Rasterisation failed: ${e.message}` };
  }
}

async function uploadToBlob(pngBuffer, filename) {
  if (!BLOB_TOKEN) return { url: null, error: "BLOB_READ_WRITE_TOKEN not set" };
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
// HANDLER
// ─────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};

    if (!body.systemPrompt || typeof body.systemPrompt !== "string") {
      return res.status(400).json({ error: "systemPrompt is required" });
    }
    if (body.systemPrompt.length > MAX_PROMPT_LEN) {
      return res.status(400).json({ error: `systemPrompt too long (max ${MAX_PROMPT_LEN})` });
    }
    if (!body.userBrief || typeof body.userBrief !== "string") {
      return res.status(400).json({ error: "userBrief is required" });
    }
    if (body.userBrief.length > MAX_BRIEF_LEN) {
      return res.status(400).json({ error: `userBrief too long (max ${MAX_BRIEF_LEN})` });
    }

    const width = Math.max(200, Math.min(2400, parseInt(body.width, 10) || 1200));
    const height = Math.max(200, Math.min(2400, parseInt(body.height, 10) || 800));
    const maxTokens = Math.max(2000, Math.min(32000, parseInt(body.maxTokens, 10) || DEFAULT_MAX_TOKENS));
    const useReasoning = body.useReasoning === true;

    const auth = await validateOwnerSession(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const startedAt = Date.now();
    let planText = null;
    let usage = { total: { input_tokens: 0, output_tokens: 0 } };

    // ─── STEP 1 (optional): Reasoning pass ───────────────────────
    if (useReasoning) {
      const planSystem = `You are a senior visual designer planning an SVG illustration. Before any code is written, you produce a written design specification covering:

1. Composition (what's in each region of the canvas)
2. Typography (fonts, sizes, weights for each text element)
3. Colour palette (with hex values)
4. Specific content (real-looking placeholder text and data)
5. Hierarchy (what's biggest, what supports it)
6. Visual treatments (gradients, shadows, badges, glows)
7. Any data visualisations (charts, bars, progress indicators) and what they show

Be specific. "Three feature cards at the bottom" is not enough. Say "Three feature cards at the bottom, each ~280px wide, with: a coloured icon (purple/teal/coral, 40px), a heading in Inter Semibold 16px, a count in Inter Regular 13px secondary colour, a thin progress bar showing percentage."

Output the spec as plain prose. No JSON, no markdown headers, just specific design direction a junior designer could execute on.`;

      const planUserMsg = `Brief: ${body.userBrief}\nCanvas: ${width}x${height}px\n\nProduce the design specification.`;

      const planResponse = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: planSystem,
        messages: [{ role: "user", content: planUserMsg }]
      });

      planText = "";
      for (const block of planResponse.content) {
        if (block.type === "text") planText += block.text;
      }
      usage.plan = planResponse.usage;
    }

    // ─── STEP 2: Generate SVG ────────────────────────────────────
    const userMessage = useReasoning && planText
      ? `Brief: ${body.userBrief}\n\nCanvas: ${width}x${height}px\n\nDesign specification to execute:\n\n${planText}\n\nNow produce the complete SVG. Output ONLY the SVG markup. Begin with <svg and end with </svg>.`
      : `Brief: ${body.userBrief}\n\nCanvas: ${width}x${height}px\n\nProduce the complete SVG. Output ONLY the SVG markup. Begin with <svg and end with </svg>.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: body.systemPrompt,
      messages: [{ role: "user", content: userMessage }]
    });

    usage.svg = response.usage;

    let rawText = "";
    for (const block of response.content) {
      if (block.type === "text") rawText += block.text;
    }

    const { svg, error: parseError } = extractSvg(rawText);
    if (!svg) {
      return res.status(200).json({
        ok: false,
        error: parseError,
        planText,
        usage,
        rawTextSnippet: rawText.slice(0, 1000)
      });
    }

    // ─── STEP 2.5: Convert <text> to <path> for reliable rasterisation ──
    // libvips on Vercel can't find the fonts the AI specifies, so without this
    // step every glyph would render as a missing-glyph rectangle. By converting
    // text to actual path data, sharp can render perfectly regardless of system fonts.
    let textConvertedSvg = svg;
    let textConversionInfo = { count: 0, errors: [] };
    try {
      const conv = convertTextToPaths(svg);
      textConvertedSvg = conv.converted;
      textConversionInfo = { count: conv.count, errors: conv.errors };
    } catch (e) {
      // Don't fail the whole render — fall back to original SVG (will probably show tofu but better than nothing)
      console.warn("[image-lab-generate] Text-to-path failed, using original:", e.message);
      textConversionInfo.errors.push("Text conversion threw: " + e.message);
    }

    // ─── STEP 3: Rasterise ───────────────────────────────────────
    const { png, error: rasterError } = await rasteriseSvg(textConvertedSvg, width, height);
    if (!png) {
      return res.status(200).json({
        ok: false,
        error: rasterError,
        svg,
        textConvertedSvg,
        textConversionInfo,
        planText,
        usage
      });
    }

    // ─── STEP 4: Upload ──────────────────────────────────────────
    const filename = `luna-marketing/owner/lab/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.png`;
    const { url, error: uploadError } = await uploadToBlob(png, filename);
    if (!url) {
      return res.status(200).json({
        ok: false,
        error: uploadError,
        svg,
        planText,
        usage
      });
    }

    return res.status(200).json({
      ok: true,
      svg,
      pngUrl: url,
      width,
      height,
      elapsedMs: Date.now() - startedAt,
      usage,
      planText,
      svgSize: svg.length,
      textConversionInfo
    });

  } catch (err) {
    console.error("[image-lab-generate] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
