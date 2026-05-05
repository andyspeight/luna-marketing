// api/email-render.js
// Day C — Email Suite v2
//
// Renders an array of section JSON to email HTML.
// Used by:
//   - The compose builder UI (live preview as you edit)
//   - email-send-now (renders before sending)
//   - The (currently paused) email-cron (will use this when re-enabled)
//
// POST /api/email-render
// Body: {
//   clientId: string,            // required, b2b-saas only
//   sections: Array<{type, props}>,  // required
//   previewText?: string,
//   title?: string,
//   unsubToken?: string,         // optional — if missing, defaults to placeholder URL
//   bodyBackground?: string,
// }
//
// Returns: { success, html, plainText, sectionsCount, warnings, errors }

const { renderEmail } = require("../lib/email-renderer");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "Clients";

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://luna-marketing.vercel.app";
const MAX_SECTIONS = 30;
const MAX_BODY_BYTES = 200_000; // hard cap on incoming JSON body

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

function buildUnsubUrl(token) {
  if (!token || typeof token !== "string") {
    return `${PUBLIC_BASE_URL}/unsubscribe`;
  }
  // Token must look like a token (alphanumeric + underscore + hyphen, max 128)
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(token)) {
    return `${PUBLIC_BASE_URL}/unsubscribe`;
  }
  return `${PUBLIC_BASE_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};

    // Quick body size check (Vercel already enforces an upper limit but we add our own)
    const bodyJsonLength = JSON.stringify(body).length;
    if (bodyJsonLength > MAX_BODY_BYTES) {
      return res.status(413).json({ error: "Request body too large" });
    }

    const { clientId, sections, previewText, title, unsubToken, bodyBackground } = body;

    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!Array.isArray(sections)) {
      return res.status(400).json({ error: "sections must be an array" });
    }
    if (sections.length === 0) {
      return res.status(400).json({ error: "sections array is empty" });
    }
    if (sections.length > MAX_SECTIONS) {
      return res.status(400).json({
        error: `Too many sections (max ${MAX_SECTIONS})`,
      });
    }

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    // Validate each section is a {type, props} object
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (!s || typeof s !== "object") {
        return res.status(400).json({ error: `Section ${i} is not an object` });
      }
      if (typeof s.type !== "string" || !s.type) {
        return res.status(400).json({ error: `Section ${i} missing type` });
      }
      if (s.props !== undefined && (typeof s.props !== "object" || s.props === null)) {
        return res.status(400).json({ error: `Section ${i} has invalid props` });
      }
    }

    const unsubUrl = buildUnsubUrl(unsubToken);

    const result = renderEmail({
      sections,
      previewText: previewText || "",
      title: title || "Travelgenix",
      unsubUrl,
      bodyBackground: bodyBackground || undefined,
    });

    if (result.errors.length > 0) {
      return res.status(500).json({
        error: "Render failed",
        details: result.errors,
        warnings: result.warnings,
      });
    }

    return res.status(200).json({
      success: true,
      html: result.html,
      plainText: result.plainText,
      sectionsCount: sections.length,
      warnings: result.warnings,
    });
  } catch (e) {
    console.error("[email-render] error:", e);
    return res.status(500).json({ error: "Render failed", detail: e.message });
  }
};
