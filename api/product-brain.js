// api/product-brain.js
//
// Product Brain dashboard API.
//
// GET  /api/product-brain?tenantId=recXXX
//   → { ok, tenantId, isOwner, mainWebsiteUrl, products: [ ... ] }
//   Lists this tenant's products with their brain state (summary, change log,
//   freshness, source URLs, supplement, canonical copy).
//
// POST /api/product-brain
//   { tenantId, action, ... }
//   actions:
//     "refresh"        { productId? }            — re-scan one product now (or all if omitted)
//     "save-source-urls" { productId, sourceUrls }
//     "save-supplement"  { productId, supplement }
//     "apply-canonical"  { productId, field, value }  — accept a suggested change
//
// Auth: cookie session via id.travelify.io. Owner can target any tenant; other
// users only their own. Same pattern as email-compose-ai.js / content-engine.
//
// Author: Travelgenix
// Date:   16 June 2026

const Anthropic = require("@anthropic-ai/sdk").default;
const {
  refreshProductBrain,
  listScannableProducts,
  loadMainWebsiteUrl,
  parseSourceUrls,
  freshnessFor,
  saveBrain,
  PL_FIELDS
} = require("../lib/product-brain");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PRODUCTS_TABLE = "tblGBl8X3RIVnCwDM";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const AUDIT_LOG_TABLE = "Audit Log";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

// Canonical fields a suggestion may be applied to, mapped to their field IDs.
const CANONICAL_FIELDS = {
  "One-liner": PL_FIELDS.oneLiner,
  "Problem solved": PL_FIELDS.problem,
  "Proof point": PL_FIELDS.proof
};

const TIME_BUDGET_MS = 270 * 1000;

// ─────────────────────────────────────────────────────────────────────
// AUTH (mirrors email-compose-ai.js)
// ─────────────────────────────────────────────────────────────────────

async function validateSession(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  try {
    const meRes = await fetch(`${ID_HOST}/api/auth/me`, { method: "GET", headers: { cookie } });
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
  if (tenantIds.length === 0) return { ok: false, status: 404, error: "No tenant profile found for your account" };
  const isOwner = tenantIds.includes(OWNER_CLIENT_ID);
  if (isOwner) {
    return { ok: true, email: session.email, isOwner: true, effectiveTenantId: targetTenantId || OWNER_CLIENT_ID };
  }
  if (targetTenantId && !tenantIds.includes(targetTenantId)) {
    return { ok: false, status: 403, error: "Not authorised for that tenant" };
  }
  return { ok: true, email: session.email, isOwner: false, effectiveTenantId: targetTenantId || tenantIds[0] };
}

// ─────────────────────────────────────────────────────────────────────
// AIRTABLE
// ─────────────────────────────────────────────────────────────────────

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Airtable ${r.status}: ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function getProduct(productId) {
  return airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCTS_TABLE}/${productId}`);
}

function productBelongsToTenant(product, tenantId) {
  const tenants = (product.fields && product.fields["Tenant"]) || [];
  return tenants.includes(tenantId);
}

async function listTenantProducts(tenantId) {
  const all = [];
  let offset = null;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const data = await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCTS_TABLE}?${params.toString()}`);
    (data.records || []).forEach(rec => all.push(rec));
    offset = data.offset;
  } while (offset);
  return all.filter(rec => productBelongsToTenant(rec, tenantId));
}

async function writeAuditLog(entry) {
  if (!AIRTABLE_KEY) return;
  try {
    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`, {
      method: "POST",
      body: JSON.stringify({
        records: [{
          fields: {
            "Event ID": eventId,
            "Timestamp": new Date().toISOString(),
            "Actor": entry.actor || "product-brain",
            "Action": "edit",
            "Subject Type": "product",
            "Subject ID": entry.productId || "",
            "Details": JSON.stringify(entry.details || {}).slice(0, 5000)
          }
        }],
        typecast: true
      })
    });
  } catch (e) {
    console.error("[product-brain] audit log failed (non-fatal):", e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// SERIALISATION
// ─────────────────────────────────────────────────────────────────────

function val(f, key) {
  const v = f[key];
  if (v && typeof v === "object" && !Array.isArray(v)) return v.name || ""; // singleSelect object
  return v == null ? "" : v;
}

function serialiseProduct(rec) {
  const f = rec.fields || {};
  const lastRefreshed = f["Brain Last Refreshed"] || "";
  const storedStatus = val(f, "Brain Status");
  // Trust an Error status verbatim; otherwise derive freshness from the date so
  // the UI shows Stale once a refresh is overdue without needing a write.
  const freshness = storedStatus === "Error" ? "Error" : freshnessFor(lastRefreshed);
  return {
    id: rec.id,
    name: f["Name"] || "(unnamed)",
    status: val(f, "Status") || "Active",
    priority: f["Priority"] || 0,
    sourceUrls: f["Source URLs"] || "",
    sourceUrlCount: parseSourceUrls(f["Source URLs"]).length,
    supplement: f["Supplement"] || "",
    brainSummary: f["Brain Summary"] || "",
    brainChangeLog: f["Brain Change Log"] || "",
    lastRefreshed,
    freshness,
    canonical: {
      "One-liner": f["One-liner"] || "",
      "Problem solved": f["Problem solved"] || "",
      "Proof point": f["Proof point"] || ""
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!AIRTABLE_KEY) return res.status(500).json({ error: "Service not configured" });

  try {
    // ── GET: list ──────────────────────────────────────────────────
    if (req.method === "GET") {
      const targetTenant = req.query.tenantId || null;
      const auth = await authoriseRequest(req, targetTenant);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

      const [records, mainWebsiteUrl] = await Promise.all([
        listTenantProducts(auth.effectiveTenantId),
        loadMainWebsiteUrl(auth.effectiveTenantId)
      ]);
      const products = records
        .map(serialiseProduct)
        .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.name.localeCompare(b.name));

      return res.status(200).json({
        ok: true,
        tenantId: auth.effectiveTenantId,
        isOwner: auth.isOwner,
        mainWebsiteUrl,
        products
      });
    }

    // ── POST: actions ──────────────────────────────────────────────
    if (req.method === "POST") {
      const body = req.body || {};
      const action = body.action;
      const auth = await authoriseRequest(req, body.tenantId || null);
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

      // Validate productId (when the action needs one) and confirm ownership.
      let product = null;
      if (body.productId) {
        if (!/^rec[A-Za-z0-9]{14}$/.test(body.productId)) {
          return res.status(400).json({ error: "Invalid productId" });
        }
        product = await getProduct(body.productId);
        if (!productBelongsToTenant(product, auth.effectiveTenantId)) {
          return res.status(403).json({ error: "Product does not belong to this tenant" });
        }
      }

      switch (action) {
        case "save-source-urls": {
          if (!product) return res.status(400).json({ error: "productId required" });
          if (typeof body.sourceUrls !== "string" || body.sourceUrls.length > 5000) {
            return res.status(400).json({ error: "sourceUrls must be a string under 5000 chars" });
          }
          await saveBrain(product.id, { [PL_FIELDS.sourceUrls]: body.sourceUrls });
          await writeAuditLog({ actor: auth.email, productId: product.id, details: { type: "save-source-urls", count: parseSourceUrls(body.sourceUrls).length } });
          return res.status(200).json({ ok: true, sourceUrls: body.sourceUrls, sourceUrlCount: parseSourceUrls(body.sourceUrls).length });
        }

        case "save-supplement": {
          if (!product) return res.status(400).json({ error: "productId required" });
          if (typeof body.supplement !== "string" || body.supplement.length > 20000) {
            return res.status(400).json({ error: "supplement must be a string under 20000 chars" });
          }
          await saveBrain(product.id, { [PL_FIELDS.supplement]: body.supplement });
          await writeAuditLog({ actor: auth.email, productId: product.id, details: { type: "save-supplement", length: body.supplement.length } });
          return res.status(200).json({ ok: true, supplement: body.supplement });
        }

        case "apply-canonical": {
          if (!product) return res.status(400).json({ error: "productId required" });
          const fieldId = CANONICAL_FIELDS[body.field];
          if (!fieldId) return res.status(400).json({ error: `field must be one of: ${Object.keys(CANONICAL_FIELDS).join(", ")}` });
          if (typeof body.value !== "string" || !body.value.trim() || body.value.length > 5000) {
            return res.status(400).json({ error: "value must be a non-empty string under 5000 chars" });
          }
          const previous = (product.fields && product.fields[body.field]) || "";
          await saveBrain(product.id, { [fieldId]: body.value });
          await writeAuditLog({ actor: auth.email, productId: product.id, details: { type: "apply-canonical", field: body.field, previous, value: body.value } });
          return res.status(200).json({ ok: true, field: body.field, value: body.value });
        }

        case "refresh": {
          if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
          const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
          const mainWebsiteUrl = await loadMainWebsiteUrl(auth.effectiveTenantId);

          // Single product refresh.
          if (product) {
            const r = await refreshProductBrain({ product, mainWebsiteUrl, anthropic, persist: true });
            await writeAuditLog({ actor: auth.email, productId: product.id, details: { type: "refresh", ok: r.ok, status: r.status, changes: (r.changes || []).length } });
            if (!r.ok) return res.status(200).json({ ok: false, status: r.status, error: r.error, product: serialiseProduct(await getProduct(product.id)) });
            return res.status(200).json({ ok: true, status: r.status, changes: r.changes, product: serialiseProduct(await getProduct(product.id)) });
          }

          // Refresh-all (owner-style bulk; bounded by the function time budget).
          const startedAt = Date.now();
          const scannable = await listScannableProducts(auth.effectiveTenantId);
          const results = [];
          for (const p of scannable) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) break;
            try {
              const r = await refreshProductBrain({ product: p, mainWebsiteUrl, anthropic, persist: true });
              results.push({ id: p.id, name: p.fields.Name, ok: r.ok, status: r.status, changes: (r.changes || []).length });
            } catch (e) {
              results.push({ id: p.id, name: p.fields.Name, ok: false, error: e.message });
            }
          }
          await writeAuditLog({ actor: auth.email, details: { type: "refresh-all", tenantId: auth.effectiveTenantId, count: results.length } });
          return res.status(200).json({ ok: true, refreshed: results.filter(r => r.ok).length, total: results.length, results });
        }

        default:
          return res.status(400).json({ error: `Unknown action: ${action}` });
      }
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[product-brain] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
