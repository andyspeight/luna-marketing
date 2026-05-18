// api/content-engine-products.js
//
// Content Engine — Product Library admin endpoint.
//
// Single endpoint handling all CRUD via ?action= query param:
//   GET  ?action=list&tenantId=...            → list all products for a tenant
//   GET  ?action=get&id=...                   → fetch one product
//   POST ?action=create  (body: product)      → create a new product
//   POST ?action=update  (body: {id, fields}) → update a product
//   POST ?action=delete  (body: {id})         → delete a product
//
// Authorisation:
//   - Validates the central Travelgenix session via id.travelify.io
//   - Determines logged-in tenant from email lookup (same pattern as auth-session)
//   - For non-owner accounts: target tenant MUST equal logged-in tenant
//   - For owner (Travelgenix): can read/write any tenant
//   - Every mutation writes an audit log entry
//
// Author: Travelgenix
// Date:   15 May 2026

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var CLIENTS_TABLE = "tblUkzvBujc94Yali";
var PRODUCTS_TABLE = "tblGBl8X3RIVnCwDM";
var AUDIT_LOG_TABLE = "Audit Log";
var ID_HOST = "https://id.travelify.io";

var OWNER_CLIENT_ID = "recFXQY7be6gMr4In"; // Travelgenix
var MAX_PRODUCTS_PER_TENANT = 200; // sanity cap

// Field IDs for Product Library
var FIELD = {
  name:        "fldnm50uGn1DSddGr",
  tenant:      "fldatn2zKKZacVJOp",
  oneLiner:    "fldXV1tORnZFlleRS",
  problem:     "fldc9vMT37lrqgLGq",
  proof:       "fldHQ828t2c8gVfAt",
  ctaText:     "fldYnc0K579e3pnUH",
  ctaUrl:      "fldhsjeVb7T40bwcm",
  heroImage:   "fldNRXSWHhiSQQglw",
  archetypes:  "fldIlBTUo9n12YiLq",
  tierMatch:   "fldOXo1H70062n8e2",
  status:      "fldiHSJWbQ8BGg37o",
  priority:    "fld87XVfztSTltkhw",
  spotlight:   "fldW2sivbb1KRt99e",
  topics:      "fldtCzXIEVVja0FFD"
};

// ─────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────

async function validateSession(req) {
  var cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  try {
    var meRes = await fetch(ID_HOST + "/api/auth/me", {
      method: "GET",
      headers: { cookie: cookie }
    });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    var data = await meRes.json();
    if (!data || !data.ok || !data.user || !data.user.email) {
      return { ok: false, status: 401, error: "Invalid session" };
    }
    return { ok: true, email: String(data.user.email).trim().toLowerCase(), fullName: data.user.fullName || "" };
  } catch (err) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
}

async function lookupTenantsForEmail(email) {
  var formula = encodeURIComponent("LOWER({Monthly Report Email})='" + email.replace(/'/g, "\\'") + "'");
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE +
            "?filterByFormula=" + formula + "&maxRecords=10&fields[]=Business Name&fields[]=Trading Name";
  var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) return [];
  var d = await r.json();
  return ((d && d.records) || []).map(function (rec) {
    return {
      id: rec.id,
      name: rec.fields["Trading Name"] || rec.fields["Business Name"] || rec.id
    };
  });
}

// ─────────────────────────────────────────────────────────
// AUTHORISATION HELPER
// ─────────────────────────────────────────────────────────

// Returns { ok: true, sessionTenants, isOwner } or { ok: false, status, error }
async function authoriseRequest(req, targetTenantId) {
  var session = await validateSession(req);
  if (!session.ok) return session;

  var tenants = await lookupTenantsForEmail(session.email);
  if (tenants.length === 0) {
    return { ok: false, status: 404, error: "No tenant profile found for your account" };
  }

  var tenantIds = tenants.map(function (t) { return t.id; });
  var isOwner = tenantIds.indexOf(OWNER_CLIENT_ID) !== -1;

  // Owner can target any tenant
  if (isOwner) {
    return {
      ok: true,
      email: session.email,
      fullName: session.fullName,
      sessionTenants: tenants,
      tenantIds: tenantIds,
      isOwner: true,
      effectiveTenantId: targetTenantId || OWNER_CLIENT_ID
    };
  }

  // Non-owner: target must equal one of their tenants
  if (targetTenantId && tenantIds.indexOf(targetTenantId) === -1) {
    return { ok: false, status: 403, error: "Not authorised for that tenant" };
  }

  return {
    ok: true,
    email: session.email,
    fullName: session.fullName,
    sessionTenants: tenants,
    tenantIds: tenantIds,
    isOwner: false,
    effectiveTenantId: targetTenantId || tenants[0].id
  };
}

// ─────────────────────────────────────────────────────────
// AIRTABLE HELPERS
// ─────────────────────────────────────────────────────────

async function airtableFetch(url, options) {
  options = options || {};
  var r = await fetch(url, Object.assign({}, options, {
    headers: Object.assign({
      Authorization: "Bearer " + AIRTABLE_KEY,
      "Content-Type": "application/json"
    }, options.headers || {})
  }));
  var text = await r.text();
  var data;
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { _raw: text }; }
  if (!r.ok) {
    var msg = (data && data.error && (data.error.message || data.error)) || text || ("HTTP " + r.status);
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

async function writeAuditLog(actor, action, subjectId, details, ip) {
  try {
    var eventId = "evt-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
    var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + encodeURIComponent(AUDIT_LOG_TABLE);
    await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        records: [{
          fields: {
            "Event ID": eventId,
            "Timestamp": new Date().toISOString(),
            "Actor": actor || "system",
            "Action": action,
            "Subject Type": "product",
            "Subject ID": subjectId || "",
            "Details": typeof details === "string" ? details : JSON.stringify(details),
            "IP": ip || ""
          }
        }],
        typecast: true
      })
    });
  } catch (e) {
    console.error("Audit log write failed (non-fatal):", e.message);
  }
}

// ─────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────

var VALID_STATUS = ["Active", "Coming Soon", "Paused", "Archived"];
var VALID_ARCHETYPES = ["newsletter", "launch", "nurture", "cold", "thought-leadership"];
var VALID_TIERS = ["Spark", "Boost", "Ignite"];

function validateProductFields(fields) {
  var errors = [];
  if (!fields || typeof fields !== "object") {
    return ["Body must be an object"];
  }
  if (fields.name !== undefined) {
    if (typeof fields.name !== "string" || fields.name.length < 1 || fields.name.length > 200) {
      errors.push("name must be 1-200 chars");
    }
  }
  if (fields.status !== undefined && VALID_STATUS.indexOf(fields.status) === -1) {
    errors.push("status must be one of: " + VALID_STATUS.join(", "));
  }
  if (fields.priority !== undefined) {
    var p = Number(fields.priority);
    if (!Number.isInteger(p) || p < 0 || p > 10) errors.push("priority must be integer 0-10");
  }
  if (fields.archetypes !== undefined && !Array.isArray(fields.archetypes)) {
    errors.push("archetypes must be an array");
  }
  if (Array.isArray(fields.archetypes)) {
    fields.archetypes.forEach(function (a) {
      if (VALID_ARCHETYPES.indexOf(a) === -1) errors.push("archetypes contains invalid: " + a);
    });
  }
  if (fields.tierMatch !== undefined && !Array.isArray(fields.tierMatch)) {
    errors.push("tierMatch must be an array");
  }
  if (Array.isArray(fields.tierMatch)) {
    fields.tierMatch.forEach(function (t) {
      if (VALID_TIERS.indexOf(t) === -1) errors.push("tierMatch contains invalid: " + t);
    });
  }
  // String length caps
  ["oneLiner", "problem", "proof", "ctaText", "topics", "notes"].forEach(function (k) {
    if (fields[k] !== undefined && typeof fields[k] !== "string") {
      errors.push(k + " must be a string");
    }
    if (typeof fields[k] === "string" && fields[k].length > 5000) {
      errors.push(k + " exceeds 5000 chars");
    }
  });
  if (fields.ctaUrl !== undefined && typeof fields.ctaUrl === "string" && fields.ctaUrl.length > 0) {
    if (!/^https?:\/\//.test(fields.ctaUrl)) errors.push("ctaUrl must be a valid http(s) URL");
    if (fields.ctaUrl.length > 1000) errors.push("ctaUrl exceeds 1000 chars");
  }
  if (fields.spotlight !== undefined && fields.spotlight !== null && fields.spotlight !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.spotlight)) errors.push("spotlight must be YYYY-MM-DD or null");
  }
  return errors;
}

// Map our nice JSON keys to Airtable field IDs for the API
function toAirtableFields(input) {
  var out = {};
  if (input.name !== undefined)       out[FIELD.name]       = input.name;
  if (input.oneLiner !== undefined)   out[FIELD.oneLiner]   = input.oneLiner;
  if (input.problem !== undefined)    out[FIELD.problem]    = input.problem;
  if (input.proof !== undefined)      out[FIELD.proof]      = input.proof;
  if (input.ctaText !== undefined)    out[FIELD.ctaText]    = input.ctaText;
  if (input.ctaUrl !== undefined)     out[FIELD.ctaUrl]     = input.ctaUrl;
  if (input.archetypes !== undefined) out[FIELD.archetypes] = input.archetypes;
  if (input.tierMatch !== undefined)  out[FIELD.tierMatch]  = input.tierMatch;
  if (input.status !== undefined)     out[FIELD.status]     = input.status;
  if (input.priority !== undefined)   out[FIELD.priority]   = input.priority;
  if (input.topics !== undefined)     out[FIELD.topics]     = input.topics;
  // spotlight: empty string = clear it
  if (input.spotlight !== undefined) {
    out[FIELD.spotlight] = (input.spotlight === "" || input.spotlight === null) ? null : input.spotlight;
  }
  return out;
}

// Convert an Airtable record to our nice JSON shape (matching what UI expects)
function fromAirtableRecord(rec) {
  var f = rec.fields || {};
  return {
    id: rec.id,
    name: f["Name"] || "",
    tenantId: (f["Tenant"] || [])[0] || null,
    oneLiner: f["One-liner"] || "",
    problem: f["Problem solved"] || "",
    proof: f["Proof point"] || "",
    ctaText: f["Primary CTA text"] || "",
    ctaUrl: f["Primary CTA URL"] || "",
    heroImage: ((f["Hero image"] || [])[0] || null),
    archetypes: f["Suitable archetypes"] || [],
    tierMatch: f["Tier match"] || [],
    status: f["Status"] || "Active",
    priority: f["Priority"] || 5,
    spotlight: f["Spotlight month"] || null,
    topics: f["Topics"] || "",
    createdTime: f["Created Time"] || null,
    lastModifiedTime: f["Last Modified Time"] || null
  };
}

// ─────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────

async function handleList(req, res, auth) {
  // Fetch all products, filter by tenant in JS (same pattern as engine)
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + PRODUCTS_TABLE +
            "?maxRecords=" + MAX_PRODUCTS_PER_TENANT;
  var data = await airtableFetch(url);
  var records = (data.records || []).filter(function (rec) {
    var tenants = (rec.fields && rec.fields["Tenant"]) || [];
    return tenants.indexOf(auth.effectiveTenantId) !== -1;
  });
  var products = records.map(fromAirtableRecord);
  return res.status(200).json({
    ok: true,
    products: products,
    tenantId: auth.effectiveTenantId,
    isOwner: auth.isOwner
  });
}

async function handleGet(req, res, auth, recordId) {
  if (!recordId || !/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + PRODUCTS_TABLE + "/" + recordId;
  var rec = await airtableFetch(url);
  var tenants = (rec.fields && rec.fields["Tenant"]) || [];
  if (tenants.indexOf(auth.effectiveTenantId) === -1 && !auth.isOwner) {
    return res.status(403).json({ error: "Product not in your tenant" });
  }
  return res.status(200).json({ ok: true, product: fromAirtableRecord(rec) });
}

async function handleCreate(req, res, auth) {
  var body = req.body || {};
  var errors = validateProductFields(body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  if (!body.name || !body.name.trim()) return res.status(400).json({ error: "name is required" });

  var fields = toAirtableFields(body);
  fields[FIELD.tenant] = [auth.effectiveTenantId];

  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + PRODUCTS_TABLE;
  var data = await airtableFetch(url, {
    method: "POST",
    body: JSON.stringify({
      records: [{ fields: fields }],
      typecast: true
    })
  });
  var rec = data.records[0];

  await writeAuditLog(
    auth.email,
    "create",
    rec.id,
    {
      type: "product-create",
      tenant: auth.effectiveTenantId,
      name: body.name,
      ownerOverride: auth.isOwner && auth.effectiveTenantId !== OWNER_CLIENT_ID
    },
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
  );

  return res.status(200).json({ ok: true, product: fromAirtableRecord(rec) });
}

async function handleUpdate(req, res, auth) {
  var body = req.body || {};
  if (!body.id || !/^rec[A-Za-z0-9]{14}$/.test(body.id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  // First fetch to verify tenant ownership
  var getUrl = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + PRODUCTS_TABLE + "/" + body.id;
  var existing = await airtableFetch(getUrl);
  var tenants = (existing.fields && existing.fields["Tenant"]) || [];
  if (tenants.indexOf(auth.effectiveTenantId) === -1 && !auth.isOwner) {
    return res.status(403).json({ error: "Product not in your tenant" });
  }

  var errors = validateProductFields(body);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });

  var fields = toAirtableFields(body);
  // Never let the API change tenant via update — that's a separate operation
  delete fields[FIELD.tenant];

  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + PRODUCTS_TABLE + "/" + body.id;
  var data = await airtableFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields: fields, typecast: true })
  });

  await writeAuditLog(
    auth.email,
    "edit",
    body.id,
    {
      type: "product-update",
      tenant: auth.effectiveTenantId,
      changedFields: Object.keys(fields),
      ownerOverride: auth.isOwner && tenants[0] !== OWNER_CLIENT_ID
    },
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
  );

  return res.status(200).json({ ok: true, product: fromAirtableRecord(data) });
}

async function handleDelete(req, res, auth) {
  var body = req.body || {};
  if (!body.id || !/^rec[A-Za-z0-9]{14}$/.test(body.id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  var getUrl = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + PRODUCTS_TABLE + "/" + body.id;
  var existing = await airtableFetch(getUrl);
  var tenants = (existing.fields && existing.fields["Tenant"]) || [];
  if (tenants.indexOf(auth.effectiveTenantId) === -1 && !auth.isOwner) {
    return res.status(403).json({ error: "Product not in your tenant" });
  }

  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + PRODUCTS_TABLE + "/" + body.id;
  await airtableFetch(url, { method: "DELETE" });

  await writeAuditLog(
    auth.email,
    "delete",
    body.id,
    {
      type: "product-delete",
      tenant: auth.effectiveTenantId,
      name: existing.fields && existing.fields["Name"],
      ownerOverride: auth.isOwner && tenants[0] !== OWNER_CLIENT_ID
    },
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
  );

  return res.status(200).json({ ok: true, deleted: body.id });
}

// Owner-only: list all available tenants for the tenant switcher
async function handleListTenants(req, res, auth) {
  if (!auth.isOwner) return res.status(403).json({ error: "Owner only" });
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE +
            "?maxRecords=200&fields[]=Business Name&fields[]=Trading Name&fields[]=Status" +
            "&sort[0][field]=Business Name&sort[0][direction]=asc";
  var data = await airtableFetch(url);
  var tenants = (data.records || []).map(function (rec) {
    return {
      id: rec.id,
      name: rec.fields["Trading Name"] || rec.fields["Business Name"] || rec.id,
      status: rec.fields["Status"] || ""
    };
  });
  return res.status(200).json({ ok: true, tenants: tenants });
}

// ─────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    var action = (req.query && req.query.action) || (req.body && req.body.action) || "";

    // Owner-only utility: list tenants (no tenantId required)
    if (action === "list-tenants") {
      var ownerAuth = await authoriseRequest(req, null);
      if (!ownerAuth.ok) return res.status(ownerAuth.status).json({ error: ownerAuth.error });
      return handleListTenants(req, res, ownerAuth);
    }

    // For everything else, resolve the target tenant
    var targetTenantId = (req.query && req.query.tenantId) ||
                         (req.body && req.body.tenantId) ||
                         null;
    if (targetTenantId && !/^rec[A-Za-z0-9]{14}$/.test(targetTenantId)) {
      return res.status(400).json({ error: "Invalid tenantId" });
    }

    var auth = await authoriseRequest(req, targetTenantId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    if (req.method === "GET" && (action === "list" || action === "")) {
      return handleList(req, res, auth);
    }
    if (req.method === "GET" && action === "get") {
      return handleGet(req, res, auth, req.query && req.query.id);
    }
    if (req.method === "POST" && action === "create") {
      return handleCreate(req, res, auth);
    }
    if (req.method === "POST" && action === "update") {
      return handleUpdate(req, res, auth);
    }
    if (req.method === "POST" && action === "delete") {
      return handleDelete(req, res, auth);
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (err) {
    console.error("content-engine-products error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
