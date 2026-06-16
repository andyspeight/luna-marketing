// api/product-visuals.js
//
// Product Visuals dashboard API (owner only).
//
// The Product Visuals table is Travelgenix-internal (it has no Tenant field):
// it describes how each product LOOKS so the image engine can render faithful
// mockups. Today only Luna Chat has a spec; this endpoint lets the owner draft
// and save specs for every product so mockups work across the catalogue.
//
// GET  /api/product-visuals
//   → { ok, products: [ { id, name, hasSpec, pvId, status, screenshotUrl,
//                         hasBrain, spec:{...} } ] }
//
// POST /api/product-visuals
//   { action, ... }
//     "draft"      { productId }                  — AI-draft a spec (not saved)
//     "save"       { productId, pvId?, spec, status? } — upsert the spec record
//     "set-status" { pvId, status }
//
// Auth: cookie session via id.travelify.io; must resolve to the Travelgenix
// owner tenant. Mirrors the auth in product-brain.js / email-compose-ai.js.
//
// Author: Travelgenix
// Date:   16 June 2026

const Anthropic = require("@anthropic-ai/sdk").default;
const { draftVisualSpec } = require("../lib/visual-spec-generator");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PRODUCTS_TABLE = "tblGBl8X3RIVnCwDM";
const PV_TABLE = "tblZJzVjkh61ItPs8";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const AUDIT_LOG_TABLE = "Audit Log";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

// Product Visuals field IDs (same as brief-generator.js — IDs survive renames).
const PV = {
  name:        "fldRvOcD05yNCGyDV",
  status:      "fldl6qBVKmhnPcjtz",
  oneLiner:    "fldI1zCALelKpd869",
  dimensions:  "fldy4YQ3ErwnVRDxV",
  header:      "fldQsGP3xWxGEU39p",
  body:        "fldWSBe5U1UkwRaLh",
  interactive: "fldbUqMrWx78bZpnd",
  footer:      "fldM9Geh8JNDncqBB",
  colour:      "fldgDys9a7fYiucoI",
  typography:  "fldcSSSTPbKro3O7k",
  variations:  "fld5vO31mApc4cubN",
  antiPatterns:"fldRLWJY0U4cdDkKV",
  aliases:     "fld7dOkgGzIGFYqNc",
  screenshot:  "fldyLJvfAqcNwIvDQ"
};

// Map the dashboard/generator spec keys → PV field IDs for writes.
const SPEC_TO_PV = {
  oneLiner: PV.oneLiner,
  dimensions: PV.dimensions,
  header: PV.header,
  body: PV.body,
  interactive: PV.interactive,
  footer: PV.footer,
  colourSignatures: PV.colour,
  typographySignatures: PV.typography,
  variations: PV.variations,
  antiPatterns: PV.antiPatterns,
  aliases: PV.aliases
};

const VALID_STATUSES = ["Active", "In progress", "Todo", "Done"];

// ─────────────────────────────────────────────────────────────────────
// AUTH (owner only)
// ─────────────────────────────────────────────────────────────────────

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
  } catch (err) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
}

async function requireOwner(req) {
  const session = await validateSession(req);
  if (!session.ok) return session;
  const formula = encodeURIComponent(`LOWER({Monthly Report Email})='${session.email.replace(/'/g, "\\'")}'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=10&fields[]=Business Name`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
  const d = r.ok ? await r.json() : { records: [] };
  const tenantIds = ((d && d.records) || []).map(rec => rec.id);
  if (!tenantIds.includes(OWNER_CLIENT_ID)) {
    return { ok: false, status: 403, error: "Product Visuals is available to the Travelgenix owner account only" };
  }
  return { ok: true, email: session.email };
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

async function listAll(tableId) {
  const all = [];
  let offset = null;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const data = await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${tableId}?${params.toString()}`);
    (data.records || []).forEach(rec => all.push(rec));
    offset = data.offset;
  } while (offset);
  return all;
}

async function getProduct(productId) {
  return airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${PRODUCTS_TABLE}/${productId}`);
}

async function writeAuditLog(entry) {
  if (!AIRTABLE_KEY) return;
  try {
    const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`, {
      method: "POST",
      body: JSON.stringify({
        records: [{ fields: {
          "Event ID": eventId, "Timestamp": new Date().toISOString(),
          "Actor": entry.actor || "product-visuals", "Action": "edit",
          "Subject Type": "product", "Subject ID": entry.subjectId || "",
          "Details": JSON.stringify(entry.details || {}).slice(0, 5000)
        } }],
        typecast: true
      })
    });
  } catch (e) { console.error("[product-visuals] audit failed (non-fatal):", e.message); }
}

// ─────────────────────────────────────────────────────────────────────
// MATCHING — link a Product Library product to a Product Visuals record
// ─────────────────────────────────────────────────────────────────────

function pvAliases(rec) {
  const raw = (rec.fields && rec.fields["Aliases"]) || "";
  return String(raw).toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
}

function pvFirstScreenshot(rec) {
  const atts = (rec.fields && rec.fields["Reference Screenshot"]) || [];
  if (Array.isArray(atts) && atts.length > 0) return { url: atts[0].url, type: atts[0].type || "image/png" };
  return { url: null, type: null };
}

/** Find the PV record for a product: exact name match, else alias contains the product name. */
function matchPv(productName, pvRecords) {
  const target = String(productName || "").toLowerCase().trim();
  if (!target) return null;
  // 1) exact name
  let hit = pvRecords.find(r => String((r.fields && r.fields["Name"]) || "").toLowerCase().trim() === target);
  if (hit) return hit;
  // 2) alias equals or contains the product name
  hit = pvRecords.find(r => pvAliases(r).some(a => a === target || a.includes(target) || target.includes(a)));
  return hit || null;
}

function specFromPv(rec) {
  const f = rec.fields || {};
  return {
    oneLiner: f["One Liner"] || "",
    dimensions: f["Dimensions And Shape"] || "",
    header: f["Header Spec"] || "",
    body: f["Body Spec"] || "",
    interactive: f["Interactive Elements Spec"] || "",
    footer: f["Footer Spec"] || "",
    colourSignatures: f["Colour Signatures"] || "",
    typographySignatures: f["Typography Signatures"] || "",
    variations: f["Variations"] || "",
    antiPatterns: f["Anti Patterns"] || "",
    aliases: f["Aliases"] || ""
  };
}

function specIsPopulated(spec) {
  return !!(spec.body && spec.body.trim()) || !!(spec.dimensions && spec.dimensions.trim());
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
    const auth = await requireOwner(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    // ── GET: list products with their visual-spec state ──────────────
    if (req.method === "GET") {
      const [products, pvRecords] = await Promise.all([listAll(PRODUCTS_TABLE), listAll(PV_TABLE)]);
      const tenantProducts = products.filter(p => ((p.fields && p.fields["Tenant"]) || []).includes(OWNER_CLIENT_ID));

      const out = tenantProducts.map(p => {
        const f = p.fields || {};
        const pv = matchPv(f["Name"], pvRecords);
        const spec = pv ? specFromPv(pv) : null;
        const shot = pv ? pvFirstScreenshot(pv) : { url: null };
        return {
          id: p.id,
          name: f["Name"] || "(unnamed)",
          productStatus: (f["Status"] && f["Status"].name) || f["Status"] || "Active",
          priority: f["Priority"] || 0,
          hasBrain: !!(f["Brain Summary"] && String(f["Brain Summary"]).trim()),
          pvId: pv ? pv.id : null,
          pvStatus: pv ? ((pv.fields["Status"] && pv.fields["Status"].name) || pv.fields["Status"] || "") : "",
          hasSpec: !!(spec && specIsPopulated(spec)),
          hasScreenshot: !!shot.url,
          spec: spec || {
            oneLiner: "", dimensions: "", header: "", body: "", interactive: "",
            footer: "", colourSignatures: "", typographySignatures: "", variations: "", antiPatterns: "", aliases: ""
          }
        };
      }).sort((a, b) => {
        // Products without a spec first, then by priority.
        if (a.hasSpec !== b.hasSpec) return a.hasSpec ? 1 : -1;
        if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
        return a.name.localeCompare(b.name);
      });

      return res.status(200).json({ ok: true, products: out });
    }

    // ── POST: actions ────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = req.body || {};
      const action = body.action;

      if (action === "set-status") {
        if (!body.pvId || !/^rec[A-Za-z0-9]{14}$/.test(body.pvId)) return res.status(400).json({ error: "Invalid pvId" });
        if (!VALID_STATUSES.includes(body.status)) return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
        await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${PV_TABLE}/${body.pvId}`, {
          method: "PATCH", body: JSON.stringify({ fields: { [PV.status]: body.status }, typecast: true })
        });
        await writeAuditLog({ actor: auth.email, subjectId: body.pvId, details: { type: "pv-set-status", status: body.status } });
        return res.status(200).json({ ok: true, status: body.status });
      }

      // draft + save both need the product
      if (!body.productId || !/^rec[A-Za-z0-9]{14}$/.test(body.productId)) {
        return res.status(400).json({ error: "Invalid or missing productId" });
      }
      const product = await getProduct(body.productId);
      if (!((product.fields && product.fields["Tenant"]) || []).includes(OWNER_CLIENT_ID)) {
        return res.status(403).json({ error: "Product not in the Travelgenix catalogue" });
      }

      if (action === "draft") {
        if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
        // Use an existing PV record's screenshot for vision, if there is one.
        const pvRecords = await listAll(PV_TABLE);
        const pv = matchPv(product.fields["Name"], pvRecords);
        const shot = pv ? pvFirstScreenshot(pv) : { url: null, type: null };

        const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
        const r = await draftVisualSpec({
          product,
          brainSummary: product.fields["Brain Summary"] || "",
          screenshotUrl: shot.url,
          screenshotMediaType: shot.type,
          anthropic
        });
        await writeAuditLog({ actor: auth.email, subjectId: product.id, details: { type: "pv-draft", ok: r.ok, usedScreenshot: r.usedScreenshot, confidence: r.confidence } });
        if (!r.ok) return res.status(200).json({ ok: false, error: r.error });
        return res.status(200).json({ ok: true, spec: r.spec, confidence: r.confidence, needsConfirmation: r.needsConfirmation, usedScreenshot: r.usedScreenshot, pvId: pv ? pv.id : null });
      }

      if (action === "save") {
        const spec = body.spec || {};
        if (typeof spec !== "object") return res.status(400).json({ error: "spec must be an object" });
        const status = body.status && VALID_STATUSES.includes(body.status) ? body.status : "Active";

        // Build the field map. Cap each field defensively.
        const fields = { [PV.status]: status };
        Object.entries(SPEC_TO_PV).forEach(([k, fieldId]) => {
          if (typeof spec[k] === "string") fields[fieldId] = spec[k].slice(0, 95000);
        });
        // Ensure aliases always include the product name so brief matching works.
        const name = product.fields["Name"] || "";
        const aliasSet = String(fields[PV.aliases] || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
        if (name && !aliasSet.includes(name.toLowerCase())) aliasSet.unshift(name.toLowerCase());
        fields[PV.aliases] = aliasSet.join(", ");

        let pvId = body.pvId && /^rec[A-Za-z0-9]{14}$/.test(body.pvId) ? body.pvId : null;
        if (pvId) {
          await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${PV_TABLE}/${pvId}`, {
            method: "PATCH", body: JSON.stringify({ fields, typecast: true })
          });
        } else {
          fields[PV.name] = name;
          const created = await airtableFetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${PV_TABLE}`, {
            method: "POST", body: JSON.stringify({ records: [{ fields }], typecast: true })
          });
          pvId = created.records && created.records[0] && created.records[0].id;
        }
        await writeAuditLog({ actor: auth.email, subjectId: product.id, details: { type: "pv-save", pvId, status } });
        return res.status(200).json({ ok: true, pvId, status });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[product-visuals] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
