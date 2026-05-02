// api/dashboard-action.js
// Action handler for dashboard buttons - approve/reject posts, engage leads, approve emails
//
// Auth: clientId from already-authenticated portal session

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const CLIENTS_TABLE = "Clients";
const POST_QUEUE_TABLE = "Post Queue";
const HOT_LEADS_TABLE = "Hot Leads";
const EMAIL_QUEUE_TABLE = "Email Queue";

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

async function patchRecord(table, id, fields) {
  return airtableFetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ fields, typecast: true }),
    }
  );
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    const client = await authenticateClient(body.clientId);
    if (!client) return res.status(403).json({ error: "Not authorized" });

    const { action, recordId, notes } = body;
    if (!action || !recordId) {
      return res.status(400).json({ error: "action and recordId required" });
    }

    let result;
    switch (action) {
      case "approve_post":
        result = await patchRecord(POST_QUEUE_TABLE, recordId, {
          "Status": "Approved",
        });
        break;

      case "reject_post":
        result = await patchRecord(POST_QUEUE_TABLE, recordId, {
          "Status": "Rejected",
          ...(notes ? { "Rejection Notes": notes.slice(0, 500) } : {}),
        });
        break;

      case "approve_email":
        result = await patchRecord(EMAIL_QUEUE_TABLE, recordId, {
          "Status": "Approved",
        });
        break;

      case "mark_lead_engaged":
        result = await patchRecord(HOT_LEADS_TABLE, recordId, {
          "Status": "Engaged",
          "Posted At": new Date().toISOString().split("T")[0],
          ...(notes ? { "Andy Comment": notes.slice(0, 1000) } : {}),
        });
        break;

      case "dismiss_lead":
        result = await patchRecord(HOT_LEADS_TABLE, recordId, {
          "Status": "Dismissed",
        });
        break;

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(200).json({ success: true, action, recordId });
  } catch (e) {
    console.error("Dashboard action failed:", e);
    return res.status(500).json({ error: e.message });
  }
};
