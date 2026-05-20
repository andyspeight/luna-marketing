// api/audiences.js
// Email Suite — Day B v1, auto-discovery rewrite (20 May 2026)
//
// Fetches every Brevo list on the account dynamically. No env-var mapping,
// no hardcoded list names — the portal stays in sync with Brevo automatically.
// When the user renames a list in Brevo or adds a new one, it shows up here
// without any code or env-var changes.
//
// GET /api/audiences?clientId=recXXX
//
// Returns: {
//   success,
//   generatedAt,
//   audiences: [{
//     listId,            // string, Brevo list ID
//     listName,          // string, the name as set in Brevo
//     label,             // string, same as listName (kept for client compat)
//     audienceMapping,   // string, derived from listName for header label
//     configured: true,  // always true for discovered lists
//     totalSubscribers,  // number
//     totalBlacklisted,  // number
//     folderId,          // number or null
//     createdAt,         // ISO date or null
//   }]
// }

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const BREVO_API_KEY = process.env.BREVO_API_KEY;

const CLIENTS_TABLE = "Clients";

// Page size for Brevo's list endpoint. 50 is the max per page.
const BREVO_LIST_PAGE_SIZE = 50;

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

// Fetch every list on the Brevo account, paginating if there are more than 50.
// Returns the raw Brevo list objects.
async function fetchAllBrevoLists() {
  if (!BREVO_API_KEY) return [];
  const all = [];
  let offset = 0;
  // Safety cap — stop after 10 pages (500 lists). No real account has more.
  for (let page = 0; page < 10; page++) {
    const url = `https://api.brevo.com/v3/contacts/lists?limit=${BREVO_LIST_PAGE_SIZE}&offset=${offset}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { "api-key": BREVO_API_KEY, Accept: "application/json" },
      });
    } catch (e) {
      console.error("Brevo lists fetch failed:", e.message);
      return all;
    }
    if (!res.ok) {
      console.error("Brevo lists fetch non-OK:", res.status);
      return all;
    }
    const data = await res.json().catch(() => ({}));
    const batch = Array.isArray(data.lists) ? data.lists : [];
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < BREVO_LIST_PAGE_SIZE) break;
    offset += BREVO_LIST_PAGE_SIZE;
  }
  return all;
}

// Derive a short header label from the list name. Used for the small
// uppercase pill at the top of each card in the portal. Heuristics — no
// hardcoded mapping. The label is purely cosmetic: send routing is by
// list ID, not by this label.
function deriveLabel(listName) {
  const n = (listName || "").toLowerCase();
  if (!n) return "LIST";
  if (n.includes("current") || n.includes("client") || n.includes("customer")) return "CLIENTS";
  if (n.includes("potential") || n.includes("lead") || n.includes("prospect")) return "LEADS";
  if (n.includes("all")) return "ALL CONTACTS";
  if (n.includes("test") || n.includes("qa")) return "TEST";
  return "LIST";
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

    const rawLists = await fetchAllBrevoLists();

    // Shape each list to the contract the client portal expects.
    // `configured: true` because we found the list on Brevo — the old
    // env-var path is gone. `audienceMapping` is now a derived header
    // label, kept for client-side template compatibility.
    const audiences = rawLists.map(list => ({
      listId: String(list.id),
      listName: list.name || "(unnamed list)",
      label: list.name || "(unnamed list)",
      audienceMapping: deriveLabel(list.name),
      configured: true,
      totalSubscribers: list.totalSubscribers || list.uniqueSubscribers || 0,
      totalBlacklisted: list.totalBlacklisted || 0,
      folderId: list.folderId || null,
      createdAt: list.createdAt || null,
    }));

    // Sort by subscriber count descending — biggest lists first.
    audiences.sort((a, b) => (b.totalSubscribers || 0) - (a.totalSubscribers || 0));

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
