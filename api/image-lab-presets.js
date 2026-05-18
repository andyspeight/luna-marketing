// api/image-lab-presets.js
//
// Storage for image lab prompt presets. Owner only.
//
// GET  /api/image-lab-presets             → list all presets
// POST /api/image-lab-presets             → create a preset
// DELETE /api/image-lab-presets?name=xxx  → delete by name
//
// Storage: Vercel Blob (single JSON file at luna-marketing/owner/lab/presets.json).
// We could use Airtable but Blob is simpler for this owner-only internal tool.
//
// Author: Travelgenix
// Date:   18 May 2026

const { put, head, list } = require("@vercel/blob");

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const ID_HOST = "https://id.travelify.io";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const PRESETS_PATH = "luna-marketing/owner/lab/presets.json";
const MAX_PRESETS = 50;
const MAX_NAME_LEN = 80;
const MAX_PROMPT_LEN = 30000;

async function validateOwnerSession(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) return { ok: false, status: 401, error: "Not signed in" };
  try {
    const meRes = await fetch(`${ID_HOST}/api/auth/me`, { headers: { cookie } });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    const data = await meRes.json();
    if (!data || !data.ok || !data.user || !data.user.email) {
      return { ok: false, status: 401, error: "Invalid session" };
    }
    const email = String(data.user.email).trim().toLowerCase();
    const formula = encodeURIComponent(`LOWER({Monthly Report Email})='${email.replace(/'/g, "\\'")}'`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula=${formula}&maxRecords=10&fields[]=Business Name`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } });
    if (!r.ok) return { ok: false, status: 502, error: "Tenant lookup failed" };
    const d = await r.json();
    const tenantIds = ((d && d.records) || []).map(rec => rec.id);
    if (!tenantIds.includes(OWNER_CLIENT_ID)) return { ok: false, status: 403, error: "Owner only" };
    return { ok: true };
  } catch (err) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
}

async function loadPresets() {
  try {
    // List blob at known path
    const result = await list({ prefix: PRESETS_PATH, limit: 1, token: BLOB_TOKEN });
    if (!result.blobs || result.blobs.length === 0) return [];
    const url = result.blobs[0].url;
    const r = await fetch(url);
    if (!r.ok) return [];
    const json = await r.json();
    return Array.isArray(json) ? json : [];
  } catch (e) {
    console.warn("[presets] load failed:", e.message);
    return [];
  }
}

async function savePresets(presets) {
  const buffer = Buffer.from(JSON.stringify(presets, null, 2), "utf8");
  await put(PRESETS_PATH, buffer, {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    token: BLOB_TOKEN,
    allowOverwrite: true
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const auth = await validateOwnerSession(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    if (req.method === "GET") {
      const presets = await loadPresets();
      return res.status(200).json({ ok: true, presets });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
        return res.status(400).json({ error: "name is required" });
      }
      if (body.name.length > MAX_NAME_LEN) {
        return res.status(400).json({ error: `name too long (max ${MAX_NAME_LEN})` });
      }
      if (!body.systemPrompt || typeof body.systemPrompt !== "string") {
        return res.status(400).json({ error: "systemPrompt is required" });
      }
      if (body.systemPrompt.length > MAX_PROMPT_LEN) {
        return res.status(400).json({ error: `systemPrompt too long (max ${MAX_PROMPT_LEN})` });
      }

      const presets = await loadPresets();
      if (presets.length >= MAX_PRESETS) {
        return res.status(400).json({ error: `Preset limit reached (max ${MAX_PRESETS}). Delete old ones first.` });
      }

      // Replace if name exists
      const idx = presets.findIndex(p => p.name === body.name);
      const entry = {
        name: body.name,
        systemPrompt: body.systemPrompt,
        defaultBrief: body.defaultBrief || "",
        defaultWidth: body.defaultWidth || 1200,
        defaultHeight: body.defaultHeight || 800,
        useReasoning: body.useReasoning === true,
        notes: body.notes || "",
        createdAt: idx === -1 ? new Date().toISOString() : presets[idx].createdAt,
        updatedAt: new Date().toISOString()
      };

      if (idx === -1) presets.push(entry);
      else presets[idx] = entry;

      await savePresets(presets);
      return res.status(200).json({ ok: true, preset: entry, total: presets.length });
    }

    if (req.method === "DELETE") {
      const name = req.query && req.query.name ? String(req.query.name) : "";
      if (!name) return res.status(400).json({ error: "name query param required" });

      const presets = await loadPresets();
      const filtered = presets.filter(p => p.name !== name);
      if (filtered.length === presets.length) {
        return res.status(404).json({ error: "Preset not found" });
      }
      await savePresets(filtered);
      return res.status(200).json({ ok: true, deleted: name, total: filtered.length });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("[image-lab-presets] error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
};
