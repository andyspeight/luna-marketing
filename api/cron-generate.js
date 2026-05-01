// api/cron-generate.js
// Weekly batch content generation for ALL active clients
// Routes to B2C (travel) or B2B (SaaS) prompt based on Client Type field
// Day 2: B2B clients get research sparks injected
// Day 3: All posts get UTM tags auto-injected after queue write
// Triggered by Vercel cron: Mon/Wed/Fri 07:00 UTC

const Anthropic = require("@anthropic-ai/sdk").default;
const { buildB2BSystemPrompt } = require("./b2b-prompt.js");
const { tagPostUrls, channelToUtmSource, postUtmContent, addUtm, replaceUrlsInText } = require("./utm-helper.js");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const QUEUE_TABLE = "tblbhyiuULvedva0K";
const EVENTS_TABLE = "tblQxIYrbzd6YlJYV";
const SPARKS_TABLE = "Research Sparks";
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

function stripCitations(text) {
  if (!text) return "";
  return text
    .replace(/<\/?cite[^>]*>/gi, "")
    .replace(/<\/?antml:cite[^>]*>/gi, "")
    .replace(/\[source[^\]]*\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normaliseChannel(channel) {
  const map = {
    "twitter": "Twitter/X",
    "twitter/x": "Twitter/X",
    "x": "Twitter/X",
    "linkedin personal": "LinkedIn Personal",
    "linkedin company": "LinkedIn Company",
    "linkedin": "LinkedIn Company",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "tiktok": "TikTok",
    "pinterest": "Pinterest",
    "google business profile": "Google Business Profile",
    "gbp": "Google Business Profile",
  };
  return map[(channel || "").toLowerCase()] || channel || "LinkedIn Personal";
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

async function getOpenSparks(limit = 10) {
  const formula = encodeURIComponent(`AND({Status}='Open', {Score}>=6)`);
  const sortQuery = "&sort%5B0%5D%5Bfield%5D=Score&sort%5B0%5D%5Bdirection%5D=desc";
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(SPARKS_TABLE)}?filterByFormula=${formula}${sortQuery}&maxRecords=${limit}`;
  try {
    const data = await airtableFetch(url);
    return (data.records || []).map((r) => ({
      id: r.id,
      source: r.fields.Source || "Unknown",
      headline: r.fields.Headline || "",
      url: r.fields.URL || "",
      summary: r.fields.Summary || "",
      score: r.fields.Score || 0,
      angle: r.fields["Suggested Angle"] || "",
    }));
  } catch (e) {
    console.error("Sparks fetch failed:", e.message);
    return [];
  }
}

async function markSparksUsed(sparkIds) {
  if (!sparkIds || sparkIds.length === 0) return;
  const unique = [...new Set(sparkIds)];
  for (const sparkId of unique) {
    try {
      await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(SPARKS_TABLE)}/${sparkId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${AIRTABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fields: { Status: "Used" }, typecast: true }),
        }
      );
    } catch (e) {
      console.error(`Mark spark used failed (${sparkId}):`, e.message);
    }
  }
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

// Write batch and RETURN the records with their new IDs (so we can UTM-tag them)
async function writeToQueueAndReturnIds(records) {
  const created = [];
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    try {
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
      if (res.ok) {
        const data = await res.json();
        created.push(...(data.records || []));
      } else {
        const err = await res.text();
        console.error(`Queue write error (batch ${i}):`, err);
      }
    } catch (e) {
      console.error(`Queue write exception (batch ${i}):`, e.message);
    }
  }
  return created;
}

// PATCH each created record with UTM-tagged URLs now we have the recordId
async function tagRecordUrls(createdRecords, postsByIndex) {
  for (let i = 0; i < createdRecords.length; i++) {
    const rec = createdRecords[i];
    const post = postsByIndex[i];
    if (!post) continue;
    
    // Tag the post object (mutates a copy) using the now-known recordId for utm_content
    const tagged = tagPostUrls(post, rec.id);
    
    // Build PATCH body with the tagged caption fields
    const patchFields = {};
    if (tagged.captionFacebook !== undefined) patchFields.fldWe3d6ec4pu9jcZ = tagged.captionFacebook;
    if (tagged.captionInstagram !== undefined) patchFields.fldpAenBNwgJMFs7k = tagged.captionInstagram;
    if (tagged.captionLinkedIn !== undefined) patchFields.fldJKPHgL0U9ZZAuX = tagged.captionLinkedIn;
    if (tagged.captionTwitter !== undefined) patchFields.fldYQsiw65rcd2X2B = tagged.captionTwitter;
    if (tagged.captionPinterest !== undefined) patchFields.fldCfdS6ByrofDtkE = tagged.captionPinterest;
    if (tagged.captionTikTok !== undefined) patchFields.fldyVawF0JrCLb9n5 = tagged.captionTikTok;
    if (tagged.captionGBP !== undefined) patchFields.fld39pPTqpajLLpnX = tagged.captionGBP;
    if (tagged.firstComment !== undefined) patchFields.fldkOeFJLYsjhZ9KZ = tagged.firstComment;
    if (tagged.ctaUrl !== undefined) patchFields.fld8s5QVemJ4plhzs = tagged.ctaUrl;
    
    if (Object.keys(patchFields).length === 0) continue;
    
    try {
      await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}/${rec.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${AIRTABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fields: patchFields, typecast: true }),
        }
      );
    } catch (e) {
      console.error(`UTM tag PATCH failed (${rec.id}):`, e.message);
    }
  }
}

// ── B2C Prompt Builder (unchanged) ──

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
  { day: "Monday", channel: "Google Business Profile", time: "10:00" },
  { day: "Tuesday", channel: "LinkedIn Personal", time: "08:30" },
  { day: "Tuesday", channel: "Facebook", time: "10:00" },
  { day: "Wednesday", channel: "LinkedIn Company", time: "09:00" },
  { day: "Wednesday", channel: "Instagram", time: "18:00" },
  { day: "Thursday", channel: "LinkedIn Personal", time: "08:30" },
  { day: "Thursday", channel: "Facebook", time: "10:00" },
  { day: "Friday", channel: "LinkedIn Personal", time: "08:30" },
  { day: "Friday", channel: "LinkedIn Company", time: "09:00" },
];

function getScheduledDate(dayName) {
  const monday = new Date(getNextMonday());
  const dayMap = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4 };
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

  const sparks = isB2B ? await getOpenSparks(10) : [];
  if (isB2B) console.log(`  loaded ${sparks.length} open sparks`);

  const systemPrompt = isB2B
    ? buildB2BSystemPrompt(f, events, sparks)
    : buildB2CSystemPrompt(f);

  const tools = isB2B
    ? [{ type: "web_search_20250305", name: "web_search" }]
    : [];

  const userMessage = isB2B
    ? (sparks.length > 0
        ? "Generate this week's B2B content. Use the Research Sparks above as your primary factual foundation for Industry Commentary posts. Search the web only if you need supplementary detail. Return ONLY a JSON array."
        : "Generate this week's B2B content. No fresh sparks today, so search the web for current UK travel industry news first, then generate all posts. Return ONLY a JSON array.")
    : "Generate this week's social media posts. Return ONLY a JSON array.";

  const messages = [{ role: "user", content: userMessage }];

  const apiParams = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    temperature: 0.7,
    system: systemPrompt,
    messages,
  };

  if (tools.length > 0) apiParams.tools = tools;

  const response = await client.messages.create(apiParams);

  let textContent = "";
  for (const block of response.content) {
    if (block.type === "text") textContent += block.text;
  }

  const jsonStr = textContent.replace(/```json/g, "").replace(/```/g, "").trim();
  
  let posts;
  try {
    posts = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`JSON parse failed for ${f["Business Name"]}:`, e.message);
    return { client: f["Business Name"], status: "error", error: "JSON parse failed" };
  }

  if (!Array.isArray(posts)) {
    return { client: f["Business Name"], status: "error", error: "Not an array" };
  }

  const weekLabel = `${new Date().getFullYear()}-W${String(Math.ceil((new Date() - new Date(new Date().getFullYear(), 0, 1)) / 86400000 / 7)).padStart(2, "0")}`;

  const queueRecords = [];
  const postsByIndex = []; // we keep the original posts to UTM-tag them after write
  const usedSparkIds = [];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    if (isB2B && post.sparkRef && Number.isInteger(post.sparkRef)) {
      const sparkIdx = post.sparkRef - 1;
      if (sparks[sparkIdx]) usedSparkIds.push(sparks[sparkIdx].id);
    }

    let imageUrl = null;
    if (post.imagePrompt) imageUrl = await searchPexelsImage(post.imagePrompt);

    let scheduledDate = null;
    let scheduledTime = null;

    if (isB2B && post.day) {
      scheduledDate = getScheduledDate(post.day);
      scheduledTime = post.time || "09:00";
    } else if (isB2B && B2B_SCHEDULE[i]) {
      scheduledDate = getScheduledDate(B2B_SCHEDULE[i].day);
      scheduledTime = B2B_SCHEDULE[i].time;
    } else {
      const days = (f["Posting Days"] || "Mon,Wed,Fri").split(",");
      const dayMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
      const dayIndex = i % days.length;
      const offset = dayMap[days[dayIndex].trim()] || 0;
      const monday = new Date(getNextMonday());
      monday.setDate(monday.getDate() + offset);
      scheduledDate = monday.toISOString().split("T")[0];
      scheduledTime = "09:00";
    }

    // Build queue record (UTM-untagged - we tag after write when we have recordId)
    const fields = {
      fldGRsU5pWRoAN34s: post.postTitle || `Post ${i + 1}`,
      fldVteQRAcqE2n1lV: [clientId],
      fldWe3d6ec4pu9jcZ: stripCitations(post.captionFacebook),
      fldpAenBNwgJMFs7k: stripCitations(post.captionInstagram),
      fldJKPHgL0U9ZZAuX: stripCitations(post.captionLinkedIn),
      fldYQsiw65rcd2X2B: stripCitations(post.captionTwitter),
      fld1cSSlrKuA1SXp5: post.hashtags || "",
      fld8s5QVemJ4plhzs: post.ctaUrl || f["Website URL"] || "",
      fld1a2lxyXPC71UtQ: scheduledDate,
      fld2zaXYmEXQHTua8: scheduledTime,
      fldDmTOSTSlkObab7: "Queued",
      fldFWP2Zkppxipo9U: weekLabel,
    };

    if (imageUrl) fields.fldNjzWAIj9eknEWS = imageUrl;

    if (isB2B) {
      fields.fldYHX5rR7f0Dgsnu = normaliseChannel(post.targetChannel);
      fields.fldZyrr9DTA6mQvxH = post.pillar || "Education";
      fields.fldkOeFJLYsjhZ9KZ = stripCitations(post.firstComment);
      fields.fldrDRwNKnOQrl5lx = "Thought Leadership";
      if (post.captionGBP) fields.fld39pPTqpajLLpnX = stripCitations(post.captionGBP);
    } else {
      fields.fldrDRwNKnOQrl5lx = post.contentType || "Destination Inspiration";
      fields.flduL1WMpt4do8C4I = post.destination || "";
      if (post.captionPinterest) fields.fldCfdS6ByrofDtkE = post.captionPinterest;
      if (post.captionTikTok) fields.fldyVawF0JrCLb9n5 = post.captionTikTok;
      if (post.captionGBP) fields.fld39pPTqpajLLpnX = post.captionGBP;
    }

    queueRecords.push({ fields });
    
    // Keep a clean copy of the original post for UTM tagging.
    // We strip citations on the captions to match what's stored.
    postsByIndex.push({
      postTitle: post.postTitle,
      targetChannel: isB2B ? normaliseChannel(post.targetChannel) : null,
      ctaUrl: post.ctaUrl || f["Website URL"] || "",
      captionFacebook: stripCitations(post.captionFacebook),
      captionInstagram: stripCitations(post.captionInstagram),
      captionLinkedIn: stripCitations(post.captionLinkedIn),
      captionTwitter: stripCitations(post.captionTwitter),
      captionPinterest: post.captionPinterest || "",
      captionTikTok: post.captionTikTok || "",
      captionGBP: stripCitations(post.captionGBP),
      firstComment: isB2B ? stripCitations(post.firstComment) : "",
    });
  }

  // Write to Airtable queue and get the created records back
  const created = await writeToQueueAndReturnIds(queueRecords);
  console.log(`  ${created.length}/${queueRecords.length} records written`);

  // Now UTM-tag the URLs in each record using the recordId for utm_content
  if (created.length > 0) {
    await tagRecordUrls(created, postsByIndex);
    console.log(`  UTM tags applied to ${created.length} records`);
  }

  if (usedSparkIds.length > 0) {
    await markSparksUsed(usedSparkIds);
    console.log(`  marked ${usedSparkIds.length} sparks as Used`);
  }

  console.log(`✓ ${f["Business Name"]}: ${created.length} posts queued`);

  return {
    client: f["Business Name"],
    status: "success",
    posts: created.length,
    type: clientType,
    sparksUsed: usedSparkIds.length,
  };
}

// ── Main Handler ──

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const clients = await getActiveClients();
    if (clients.length === 0) {
      return res.status(200).json({ message: "No active clients found" });
    }

    const events = await getUpcomingEvents(4);

    console.log(`Starting batch generation: ${clients.length} clients, ${events.length} upcoming events`);

    const results = [];
    for (const record of clients) {
      try {
        const result = await processClient(record, events);
        results.push(result);
      } catch (e) {
        console.error(`Error processing ${record.fields["Business Name"]}:`, e);
        results.push({ client: record.fields["Business Name"], status: "error", error: e.message });
      }
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
