// api/image-generate.js
//
// POST /api/image-generate
// Body: {
//   tenantId: "recXXX",
//   brief: "Apple-style mockup of a chat widget on a travel website",
//   style: "product-mockup" | "abstract" | "lifestyle",
//   slot: "hero" | "hero-square" | "feature-story" | "card" | "thumbnail" | "banner",
//   brandColours: { primary, secondary }  // optional
// }
//
// Returns: { ok, pngUrl, svg, width, height, dimensions, elapsedMs }
//
// Rate limit: 20 image generations per user per hour (cost control).
// Auth: session cookie required.
//
// Author: Travelgenix
// Date:   18 May 2026

const { generateImage } = require("../lib/image-generator");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const MAX_BRIEF_LENGTH = 1000;
const VALID_STYLES = ["product-mockup", "abstract", "lifestyle"];
const VALID_SLOTS = ["hero", "hero-square", "feature-story", "card", "thumbnail", "banner"];

// ─────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────

async function validateSession(req) {
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
    return { ok: true, email: String(data.user.email).trim().toLowerCase() };
  } catch (err) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
}

async function lookupTenantsForEmail(email) {
  const formula = encodeURIComponent(`LOWER({Monthly Report Email})='${email.replace(/'/g, "\\'")}'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=10&fields[]=Business Name`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
  if (!r.ok) return [];
  const d = await r.json();
  return ((d && d.records) || []).map(rec => rec.id);
}

async function authoriseRequest(req, targetTenantId) {
  const session = await validateSession(req);
  if (!session.ok) return session;

  const tenantIds = await lookupTenantsForEmail(session.email);
  if (tenantIds.length === 0) {
    return { ok: false, status: 404, error: "No tenant profile found" };
  }

  const isOwner = tenantIds.includes(OWNER_CLIENT_ID);
  if (isOwner) return { ok: true, email: session.email, effectiveTenantId: targetTenantId || OWNER_CLIENT_ID };
  if (targetTenantId && !tenantIds.includes(targetTenantId)) {
    return { ok: false, status: 403, error: "Not authorised for that tenant" };
  }
  return { ok: true, email: session.email, effectiveTenantId: targetTenantId || tenantIds[0] };
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

    if (!body.tenantId || !/^rec[A-Za-z0-9]{14}$/.test(body.tenantId)) {
      return res.status(400).json({ error: "Invalid or missing tenantId" });
    }
    if (!body.brief || typeof body.brief !== "string" || body.brief.trim().length === 0) {
      return res.status(400).json({ error: "brief is required" });
    }
    if (body.brief.length > MAX_BRIEF_LENGTH) {
      return res.status(400).json({ error: `brief must be under ${MAX_BRIEF_LENGTH} chars` });
    }
    if (body.style && !VALID_STYLES.includes(body.style)) {
      return res.status(400).json({ error: `style must be one of: ${VALID_STYLES.join(", ")}` });
    }
    if (body.slot && !VALID_SLOTS.includes(body.slot)) {
      return res.status(400).json({ error: `slot must be one of: ${VALID_SLOTS.join(", ")}` });
    }

    const auth = await authoriseRequest(req, body.tenantId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const result = await generateImage({
      brief: body.brief,
      style: body.style || "product-mockup",
      slot: body.slot || "hero",
      brandColours: body.brandColours,
      tenantId: auth.effectiveTenantId
    });

    if (!result.ok) {
      console.error("[image-generate] generation failed:", result.error);
      return res.status(500).json({ error: result.error || "Generation failed" });
    }

    return res.status(200).json({
      ok: true,
      pngUrl: result.pngUrl,
      svg: result.svg,
      width: result.width,
      height: result.height,
      dimensions: result.dimensions,
      style: result.style,
      elapsedMs: result.elapsedMs
    });

  } catch (err) {
    console.error("[image-generate] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
