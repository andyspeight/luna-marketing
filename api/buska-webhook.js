// api/buska-webhook.js
// Receives Buska signal webhooks, scores each lead, writes to Hot Leads table
//
// Buska sends one POST per signal when their monitor matches a keyword.
// We're flexible about the payload shape because Buska's exact format isn't published —
// we extract whatever's useful and log everything for debugging.
//
// Auth: shared secret in URL query param (?secret=...) for low-friction Buska compat
//       Falls back to Bearer token if Authorization header present
//       If no secret env var is set we accept any payload (URL is the obscurity)

const Anthropic = require("@anthropic-ai/sdk").default;

const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const HOT_LEADS_TABLE = "Hot Leads";
const BUSKA_SECRET = process.env.BUSKA_WEBHOOK_SECRET || ""; // optional

// ── Airtable helpers ──

async function airtableCreate(table, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable create failed: ${r.status} ${err}`);
  }
  return r.json();
}

// ── Buska payload normalisation ──

/**
 * Buska's webhook payload format isn't formally documented but typically contains:
 * - lead/match info (source platform, post URL, content)
 * - author info (name, profile URL, title, company)
 * - matched keywords or search name
 * - any AI score Buska computed
 *
 * We extract these defensively — fall back gracefully if fields are missing.
 */
function normaliseBuskaPayload(body) {
  // Try common Buska payload shapes
  const lead = body.lead || body.signal || body.mention || body;
  const author = lead.author || lead.user || lead.profile || body.author || {};
  const search = body.search || body.automation || body.monitor || {};
  
  return {
    platform: pickFirst(lead.platform, lead.source, body.platform, "LinkedIn"),
    postUrl: pickFirst(lead.url, lead.post_url, lead.link, body.url),
    postContent: pickFirst(lead.content, lead.text, lead.body, lead.message, body.content, ""),
    authorName: pickFirst(author.name, author.full_name, author.display_name, lead.author_name, ""),
    authorProfileUrl: pickFirst(author.url, author.profile_url, author.linkedin_url, ""),
    authorTitle: pickFirst(author.title, author.job_title, author.headline, ""),
    authorCompany: pickFirst(author.company, author.company_name, author.organization, ""),
    keywordsMatched: pickFirst(
      Array.isArray(lead.keywords) ? lead.keywords.join(", ") : lead.keywords,
      Array.isArray(body.keywords) ? body.keywords.join(", ") : body.keywords,
      search.name,
      search.keywords,
      ""
    ),
    buskaScore: pickFirst(lead.score, lead.ai_score, body.score, null),
    leadType: detectLeadType(lead, search),
    rawPayload: body,
  };
}

function pickFirst(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return values[values.length - 1] || "";
}

function detectLeadType(lead, search) {
  const text = JSON.stringify({ lead, search }).toLowerCase();
  if (text.includes("travelgenix")) return "Brand Mention";
  if (text.includes("tprofile") || text.includes("inspiretec") || text.includes("dolphin dynamics") || text.includes("traveltek")) return "Competitor Mention";
  if (text.includes("looking for") || text.includes("recommendation") || text.includes("anyone use") || text.includes("alternative")) return "Buying Intent";
  return "Industry Discussion";
}

// ── Scoring ──

/**
 * Score the lead 0-10 based on relevance to Travelgenix.
 * Uses Claude for nuanced evaluation. Falls back to heuristics if AI unavailable.
 */
async function scoreLead(normalised) {
  // Quick heuristic fallback
  function heuristicScore() {
    let score = 4;
    if (normalised.leadType === "Brand Mention") score += 4;
    if (normalised.leadType === "Buying Intent") score += 4;
    if (normalised.leadType === "Competitor Mention") score += 2;
    const titleLc = (normalised.authorTitle || "").toLowerCase();
    if (titleLc.includes("ceo") || titleLc.includes("founder") || titleLc.includes("owner") || titleLc.includes("director")) score += 1;
    if (titleLc.includes("travel") || titleLc.includes("tour")) score += 1;
    return Math.min(10, score);
  }
  
  try {
    const prompt = `You are scoring a LinkedIn signal for relevance to Travelgenix, a UK B2B travel-tech SaaS company that sells software to travel agencies, tour operators, and OTAs.

Score this signal 0-10 where:
0-3 = irrelevant or low value (consumer travel chatter, off-topic)
4-6 = mildly interesting (industry discussion not specifically about software)
7-8 = strong (travel professional discussing pain points, considering software)
9-10 = critical (direct buying intent, competitor mention with frustration, brand mention)

Signal:
- Author: ${normalised.authorName} (${normalised.authorTitle || "no title"} at ${normalised.authorCompany || "unknown"})
- Type: ${normalised.leadType}
- Keywords matched: ${normalised.keywordsMatched}
- Post: "${(normalised.postContent || "").slice(0, 800)}"

Respond with ONLY a JSON object: {"score": N, "reasoning": "one sentence"}`;
    
    const response = await aiClient.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });
    
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      score: Math.max(0, Math.min(10, Number(parsed.score) || 0)),
      reasoning: parsed.reasoning || "",
    };
  } catch (e) {
    console.error("Lead scoring failed, falling back to heuristic:", e.message);
    return { score: heuristicScore(), reasoning: "Heuristic score (AI unavailable)" };
  }
}

// ── Main handler ──

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  
  // Auth: optional shared secret
  if (BUSKA_SECRET) {
    const headerAuth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const querySecret = (req.query && req.query.secret) || "";
    if (headerAuth !== BUSKA_SECRET && querySecret !== BUSKA_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  
  try {
    const body = req.body || {};
    
    // Normalise the payload
    const lead = normaliseBuskaPayload(body);
    
    // Score it
    const scoring = await scoreLead(lead);
    
    // Build the Lead Title — short summary for the row primary field
    const titleSnippet = (lead.postContent || "").slice(0, 80).replace(/\s+/g, " ").trim();
    const leadTitle = lead.authorName
      ? `${lead.authorName}: ${titleSnippet || lead.keywordsMatched}`
      : `Buska signal: ${titleSnippet || lead.keywordsMatched}`;
    
    // Write to Hot Leads
    const fields = {
      "Lead Title": leadTitle.slice(0, 200),
      "Source": "Buska",
      "Platform": lead.platform,
      "Author Name": lead.authorName || "",
      "Author Profile URL": lead.authorProfileUrl || "",
      "Author Title": lead.authorTitle || "",
      "Author Company": lead.authorCompany || "",
      "Post URL": lead.postUrl || "",
      "Post Content": lead.postContent || "",
      "Keywords Matched": lead.keywordsMatched || "",
      "Score": scoring.score,
      "Lead Type": lead.leadType,
      "Status": "New",
      "Captured": new Date().toISOString(),
      "Notes": scoring.reasoning ? `Scoring rationale: ${scoring.reasoning}` : "",
    };
    
    const result = await airtableCreate(HOT_LEADS_TABLE, fields);
    const recordId = result.records && result.records[0] ? result.records[0].id : null;
    
    return res.status(200).json({
      success: true,
      recordId,
      score: scoring.score,
      leadType: lead.leadType,
    });
  } catch (e) {
    console.error("Buska webhook error:", e);
    return res.status(500).json({ error: e.message });
  }
};
