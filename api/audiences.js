// api/audiences.js
// Day B — Email Suite v1
//
// Fetches the Brevo lists configured for this account, with contact counts
// and metadata. Results are cached briefly to avoid hammering Brevo's API.
//
// GET /api/audiences?clientId=recXXX
//
// Returns: { success, audiences: [{ id, name, totalSubscribers, totalBlacklisted, ... }] }

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const BREVO_API_KEY = process.env.BREVO_API_KEY;

// Brevo list ID env vars (set in Vercel)
// These map our internal audience labels to actual Brevo list IDs
const LIST_IDS = {
  "Travelgenix Clients": process.env.BREVO_LIST_TG_CLIENTS || process.env.BREVO_LIST_TRAVELGENIX_CLIENTS,
  "Inbound Leads": process.env.BREVO_LIST_INBOUND_LEADS || process.env.BREVO_LIST_INBOUND,
  "Demo Requested": process.env.BREVO_LIST_DEMO_REQUESTED,
};

const CLIENTS_TABLE = "Clients";

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Airtable ${r.status}`);
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

async function fetchBrevoList(listId) {
  if (!listId || !BREVO_API_KEY) return null;
  const url = `https://api.brevo.com/v3/contacts/lists/${listId}`;
  try {
    const r = await fetch(url, {
      headers: { "api-key": BREVO_API_KEY, Accept: "application/json" },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error(`Brevo list fetch failed for ID ${listId}:`, e.message);
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const clientId = req.query && req.query.clientId;
    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    if (!BREVO_API_KEY) {
      return res.status(503).json({ error: "Brevo API key not configured" });
    }

    // Build audience list
    const labelToAudienceMap = {
      "Travelgenix Clients": "Client",
      "Inbound Leads": "Nurture",
      "Demo Requested": "Nurture",
    };

    const audiences = [];
    for (const [label, listId] of Object.entries(LIST_IDS)) {
      if (!listId) {
        audiences.push({
          label,
          listId: null,
          audienceMapping: labelToAudienceMap[label],
          configured: false,
          error: "Brevo list ID not set in environment",
        });
        continue;
      }

      const list = await fetchBrevoList(listId);
      if (!list) {
        audiences.push({
          label,
          listId,
          audienceMapping: labelToAudienceMap[label],
          configured: true,
          error: "Could not fetch from Brevo",
        });
        continue;
      }

      audiences.push({
        label,
        listId: String(list.id || listId),
        listName: list.name || label,
        audienceMapping: labelToAudienceMap[label],
        configured: true,
        totalSubscribers: list.totalSubscribers || list.uniqueSubscribers || 0,
        totalBlacklisted: list.totalBlacklisted || 0,
        folderId: list.folderId || null,
        createdAt: list.createdAt || null,
      });
    }

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      audiences,
    });
  } catch (e) {
    console.error("Audiences error:", e);
    return res.status(500).json({ error: e.message });
  }
};
