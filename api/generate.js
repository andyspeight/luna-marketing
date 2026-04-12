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
    var response = await fetch("https://www.gov.uk/foreign-travel-advice/" + slug, { headers: { Accept: "application/json" } });
    if (!response.ok) return { safe: true, level: "not_found" };
    var data = await response.json();
    var content = JSON.stringify(data).toLowerCase();
    if (content.includes("advise against all travel"))
      return { safe: false, level: "against_all_travel", reason: "FCDO advises against all travel to " + country };
    if (content.includes("advise against all but essential travel"))
      return { safe: false, level: "against_all_but_essential", reason: "FCDO advises against all but essential travel to " + country };
    return { safe: true, level: "no_warning" };
  } catch (err) { return { safe: true, level: "check_failed" }; }
}

async function searchImage(query, orientation) {
  if (!PEXELS_KEY) return null;
  try {
    var url = "https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) +
      "&orientation=" + (orientation || "landscape") + "&per_page=1&size=large";
    var res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    if (data.photos && data.photos.length > 0) return data.photos[0].src.large2x || data.photos[0].src.large;
    return null;
  } catch (err) { return null; }
}

async function searchVideo(query) {
  if (!PEXELS_KEY) return null;
  try {
    var url = "https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) +
      "&orientation=portrait&per_page=1&size=medium";
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

function buildSystemPrompt(clientRecord) {
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
    "Specialisms: " + (Array.isArray(f["Specialisms"]) ? f["Specialisms"].join(", ") : f["Specialisms"] || "") + "\n\n" +
    "## Content Request\n" +
    "Generate " + (f["Posting Frequency"] || 3) + " social media posts for the week beginning " + getNextMonday() + ".\n\n" +
    "Content mix weightings:\n" +
    "- Destination Inspiration: 40%\n- Offer Highlight: 20%\n- Travel Tips: 15%\n- Social Proof: 10%\n- Seasonal/Event: 10%\n- Behind the Scenes: 5%\n\n" +
    "## Platform-Specific Rules\n\n" +
    "### Facebook\n- Caption: 50-200 words\n- Hashtags: 3-5\n- Landscape image (1.91:1)\n\n" +
    "### Instagram\n- Caption: 50-150 words\n- Hashtags: 5-15\n- Square image (1:1)\n\n" +
    "### LinkedIn\n- Caption: 50-250 words\n- Hashtags: 3-5\n- Professional tone, industry insight angle\n- Landscape image (1.91:1)\n\n" +
    "### Twitter/X\n- Caption: MAX 280 CHARACTERS including any link. This is a hard limit.\n- Punchy, conversational, one clear thought\n- 1-3 hashtags woven into the text\n- No separate hashtag block\n\n" +
    "### Pinterest\n- Pin title: max 100 characters, SEO keyword-rich\n- Pin description: 100-300 characters, inspirational + searchable\n- Portrait image (2:3 ratio)\n- Think search intent: what would someone type to find this?\n\n" +
    "### TikTok\n- Caption: 50-150 characters, casual and hook-first\n- Start with a hook: question, surprising fact, or bold statement\n- 3-5 trending-style hashtags\n- Portrait video\n\n" +
    "### Google Business Profile\n- Caption: 100-300 words\n- Local SEO focused: mention the business name and location\n- Include a clear CTA (Book now, Call us, Visit our website)\n- Professional but warm\n\n" +
    "## Content Rules (Non-Negotiable)\n\n" +
    "### Language\n- UK English only. Colour not color. Favourite not favorite.\n- No em dashes. Use commas, full stops or colons.\n- No Oxford comma.\n\n" +
    "### Banned Phrases\nNever use: leverage, seamless, game-changer, deep dive, elevate, unlock, navigate, landscape, robust, cutting-edge, empower, harness, delve, nestled, embark, tapestry, picture this, there's something for everyone, the world is waiting, adventure awaits, escape the ordinary, hidden gem, bucket list, sun-kissed\n\n" +
    "### Safety\n- No political, religious, or controversial content.\n- No pricing unless explicitly provided.\n- No competitor mentions.\n- No negative content about any destination.\n- No content about destinations not in this agent's list.\n\n" +
    "### CTA Links\nFormat: " + website + "/destinations/destination-slug?utm_source=social&utm_medium=PLATFORM&utm_campaign=luna_marketing\n\n" +
    "### Image/Video Tags\nFor each post provide:\n- image_tags: array of 3 specific search terms for landscape photo\n- pinterest_image_tags: array of 3 terms for portrait/vertical photo\n- video_tags: array of 3 terms for short travel video (scenic, aerial, walking tours)\n\n" +
    "## Output Format\n\nReturn a JSON array. No markdown, no commentary. Each post object:\n" +
    "post_number, content_type, destination, destination_slug,\n" +
    "caption_facebook, caption_instagram, caption_linkedin, caption_twitter, caption_pinterest_title, caption_pinterest, caption_tiktok, caption_gbp,\n" +
    "hashtags_facebook (array), hashtags_instagram (array), hashtags_linkedin (array), hashtags_twitter (array), hashtags_pinterest (array), hashtags_tiktok (array),\n" +
    "cta_url, image_tags (array of 3), pinterest_image_tags (array of 3), video_tags (array of 3),\n" +
    "suggested_day, suggested_time";
}

function getNextMonday() {
  var now = new Date(); var day = now.getDay();
  var diff = day === 0 ? 1 : 8 - day;
  var monday = new Date(now); monday.setDate(now.getDate() + diff);
  return monday.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function getWeekString() {
  var now = new Date(); var start = new Date(now.getFullYear(), 0, 1);
  var diff = now - start;
  var week = Math.ceil(((diff / 86400000 + start.getDay() + 1) / 7));
  return now.getFullYear() + "-W" + String(week).padStart(2, "0");
}

async function queuePosts(posts, clientId, autoPublish) {
  var created = [];
  for (var i = 0; i < posts.length; i++) {
    var post = posts[i];

    // Landscape image (FB, LI, Twitter, GBP)
    var dest = post.destination || "";
    var tags = post.image_tags || [];
    var imgQuery = dest && dest !== "General"
      ? (tags.length > 0 ? dest + " " + tags[0] : dest + " travel holiday")
      : (tags.length > 0 ? tags[0] + " travel" : "travel holiday beach");
    var imageUrl = await searchImage(imgQuery, "landscape");

    // Portrait image (Pinterest)
    var pinTags = post.pinterest_image_tags || tags;
    var pinQuery = dest && dest !== "General"
      ? (pinTags.length > 0 ? dest + " " + pinTags[0] : dest + " travel")
      : (pinTags.length > 0 ? pinTags[0] + " travel" : "travel holiday");
    var pinterestImageUrl = await searchImage(pinQuery, "portrait");

    // Video (TikTok)
    var vidTags = post.video_tags || tags;
    var vidQuery = dest && dest !== "General"
      ? (vidTags.length > 0 ? dest + " " + vidTags[0] : dest + " travel scenic")
      : (vidTags.length > 0 ? vidTags[0] + " travel" : "travel holiday scenic");
    var videoUrl = await searchVideo(vidQuery);

    // FCDO check
    var fcdo = await checkFCDO(post.destination);
    var status = !fcdo.safe ? "Suppressed" : (autoPublish ? "Approved" : "Queued");
    var suppressionReason = fcdo.safe ? "" : (fcdo.reason || "FCDO advisory");

    // Build all hashtags into one string (deduplicated)
    var allHashtags = [].concat(
      post.hashtags_facebook || [], post.hashtags_instagram || [],
      post.hashtags_twitter || [], post.hashtags_pinterest || [],
      post.hashtags_tiktok || []
    ).filter(function(v, idx, arr) { return arr.indexOf(v) === idx; }).join(", ");

    var record = {
      fields: {
        "Post Title": (dest || "General") + " " + (post.content_type || "") + " - " + (post.suggested_day || ""),
        "Client": [clientId],
        "Content Type": post.content_type,
        "Caption - Facebook": post.caption_facebook || "",
        "Caption - Instagram": post.caption_instagram || "",
        "Caption - LinkedIn": post.caption_linkedin || "",
        "Caption - Twitter": post.caption_twitter || "",
        "Caption - Pinterest": post.caption_pinterest || "",
        "Caption - TikTok": post.caption_tiktok || "",
        "Caption - GBP": post.caption_gbp || "",
        "Hashtags": allHashtags,
        "CTA URL": post.cta_url || "",
        "Destination": dest,
        "Scheduled Time": post.suggested_time || "09:00",
        "Status": status,
        "Suppression Reason": suppressionReason,
        "Generated Week": getWeekString(),
        "Image URL": imageUrl || "",
        "Image Position": "50% 50%",
        "Pinterest Image URL": pinterestImageUrl || "",
        "Video URL": videoUrl || ""
      }
    };

    var res = await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblbhyiuULvedva0K",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [record], typecast: true })
      }
    );
    if (res.ok) {
      var data = await res.json();
      created.push({
        id: data.records[0].id,
        _imageUrl: imageUrl, _pinterestUrl: pinterestImageUrl, _videoUrl: videoUrl,
        _fcdoStatus: fcdo.level, _suppressed: !fcdo.safe, _status: status
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

  try {
    var body = req.body || {};
    var clientId = body.clientId;
    var dryRun = body.dryRun;
    if (!clientId) return res.status(400).json({ error: "clientId is required" });

    var clientRecord = await getClient(clientId);
    var autoPublish = !!clientRecord.fields["Auto Publish"];
    var systemPrompt = buildSystemPrompt(clientRecord);

    var response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 6000,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: "user", content: "Generate this week's social media posts." }]
    });

    var text = response.content.map(function(c) { return c.type === "text" ? c.text : ""; }).filter(Boolean).join("");
    var cleaned = text.replace(/```json|```/g, "").trim();
    var posts;
    try { posts = JSON.parse(cleaned); } catch (e) {
      return res.status(500).json({ error: "Failed to parse Claude response as JSON", raw: cleaned.substring(0, 500) });
    }

    var queued = [];
    var suppressed = 0;
    var approved = 0;
    if (!dryRun) {
      queued = await queuePosts(posts, clientId, autoPublish);
      suppressed = queued.filter(function(q) { return q._suppressed; }).length;
      approved = queued.filter(function(q) { return q._status === "Approved"; }).length;
    }

    return res.status(200).json({
      success: true, posts: posts, queued: queued.length,
      suppressed: suppressed, approved: approved, autoPublish: autoPublish,
      client: clientRecord.fields["Business Name"], week: getWeekString()
    });
  } catch (err) {
    console.error("Generate error:", err);
    return res.status(500).json({ error: err.message });
  }
};
