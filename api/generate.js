const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PEXELS_KEY = process.env.PEXELS_KEY;

async function getClient(clientId) {
  var res = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali/" + clientId,
    { headers: { Authorization: "Bearer " + AIRTABLE_KEY } }
  );
  if (!res.ok) throw new Error("Failed to fetch client: " + res.statusText);
  return res.json();
}

async function checkFCDO(country) {
  if (!country || country === "General") return { safe: true, level: "none" };
  try {
    var slug = country.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    var url = "https://www.gov.uk/foreign-travel-advice/" + slug;
    var response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return { safe: true, level: "not_found" };
    var data = await response.json();
    var content = JSON.stringify(data).toLowerCase();
    if (content.includes("advise against all travel")) {
      return { safe: false, level: "against_all_travel", reason: "FCDO advises against all travel to " + country };
    }
    if (content.includes("advise against all but essential travel")) {
      return { safe: false, level: "against_all_but_essential", reason: "FCDO advises against all but essential travel to " + country };
    }
    return { safe: true, level: "no_warning" };
  } catch (err) {
    return { safe: true, level: "check_failed", reason: err.message };
  }
}

async function searchImage(query, orientation) {
  if (!PEXELS_KEY) return null;
  try {
    var url = "https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) + "&orientation=" + (orientation || "landscape") + "&per_page=1&size=large";
    var res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    if (data.photos && data.photos.length > 0) {
      return data.photos[0].src.large2x || data.photos[0].src.large;
    }
    return null;
  } catch (err) {
    return null;
  }
}

function buildSystemPrompt(clientRecord) {
  var f = clientRecord.fields;
  return "You are Luna, the automated social media content engine for travel agents. You generate social media posts that will be published to Facebook, Instagram and LinkedIn without human review. Because no human checks your output before it goes live, accuracy and brand safety are paramount.\n\nYou are writing on behalf of a specific travel agent. Their brand profile is provided below. Every post must sound like it came from this agent, not from an AI or a generic marketing tool.\n\n## Client Profile\n\nBusiness Name: " + (f["Business Name"] || "") + "\nTrading Name: " + (f["Trading Name"] || "") + "\nWebsite: " + (f["Website URL"] || "") + "\nPhone: " + (f["Phone"] || "") + "\n\n## Brand Voice\n\nTone: " + (f["Tone Keywords"] || "warm, professional") + "\nEmoji usage: " + (f["Emoji Usage"] || "Light") + "\nFormality: " + (f["Formality"] || "Balanced") + "\nSentence style: " + (f["Sentence Style"] || "Short and punchy") + "\nCTA style: " + (f["CTA Style"] || "Question-based") + "\nExample phrases from their brand: " + (f["Example Phrases"] || "") + "\n\n## What This Agent Sells\n\nDestinations: " + (f["Destinations"] || "") + "\nSpecialisms: " + (Array.isArray(f["Specialisms"]) ? f["Specialisms"].join(", ") : f["Specialisms"] || "") + "\n\n## Content Request\n\nGenerate " + (f["Posting Frequency"] || 3) + " social media posts for the week beginning " + getNextMonday() + ".\n\nThe content mix should follow these weightings:\n- Destination Inspiration: 40%\n- Offer Highlight: 20%\n- Travel Tips: 15%\n- Social Proof: 10%\n- Seasonal/Event: 10%\n- Behind the Scenes: 5%\n\nRound to the nearest whole post. For 3 posts per week, a typical mix is 2 Destination Inspiration and 1 rotating type. Vary the rotating type week to week.\n\n## Content Rules (Non-Negotiable)\n\n### Language\n- UK English only. Colour not color. Favourite not favorite. Centre not center.\n- No em dashes. Use commas, full stops or colons instead.\n- No Oxford comma. Write \"Turkey, Greece and Spain\" not \"Turkey, Greece, and Spain\".\n\n### Banned Phrases\nNever use any of these: leverage, seamless, game-changer, deep dive, elevate, unlock, navigate, landscape, robust, cutting-edge, empower, harness, at the end of the day, in today's world, it's important to note, it's worth noting, delve, nestled, embark, tapestry, picture this, ever-changing, testament to, whether you're, there's something for everyone, the world is waiting, adventure awaits, escape the ordinary, hidden gem, bucket list, wander, paradise found, sun-kissed\n\n### Safety\n- No political content. No religious content. No controversial opinions.\n- No health claims or medical advice.\n- No pricing unless explicitly provided in a supplier offers section. Never invent, estimate or round prices.\n- No competitor mentions. Never name another travel agent, OTA, tour operator or technology provider.\n- No negative content about any destination, country, culture or people.\n- No content about destinations not in this agent's destination list.\n\n### Structure\n- Every post must include a call-to-action.\n- Captions: 50-200 words for Facebook, 50-150 words for Instagram, 50-250 words for LinkedIn.\n- Hashtags: 5-15 for Instagram, 3-5 for Facebook, 3-5 for LinkedIn.\n- Never use the same opening word for two posts.\n- Never start a post with a hashtag.\n- Be specific to the destination. Reference actual places, beaches, streets, dishes, experiences.\n\n### CTA Links\n- Format: " + (f["Website URL"] || "") + "/destinations/destination-slug?utm_source=social&utm_medium=platform&utm_campaign=luna_marketing\n\n### Image Tags\nFor each post, provide 3 image search tags that describe the ideal image. Be specific.\n\n## Output Format\n\nReturn a JSON array of post objects. No markdown, no commentary, no preamble. Only valid JSON.\n\nEach post object must have exactly these fields:\npost_number, content_type, destination, destination_slug, caption_facebook, caption_instagram, caption_linkedin, hashtags_facebook (array), hashtags_instagram (array), hashtags_linkedin (array), cta_url_facebook, cta_url_instagram, cta_url_linkedin, image_tags (array of 3), image_orientation, suggested_day, suggested_time";
}

function getNextMonday() {
  var now = new Date();
  var day = now.getDay();
  var diff = day === 0 ? 1 : 8 - day;
  var monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function getWeekString() {
  var now = new Date();
  var start = new Date(now.getFullYear(), 0, 1);
  var diff = now - start;
  var week = Math.ceil(((diff / 86400000 + start.getDay() + 1) / 7));
  return now.getFullYear() + "-W" + String(week).padStart(2, "0");
}

async function queuePosts(posts, clientId, autoPublish) {
  var created = [];
  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];

    // Build image search query with destination for relevance
    var tags = post.image_tags || [];
    var dest = post.destination || "";
    var imageQuery;
    if (dest && dest !== "General") {
      imageQuery = tags.length > 0 ? dest + " " + tags[0] : dest + " travel holiday";
    } else {
      imageQuery = tags.length > 0 ? tags[0] + " travel holiday" : "travel holiday beach";
    }

    // Fetch image from Pexels
    var imageUrl = await searchImage(imageQuery, post.image_orientation || "landscape");

    // Check FCDO advisory
    var fcdo = await checkFCDO(post.destination);

    // Determine status: Suppressed if FCDO warning, Approved if auto-publish, Queued if manual review
    var status = !fcdo.safe ? "Suppressed" : (autoPublish ? "Approved" : "Queued");
    var suppressionReason = fcdo.safe ? "" : (fcdo.reason || "FCDO advisory");

    var record = {
      fields: {
        "Post Title": (post.destination || "General") + " " + (post.content_type || "") + " - " + (post.suggested_day || ""),
        "Client": [clientId],
        "Content Type": post.content_type,
        "Caption - Facebook": post.caption_facebook,
        "Caption - Instagram": post.caption_instagram,
        "Caption - LinkedIn": post.caption_linkedin || "",
        "Hashtags": [].concat(post.hashtags_facebook || [], post.hashtags_instagram || [])
          .filter(function (v, idx, arr) { return arr.indexOf(v) === idx; })
          .join(", "),
        "CTA URL": post.cta_url_facebook || "",
        "Destination": post.destination || "",
        "Scheduled Time": post.suggested_time || "09:00",
        "Status": status,
        "Suppression Reason": suppressionReason,
        "Generated Week": getWeekString(),
        "Image URL": imageUrl || "",
        "Image Position": "50% 50%"
      }
    };

    var res = await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblbhyiuULvedva0K",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + AIRTABLE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ records: [record], typecast: true })
      }
    );
    if (res.ok) {
      var data = await res.json();
      created.push({
        id: data.records[0].id,
        _imageUrl: imageUrl,
        _fcdoStatus: fcdo.level,
        _suppressed: !fcdo.safe,
        _status: status
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  console.log("PEXELS_KEY present:", !!PEXELS_KEY, "AIRTABLE_KEY present:", !!AIRTABLE_KEY);

  try {
    var body = req.body || {};
    var clientId = body.clientId;
    var dryRun = body.dryRun;

    if (!clientId) return res.status(400).json({ error: "clientId is required" });

    // 1. Fetch client from Airtable
    var clientRecord = await getClient(clientId);
    var autoPublish = !!clientRecord.fields["Auto Publish"];

    // 2. Build system prompt
    var systemPrompt = buildSystemPrompt(clientRecord);

    // 3. Call Claude API
    var response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: "user", content: "Generate this week's social media posts." }]
    });

    // 4. Parse response
    var text = response.content
      .map(function (c) { return c.type === "text" ? c.text : ""; })
      .filter(Boolean)
      .join("");

    var cleaned = text.replace(/```json|```/g, "").trim();
    var posts;
    try {
      posts = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: "Failed to parse Claude response as JSON", raw: cleaned.substring(0, 500) });
    }

    // 5. Queue posts to Airtable with images and FCDO checks (unless dry run)
    var queued = [];
    var suppressed = 0;
    var approved = 0;
    if (!dryRun) {
      queued = await queuePosts(posts, clientId, autoPublish);
      suppressed = queued.filter(function (q) { return q._suppressed; }).length;
      approved = queued.filter(function (q) { return q._status === "Approved"; }).length;
    }

    return res.status(200).json({
      success: true,
      posts: posts,
      queued: queued.length,
      suppressed: suppressed,
      approved: approved,
      autoPublish: autoPublish,
      client: clientRecord.fields["Business Name"],
      week: getWeekString()
    });
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).json({ error: err.message });
  }
};
