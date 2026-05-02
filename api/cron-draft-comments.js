// api/cron-draft-comments.js
// Daily cron — drafts LinkedIn comments for top "New" Hot Leads
// Triggered by Vercel cron Mon-Fri 08:00 UTC
//
// PATCHED 1 May 2026 (Day 6.5):
//   - BRAND_GUARDRAILS prepended to system prompt
//   - validateContent called on each comment before saving
//   - Failed comments are NOT saved; lead stays in 'New' status with notes
//     explaining why so the next run can retry

const Anthropic = require("@anthropic-ai/sdk").default;
const { BRAND_GUARDRAILS } = require("./brand-guardrails.js");
const { validateContent } = require("./validate-content.js");

const aiClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const HOT_LEADS_TABLE = "Hot Leads";
const CRON_SECRET = process.env.CRON_SECRET;

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

async function draftComment(lead) {
  const commentPrompt = `You write LinkedIn comments on behalf of Andy Speight, CEO of Travelgenix (a UK B2B travel-tech SaaS company).

Your comments must sound EXACTLY like Andy:
- Warm but direct. Conversational. UK English.
- Specific not generic. References something concrete in the post.
- One useful idea or observation per comment, not three.
- Sometimes asks a thoughtful question, sometimes shares a contrarian take.
- Never sales-y. Never starts with "Great post!" or similar fluff.
- 2-4 sentences max. Mobile-readable.

LEAD TYPE: ${lead["Lead Type"]}

${lead["Lead Type"] === "Brand Mention" ? "→ Travelgenix was mentioned. Thank graciously, add value, never just 'thanks'." : ""}
${lead["Lead Type"] === "Competitor Mention" ? "→ A competitor was mentioned. The brand guardrails above explain how to handle this — speak generally about industry trends or how clients have moved over to Travelgenix from various other systems." : ""}
${lead["Lead Type"] === "Buying Intent" ? "→ Someone's asking about travel software. Don't pitch. Ask a useful clarifying question or share an insight. Build rapport first. If they named a competitor they're using, refer to it generically as 'your current setup' or 'what you've got now'." : ""}
${lead["Lead Type"] === "Industry Discussion" ? "→ A travel industry discussion. Add a genuinely useful perspective. Andy as a knowledgeable peer." : ""}

OUTPUT — return ONLY the comment text. No preamble, no quotes, no explanations.`;

  // Prepend brand guardrails (anti-fabrication, anti-competitor-naming, banned words, etc.)
  const systemPrompt = BRAND_GUARDRAILS + "\n\n" + commentPrompt;

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

        // VALIDATE the generated comment
        const validation = validateContent(comment);

        if (validation.severity === "fail") {
          // Don't save the bad comment. Add a note so we can see why it was rejected.
          // Status stays 'New' so the next run can retry (different temperature).
          const issuesShort = validation.issues
            .filter(i => i.severity === "fail")
            .map(i => i.code).join(", ");
          await airtablePatch(HOT_LEADS_TABLE, lead.id, {
            "Notes": `[${new Date().toISOString().slice(0, 16)}] Comment generation produced flagged content (${issuesShort}) and was discarded. Will retry on next run.`,
          });
          console.warn(`[VALIDATOR] Comment for ${lead.id} blocked: ${issuesShort}`);
          results.push({ id: lead.id, status: "rejected_by_validator", issues: issuesShort });
        } else {
          // Comment passed (warn or pass) — save it
          const fields = {
            "Suggested Comment": comment,
            "Comment Drafted At": new Date().toISOString(),
            "Status": "Drafted",
          };
          if (validation.severity === "warn") {
            const warnNote = validation.issues
              .filter(i => i.severity === "warn")
              .map(i => i.code).join(", ");
            fields["Notes"] = `Comment passed with warnings: ${warnNote}`;
          }
          await airtablePatch(HOT_LEADS_TABLE, lead.id, fields);
          results.push({
            id: lead.id,
            status: "drafted",
            commentLength: comment.length,
            severity: validation.severity,
          });
        }
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
      rejectedByValidator: results.filter((r) => r.status === "rejected_by_validator").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (e) {
    console.error("Comment drafting cron failed:", e);
    return res.status(500).json({ error: e.message });
  }
};
