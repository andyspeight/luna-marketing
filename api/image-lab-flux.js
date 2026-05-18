// api/image-lab-flux.js
//
// FLUX 1.1 Pro Ultra generation endpoint for the image lab. Owner only.
//
// POST /api/image-lab-flux
// Body: {
//   brief: "Greek island village at sunset, white buildings, blue domes",
//   aspectRatio: "16:9" | "1:1" | "4:3" | "21:9" | "3:1",
//   raw: false,        // true = less stylised, more photographic
//   safetyTolerance: 2,
//   rawPrompt: false   // true = skip enrichment, use brief verbatim
// }
//
// Returns: { ok, pngUrl, originalUrl, width, height, finalPrompt, elapsedMs, predictionId }
//
// Author: Travelgenix
// Date:   18 May 2026

const { generateFluxImage } = require("../lib/flux-generator");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const MAX_BRIEF_LEN = 2000;
const VALID_ASPECT_RATIOS = ["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "9:21", "3:1"];

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

    if (!body.brief || typeof body.brief !== "string" || body.brief.trim().length === 0) {
      return res.status(400).json({ error: "brief is required" });
    }
    if (body.brief.length > MAX_BRIEF_LEN) {
      return res.status(400).json({ error: `brief too long (max ${MAX_BRIEF_LEN})` });
    }
    if (body.aspectRatio && !VALID_ASPECT_RATIOS.includes(body.aspectRatio)) {
      return res.status(400).json({ error: `aspectRatio must be one of: ${VALID_ASPECT_RATIOS.join(", ")}` });
    }

    const auth = await validateOwnerSession(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // Derive slot from aspect ratio for proper output dimensions
    let slot = "hero";
    if (body.aspectRatio === "1:1") slot = "hero-square";
    else if (body.aspectRatio === "21:9") slot = "feature-story";
    else if (body.aspectRatio === "4:3") slot = "card";
    else if (body.aspectRatio === "3:1") slot = "banner";
    // else default "hero" (16:9)

    const result = await generateFluxImage({
      brief: body.brief,
      slot,
      aspectRatio: body.aspectRatio,
      raw: body.raw === true,
      safetyTolerance: parseInt(body.safetyTolerance, 10) || 2,
      rawPrompt: body.rawPrompt === true,
      tenantId: OWNER_CLIENT_ID
    });

    if (!result.ok) {
      console.error("[image-lab-flux] failed:", result.error);
      return res.status(500).json({ error: result.error, predictionId: result.predictionId });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error("[image-lab-flux] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
