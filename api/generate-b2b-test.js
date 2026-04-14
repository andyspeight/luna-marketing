// api/generate-b2b-test.js
// Manual trigger to generate B2B content for Travelgenix only
// Call: POST /api/generate-b2b-test with Authorization: Bearer {CRON_SECRET}
// Or visit in browser for GET (no auth needed for testing — remove before production)

const Anthropic = require("@anthropic-ai/sdk").default;
const { buildB2BSystemPrompt } = require("./b2b-prompt.js");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const EVENTS_TABLE = "tblQxIYrbzd6YlJYV";
const TRAVELGENIX_RECORD = "recFXQY7be6gMr4In";

async function airtableFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Airtable: ${res.statusText}`);
  return res.json();
}

function getDateInWeeks(weeks) {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split("T")[0];
}

module.exports = async (req, res) => {
  try {
    // Fetch Travelgenix client record
    const clientData = await airtableFetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}/${TRAVELGENIX_RECORD}`
    );
    const fields = clientData.fields;

    // Fetch upcoming events
    const cutoff = getDateInWeeks(4);
    const today = new Date().toISOString().split("T")[0];
    const formula = `AND(IS_AFTER({Date Start},'${today}'),IS_BEFORE({Date Start},'${cutoff}'))`;
    const eventsData = await airtableFetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${EVENTS_TABLE}?filterByFormula=${encodeURIComponent(formula)}`
    );
    const events = (eventsData.records || []).map((r) => r.fields);

    // Build B2B prompt
    const systemPrompt = buildB2BSystemPrompt(fields, events);

    console.log("Generating B2B content for Travelgenix...");
    console.log(`Events in scope: ${events.length}`);

    // Call Claude with web search enabled
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8000,
      temperature: 0.7,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [
        {
          role: "user",
          content:
            "Generate this week's B2B content for Travelgenix. Search for current UK travel industry news first, then generate all 12 posts. Return ONLY a valid JSON array.",
        },
      ],
    });

    // Extract text
    let textContent = "";
    for (const block of response.content) {
      if (block.type === "text") {
        textContent += block.text;
      }
    }

    // Parse
    const jsonStr = textContent
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let posts;
    try {
      posts = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(200).json({
        status: "parse_error",
        error: e.message,
        rawResponse: textContent.slice(0, 2000),
        usage: response.usage,
      });
    }

    // Clean posts: strip citations from web search and normalise channels
    const cleanText = (t) => {
      if (!t) return "";
      return t
        .replace(/<\/?cite[^>]*>/gi, "")
        .replace(/<\/?antml:cite[^>]*>/gi, "")
        .replace(/\[source[^\]]*\]/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    };

    const channelMap = {
      "twitter": "Twitter/X", "twitter/x": "Twitter/X", "x": "Twitter/X",
      "linkedin personal": "LinkedIn Personal", "linkedin company": "LinkedIn Company",
      "facebook": "Facebook", "instagram": "Instagram",
    };

    const cleanedPosts = posts.map((p) => ({
      ...p,
      targetChannel: channelMap[(p.targetChannel || "").toLowerCase()] || p.targetChannel,
      captionLinkedIn: cleanText(p.captionLinkedIn),
      captionTwitter: cleanText(p.captionTwitter),
      captionFacebook: cleanText(p.captionFacebook),
      captionInstagram: cleanText(p.captionInstagram),
      firstComment: cleanText(p.firstComment),
    }));

    // Return for review (don't write to queue in test mode)
    return res.status(200).json({
      status: "success",
      client: "Travelgenix",
      clientType: "b2b-saas",
      eventsInScope: events.map((e) => e["Event Name"]),
      postCount: cleanedPosts.length,
      posts: cleanedPosts,
      usage: response.usage,
      note: "TEST MODE — posts NOT written to queue. Review and then use the full cron endpoint to write.",
    });
  } catch (e) {
    console.error("B2B test error:", e);
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
};
