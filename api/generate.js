const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PEXELS_KEY = process.env.PEXELS_KEY;

async function getClient(clientId) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/tblUkzvBujc94Yali/${clientId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
  );
  if (!res.ok) throw new Error("Failed to fetch client: " + res.statusText);
  return res.json();
}

// FCDO check for a destination
async function checkFCDO(country) {
  if (!country || country === "General") return { safe: true, level: "none" };
  try {
    const slug = country.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const url = `https://www.gov.uk/foreign-travel-advice/${slug}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return { safe: true, level: "not_found" };
    const data = await response.json();
    const content = JSON.stringify(data).toLowerCase();
    if (content.includes("advise against all travel")) {
      return { safe: false, level: "against_all_travel", reason: "FCDO advises against all travel to " + country };
    }
    if (content.includes("advise against all but essential travel")) {
      return { safe: false, level: "against_all_but_essential", reason: "FCDO advises against all but essential travel to " + country };
    }
    return { safe: true, level: "no_warning" };
  } catch (err) {
    // On error, default to safe (don't block due to fetch failure)
    return { safe: true, level: "check_failed", reason: err.message };
  }
}

// Pexels image search
async function searchImage(query, orientation) {
  if (!PEXELS_KEY) return null;
  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${orientation || "landscape"}&per_page=1&size=large`;
    const res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.photos && data.photos.length > 0) {
      return data.photos[0].src.large2x || data.photos[0].src.large;
    }
    return null;
  } catch (err) {
    return null;
  }
}

function buildSystemPrompt(client) {
  const f = client.fields;
  return `You are Luna, the automated social media content engine for travel agents. You generate social media posts that will be published to Facebook, Instagram and LinkedIn without human review. Because no human checks your output before it goes live, accuracy and brand safety are paramount.

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

## Content Request

Generate ${f["Posting Frequency"] || 3} social media posts for the week beginning ${getNextMonday()}.

The content mix should follow these weightings:
- Destination Inspiration: 40%
- Offer Highlight: 20%
- Travel Tips: 15%
- Social Proof: 10%
- Seasonal/Event: 10%
- Behind the Scenes: 5%

Round to the nearest whole post. For 3 posts per week, a typical mix is 2 Destination Inspiration and 1 rotating type. Vary the rotating type week to week.

## Content Rules (Non-Negotiable)

### Language
- UK English only. Colour not color. Favourite not favorite. Centre not center.
- No em dashes. Use commas, full stops or colons instead.
- No Oxford comma. Write "Turkey, Greece and Spain" not "Turkey, Greece, and Spain".

### Banned Phrases
Never use any of these: leverage, seamless, game-changer, deep dive, elevate, unlock, navigate, landscape, robust, cutting-edge, empower, harness, at the end of the day, in today's world, it's important to note, it's worth noting, delve, nestled, embark, tapestry, picture this, ever-changing, testament to, whether you're, there's something for everyone, the world is waiting, adventure awaits, escape the ordinary, hidden gem, bucket list, wander, paradise found, sun-kissed

### Safety
- No political content. No religious content. No controversial opinions.
- No health claims or medical advice.
- No pricing unless explicitly provided in a supplier offers section. Never invent, estimate or round prices.
- No competitor mentions. Never name another travel agent, OTA, tour operator or technology provider.
- No negative content about any destination, country, culture or people.
- No content about destinations not in this agent's destination list.

### Structure
- Every post must include a call-to-action.
- Captions: 50-200 words for Facebook, 50-150 words for Instagram, 50-250 words for LinkedIn.
- Hashtags: 5-15 for Instagram, 3-5 for Facebook, 3-5 for LinkedIn.
- Never use the same opening word for two posts.
- Never start a post with a hashtag.
- Be specific to the destination. Reference actual places, beaches, streets, dishes, experiences.

### CTA Links
- Format: ${f["Website URL"] || ""}/destinations/destination-slug?utm_source=social&utm_medium=platform&utm_campaign=luna_marketing

### Image Tags
For each post, provide 3 image search tags that describe the ideal image. Be specific.

## Output Format

Return a JSON array of post objects. No markdown, no commentary, no preamble. Only valid JSON.

Each post object must have exactly these fields:
post_number, content_type, destination, destination_slug, caption_facebook, caption_instagram, caption_linkedin, hashtags_facebook (array), hashtags_instagram (array), hashtags_linkedin (array), cta_url_facebook, cta_url_instagram, cta_url_linkedin, image_tags (array of 3), image_orientation, suggested_day, suggested_time`;
}

function getNextMonday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getWeekString() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const week = Math.ceil(((diff / 86400000 + start.getDay() + 1) / 7));
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function queuePosts(posts, clientId) {
  const created = [];
  for (const post of posts) {
    // Build image search query with destination for relevance
    const tags = post.image_tags || [];
    const dest = post.destination || "";
    let imageQuery;
    if (dest && dest !== "General") {
      imageQuery = tags.length > 0 ? dest + " " + tags[0] : dest + " travel holiday";
    } else {
      imageQuery = tags.length > 0 ? tags[0] + " travel holiday" : "travel holiday beach";
    }

    // Fetch image from Pexels
    const imageUrl = await searchImage(imageQuery, post.image_orientation || "landscape");

    // Check FCDO advisory
    const fcdo = await checkFCDO(post.destination);

    const status = fcdo.safe ? "Queued" : "Suppressed";
    const suppressionReason = fcdo.safe ? "" : fcdo.reason || "FCDO advisory";

    const record = {
      fields: {
        "Post Title": `${post.destination} ${post.content_type} - ${post.suggested_day}`,
        "Client": [clientId],
        "Content Type": post.content_type,
        "Caption - Facebook": post.caption_facebook,
        "Caption - Instagram": post.caption_instagram,
        "Caption - LinkedIn": post.caption_linkedin || "",
        "Hashtags": [...(post.hashtags_facebook || []), ...(post.hashtags_instagram || [])]
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", "),
        "CTA URL": post.cta_url_facebook || "",
        "Destination": post.destination || "",
        "Scheduled Time": post.suggested_time || "09:00",
        "Status": status,
        "Suppression Reason": suppressionReason,
        "Generated Week": getWeekString(),
        "Image URL": imageUrl || "",
      },
    };

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/tblbhyiuULvedva0K`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: [record], typecast: true }),
      }
    );
    if (res.ok) {
      const data = await res.json();
      created.push({
        ...data.records[0],
        _imageUrl: imageUrl,
        _fcdoStatus: fcdo.level,
        _suppressed: !fcdo.safe,
      });
    }
  }
  return created;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { clientId, dryRun } = req.body || {};

    if (!clientId)
      return res.status(400).json({ error: "clientId is required" });

    // 1. Fetch client from Airtable
    const clientRecord = await getClient(clientId);

    // 2. Build system prompt
    const systemPrompt = buildSystemPrompt(clientRecord);

    // 3. Call Claude API
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        { role: "user", content: "Generate this week's social media posts." },
      ],
    });

    // 4. Parse response
    const text = response.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .filter(Boolean)
      .join("");

    const cleaned = text.replace(/```json|```/g, "").trim();
    let posts;
    try {
      posts = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({
        error: "Failed to parse Claude response as JSON",
        raw: cleaned.substring(0, 500),
      });
    }

    // 5. Queue posts to Airtable with images and FCDO checks (unless dry run)
    let queued = [];
    let suppressed = 0;
    if (!dryRun) {
      queued = await queuePosts(posts, clientId);
      suppressed = queued.filter((q) => q._suppressed).length;
    }

    return res.status(200).json({
      success: true,
      posts,
      queued: queued.length,
      suppressed,
      client: clientRecord.fields["Business Name"],
      week: getWeekString(),
    });
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).json({ error: err.message });
  }
};
