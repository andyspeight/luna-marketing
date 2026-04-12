const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PEXELS_KEY = process.env.PEXELS_KEY;

async function getClient(clientId) {
  var res = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali/" + clientId, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!res.ok) throw new Error("Failed to fetch client: " + res.statusText);
  return res.json();
}

async function searchImage(query, orientation) {
  if (!PEXELS_KEY) return null;
  try {
    var res = await fetch("https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) + "&orientation=" + (orientation || "landscape") + "&per_page=3&size=large", { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    if (!data.photos || data.photos.length === 0) return null;
    var idx = Math.floor(Math.random() * Math.min(data.photos.length, 3));
    return data.photos[idx].src.large2x || data.photos[idx].src.large;
  } catch (e) { return null; }
}

async function searchVideo(query) {
  if (!PEXELS_KEY) return null;
  try {
    var res = await fetch("https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) + "&orientation=portrait&per_page=3&size=medium", { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    if (!data.videos || data.videos.length === 0) return null;
    var vid = data.videos[Math.floor(Math.random() * Math.min(data.videos.length, 3))];
    var files = vid.video_files.filter(function(f) { return f.quality === "hd" || f.quality === "sd"; }).sort(function(a, b) { return (b.height || 0) - (a.height || 0); });
    return files.length > 0 ? files[0].link : null;
  } catch (e) { return null; }
}

async function checkFCDO(country) {
  if (!country || country === "General") return { safe: true };
  try {
    var slug = country.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    var res = await fetch("https://www.gov.uk/foreign-travel-advice/" + slug, { headers: { Accept: "application/json" } });
    if (!res.ok) return { safe: true };
    var data = await res.json();
    var content = JSON.stringify(data).toLowerCase();
    if (content.includes("advise against all travel")) return { safe: false, reason: "FCDO advises against all travel to " + country };
    if (content.includes("advise against all but essential travel")) return { safe: false, reason: "FCDO advises against all but essential travel to " + country };
    return { safe: true };
  } catch (e) { return { safe: true }; }
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
    var prompt = body.prompt;
    var saveToQueue = body.saveToQueue !== false;

    if (!clientId) return res.status(400).json({ error: "clientId is required" });
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    var clientRecord = await getClient(clientId);
    var f = clientRecord.fields;
    var autoPublish = !!f["Auto Publish"];

    var systemPrompt = "You are Luna, the automated social media content engine for travel agents. Generate exactly ONE social media post for 7 platforms simultaneously: Facebook, Instagram, LinkedIn, Twitter/X, Pinterest, TikTok and Google Business Profile.\n\n" +
      "Client:\nBusiness: " + (f["Business Name"] || "") + "\nTrading: " + (f["Trading Name"] || "") + "\nWebsite: " + (f["Website URL"] || "") + "\nTone: " + (f["Tone Keywords"] || "warm, professional") + "\nEmoji: " + (f["Emoji Usage"] || "Light") + "\nFormality: " + (f["Formality"] || "Balanced") + "\nSentence: " + (f["Sentence Style"] || "Short and punchy") + "\nCTA: " + (f["CTA Style"] || "Question-based") + "\n\n" +
      "Rules:\n- UK English. No em dashes. No Oxford comma.\n- Banned: leverage, seamless, game-changer, deep dive, elevate, unlock, navigate, landscape, robust, cutting-edge, empower, harness, delve, nestled, embark, tapestry, picture this, there's something for everyone, adventure awaits, escape the ordinary, hidden gem, bucket list, sun-kissed\n- No political/religious/controversial content. No pricing unless provided. No competitors.\n- Every post needs a CTA.\n- Be specific to the destination.\n\n" +
      "Platform specs:\n" +
      "- Facebook: 50-200 words, 3-5 hashtags\n" +
      "- Instagram: 50-150 words, 5-15 hashtags\n" +
      "- LinkedIn: 50-250 words, 3-5 hashtags (professional tone)\n" +
      "- Twitter/X: max 270 chars (leave room for link), 2-3 hashtags\n" +
      "- Pinterest: 50-100 words, descriptive and searchable, 5-10 hashtags\n" +
      "- TikTok: 30-100 words, casual and energetic, 3-5 trending hashtags\n" +
      "- Google Business: 50-150 words, local/direct, no hashtags, include a CTA\n\n" +
      "CTA link: " + (f["Website URL"] || "") + "/destinations/destination-slug?utm_source=social&utm_medium=PLATFORM&utm_campaign=luna_marketing\n\n" +
      "Return ONLY valid JSON:\n{content_type, destination, destination_slug, caption_facebook, caption_instagram, caption_linkedin, caption_twitter, caption_pinterest, caption_tiktok, caption_gbp, hashtags_facebook (array), hashtags_instagram (array), hashtags_linkedin (array), image_tags (array of 3), suggested_day, suggested_time}";

    var response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }]
    });

    var text = response.content.map(function(c) { return c.type === "text" ? c.text : ""; }).filter(Boolean).join("");
    var cleaned = text.replace(/```json|```/g, "").trim();
    var post;
    try { post = JSON.parse(cleaned); } catch (e) {
      return res.status(500).json({ error: "Failed to parse response", raw: cleaned.substring(0, 500) });
    }

    // Images: landscape for FB/IG/LI/X/GBP, portrait for Pinterest
    var tags = post.image_tags || [];
    var dest = post.destination || "";
    var imageQuery = dest && dest !== "General" ? (tags.length > 0 ? dest + " " + tags[0] : dest + " travel") : (tags.length > 0 ? tags[0] + " travel" : "travel holiday");
    var imageUrl = await searchImage(imageQuery, "landscape");
    var pinterestImageUrl = await searchImage(imageQuery, "portrait");
    var videoUrl = await searchVideo(imageQuery);

    // FCDO check
    var fcdo = await checkFCDO(post.destination);
    var status = !fcdo.safe ? "Suppressed" : (autoPublish ? "Approved" : "Queued");

    // Save to Airtable
    var savedRecord = null;
    if (saveToQueue) {
      var record = {
        fields: {
          "Post Title": (post.destination || "Custom") + " " + (post.content_type || "Post") + " - Prompt",
          "Client": [clientId],
          "Content Type": post.content_type || "Destination Inspiration",
          "Caption - Facebook": post.caption_facebook || "",
          "Caption - Instagram": post.caption_instagram || "",
          "Caption - LinkedIn": post.caption_linkedin || "",
          "Caption - Twitter": post.caption_twitter || "",
          "Caption - Pinterest": post.caption_pinterest || "",
          "Caption - TikTok": post.caption_tiktok || "",
          "Caption - GBP": post.caption_gbp || "",
          "Hashtags": [].concat(post.hashtags_facebook || [], post.hashtags_instagram || []).filter(function(v, i, a) { return a.indexOf(v) === i; }).join(", "),
          "CTA URL": post.cta_url_facebook || "",
          "Destination": post.destination || "",
          "Scheduled Time": post.suggested_time || "09:00",
          "Status": status,
          "Suppression Reason": fcdo.safe ? "" : (fcdo.reason || ""),
          "Generated Week": "PROMPT",
          "Image URL": imageUrl || "",
          "Image Position": "50% 50%",
          "Pinterest Image URL": pinterestImageUrl || "",
          "Video URL": videoUrl || ""
        }
      };
      var aRes = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblbhyiuULvedva0K", {
        method: "POST",
        headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [record], typecast: true })
      });
      if (aRes.ok) { var aData = await aRes.json(); savedRecord = aData.records[0]; }
    }

    return res.status(200).json({
      success: true, post: post, image_url: imageUrl, pinterest_image_url: pinterestImageUrl, video_url: videoUrl,
      fcdo_safe: fcdo.safe, status: status, saved: !!savedRecord, record_id: savedRecord ? savedRecord.id : null,
      client: f["Business Name"], prompt: prompt
    });
  } catch (err) {
    console.error("Prompt post error:", err);
    return res.status(500).json({ error: err.message });
  }
};
