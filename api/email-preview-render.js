// api/email-preview-render.js
//
// Render a sections JSON array to HTML for in-composer preview.
//
// POST /api/email-preview-render
// Body: {
//   tenantId: "recXXX",
//   sections: [{type, props}, ...],
//   subject: "optional, just used as the <title>",
//   previewText: "optional"
// }
//
// Returns: { ok: true, html, plainText, warnings, errors }
//
// Auth: session cookie. Read-only — no Airtable writes. Tenant authorisation
// because the renderer needs the tenant's brand kit (Session 3 will wire that).
// For now, uses default Travelgenix brand regardless of tenant.
//
// Author: Travelgenix
// Date:   18 May 2026

const { renderEmail } = require("../lib/email-renderer");
const { prepareSections } = require("../lib/email-render-prepare");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const MAX_SECTIONS = 30;

// ─────────────────────────────────────────────────────────────────────
// AUTH (same pattern as the compose endpoints)
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
  if (isOwner) return { ok: true, effectiveTenantId: targetTenantId || OWNER_CLIENT_ID };
  if (targetTenantId && !tenantIds.includes(targetTenantId)) {
    return { ok: false, status: 403, error: "Not authorised for that tenant" };
  }
  return { ok: true, effectiveTenantId: targetTenantId || tenantIds[0] };
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
    if (!Array.isArray(body.sections)) {
      return res.status(400).json({ error: "sections must be an array" });
    }
    if (body.sections.length > MAX_SECTIONS) {
      return res.status(400).json({ error: `Too many sections (max ${MAX_SECTIONS})` });
    }

    const auth = await authoriseRequest(req, body.tenantId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // Sanitise sections — strip any UI-only props (anything starting with __)
    const cleanSections = body.sections.map(s => {
      if (!s || typeof s !== "object" || !s.type) return null;
      const cleanProps = {};
      if (s.props && typeof s.props === "object") {
        Object.keys(s.props).forEach(k => {
          if (k.indexOf("__") !== 0) cleanProps[k] = s.props[k];
        });
      }
      return { type: s.type, props: cleanProps };
    }).filter(Boolean);

    // Hydrate offer sections if any (Travelify network round-trip)
    let preparedSections = cleanSections;
    const prepareWarnings = [];
    try {
      const prepared = await prepareSections(cleanSections);
      preparedSections = prepared.sections;
      if (Array.isArray(prepared.warnings)) prepareWarnings.push(...prepared.warnings);
    } catch (e) {
      // Don't fail the whole render if offers fetch breaks — log and continue
      console.warn("[email-preview-render] prepareSections failed:", e.message);
      prepareWarnings.push("Offers fetch failed: " + e.message);
    }

    // Render — default Travelgenix brand (Session 3 will plumb in real tenant brand)
    const result = renderEmail({
      sections: preparedSections,
      subject: body.subject || "Preview",
      title: body.subject || "Preview",
      previewText: body.previewText || "",
      unsubUrl: "#preview"
    });

    return res.status(200).json({
      ok: true,
      html: result.html,
      plainText: result.plainText,
      warnings: [...(result.warnings || []), ...prepareWarnings],
      errors: result.errors || []
    });

  } catch (err) {
    console.error("[email-preview-render] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
