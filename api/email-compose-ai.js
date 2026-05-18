// api/email-compose-ai.js
//
// Vercel API route for AI-driven email composition.
//
// POST /api/email-compose-ai
// Body: {
//   tenantId: "recXXX",
//   intent: "Write an email about Luna Chat for Boost-tier clients",
//   archetype: "marketing-newsletter" | "b2b-weekly" | "product-launch" | "transactional",
//   audience: "Cold" | "Nurture" | "Client" | "Drip",
//   audienceSegment: "optional label",
//   featureProductIds: ["recXXX"],   // optional
//   toneOverrides: "optional"
// }
//
// Auth: cookie session via id.travelify.io. Tenant authorisation enforced.
//
// Returns: draft object — see content-composer-core for shape.
//
// Author: Travelgenix
// Date:   18 May 2026

const { compose } = require("../lib/content-composer-core");
const emailAdaptor = require("../lib/content-composer-email");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const VALID_ARCHETYPES = ["b2b-weekly", "marketing-newsletter", "product-launch", "transactional"];
const VALID_AUDIENCES = ["Cold", "Nurture", "Client", "Drip"];

// ─────────────────────────────────────────────────────────────────────
// AUTH (same pattern as content-engine-products.js)
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
    return { ok: true, email: String(data.user.email).trim().toLowerCase(), fullName: data.user.fullName || "" };
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
    return { ok: false, status: 404, error: "No tenant profile found for your account" };
  }

  const isOwner = tenantIds.includes(OWNER_CLIENT_ID);
  if (isOwner) {
    return {
      ok: true,
      email: session.email,
      isOwner: true,
      effectiveTenantId: targetTenantId || OWNER_CLIENT_ID
    };
  }

  if (targetTenantId && !tenantIds.includes(targetTenantId)) {
    return { ok: false, status: 403, error: "Not authorised for that tenant" };
  }

  return {
    ok: true,
    email: session.email,
    isOwner: false,
    effectiveTenantId: targetTenantId || tenantIds[0]
  };
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

    // Input validation
    if (!body.tenantId || !/^rec[A-Za-z0-9]{14}$/.test(body.tenantId)) {
      return res.status(400).json({ error: "Invalid or missing tenantId" });
    }
    if (!body.intent || typeof body.intent !== "string" || body.intent.trim().length === 0) {
      return res.status(400).json({ error: "intent is required" });
    }
    if (body.intent.length > 2000) {
      return res.status(400).json({ error: "intent must be under 2000 characters" });
    }
    if (body.archetype && !VALID_ARCHETYPES.includes(body.archetype)) {
      return res.status(400).json({ error: `archetype must be one of: ${VALID_ARCHETYPES.join(", ")}` });
    }
    if (body.audience && !VALID_AUDIENCES.includes(body.audience)) {
      return res.status(400).json({ error: `audience must be one of: ${VALID_AUDIENCES.join(", ")}` });
    }
    if (body.featureProductIds && !Array.isArray(body.featureProductIds)) {
      return res.status(400).json({ error: "featureProductIds must be an array" });
    }
    if (Array.isArray(body.featureProductIds)) {
      for (const id of body.featureProductIds) {
        if (typeof id !== "string" || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
          return res.status(400).json({ error: `Invalid product ID in featureProductIds: ${id}` });
        }
      }
    }

    // Auth + tenant authorisation
    const auth = await authoriseRequest(req, body.tenantId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // Call core composer
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const draft = await compose({
      tenantId: auth.effectiveTenantId,
      intent: body.intent,
      archetype: body.archetype || "marketing-newsletter",
      audience: body.audience || "Client",
      audienceSegment: body.audienceSegment,
      audienceContext: body.audienceContext,
      featureProductIds: body.featureProductIds,
      toneOverrides: body.toneOverrides,
      actor: auth.email,
      ip
    }, emailAdaptor);

    return res.status(200).json({ ok: true, draft });

  } catch (err) {
    console.error("[email-compose-ai] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
