// api/image-lab-html.js
//
// Lab endpoint for the Claude → HTML/CSS → Chrome rendering pipeline.
// Owner only.
//
// POST /api/image-lab-html
// Body: {
//   systemPrompt: "full system prompt that tells Claude how to write HTML",
//   userBrief:    "what to draw",
//   viewportWidth:  1200,  // logical pixels
//   viewportHeight: 800,
//   deviceScale:    2,     // 1, 2, or 3
//   maxTokens:      16000  // max tokens for the HTML generation
// }
//
// Returns:
//   { ok, html, pngUrl, hctiUrl, hctiId, width, height,
//     viewportWidth, viewportHeight, deviceScale,
//     htmlSize, elapsedMs, claudeMs, hctiMs, usage }
//
// Auth: cookie session + must be owner (Travelgenix client ID).
//
// Author: Travelgenix
// Date:   18 May 2026

const Anthropic = require("@anthropic-ai/sdk").default;
const { generateHtmlImage } = require("../lib/html-image-generator");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
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
// AUTH
// ─────────────────────────────────────────────────────────────────────

async function validateOwnerSession(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  try {
    const meRes = await fetch(`${ID_HOST}/api/auth/me`, { headers: { cookie } });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    const data = await meRes.json();
    if (!data || !data.ok || !data.user || !data.user.email) {
      return { ok: false, status: 401, error: "Invalid session" };
    }
    const email = String(data.user.email).trim().toLowerCase();
    const formula = encodeURIComponent(`LOWER({Monthly Report Email})='${email.replace(/'/g, "\\'")}'`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=10&fields[]=Business Name`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
    if (!r.ok) return { ok: false, status: 502, error: "Tenant lookup failed" };
    const d = await r.json();
    const tenantIds = ((d && d.records) || []).map(rec => rec.id);
    if (!tenantIds.includes(OWNER_CLIENT_ID)) return { ok: false, status: 403, error: "Owner only" };
    return { ok: true };
  } catch (err) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────
// HTML EXTRACTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract the HTML document from Claude's response. Strips any markdown
 * fences and surrounding chat. Also runs basic security sanitisation —
 * we reject anything containing <script> tags (HCTI executes them but
 * we don't want arbitrary JS in our pipeline) unless the user explicitly
 * opted in. For Travelgenix marketing imagery, static HTML+CSS is plenty.
 */
function extractHtml(rawText) {
  if (!rawText || typeof rawText !== "string") {
    return { html: null, error: "Empty response" };
  }
  let cleaned = rawText.trim();

  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:html|xml)?\s*/i, "").replace(/```\s*$/, "").trim();

  // Find the start of the HTML
  const startMatch = cleaned.match(/<(!DOCTYPE\s+html|html|head|body|style|div|section|article|main)[\s>]/i);
  if (!startMatch) {
    return { html: null, error: "No HTML tag found in response" };
  }
  let html = cleaned.slice(startMatch.index);

  // Defence-in-depth: reject <script> tags. We're generating static
  // marketing imagery — no JS needed. HCTI would execute them.
  if (/<script[\s>]/i.test(html)) {
    return { html: null, error: "HTML contains <script> tag (not allowed in lab)" };
  }

  // Auto-replace em/en dashes if Claude slipped any in despite the prompt
  html = html.replace(/[\u2013\u2014]/g, ",");

  if (html.length < 100) {
    return { html: null, error: `HTML too short (${html.length} chars)` };
  }

  return { html, error: null };
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

    const viewportWidth = Math.max(200, Math.min(2400, parseInt(body.viewportWidth, 10) || 1200));
    const viewportHeight = Math.max(200, Math.min(2400, parseInt(body.viewportHeight, 10) || 800));
    const deviceScale = Math.max(1, Math.min(3, parseInt(body.deviceScale, 10) || 2));
    const maxTokens = Math.max(2000, Math.min(32000, parseInt(body.maxTokens, 10) || DEFAULT_MAX_TOKENS));

    const auth = await validateOwnerSession(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const startedAt = Date.now();

    // ─── STEP 1: Claude generates HTML ──────────────────────────
    const claudeStart = Date.now();
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const userMessage = `Brief: ${body.userBrief}

Canvas: ${viewportWidth}x${viewportHeight}px (this is the design size — the renderer outputs at ${deviceScale}x for retina, so final PNG is ${viewportWidth * deviceScale}x${viewportHeight * deviceScale}px)

Produce the complete HTML document. Output ONLY the HTML, starting with <!DOCTYPE html>. No preamble, no markdown fences, no explanation.`;

    let response;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: body.systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      });
    } catch (e) {
      return res.status(200).json({
        ok: false,
        error: `Claude API error: ${e.message}`,
        stage: "claude"
      });
    }

    const claudeMs = Date.now() - claudeStart;

    let rawText = "";
    for (const block of response.content) {
      if (block.type === "text") rawText += block.text;
    }

    const { html, error: parseError } = extractHtml(rawText);
    if (!html) {
      return res.status(200).json({
        ok: false,
        error: parseError,
        stage: "extract",
        rawTextSnippet: rawText.slice(0, 1500),
        usage: response.usage,
        claudeMs
      });
    }

    // ─── STEP 2: HCTI renders the HTML in Chrome ───────────────
    const hctiStart = Date.now();
    const result = await generateHtmlImage({
      html,
      tenantId: OWNER_CLIENT_ID,
      viewportWidth,
      viewportHeight,
      deviceScale
    });
    const hctiMs = Date.now() - hctiStart;

    if (!result.ok) {
      return res.status(200).json({
        ok: false,
        error: result.error,
        stage: "hcti",
        html, // include so we can inspect what Claude wrote
        htmlSize: html.length,
        usage: response.usage,
        claudeMs,
        hctiMs
      });
    }

    return res.status(200).json({
      ok: true,
      html,
      pngUrl: result.pngUrl,
      hctiUrl: result.hctiUrl,
      hctiId: result.hctiId,
      width: result.width,
      height: result.height,
      viewportWidth: result.viewportWidth,
      viewportHeight: result.viewportHeight,
      deviceScale: result.deviceScale,
      htmlSize: html.length,
      elapsedMs: Date.now() - startedAt,
      claudeMs,
      hctiMs,
      usage: response.usage
    });

  } catch (err) {
    console.error("[image-lab-html] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
