// api/cron-draft-comments.js
// Daily cron — drafts LinkedIn comments for top "New" Hot Leads
// Triggered by Vercel cron Mon-Fri 08:00 UTC
//
// What it does:
//   1. Pull all Hot Leads with Status=New AND Score >= 6
//   2. For each, draft a LinkedIn comment in Andy's voice
//   3. Write the draft into Suggested Comment field, set Status=Drafted
//   4. Andy reviews in Airtable, copy-pastes manually onto LinkedIn

const Anthropic = require("@anthropic-ai/sdk").default;

const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const HOT_LEADS_TABLE = "Hot Leads";
const CRON_SECRET = process.env.CRON_SECRET;

// ── Airtable ──

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
  return r.json();
}

async function airtablePatch(table, id, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields, typecast: true }),
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable patch failed: ${r.status} ${err}`);
  }
  return r.json();
}

async function getNewLeads() {
  const formula = encodeURIComponent(`AND({Status}='New', {Score}>=6)`);
  const sortQuery = "&sort%5B0%5D%5Bfield%5D=Score&sort%5B0%5D%5Bdirection%5D=desc";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(HOT_LEADS_TABLE)}?filterByFormula=${formula}${sortQuery}&maxRecords=20`;
  const data = await airtableFetch(url);
  return (data.records || []).map((r) => ({ id: r.id, ...r.fields }));
}

// ── Comment drafting ──

async function draftComment(lead) {
  const systemPrompt = `You write LinkedIn comments on behalf of Andy Speight, CEO of Travelgenix (a UK B2B travel-tech SaaS company).

Your comments must sound EXACTLY like Andy:
- Warm but direct. Conversational. UK English.
- Specific not generic. References something concrete in the post.
- One useful idea or observation per comment, not three.
- Sometimes asks a thoughtful question, sometimes shares a contrarian take.
- Never sales-y. Never starts with "Great post!" or similar fluff.
- 2-4 sentences max. Mobile-readable.

BANNED: leverage, utilize, synergy, game-changer, innovative, cutting-edge, delve, unlock, navigate (as in "navigate the landscape"), em dashes, Oxford commas.

CONTEXT — what Andy/Travelgenix does (use sparingly, only when natural):
- Travelgenix sells travel-tech SaaS to travel agencies and tour operators
- Mid-office (Travelify), AI suite (Luna Brain, Chat, Marketing), 100+ widgets
- Premium suppliers via direct API: RateHawk, WebBeds, Hotelbeds, Jet2 Holidays, TUI
- Andy is opinionated about: AI replacing OTAs, post-sale client success, value over price

LEAD TYPE TO HANDLE: ${lead["Lead Type"]}

${lead["Lead Type"] === "Brand Mention" ? "→ Travelgenix was mentioned. Thank graciously, add value, never just 'thanks'." : ""}
${lead["Lead Type"] === "Competitor Mention" ? "→ Competitor was mentioned. Don't slag them off. Be magnanimous, then highlight a different angle Travelgenix takes (without saying 'we're better')." : ""}
${lead["Lead Type"] === "Buying Intent" ? "→ Someone's asking about travel software. Don't pitch. Ask a useful clarifying question or share an insight. Build rapport first." : ""}
${lead["Lead Type"] === "Industry Discussion" ? "→ A travel industry discussion. Add a genuinely useful perspective. Andy as a knowledgeable peer." : ""}

OUTPUT — return ONLY the comment text. No preamble, no quotes, no explanations.`;

  const userMessage = `LinkedIn post by ${lead["Author Name"] || "(unknown)"} (${lead["Author Title"] || "no title"} at ${lead["Author Company"] || "unknown"}):

"${(lead["Post Content"] || "").slice(0, 1500)}"

Draft Andy's comment.`;

  const response = await aiClient.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    temperature: 0.75,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  let text = "";
  for (const block of response.content) {
    if (block.type === "text") text += block.text;
  }
  return text.trim().replace(/^["']|["']$/g, "");
}

// ── Main handler ──

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const leads = await getNewLeads();
    console.log(`Comment drafting cron: ${leads.length} new leads to process`);

    const results = [];
    for (const lead of leads) {
      try {
        const comment = await draftComment(lead);
        await airtablePatch(HOT_LEADS_TABLE, lead.id, {
          "Suggested Comment": comment,
          "Comment Drafted At": new Date().toISOString(),
          "Status": "Drafted",
        });
        results.push({ id: lead.id, status: "drafted", commentLength: comment.length });
      } catch (e) {
        console.error(`Comment draft failed for ${lead.id}:`, e.message);
        results.push({ id: lead.id, status: "failed", error: e.message });
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      drafted: results.filter((r) => r.status === "drafted").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (e) {
    console.error("Comment drafting cron failed:", e);
    return res.status(500).json({ error: e.message });
  }
};
