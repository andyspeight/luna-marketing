const Anthropic = require("@anthropic-ai/sdk").default;

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

async function fetchWebsite(url) {
  // Normalise URL
  if (!url.startsWith("http")) url = "https://" + url;
  try {
    var res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LunaMarketing/1.0; +https://luna-marketing.vercel.app)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var html = await res.text();
    // Strip scripts, styles, and tags to reduce token usage
    html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
    html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
    // Keep meta tags, links, and body content
    var meta = "";
    var metaMatches = html.match(/<meta[^>]*>/gi);
    if (metaMatches) meta = metaMatches.join("\n");
    var linkMatches = html.match(/<link[^>]*>/gi);
    if (linkMatches) meta += "\n" + linkMatches.slice(0, 20).join("\n");
    // Extract visible text
    var text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // Truncate to reasonable size for Claude
    if (text.length > 12000) text = text.substring(0, 12000);
    if (meta.length > 3000) meta = meta.substring(0, 3000);
    return { url: url, meta: meta, text: text, success: true };
  } catch (err) {
    return { url: url, meta: "", text: "", success: false, error: err.message };
  }
}

async function analyseWithClaude(siteData) {
  var prompt = "You are analysing a travel agent's website to extract their brand profile for an automated social media tool called Luna Marketing.\n\n" +
    "Website URL: " + siteData.url + "\n\n" +
    "META TAGS:\n" + siteData.meta + "\n\n" +
    "PAGE CONTENT:\n" + siteData.text + "\n\n" +
    "Extract the following information from this website. Be specific and accurate. Only include information you can genuinely find or confidently infer from the content.\n\n" +
    "Return ONLY valid JSON with no markdown fences:\n" +
    "{\n" +
    '  "business_name": "The registered or legal business name",\n' +
    '  "trading_name": "The name they trade under (often different from business name)",\n' +
    '  "phone": "UK phone number if found",\n' +
    '  "email": "Email address if found",\n' +
    '  "destinations": "Comma-separated list of all destinations mentioned (countries and specific resorts/cities)",\n' +
    '  "specialisms": ["Array of holiday types they specialise in, e.g. Beach, Family, Luxury, Cruise, Ski, City Breaks, Weddings, Touring, Long Haul, Short Haul, Adventure, All Inclusive"],\n' +
    '  "tone_keywords": "3-5 comma-separated words describing their brand voice (e.g. warm, professional, fun, aspirational, chatty, knowledgeable)",\n' +
    '  "formality": "One of: Casual, Balanced, Formal",\n' +
    '  "emoji_usage": "One of: None, Light, Heavy (based on their current social/web content)",\n' +
    '  "sentence_style": "One of: Short and punchy, Longer and descriptive",\n' +
    '  "cta_style": "One of: Direct, Soft, Question-based",\n' +
    '  "primary_colour": "Hex colour code of their primary brand colour (from logo/header/buttons)",\n' +
    '  "secondary_colour": "Hex colour code of their secondary brand colour",\n' +
    '  "logo_url": "URL of their logo image if found in meta tags or page",\n' +
    '  "example_phrases": "3-5 actual phrases from their website that capture their brand voice",\n' +
    '  "social_facebook": "Facebook page URL if found",\n' +
    '  "social_instagram": "Instagram URL if found",\n' +
    '  "social_twitter": "Twitter/X URL if found",\n' +
    '  "social_pinterest": "Pinterest URL if found",\n' +
    '  "social_tiktok": "TikTok URL if found",\n' +
    '  "social_linkedin": "LinkedIn URL if found",\n' +
    '  "confidence": "High, Medium, or Low - how confident you are in the overall extraction"\n' +
    "}\n\n" +
    "If you cannot find a value, use an empty string for strings or an empty array for arrays. Do not guess or fabricate data.";

  var response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    temperature: 0,
    messages: [{ role: "user", content: prompt }],
  });

  var text = response.content
    .map(function (c) { return c.type === "text" ? c.text : ""; })
    .filter(Boolean)
    .join("");
  var cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

async function createClient(profile, websiteUrl) {
  var fields = {
    "Business Name": profile.business_name || "",
    "Trading Name": profile.trading_name || "",
    "Website URL": websiteUrl,
    "Phone": profile.phone || "",
    "Destinations": profile.destinations || "",
    "Tone Keywords": profile.tone_keywords || "",
    "Formality": profile.formality || "Balanced",
    "Emoji Usage": profile.emoji_usage || "Light",
    "Sentence Style": profile.sentence_style || "Short and punchy",
    "CTA Style": profile.cta_style || "Question-based",
    "Primary Colour": profile.primary_colour || "",
    "Secondary Colour": profile.secondary_colour || "",
    "Logo URL": profile.logo_url || "",
    "Example Phrases": profile.example_phrases || "",
    "Status": "Onboarding",
    "Package": "Boost",
    "Posting Frequency": 3,
    "Posting Days": "Mon,Wed,Fri",
    "Monthly Report Email": profile.email || "",
  };

  // Add specialisms if found
  if (profile.specialisms && profile.specialisms.length > 0) {
    fields["Specialisms"] = profile.specialisms;
  }

  var res = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + AIRTABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{ fields: fields }], typecast: true }),
    }
  );
  if (!res.ok) {
    var errText = await res.text();
    throw new Error("Airtable error: " + res.status + " " + errText);
  }
  var data = await res.json();
  return data.records[0];
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var body = req.body || {};
    var url = body.url;
    var saveToAirtable = body.save !== false;

    if (!url) return res.status(400).json({ error: "url is required" });

    // 1. Fetch the website
    var siteData = await fetchWebsite(url);
    if (!siteData.success) {
      return res.status(400).json({
        error: "Could not fetch website: " + siteData.error,
        url: siteData.url,
      });
    }

    // 2. Analyse with Claude
    var profile = await analyseWithClaude(siteData);

    // 3. Optionally save to Airtable
    var savedRecord = null;
    if (saveToAirtable) {
      savedRecord = await createClient(profile, url);
    }

    return res.status(200).json({
      success: true,
      profile: profile,
      saved: !!savedRecord,
      client_id: savedRecord ? savedRecord.id : null,
      url: url,
    });
  } catch (err) {
    console.error("Scan error:", err);
    return res.status(500).json({ error: err.message });
  }
};
