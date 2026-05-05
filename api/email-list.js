// api/email-list.js
// Day A — Email Suite v1
// 
// Returns the email queue for a client, with optional filtering and pagination.
// Mirrors the dashboard-data.js pattern for consistency.
//
// Auth: clientId in query string. Email tab is gated to b2b-saas clients only.
// 
// GET /api/email-list?clientId=recXXX&status=awaiting&audience=client&limit=50&view=queue
//
// Query params:
//   clientId    (required) - Airtable record ID for the client
//   view        (optional) - "queue" (default) | "sent"
//                            queue: shows non-Sent statuses
//                            sent:  shows only Sent and within last 30 days
//   status      (optional) - filter by exact Status value (overrides view)
//   audience    (optional) - filter by Audience: Cold|Nurture|Client|Drip
//   limit       (optional) - max records to return (default 50, max 100)
//
// Returns: { success, view, total, emails: [...] }

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const CLIENTS_TABLE = "Clients";
const EMAIL_QUEUE_TABLE = "Email Queue";

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error: ${r.status} ${err}`);
  }
  return r.json();
}

async function listAll(table, params = "", maxRecords = 100) {
  const all = [];
  let offset = "";
  let safety = 0;
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?${params}${offset ? `&offset=${offset}` : ""}`;
    const data = await airtableFetch(url);
    all.push(...(data.records || []));
    offset = data.offset || "";
    if (all.length >= maxRecords) break;
    if (++safety > 10) break;
  } while (offset);
  return all.slice(0, maxRecords);
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

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function buildFilterFormula({ view, status, audience }) {
  const clauses = [];

  // Status filter
  if (status) {
    clauses.push(`{Status}='${status.replace(/'/g, "\\'")}'`);
  } else if (view === "sent") {
    const since = isoDaysAgo(30);
    clauses.push(`AND({Status}='Sent', IS_AFTER({Sent At}, '${since}'))`);
  } else {
    // Default: queue view = anything not Sent and not Cancelled
    clauses.push(`AND({Status}!='Sent', {Status}!='Cancelled')`);
  }

  // Audience filter
  if (audience) {
    const safe = audience.replace(/'/g, "\\'");
    clauses.push(`{Audience}='${safe}'`);
  }

  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  return `AND(${clauses.join(", ")})`;
}

function shapeEmail(rec, view) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    subject: f["Subject"] || "(no subject)",
    previewText: f["Preview Text"] || "",
    status: f["Status"] || "Draft",
    audience: f["Audience"] || "",
    audienceSegment: f["Audience Segment"] || "",
    emailType: f["Email Type"] || "",
    scheduledSend: f["Scheduled Send"] || null,
    sentAt: f["Sent At"] || null,
    recipientsCount: f["Recipients Count"] || 0,
    recipientEmail: f["Recipient Email"] || "",
    recipientName: f["Recipient Name"] || "",
    sendResult: f["Send Result"] || null,
    qualityIssues: f["Quality Issues"] || null,
    consentVerifiedAt: f["Consent Verified At"] || null,
    // Sent-only fields
    opens: view === "sent" ? (f["Opens"] || f["Open Count"] || 0) : undefined,
    clicks: view === "sent" ? (f["Clicks"] || f["Click Count"] || 0) : undefined,
    openRate: view === "sent" && (f["Recipients Count"] > 0)
      ? (((f["Opens"] || f["Open Count"] || 0) / f["Recipients Count"]) * 100).toFixed(1)
      : undefined,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const clientId = req.query && req.query.clientId;
    const view = (req.query && req.query.view) || "queue";
    const status = req.query && req.query.status;
    const audience = req.query && req.query.audience;
    const limit = Math.min(parseInt(req.query && req.query.limit) || 50, 100);

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    // Build filter
    const formula = buildFilterFormula({ view, status, audience });
    
    // Sort: queue ascending by scheduled send, sent descending by sent at
    const sortField = view === "sent" ? "Sent At" : "Scheduled Send";
    const sortDir = view === "sent" ? "desc" : "asc";

    const params = [
      formula ? `filterByFormula=${encodeURIComponent(formula)}` : "",
      `sort%5B0%5D%5Bfield%5D=${encodeURIComponent(sortField)}`,
      `sort%5B0%5D%5Bdirection%5D=${sortDir}`,
      `pageSize=${Math.min(limit, 100)}`,
    ].filter(Boolean).join("&");

    const records = await listAll(EMAIL_QUEUE_TABLE, params, limit);
    const emails = records.map(r => shapeEmail(r, view));

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      view,
      filters: { status: status || null, audience: audience || null },
      total: emails.length,
      emails,
    });
  } catch (e) {
    console.error("Email list error:", e);
    return res.status(500).json({ error: e.message });
  }
};
