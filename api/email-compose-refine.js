// api/email-compose-refine.js
//
// Vercel API route for AI-driven email refinement.
//
// POST /api/email-compose-refine
// Body: {
//   tenantId: "recXXX",
//   currentDraft: { ... full draft object ... },
//   refinementPrompt: "Make it shorter / Lead with the offer / etc",
//   refinementHistory: [{prompt, result}, ...]  // optional, previous refinements
// }
//
// Returns: new draft object with the same shape as compose.
//
// Author: Travelgenix
// Date:   18 May 2026

const { refine } = require("../lib/content-composer-core");
const emailAdaptor = require("../lib/content-composer-email");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const MAX_REFINEMENTS = 10;
const MAX_PROMPT_LEN = 1000;

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

    if (!body.tenantId || !/^rec[A-Za-z0-9]{14}$/.test(body.tenantId)) {
      return res.status(400).json({ error: "Invalid or missing tenantId" });
    }
    if (!body.refinementPrompt || typeof body.refinementPrompt !== "string") {
      return res.status(400).json({ error: "refinementPrompt is required" });
    }
    if (body.refinementPrompt.length > MAX_PROMPT_LEN) {
      return res.status(400).json({ error: `refinementPrompt must be under ${MAX_PROMPT_LEN} characters` });
    }
    if (!body.currentDraft || typeof body.currentDraft !== "object") {
      return res.status(400).json({ error: "currentDraft is required" });
    }
    if (body.refinementHistory && !Array.isArray(body.refinementHistory)) {
      return res.status(400).json({ error: "refinementHistory must be an array" });
    }
    if (body.refinementHistory && body.refinementHistory.length >= MAX_REFINEMENTS) {
      return res.status(429).json({
        error: `Refinement limit reached (${MAX_REFINEMENTS}). Start a new draft for a clearer brief.`
      });
    }

    const auth = await authoriseRequest(req, body.tenantId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const draft = await refine({
      tenantId: auth.effectiveTenantId,
      refinementPrompt: body.refinementPrompt,
      currentDraft: body.currentDraft,
      refinementHistory: body.refinementHistory || [],
      actor: auth.email,
      ip
    }, emailAdaptor);

    return res.status(200).json({ ok: true, draft });

  } catch (err) {
    console.error("[email-compose-refine] error:", err);
    if (/refinement limit/i.test(err.message)) {
      return res.status(429).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
