// api/image-generate-v2.js
//
// POST /api/image-generate-v2
// Body: {
//   tenantId: "recXXX",
//
//   // Section spec (composer normally provides these)
//   sectionType: "hero" | "feature-card" | "pricing-card" | "data-card"
//              | "product-mockup" | "comparison" | "value-prop"
//              | "destination-spotlight" | "other",
//   sectionContent: {
//     headline?: string,
//     subhead?: string,
//     bodyText?: string,
//     productContext?: string,
//     facts?: string[],
//     cta?: string
//   },
//   slot?: "hero" | "hero-square" | "card" | "banner" | ...,
//
//   // Optional overrides
//   brandTokens?: { brandName, navy, teal, audience, tone },
//   styleReference?: { layoutPattern, typographyFeel, density, mood },  // Stage E
//   briefOverride?: string,   // Use this brief, skip generation
//   source?: "composer" | "lab" | "manual" | "api",  // default "composer"
//   emailQueueId?: string,    // Link in Airtable
//   name?: string             // Auto-generated if absent
// }
//
// Returns:
//   { ok, pngUrl, brief, html, width, height, viewportWidth, viewportHeight,
//     model, briefMs, htmlMs, hctiMs, totalMs,
//     airtableRecordId, htmlSize }
//
// Auth: session cookie required. Owner can target any tenant. Others can
// only target tenants they own.
//
// Author: Travelgenix
// Date:   18 May 2026

const { generateImage } = require("../lib/image-generator-v2");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const VALID_SECTION_TYPES = [
  "hero", "feature-card", "pricing-card", "data-card",
  "product-mockup", "comparison", "value-prop",
  "destination-spotlight", "other"
];
const VALID_SLOTS = [
  "hero", "hero-square", "hero-tall", "feature-story",
  "card", "card-square", "thumbnail", "banner", "wide"
];
const VALID_SOURCES = ["composer", "lab", "manual", "api"];

const MAX_HEADLINE_LEN = 300;
const MAX_BODY_LEN = 3000;
const MAX_BRIEF_OVERRIDE_LEN = 5000;

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
  if (isOwner) {
    return { ok: true, email: session.email, effectiveTenantId: targetTenantId || OWNER_CLIENT_ID };
  }
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

    // ─── VALIDATION ───────────────────────────────────────────
    if (!body.sectionType || typeof body.sectionType !== "string") {
      return res.status(400).json({ error: "sectionType is required" });
    }
    if (!VALID_SECTION_TYPES.includes(body.sectionType)) {
      return res.status(400).json({ error: `sectionType must be one of: ${VALID_SECTION_TYPES.join(", ")}` });
    }
    if (body.slot && !VALID_SLOTS.includes(body.slot)) {
      return res.status(400).json({ error: `slot must be one of: ${VALID_SLOTS.join(", ")}` });
    }
    if (body.source && !VALID_SOURCES.includes(body.source)) {
      return res.status(400).json({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` });
    }

    // Either sectionContent OR briefOverride must be present
    if (!body.briefOverride && (!body.sectionContent || typeof body.sectionContent !== "object")) {
      return res.status(400).json({ error: "sectionContent (or briefOverride) is required" });
    }

    if (body.briefOverride) {
      if (typeof body.briefOverride !== "string") {
        return res.status(400).json({ error: "briefOverride must be a string" });
      }
      if (body.briefOverride.length > MAX_BRIEF_OVERRIDE_LEN) {
        return res.status(400).json({ error: `briefOverride too long (max ${MAX_BRIEF_OVERRIDE_LEN})` });
      }
    } else {
      const sc = body.sectionContent;
      if (sc.headline && (typeof sc.headline !== "string" || sc.headline.length > MAX_HEADLINE_LEN)) {
        return res.status(400).json({ error: "headline must be a string <= " + MAX_HEADLINE_LEN + " chars" });
      }
      if (sc.subhead && (typeof sc.subhead !== "string" || sc.subhead.length > MAX_HEADLINE_LEN)) {
        return res.status(400).json({ error: "subhead must be a string <= " + MAX_HEADLINE_LEN + " chars" });
      }
      if (sc.bodyText && (typeof sc.bodyText !== "string" || sc.bodyText.length > MAX_BODY_LEN)) {
        return res.status(400).json({ error: "bodyText must be a string <= " + MAX_BODY_LEN + " chars" });
      }
      if (sc.facts && !Array.isArray(sc.facts)) {
        return res.status(400).json({ error: "facts must be an array of strings" });
      }
    }

    // ─── AUTH ─────────────────────────────────────────────────
    const auth = await authoriseRequest(req, body.tenantId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // ─── GENERATE ─────────────────────────────────────────────
    const result = await generateImage({
      tenantId: auth.effectiveTenantId,
      sectionType: body.sectionType,
      sectionContent: body.sectionContent,
      slot: body.slot,
      brandTokens: body.brandTokens,
      styleReference: body.styleReference,
      briefOverride: body.briefOverride,
      source: body.source || "composer",
      emailQueueId: body.emailQueueId,
      name: body.name
    });

    if (!result.ok) {
      console.error("[image-generate-v2] generation failed:", result.error, "stage:", result.stage);
      return res.status(200).json({
        ok: false,
        error: result.error,
        stage: result.stage,
        brief: result.brief,
        briefMs: result.briefMs,
        htmlMs: result.htmlMs,
        hctiMs: result.hctiMs
      });
    }

    return res.status(200).json({
      ok: true,
      pngUrl: result.pngUrl,
      brief: result.brief,
      html: result.html,
      width: result.width,
      height: result.height,
      viewportWidth: result.viewportWidth,
      viewportHeight: result.viewportHeight,
      model: result.model,
      briefMs: result.briefMs,
      htmlMs: result.htmlMs,
      hctiMs: result.hctiMs,
      totalMs: result.totalMs,
      htmlSize: result.htmlSize,
      airtableRecordId: result.airtableRecordId,
      airtableError: result.airtableError
    });

  } catch (err) {
    console.error("[image-generate-v2] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
