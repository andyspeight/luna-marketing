// api/email-templates-save.js
// Phase 1 — Save current builder sections as a reusable email template.
//
// POST /api/email-templates-save
// Body: {
//   clientId:           "recXXX" (required, auth gate)
//   templateName:       "Promotional weekly" (required, 1-60 chars)
//   description:        "Subhead under name in dropdown" (optional, max 200)
//   category:           "Marketing" (optional)
//   sectionsJson:       "[...]" (required, valid JSON array of {type,props})
//   subjectSuggestion:  "..." (optional, max 200)
//   previewSuggestion:  "..." (optional, max 200)
// }
//
// Returns: { success, templateId, name }
//
// Notes:
//   - Authorisation gate identical to email-compose.js (b2b-saas only)
//   - Sets Active=true and Sort Order=999 on new template so it appears
//     at the bottom of the dropdown until the user manually re-orders
//   - sectionsJson is validated as JSON parsable + an array; on success
//     written verbatim (it's the wire format the builder + renderer use)

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "Clients";
const TEMPLATES_TABLE = "Email Templates";

const MAX_SECTIONS_JSON_BYTES = 200_000;

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error ${r.status}: ${err}`);
  }
  return r.json();
}

// Auth: only b2b-saas clients can use the email suite (matches email-compose,
// email-list). For now this is just Travelgenix; will broaden when we onboard
// other tenants.
async function authenticateClient(clientId) {
  if (!clientId || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(CLIENTS_TABLE)}/${clientId}`;
  try {
    const data = await airtableFetch(url);
    if (!data || !data.fields) return null;
    const clientType = (data.fields["Client Type"] || "").toLowerCase();
    if (clientType !== "b2b-saas") return null;
    return { id: data.id, ...data.fields };
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    const {
      clientId,
      templateName,
      description,
      category,
      sectionsJson,
      subjectSuggestion,
      previewSuggestion,
    } = body;

    // ── Validation ────────────────────────────────────────────────
    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!templateName || typeof templateName !== "string") {
      return res.status(400).json({ error: "templateName required" });
    }
    const cleanName = String(templateName).trim().slice(0, 60);
    if (cleanName.length === 0) {
      return res.status(400).json({ error: "templateName cannot be empty" });
    }
    if (!sectionsJson || typeof sectionsJson !== "string") {
      return res.status(400).json({ error: "sectionsJson required" });
    }
    if (sectionsJson.length > MAX_SECTIONS_JSON_BYTES) {
      return res.status(413).json({ error: "sectionsJson too large" });
    }

    // sectionsJson must parse as an array. Reject anything else (object,
    // string, null) since the renderer expects [{type, props}, ...].
    let parsed;
    try {
      parsed = JSON.parse(sectionsJson);
    } catch (e) {
      return res.status(400).json({ error: "sectionsJson is not valid JSON" });
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return res.status(400).json({ error: "sectionsJson must be a non-empty array" });
    }
    // Light shape check — every element must have a string type
    for (let i = 0; i < parsed.length; i++) {
      const s = parsed[i];
      if (!s || typeof s !== "object" || typeof s.type !== "string" || !s.type) {
        return res.status(400).json({ error: `Section ${i} is invalid (missing type)` });
      }
    }

    // ── Auth ─────────────────────────────────────────────────────
    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    // ── Create template record ───────────────────────────────────
    // Field names match the Email Templates table schema (see luna-email-composer
    // skill for the contract). Active defaults true so it appears immediately.
    const fields = {
      "Template Name": cleanName,
      "Sections JSON": sectionsJson,
      "Active": true,
      "Sort Order": 999,
    };
    if (description && typeof description === "string") {
      fields["Description"] = String(description).trim().slice(0, 200);
    }
    if (category && typeof category === "string") {
      fields["Category"] = String(category).trim().slice(0, 60);
    }
    if (subjectSuggestion && typeof subjectSuggestion === "string") {
      fields["Subject Suggestion"] = String(subjectSuggestion).trim().slice(0, 200);
    }
    if (previewSuggestion && typeof previewSuggestion === "string") {
      fields["Preview Text Suggestion"] = String(previewSuggestion).trim().slice(0, 200);
    }

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TEMPLATES_TABLE)}`;
    const created = await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        records: [{ fields }],
        typecast: true,
      }),
    });

    const templateId = created.records[0].id;

    return res.status(200).json({
      success: true,
      templateId,
      name: cleanName,
    });
  } catch (e) {
    console.error("[email-templates-save] error:", e);
    return res.status(500).json({ error: e.message || "Internal error" });
  }
};
