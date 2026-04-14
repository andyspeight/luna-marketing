// api/cron-generate.js
// Weekly batch content generation for ALL active clients
// Routes to B2C (travel) or B2B (SaaS) prompt based on Client Type field
// Triggered by Vercel cron: Sunday 18:00 UTC

const Anthropic = require("@anthropic-ai/sdk").default;
const { buildB2BSystemPrompt } = require("./b2b-prompt.js");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const QUEUE_TABLE = "tblbhyiuULvedva0K";
const EVENTS_TABLE = "tblQxIYrbzd6YlJYV";
const CRON_SECRET = process.env.CRON_SECRET;

// ── Helpers ──

function getNextMonday() {
  const d = new Date();
  d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
  return d.toISOString().split("T")[0];
}

function getDateInWeeks(weeks) {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split("T")[0];
}

// ── Airtable Fetchers ──

async function airtableFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Airtable error: ${res.statusText}`);
  return res.json();
}

async function getActiveClients() {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula={Status}='Active'`;
  const data = await airtableFetch(url);
  return data.records || [];
}

async function getUpcomingEvents(weeksAhead = 4) {
  const cutoff = getDateInWeeks(weeksAhead);
  const today = new Date().toISOString().split("T")[0];
  const formula = `AND(IS_AFTER({Date Start},'${today}'),IS_BEFORE({Date Start},'${cutoff}'))`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${EVENTS_TABLE}?filterByFormula=${encodeURIComponent(formula)}`;
  const data = await airtableFetch(url);
  return (data.records || []).map((r) => r.fields);
}

async function searchPexelsImage(query) {
  const PEXELS_KEY = process.env.PEXELS_KEY;
  if (!PEXELS_KEY) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    const data = await res.json();
    if (data.photos && data.photos.length > 0) {
      return data.photos[0].src.large2x;
    }
  } catch (e) {
    console.error("Pexels error:", e.message);
  }
  return null;
}

async function writeToQueue(records) {
  // Batch in groups of 10
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: batch, typecast: true }),
      }
    );
    if (!res.ok) {
      const err = await res.text();
      console.error(`Queue write error (batch ${i}):`, err);
    }
  }
}

// ── B2C Prompt Builder (existing travel content) ──

function buildB2CSystemPrompt(f) {
  return `You are Luna, the automated social media content engine for travel agents. You generate social media posts that will be published to Facebook, Instagram, LinkedIn, Twitter/X, Pinterest, TikTok and Google Business Profile without human review. Because no human checks your output before it goes live, accuracy and brand safety are paramount.

You are writing on behalf of a specific travel agent. Their brand profile is provided below. Every post must sound like it came from this agent, not from an AI or a generic marketing tool.

## Client Profile

Business Name: ${f["Business Name"] || ""}
Trading Name: ${f["Trading Name"] || ""}
Website: ${f["Website URL"] || ""}
Phone: ${f["Phone"] || ""}

## Brand Voice

Tone: ${f["Tone Keywords"] || "warm, professional"}
Emoji usage: ${f["Emoji Usage"] || "Light"}
Formality: ${f["Formality"] || "Balanced"}
Sentence style: ${f["Sentence Style"] || "Short and punchy"}
CTA style: ${f["CTA Style"] || "Question-based"}
Example phrases from their brand: ${f["Example Phrases"] || ""}

## What This Agent Sells

Destinations: ${f["Destinations"] || ""}
Specialisms: ${Array.isArray(f["Specialisms"]) ? f["Specialisms"].join(", ") : f["Specialisms"] || ""}

## Content Rules

BANNED words/phrases: "leverage", "utilize", "synergy", "game-changer", "innovative", "cutting-edge", "delve", "in today's digital landscape", "it's important to note"
Use UK English spelling. Use contractions naturally. 
No more than 3 hashtags per platform. No Oxford commas. No em dashes.

## Output Format

Return ONLY a valid JSON array. No markdown fences. No preamble.

Each object:
{
  "postTitle": "Short internal title",
  "contentType": "Destination Inspiration",
  "destination": "Santorini",
  "captionFacebook": "...",
  "captionInstagram": "...",
  "captionLinkedIn": "...",
  "captionTwitter": "...",
  "captionPinterest": "...",
  "captionTikTok": "...",
  "captionGBP": "...",
  "hashtags": "#travel #holidays",
  "imagePrompt": "Pexels search query",
  "ctaUrl": "https://..."
}

Generate ${f["Posting Frequency"] || 3} social media posts for the week beginning ${getNextMonday()}.`;
}

// ── Schedule Mapping ──

const B2B_SCHEDULE = [
  { day: "Monday", channel: "LinkedIn Personal", time: "08:30" },
  { day: "Monday", channel: "Twitter/X", time: "12:00" },
  { day: "Tuesday", channel: "LinkedIn Personal", time: "08:30" },
  { day: "Tuesday", channel: "Facebook", time: "10:00" },
  { day: "Wednesday", channel: "LinkedIn Company", time: "09:00" },
  { day: "Wednesday", channel: "Twitter/X", time: "12:00" },
  { day: "Wednesday", channel: "Instagram", time: "18:00" },
  { day: "Thursday", channel: "LinkedIn Personal", time: "08:30" },
  { day: "Thursday", channel: "Twitter/X", time: "12:00" },
  { day: "Thursday", channel: "Facebook", time: "10:00" },
  { day: "Friday", channel: "LinkedIn Personal", time: "08:30" },
  { day: "Friday", channel: "LinkedIn Company", time: "09:00" },
];

function getScheduledDate(dayName) {
  const monday = new Date(getNextMonday());
  const dayMap = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
  };
  const offset = dayMap[dayName] || 0;
  const d = new Date(monday);
  d.setDate(d.getDate() + offset);
  return d.toISOString().split("T")[0];
}

// ── Process a Single Client ──

async function processClient(record, events) {
  const f = record.fields;
  const clientId = record.id;
  const clientType = f["Client Type"] || "b2c-travel";
  const isB2B = clientType === "b2b-saas";

  console.log(
    `Processing ${f["Business Name"]} (${clientType}, ${f["Posting Frequency"] || (isB2B ? 12 : 3)} posts)`
  );

  // Build the appropriate prompt
  const systemPrompt = isB2B
    ? buildB2BSystemPrompt(f, events)
    : buildB2CSystemPrompt(f);

  // Call Claude API — B2B gets web search for news intelligence
  const tools = isB2B
    ? [{ type: "web_search_20250305", name: "web_search" }]
    : [];

  const messages = [
    {
      role: "user",
      content: isB2B
        ? "Generate this week's B2B content. Search for current UK travel industry news first, then generate all posts. Return ONLY a JSON array."
        : "Generate this week's social media posts. Return ONLY a JSON array.",
    },
  ];

  const apiParams = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    temperature: 0.7,
    system: systemPrompt,
    messages,
  };

  if (tools.length > 0) {
    apiParams.tools = tools;
  }

  const response = await client.messages.create(apiParams);

  // Extract text content from response (may have multiple blocks if web search used)
  let textContent = "";
  for (const block of response.content) {
    if (block.type === "text") {
      textContent += block.text;
    }
  }

  // Parse JSON from response
  const jsonStr = textContent
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  
  let posts;
  try {
    posts = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`JSON parse failed for ${f["Business Name"]}:`, e.message);
    console.error("Raw response:", textContent.slice(0, 500));
    return { client: f["Business Name"], status: "error", error: "JSON parse failed" };
  }

  if (!Array.isArray(posts)) {
    console.error(`Response not an array for ${f["Business Name"]}`);
    return { client: f["Business Name"], status: "error", error: "Not an array" };
  }

  // ── Post-Processing ──

  const weekLabel = `${new Date().getFullYear()}-W${String(Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 86400000 / 7)).padStart(2, "0")}`;

  const queueRecords = [];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    // Get image from Pexels
    let imageUrl = null;
    if (post.imagePrompt) {
      imageUrl = await searchPexelsImage(post.imagePrompt);
    }

    // Calculate scheduled date
    let scheduledDate = null;
    let scheduledTime = null;

    if (isB2B && post.day) {
      scheduledDate = getScheduledDate(post.day);
      scheduledTime = post.time || "09:00";
    } else if (isB2B && B2B_SCHEDULE[i]) {
      scheduledDate = getScheduledDate(B2B_SCHEDULE[i].day);
      scheduledTime = B2B_SCHEDULE[i].time;
    } else {
      // B2C: distribute across posting days
      const days = (f["Posting Days"] || "Mon,Wed,Fri").split(",");
      const dayMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      const dayIndex = i % days.length;
      const offset = dayMap[days[dayIndex].trim()] || 0;
      const monday = new Date(getNextMonday());
      monday.setDate(monday.getDate() + offset);
      scheduledDate = monday.toISOString().split("T")[0];
      scheduledTime = "09:00";
    }

    // Build queue record
    const fields = {
      fldGRsU5pWRoAN34s: post.postTitle || `Post ${i + 1}`, // Post Title
      fldVteQRAcqE2n1lV: [clientId], // Client link
      fldWe3d6ec4pu9jcZ: post.captionFacebook || "", // Caption - Facebook
      fldpAenBNwgJMFs7k: post.captionInstagram || "", // Caption - Instagram
      fldJKPHgL0U9ZZAuX: post.captionLinkedIn || "", // Caption - LinkedIn
      fldYQsiw65rcd2X2B: post.captionTwitter || "", // Caption - Twitter
      fld1cSSlrKuA1SXp5: post.hashtags || "", // Hashtags
      fld8s5QVemJ4plhzs: post.ctaUrl || f["Website URL"] || "", // CTA URL
      fld1a2lxyXPC71UtQ: scheduledDate, // Scheduled Date
      fld2zaXYmEXQHTua8: scheduledTime, // Scheduled Time
      fldDmTOSTSlkObab7: "Queued", // Status
      fldFWP2Zkppxipo9U: weekLabel, // Generated Week
    };

    // Add image URL if found
    if (imageUrl) {
      fields.fldNjzWAIj9eknEWS = imageUrl; // Image URL
    }

    // B2B-specific fields
    if (isB2B) {
      fields.fldYHX5rR7f0Dgsnu = post.targetChannel || "LinkedIn Personal"; // Target Channel
      fields.fldZyrr9DTA6mQvxH = post.pillar || "Education"; // Content Pillar
      fields.fldkOeFJLYsjhZ9KZ = post.firstComment || ""; // First Comment
      fields.fldrDRwNKnOQrl5lx = "Thought Leadership"; // Content Type
    } else {
      // B2C-specific fields
      fields.fldrDRwNKnOQrl5lx = post.contentType || "Destination Inspiration";
      fields.flduL1WMpt4do8C4I = post.destination || ""; // Destination

      // B2C platform captions
      if (post.captionPinterest) fields.fldCfdS6ByrofDtkE = post.captionPinterest;
      if (post.captionTikTok) fields.fldyVawF0JrCLb9n5 = post.captionTikTok;
      if (post.captionGBP) fields.fld39pPTqpajLLpnX = post.captionGBP;
    }

    queueRecords.push({ fields });
  }

  // Write to Airtable queue
  await writeToQueue(queueRecords);

  console.log(
    `✓ ${f["Business Name"]}: ${queueRecords.length} posts queued (${clientType})`
  );

  return {
    client: f["Business Name"],
    status: "success",
    posts: queueRecords.length,
    type: clientType,
  };
}

// ── Main Handler ──

module.exports = async (req, res) => {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Optional: restrict to Sundays only in production
  // Uncomment for production:
  // const today = new Date().getDay();
  // if (today !== 0) {
  //   return res.status(200).json({ message: "Not Sunday, skipping" });
  // }

  try {
    // Fetch all active clients
    const clients = await getActiveClients();
    if (clients.length === 0) {
      return res.status(200).json({ message: "No active clients found" });
    }

    // Fetch upcoming events (for B2B clients)
    const events = await getUpcomingEvents(4);

    console.log(
      `Starting batch generation: ${clients.length} clients, ${events.length} upcoming events`
    );

    // Process each client
    const results = [];
    for (const record of clients) {
      try {
        const result = await processClient(record, events);
        results.push(result);
      } catch (e) {
        console.error(`Error processing ${record.fields["Business Name"]}:`, e);
        results.push({
          client: record.fields["Business Name"],
          status: "error",
          error: e.message,
        });
      }

      // Brief pause between clients to respect API limits
      await new Promise((r) => setTimeout(r, 2000));
    }

    const summary = {
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      errors: results.filter((r) => r.status === "error").length,
      b2b: results.filter((r) => r.type === "b2b-saas").length,
      b2c: results.filter((r) => r.type === "b2c-travel").length,
      results,
    };

    console.log("Batch complete:", JSON.stringify(summary, null, 2));
    return res.status(200).json(summary);
  } catch (e) {
    console.error("Cron generation failed:", e);
    return res.status(500).json({ error: e.message });
  }
};
