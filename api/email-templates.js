// api/email-templates.js
// Day C — Email Suite v2
//
// Returns the seeded Email Templates from Airtable for the builder UI's
// "Start from template" dropdown. Each template has a sections JSON
// blob that the builder can clone into a new email.
//
// GET /api/email-templates?clientId=rec...
// Returns: { success, templates: [{ id, name, description, category, sections, subjectSuggestion, previewSuggestion }] }
//
// Auth: clientId required, must be b2b-saas. Templates are global (not per-client) for now.

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "Clients";
const TEMPLATES_TABLE = "Email Templates";

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
  if (req.method !== "GET") {
    res.status(405).json({ success: false, error: "Method not allowed" });
    return;
  }

  const clientId = req.query.clientId;
  const client = await authenticateClient(clientId);
  if (!client) {
    res.status(401).json({ success: false, error: "Unauthorised" });
    return;
  }

  try {
    const params = new URLSearchParams();
    params.set("filterByFormula", "{Active}=1");
    params.append("sort[0][field]", "Sort Order");
    params.append("sort[0][direction]", "asc");
    params.set("pageSize", "100");

    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TEMPLATES_TABLE)}?${params.toString()}`;
    const data = await airtableFetch(url);

    const templates = (data.records || []).map(rec => {
      const f = rec.fields || {};
      let sections = [];
      const raw = f["Sections JSON"];
      if (raw) {
        try { sections = JSON.parse(raw); } catch {
          // Bad JSON — return empty sections rather than crashing
          sections = [];
        }
      }
      return {
        id: rec.id,
        name: f["Template Name"] || "(untitled)",
        description: f["Description"] || "",
        category: f["Category"] || "",
        sections: Array.isArray(sections) ? sections : [],
        subjectSuggestion: f["Subject Suggestion"] || "",
        previewSuggestion: f["Preview Text Suggestion"] || "",
      };
    });

    res.status(200).json({ success: true, templates });
  } catch (e) {
    console.error("[email-templates] Error:", e);
    // If the table doesn't exist yet, return an empty list rather than 500
    if (e.message && e.message.includes("NOT_FOUND")) {
      res.status(200).json({ success: true, templates: [], warning: "Email Templates table not found" });
      return;
    }
    res.status(500).json({ success: false, error: e.message || "Failed to load templates" });
  }
};
