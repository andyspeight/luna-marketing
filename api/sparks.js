// api/sparks.js
// Read-only feed of Research Sparks for the post Composer.
//
// The daily research cron (api/research-feed.js) scores travel-industry
// news and writes the top items to the "Research Sparks" table — but until
// now nothing surfaced them to the user. This endpoint lets the Composer
// show "today in travel" so industry-comment posts can start from a real
// story instead of a blank prompt.
//
// GET /api/sparks           → { success, sparks: [...] }
//
// Sparks are public news headlines (no tenant data), so this is a simple
// read with no per-tenant filtering — same lightweight posture as the
// other client-portal reads.

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const SPARKS_TABLE = "Research Sparks";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  if (!AIRTABLE_KEY) return res.status(500).json({ error: "AIRTABLE_KEY not configured" });

  try {
    const params = new URLSearchParams();
    params.append("filterByFormula", "{Status}='Open'");
    params.append("maxRecords", "12");
    params.append("sort[0][field]", "Captured");
    params.append("sort[0][direction]", "desc");

    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(SPARKS_TABLE)}?${params}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
    );
    if (!r.ok) throw new Error(`Airtable ${r.status}`);
    const data = await r.json();

    const sparks = (data.records || []).map(function (rec) {
      const f = rec.fields || {};
      return {
        id: rec.id,
        headline: f["Headline"] || "",
        url: f["URL"] || "",
        source: typeof f["Source"] === "object" && f["Source"] !== null ? (f["Source"].name || "") : (f["Source"] || ""),
        summary: f["Summary"] || "",
        score: f["Score"] || 0,
        angle: f["Suggested Angle"] || "",
        captured: f["Captured"] || "",
      };
    }).filter(function (s) { return s.headline; });

    return res.status(200).json({ success: true, sparks: sparks });
  } catch (e) {
    console.error("[sparks] error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};
