var Anthropic = require("@anthropic-ai/sdk").default;

var anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var PEXELS_KEY = process.env.PEXELS_KEY;

// ── Helpers ──

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
  } catch (err) { return null; }
}

async function searchVideo(query) {
  if (!PEXELS_KEY) return null;
  try {
    var url = "https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) + "&orientation=portrait&per_page=1&size=medium";
    var res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    if (data.videos && data.videos.length > 0) {
      var v = data.videos[0];
      var files = v.video_files || [];
      var best = files.filter(function(f) { return f.quality === "hd"; }).sort(function(a,b) { return (b.width||0) - (a.width||0); })[0];
      if (!best) best = files[0];
      return best ? best.link : null;
    }
    return null;
  } catch (err) { return null; }
}

function getWeekString() {
  var d = new Date();
  var oneJan = new Date(d.getFullYear(), 0, 1);
  var weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return d.getFullYear() + "-W" + (weekNum < 10 ? "0" : "") + weekNum;
}

function getNextMonday() {
  var d = new Date();
  var day = d.getDay();
  var diff = day === 0 ? 1 : 8 - day;
  var monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday.toISOString().split("T")[0];
}

function getClientType(clientRecord) {
  var ct = clientRecord.fields["Client Type"];
  if (!ct) return "b2c-travel";
  var name = typeof ct === "object" ? ct.name : ct;
  return (name || "b2c-travel").toLowerCase();
}

// ── System Prompts ──

function buildB2CPrompt(clientRecord) {
  var f = clientRecord.fields;
  var website = f["Website URL"] || "";

  return "You are Luna, the automated social media content engine for travel agents. You generate social media posts for 7 platforms simultaneously: Facebook, Instagram, LinkedIn, Twitter/X, Pinterest, TikTok and Google Business Profile.\n\n" +
    "## Client Profile\n" +
    "Business Name: " + (f["Business Name"] || "") + "\n" +
    "Trading Name: " + (f["Trading Name"] || "") + "\n" +
    "Website: " + website + "\n" +
    "Phone: " + (f["Phone"] || "") + "\n\n" +
    "## Brand Voice\n" +
    "Tone: " + (f["Tone Keywords"] || "warm, professional") + "\n" +
    "Emoji usage: " + (f["Emoji Usage"] || "Light") + "\n" +
    "Formality: " + (f["Formality"] || "Balanced") + "\n" +
    "Sentence style: " + (f["Sentence Style"] || "Short and punchy") + "\n" +
    "CTA style: " + (f["CTA Style"] || "Question-based") + "\n" +
    "Example phrases: " + (f["Example Phrases"] || "") + "\n\n" +
    "## What This Agent Sells\n" +
    "Destinations: " + (f["Destinations"] || "") + "\n" +
    "Specialisms: " + (Array.isArray(f["Specialisms"]) ? f["Specialisms"].map(function(s) { return typeof s === "object" ? s.name : s; }).join(", ") : f["Specialisms"] || "") + "\n\n" +
    "## Content Request\n\n" +
    "Generate " + (f["Posting Frequency"] || 3) + " social media posts for the week beginning " + getNextMonday() + ".\n\n" +
    "Each post needs DIFFERENT captions for each platform:\n" +
    "- **caption_facebook**: 50-200 words. Conversational, storytelling. Include a clear CTA.\n" +
    "- **caption_instagram**: 50-150 words. Emoji-friendly, aspirational. Include 8-15 relevant hashtags at the end.\n" +
    "- **caption_linkedin**: 50-250 words. Professional, insight-driven. Good for travel industry professionals.\n" +
    "- **caption_twitter**: Max 200 characters. Punchy, conversational. No hashtags. Include CTA link.\n" +
    "- **caption_pinterest**: Max 300 characters. SEO-rich, keyword-heavy, inspirational. Search-optimised.\n" +
    "- **caption_tiktok**: Max 100 words. Casual, trend-aware, hook-first. Use 3-5 trending hashtags.\n" +
    "- **caption_gbp**: Max 100 words. Local SEO focused. Include business name and phone. Clear CTA.\n\n" +
    "Each post must also have: destination, content_type (one of: Destination Spotlight, Deal Alert, Travel Tip, Customer Story, Seasonal, Event-Based, Behind the Scenes), suggested_day (Mon-Sun), suggested_time (HH:MM), image_search_query (a specific Pexels search query for finding a great image).\n\n" +
    "CRITICAL: The CTA URL for every post MUST be: " + website + "\n\n" +
    "Mix content types across the week. Don't repeat the same destination twice.\n\n" +
    "Respond with ONLY a JSON array of post objects. No markdown, no explanation.";
}

function buildB2BPrompt(clientRecord) {
  var f = clientRecord.fields;
  var website = f["Website URL"] || "";
  var pillars = [];
  if (Array.isArray(f["Content Pillars"])) {
    pillars = f["Content Pillars"].map(function(p) { return typeof p === "object" ? p.name : p; });
  }
  var channels = [];
  if (Array.isArray(f["Target Channels"])) {
    channels = f["Target Channels"].map(function(c) { return typeof c === "object" ? c.name : c; });
  }
  var postCount = f["Posting Frequency"] || 10;

  return "You are Luna, the B2B social media content engine for Travelgenix — a travel technology SaaS company. You generate thought leadership, product marketing, and educational content for a tech company that sells to travel agents and tour operators.\n\n" +
    "## Company Profile\n" +
    "Company: " + (f["Business Name"] || "Travelgenix") + "\n" +
    "Website: " + website + "\n" +
    "What they sell: Bookable websites, Travelify mid-office platform, Luna AI suite (marketing, brain chatbot, quick quote), 100+ travel widgets. SaaS for SME travel agents.\n" +
    "Strapline: Everything just got a little easier...\n" +
    "Positioning: We sell solutions, not products or technology.\n\n" +
    "## Brand Voice\n" +
    "Tone: " + (f["Tone Keywords"] || "warm, knowledgeable, professional, playful") + "\n" +
    "Style: Knowledgeable friend, not corporate consultant. Never dry. Zero jargon.\n" +
    "Emoji usage: " + (f["Emoji Usage"] || "Light") + "\n" +
    "Formality: " + (f["Formality"] || "Balanced") + "\n" +
    "CTA style: " + (f["CTA Style"] || "Soft") + "\n\n" +
    "## Content Pillars\n" +
    (pillars.length > 0 ? pillars.join(", ") : "Product in Action, Industry Commentary, Education, Founders Perspective, Client Proof") + "\n\n" +
    "## Target Channels\n" +
    (channels.length > 0 ? channels.join(", ") : "LinkedIn Personal, LinkedIn Company, Facebook, Instagram, Google Business Profile") + "\n\n" +
    "## Post Distribution (per week)\n" +
    "Generate exactly " + postCount + " posts with this channel mix:\n" +
    "- 4x LinkedIn Personal (Andy Speight — CEO, thought leader, personal voice)\n" +
    "- 2x LinkedIn Company (Travelgenix brand page — product, announcements, education)\n" +
    "- 2x Facebook (lighter, community-focused, behind the scenes)\n" +
    "- 1x Instagram (visual, product screenshots, team culture)\n" +
    "- 1x Google Business Profile (local SEO, service updates, client proof)\n\n" +
    "## Channel Voice Guidelines\n" +
    "**LinkedIn Personal (Andy Speight):** First-person voice. 'I' not 'we'. Thought leadership, opinions, observations about travel tech. Hook in first line. Line breaks for readability. No corporate speak. Authentic, sometimes vulnerable. End with a question or insight. 150-300 words.\n" +
    "**LinkedIn Company (Travelgenix):** Third-person brand voice. Product updates, client wins, educational content. Professional but warm. 100-200 words.\n" +
    "**Facebook:** Casual, friendly, behind-the-scenes. Short and visual. 50-150 words.\n" +
    "**Instagram:** Visual-first caption. Emoji OK. 50-100 words + 8-12 hashtags.\n" +
    "**Google Business Profile:** Local SEO focused. Service description, client proof, clear CTA. 50-100 words.\n\n" +
    "## First Comment (LinkedIn only)\n" +
    "For EVERY LinkedIn Personal and LinkedIn Company post, generate a first_comment — this is posted immediately after the main post to seed engagement. It should:\n" +
    "- Ask a question OR share additional context\n" +
    "- Be 1-3 sentences\n" +
    "- Feel natural, not salesy\n" +
    "- For Personal posts: 'What's your experience with...?' or 'I'd love to hear...'\n" +
    "- For Company posts: 'Have you tried...?' or 'Drop us a message if...'\n\n" +
    "## Content Request\n\n" +
    "Generate " + postCount + " posts for the week beginning " + getNextMonday() + ".\n\n" +
    "Each post must have:\n" +
    "- target_channel: One of: 'LinkedIn Personal', 'LinkedIn Company', 'Facebook', 'Instagram', 'Google Business Profile'\n" +
    "- content_pillar: One of: " + (pillars.length > 0 ? pillars.map(function(p) { return "'" + p + "'"; }).join(", ") : "'Product in Action', 'Industry Commentary', 'Education', 'Founders Perspective', 'Client Proof'") + "\n" +
    "- caption_facebook: The main caption (used for the target platform)\n" +
    "- caption_instagram: Instagram version (always generate even if not the target — used for cross-posting)\n" +
    "- caption_linkedin: LinkedIn version\n" +
    "- caption_twitter: Max 200 chars, punchy\n" +
    "- caption_pinterest: Max 300 chars, SEO-rich\n" +
    "- caption_tiktok: Max 100 words, casual\n" +
    "- caption_gbp: Max 100 words, local SEO\n" +
    "- first_comment: First comment text (REQUIRED for LinkedIn Personal and LinkedIn Company, empty string for other channels)\n" +
    "- content_type: One of: Product Spotlight, Thought Leadership, Industry News, Client Success, Tips & Education, Behind the Scenes, Event-Based\n" +
    "- destination: 'General' (B2B content is not destination-specific)\n" +
    "- suggested_day: Mon-Sun\n" +
    "- suggested_time: HH:MM\n" +
    "- image_search_query: Pexels search query (e.g. 'travel technology dashboard', 'business meeting laptop', 'travel agent office')\n\n" +
    "CRITICAL: CTA URL for every post MUST be: " + website + "\n" +
    "Mix content pillars across the week. Alternate between LinkedIn Personal and Company.\n\n" +
    "Respond with ONLY a JSON array of post objects. No markdown, no explanation.";
}

// ── Queue Posts to Airtable ──

async function queuePosts(posts, clientId, autoPublish, isB2B) {
  var created = [];
  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];
    var dest = post.destination || "General";

    // FCDO check (skip for B2B since destinations are "General")
    var fcdo = { safe: true };
    if (!isB2B && dest !== "General") {
      fcdo = await checkFCDO(dest);
    }

    var status = !fcdo.safe ? "Suppressed" : (autoPublish ? "Approved" : "Queued");

    // Search for image
    var imageQuery = post.image_search_query || (isB2B ? "travel technology" : dest + " travel");
    var imageUrl = await searchImage(imageQuery, "landscape");
    var pinterestImageUrl = await searchImage(imageQuery, "portrait");
    var videoUrl = null;
    if (!isB2B) {
      videoUrl = await searchVideo(imageQuery);
    }

    // Build Airtable record
    var fields = {
      "Post Title": (post.destination || "General") + " " + (post.content_type || "") + " - " + (post.suggested_day || "Mon"),
      "Client": [clientId],
      "Content Type": post.content_type || "",
      "Caption - Facebook": post.caption_facebook || "",
      "Caption - Instagram": post.caption_instagram || "",
      "Caption - LinkedIn": post.caption_linkedin || "",
      "Caption - Twitter": post.caption_twitter || "",
      "Caption - Pinterest": post.caption_pinterest || "",
      "Caption - TikTok": post.caption_tiktok || "",
      "Caption - GBP": post.caption_gbp || "",
      "Hashtags": "",
      "CTA URL": post.cta_url || post.cta_url_facebook || "",
      "Destination": dest,
      "Scheduled Time": post.suggested_time || "09:00",
      "Status": status,
      "Generated Week": getWeekString(),
      "Image URL": imageUrl || "",
      "Pinterest Image URL": pinterestImageUrl || "",
      "Video URL": videoUrl || ""
    };

    // Add suppression reason if needed
    if (!fcdo.safe) {
      fields["Suppression Reason"] = fcdo.reason || "FCDO advisory";
    }

    // B2B-specific fields
    if (isB2B) {
      if (post.target_channel) fields["Target Channel"] = post.target_channel;
      if (post.content_pillar) fields["Content Pillar"] = post.content_pillar;
      if (post.first_comment) fields["First Comment"] = post.first_comment;
    }

    var res = await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblbhyiuULvedva0K",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + AIRTABLE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ records: [{ fields: fields }], typecast: true })
      }
    );
    if (res.ok) {
      var data = await res.json();
      var rec = data.records[0];
      rec._suppressed = !fcdo.safe;
      rec._status = status;
      created.push(rec);
    } else {
      console.error("Failed to create post:", (await res.text()).substring(0, 200));
    }
  }
  return created;
}

// ── Main Handler ──

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  console.log("Generate called. ANTHROPIC_API_KEY present:", !!process.env.ANTHROPIC_API_KEY,
    "PEXELS_KEY present:", !!PEXELS_KEY, "AIRTABLE_KEY present:", !!AIRTABLE_KEY);

  try {
    var body = req.body || {};
    var clientId = body.clientId;
    var dryRun = body.dryRun;

    if (!clientId) return res.status(400).json({ error: "clientId is required" });

    // 1. Fetch client from Airtable
    var clientRecord = await getClient(clientId);
    var autoPublish = !!clientRecord.fields["Auto Publish"];
    var clientType = getClientType(clientRecord);
    var isB2B = clientType === "b2b-saas";

    // 2. Build system prompt based on client type
    var systemPrompt = isB2B ? buildB2BPrompt(clientRecord) : buildB2CPrompt(clientRecord);

    // 3. Call Claude API
    var response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
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
      queued = await queuePosts(posts, clientId, autoPublish, isB2B);
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
      clientType: clientType,
      isB2B: isB2B,
      client: clientRecord.fields["Business Name"],
      week: getWeekString()
    });
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).json({ error: err.message });
  }
};
