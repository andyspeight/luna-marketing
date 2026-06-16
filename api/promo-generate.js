// api/promo-generate.js
//
// Phase A — "this week we're promoting X".
//
// POST /api/promo-generate
// Body: {
//   tenantId: "recXXX",
//   productId: "recXXX",
//   outputs: ["email","social","images"],   // any subset
//   archetype: "product-launch" | "marketing-newsletter" | "b2b-weekly" | "transactional",
//   audience: "Cold" | "Nurture" | "Client" | "Drip",
//   socialCount: 1..6
// }
//
// Generates the selected deliverables as DRAFTS only (nothing sends/publishes):
//   email  → Email Queue (Status "Draft")
//   social → Post Queue ("Queued", or "Quality Hold" if the validator fails them)
//   images → Generated Images (a product mockup)
//
// Each output runs independently; one failing does not abort the others. The
// response reports per-output success/failure so the UI can show what landed.
//
// Auth: cookie session via id.travelify.io; owner may target any tenant, others
// only their own. Same pattern as product-brain.js / email-compose-ai.js.
//
// Author: Travelgenix
// Date:   16 June 2026

const {
  generateEmailDraft,
  generateSocialDrafts,
  generateMockup,
  generateBlogPost
} = require("../lib/promo-orchestrator");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PRODUCTS_TABLE = "tblGBl8X3RIVnCwDM";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const AUDIT_LOG_TABLE = "Audit Log";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const VALID_ARCHETYPES = ["b2b-weekly", "marketing-newsletter", "product-launch", "transactional"];
const VALID_AUDIENCES = ["Cold", "Nurture", "Client", "Drip"];
const VALID_OUTPUTS = ["email", "social", "images", "blog"];

// Per-output soft timeout. Generation calls reach out to Anthropic / HCTI; if
// one hangs we must still return a clean result rather than let the whole
// function sit until the platform kills it (which surfaces as a "-" status and
// an opaque spinner in the UI). Mockups render in ~2.5 min, so the images
// output gets a much longer budget than the text outputs.
const OUTPUT_TIMEOUT_MS = { email: 110 * 1000, social: 110 * 1000, images: 240 * 1000, blog: 200 * 1000 };

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s. It may still finish in the background — check the tab, or try generating just this item.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── auth (mirrors product-brain.js) ──────────────────────────────────
async function validateSession(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) return { ok: false, status: 401, error: "Not signed in" };
  try {
    const meRes = await fetch(`${ID_HOST}/api/auth/me`, { method: "GET", headers: { cookie } });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    const data = await meRes.json();
    if (!data || !data.ok || !data.user || !data.user.email) return { ok: false, status: 401, error: "Invalid session" };
    return { ok: true, email: String(data.user.email).trim().toLowerCase() };
  } catch (err) { return { ok: false, status: 502, error: "Auth check failed" }; }
}

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Airtable ${r.status}: ${t.slice(0, 200)}`); }
  return r.json();
}

async function lookupTenantsForEmail(email) {
  const formula = encodeURIComponent(`LOWER({Monthly Report Email})='${email.replace(/'/g, "\\'")}'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=10&fields[]=Business Name`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
  if (!r.ok) return [];
  const d = await r.json();
  return ((d && d.records) || []).map(rec => rec.id);
}

async function authorise(req, targetTenantId) {
  const session = await validateSession(req);
  if (!session.ok) return session;
  const tenantIds = await lookupTenantsForEmail(session.email);
  if (tenantIds.length === 0) return { ok: false, status: 404, error: "No tenant profile found for your account" };
  const isOwner = tenantIds.includes(OWNER_CLIENT_ID);
  if (isOwner) return { ok: true, email: session.email, isOwner: true, effectiveTenantId: targetTenantId || OWNER_CLIENT_ID };
  if (targetTenantId && !tenantIds.includes(targetTenantId)) return { ok: false, status: 403, error: "Not authorised for that tenant" };
  return { ok: true, email: session.email, isOwner: false, effectiveTenantId: targetTenantId || tenantIds[0] };
}

async function writeAuditLog(entry) {
  if (!AIRTABLE_KEY) return;
  try {
    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`, {
      method: "POST",
      body: JSON.stringify({ records: [{ fields: {
        "Event ID": eventId, "Timestamp": new Date().toISOString(), "Actor": entry.actor || "promo-generate",
        "Action": "edit", "Subject Type": "product", "Subject ID": entry.productId || "",
        "Details": JSON.stringify(entry.details || {}).slice(0, 5000)
      } }], typecast: true })
    });
  } catch (e) { console.error("[promo-generate] audit failed (non-fatal):", e.message); }
}

// ── handler ──────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!AIRTABLE_KEY || !ANTHROPIC_API_KEY) return res.status(500).json({ error: "Service not configured" });

  try {
    const body = req.body || {};
    if (!body.tenantId || !/^rec[A-Za-z0-9]{14}$/.test(body.tenantId)) return res.status(400).json({ error: "Invalid or missing tenantId" });
    if (!body.productId || !/^rec[A-Za-z0-9]{14}$/.test(body.productId)) return res.status(400).json({ error: "Invalid or missing productId" });

    const outputs = Array.isArray(body.outputs) ? body.outputs.filter(o => VALID_OUTPUTS.includes(o)) : [];
    if (outputs.length === 0) return res.status(400).json({ error: `outputs must include at least one of: ${VALID_OUTPUTS.join(", ")}` });

    const archetype = VALID_ARCHETYPES.includes(body.archetype) ? body.archetype : "product-launch";
    const audience = VALID_AUDIENCES.includes(body.audience) ? body.audience : "Nurture";
    const socialCount = Math.max(1, Math.min(6, parseInt(body.socialCount, 10) || 3));

    const auth = await authorise(req, body.tenantId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // Load product + owning client, and confirm the product belongs to the tenant.
    const [product, client] = await Promise.all([
      airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCTS_TABLE}/${body.productId}`),
      airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${auth.effectiveTenantId}`)
    ]);
    if (!((product.fields && product.fields["Tenant"]) || []).includes(auth.effectiveTenantId)) {
      return res.status(403).json({ error: "Product does not belong to this tenant" });
    }

    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const productName = (product.fields && product.fields["Name"]) || body.productId;
    const results = {};

    // Run each requested output independently so one failure doesn't sink the rest.
    if (outputs.includes("email")) {
      try {
        results.email = { ok: true, ...(await withTimeout(generateEmailDraft({ tenantId: auth.effectiveTenantId, product, archetype, audience, actor: auth.email, ip }), OUTPUT_TIMEOUT_MS.email, "Email draft")) };
      } catch (e) { console.error("[promo-generate] email failed:", e); results.email = { ok: false, error: e.message }; }
    }
    if (outputs.includes("social")) {
      try {
        results.social = { ok: true, ...(await withTimeout(generateSocialDrafts({ client: client.fields || {}, clientId: auth.effectiveTenantId, product, count: socialCount, actor: auth.email }), OUTPUT_TIMEOUT_MS.social, "Social posts")) };
      } catch (e) { console.error("[promo-generate] social failed:", e); results.social = { ok: false, error: e.message }; }
    }
    if (outputs.includes("images")) {
      try {
        results.images = await withTimeout(generateMockup({ tenantId: auth.effectiveTenantId, product }), OUTPUT_TIMEOUT_MS.images, "Mockup");
      } catch (e) { console.error("[promo-generate] mockup failed:", e); results.images = { ok: false, error: e.message }; }
    }
    if (outputs.includes("blog")) {
      try {
        results.blog = { ok: true, ...(await withTimeout(generateBlogPost({ tenantId: auth.effectiveTenantId, product, client: client.fields || {} }), OUTPUT_TIMEOUT_MS.blog, "Blog")) };
      } catch (e) { console.error("[promo-generate] blog failed:", e); results.blog = { ok: false, error: e.message }; }
    }

    await writeAuditLog({
      actor: auth.email, productId: product.id,
      details: { type: "promo-generate", product: productName, outputs, archetype, audience, socialCount,
        email: results.email && results.email.ok, social: results.social && results.social.ok, images: results.images && results.images.ok, blog: results.blog && results.blog.ok }
    });

    return res.status(200).json({ ok: true, product: productName, results });
  } catch (err) {
    console.error("[promo-generate] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
