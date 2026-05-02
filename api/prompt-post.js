// api/prompt-post.js
// Single post generator from a user prompt. Used by the "Create Post from Prompt"
// flow in the client portal.
//
// PATCHED 1 May 2026 (Day 6.5):
//   - Brand guardrails prepended to system prompt
//   - Content validator wired in before saving
//   - Auto Publish DISABLED for Travelgenix (b2b-saas) regardless of client setting
//   - If validator fails, status flips to 'Quality Hold' instead of Approved/Queued

const Anthropic = require("@anthropic-ai/sdk").default;
const { BRAND_GUARDRAILS } = require("./brand-guardrails.js");
const { validatePost } = require("./validate-content.js");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const PEXELS_KEY = process.env.PEXELS_KEY;

const TRAVELGENIX_CLIENT_ID = "recFXQY7be6gMr4In";

async function getClient(clientId) {
  var res = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali/" + clientId, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!res.ok) throw new Error("Failed to fetch client: " + res.statusText);
  return res.json();
}

async function searchImage(query, orientation) {
  if (!PEXELS_KEY) return null;
  try {
    var res = await fetch("https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) + "&orientation=" + (orientation || "landscape") + "&per_page=1&size=large", { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    return data.photos && data.photos.length > 0 ? (data.photos[0].src.large2x || data.photos[0].src.large) : null;
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
    if (!prompt) return res.status(400).json({ error: "prompt is required. Describe what kind of post you want." });

    var clientRecord = await getClient(clientId);
    var f = clientRecord.fields;
    var clientType = (f["Client Type"] || "").toLowerCase();
    var isTravelgenix = clientId === TRAVELGENIX_CLIENT_ID || clientType === "b2b-saas";

    // Auto Publish disabled for B2B SaaS clients regardless of their setting.
    // Travelgenix's reputational risk from a fabricated post is too high to
    // ever skip manual review. Client can still toggle Auto Publish in their
    // settings, but for B2B it is silently overridden here.
    var autoPublish = isTravelgenix ? false : !!f["Auto Publish"];

    // Build the per-client base prompt (kept similar to original for parity)
    var basePrompt = "You are Luna, the automated social media content engine for travel agents. Generate exactly ONE social media post based on the user's request below.\n\nYou are writing on behalf of this travel agent:\nBusiness: " + (f["Business Name"] || "") + "\nTrading Name: " + (f["Trading Name"] || "") + "\nWebsite: " + (f["Website URL"] || "") + "\nTone: " + (f["Tone Keywords"] || "warm, professional") + "\nEmoji: " + (f["Emoji Usage"] || "Light") + "\nFormality: " + (f["Formality"] || "Balanced") + "\nSentence style: " + (f["Sentence Style"] || "Short and punchy") + "\nCTA style: " + (f["CTA Style"] || "Question-based") + "\n\nRules:\n- UK English only.\n- No political, religious, or controversial content.\n- No pricing unless the user provides specific prices in their prompt.\n- Every post must include a call-to-action.\n- Facebook caption: 50-200 words. Instagram: 50-150 words. LinkedIn: 50-250 words. Twitter/X: 200 chars max, punchy. Pinterest: 300 chars max, SEO-rich. TikTok: 100 words max, casual hook-first. GBP: 100 words max, local SEO.\n- Hashtags: 8-15 for Instagram, 3-5 for Facebook, 3-5 for LinkedIn, 3-5 for TikTok. None for Twitter, Pinterest, or GBP.\n- Be specific to the destination. Reference actual places, beaches, dishes, experiences.\n\nCTA link format: " + (f["Website URL"] || "") + "/destinations/destination-slug?utm_source=social&utm_medium=platform&utm_campaign=luna_marketing\n\nReturn ONLY valid JSON with no markdown fences. One object with these fields:\ncontent_type, destination, destination_slug, caption_facebook, caption_instagram, caption_linkedin, caption_twitter, caption_pinterest, caption_tiktok, caption_gbp, hashtags_facebook (array), hashtags_instagram (array), hashtags_linkedin (array), hashtags_tiktok (array), cta_url_facebook, image_tags (array of 3 specific search terms), image_orientation, suggested_day, suggested_time";

    // Travelgenix gets the full brand guardrails prepended.
    // B2C clients still keep their original lighter ruleset for now (per scope
    // decision: Just Travelgenix in Day 6.5). When scope expands, add guardrails
    // to all clients.
    var systemPrompt = isTravelgenix
      ? BRAND_GUARDRAILS + "\n\n" + basePrompt
      : basePrompt;

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

    // Get image
    var tags = post.image_tags || [];
    var dest = post.destination || "";
    var imageQuery = dest && dest !== "General" ? (tags.length > 0 ? dest + " " + tags[0] : dest + " travel") : (tags.length > 0 ? tags[0] + " travel" : "travel holiday");
    var imageUrl = await searchImage(imageQuery, post.image_orientation || "landscape");

    // FCDO check
    var fcdo = await checkFCDO(post.destination);

    // Build draft fields object for validation (mirrors what we'll save)
    var draftFields = {
      "Caption - Facebook": post.caption_facebook || "",
      "Caption - Instagram": post.caption_instagram || "",
      "Caption - LinkedIn": post.caption_linkedin || "",
      "Caption - Twitter": post.caption_twitter || "",
      "Caption - Pinterest": post.caption_pinterest || "",
      "Caption - TikTok": post.caption_tiktok || "",
      "Caption - GBP": post.caption_gbp || ""
    };

    // VALIDATE before deciding status (Travelgenix only)
    var validation = null;
    var qualityIssues = "";
    if (isTravelgenix) {
      validation = validatePost(draftFields);
      if (validation.severity === "fail") {
        qualityIssues = validation.formattedReport;
        console.warn("[VALIDATOR] Prompt-post BLOCKED: " + qualityIssues);
      } else if (validation.severity === "warn") {
        qualityIssues = validation.formattedReport;
      }
    }

    // Determine final status
    var status;
    if (!fcdo.safe) {
      status = "Suppressed";
    } else if (validation && validation.severity === "fail") {
      // Validator blocks — never publish
      status = "Quality Hold";
    } else if (autoPublish) {
      status = "Approved";
    } else {
      status = "Queued";
    }

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
          "Image Position": "50% 50%"
        }
      };

      // If validator flagged issues, write them to Quality Issues field.
      // (Field must exist on Post Queue table — added during Day 6.5 setup.)
      if (qualityIssues) {
        record.fields["Quality Issues"] = qualityIssues.slice(0, 50000);
      }

      var aRes = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblbhyiuULvedva0K", {
        method: "POST",
        headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ records: [record], typecast: true })
      });
      if (aRes.ok) { var aData = await aRes.json(); savedRecord = aData.records[0]; }
    }

    return res.status(200).json({
      success: true,
      post: post,
      image_url: imageUrl,
      fcdo_safe: fcdo.safe,
      status: status,
      validation: validation ? {
        severity: validation.severity,
        issueCount: validation.issues.length,
        report: validation.formattedReport,
      } : null,
      saved: !!savedRecord,
      record_id: savedRecord ? savedRecord.id : null,
      client: f["Business Name"],
      prompt: prompt
    });
  } catch (err) {
    console.error("Prompt post error:", err);
    return res.status(500).json({ error: err.message });
  }
};
