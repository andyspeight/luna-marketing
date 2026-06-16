// api/image-library.js
//
// Lists the tenant's generated images (the Generated Images table — product
// mockups and other AI graphics) so the portal can offer a "Choose from
// library" picker on social posts and in the email builder.
//
// GET /api/image-library?tenantId=recXXX
//   → { ok, images: [ { id, name, url, width, height, type, created } ] }
//
// Auth: cookie session via id.travelify.io; owner may target any tenant, others
// only their own. Same pattern as product-brain.js.
//
// Author: Travelgenix
// Date:   16 June 2026

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const GENERATED_IMAGES_TABLE = "tblov7qu0dSpQVExf";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

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

async function authorise(req, targetTenantId) {
  const session = await validateSession(req);
  if (!session.ok) return session;
  const formula = encodeURIComponent(`LOWER({Monthly Report Email})='${session.email.replace(/'/g, "\\'")}'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=10&fields[]=Business Name`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
  const d = r.ok ? await r.json() : { records: [] };
  const tenantIds = ((d && d.records) || []).map(rec => rec.id);
  if (tenantIds.length === 0) return { ok: false, status: 404, error: "No tenant profile found" };
  const isOwner = tenantIds.includes(OWNER_CLIENT_ID);
  if (isOwner) return { ok: true, effectiveTenantId: targetTenantId || OWNER_CLIENT_ID };
  if (targetTenantId && !tenantIds.includes(targetTenantId)) return { ok: false, status: 403, error: "Not authorised for that tenant" };
  return { ok: true, effectiveTenantId: targetTenantId || tenantIds[0] };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!AIRTABLE_KEY) return res.status(500).json({ error: "Service not configured" });

  try {
    const auth = await authorise(req, req.query.tenantId || null);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const tenant = auth.effectiveTenantId;

    // Fetch the Generated Images, newest first.
    const params = new URLSearchParams({ pageSize: "100" });
    params.set("sort[0][field]", "Created Time");
    params.set("sort[0][direction]", "desc");
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${GENERATED_IMAGES_TABLE}?${params.toString()}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Airtable ${r.status}: ${t.slice(0, 200)}`); }
    const d = await r.json();

    const images = (d.records || [])
      .filter(rec => {
        const f = rec.fields || {};
        const tenants = f["Tenant"] || [];
        // Owner sees all (some legacy rows may have no tenant link); others are scoped.
        const scoped = tenant === OWNER_CLIENT_ID ? true : tenants.includes(tenant);
        return f["PNG URL"] && scoped;
      })
      .map(rec => {
        const f = rec.fields || {};
        return {
          id: rec.id,
          name: f["Name"] || "Image",
          url: f["PNG URL"],
          width: f["Width"] || null,
          height: f["Height"] || null,
          type: (f["Section Type"] && f["Section Type"].name) || f["Section Type"] || "",
          created: rec.createdTime
        };
      });

    return res.status(200).json({ ok: true, tenantId: tenant, images });
  } catch (err) {
    console.error("[image-library] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
