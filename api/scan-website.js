const Anthropic = require("@anthropic-ai/sdk").default;

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

/* ── WEBSITE FETCHER ── */
async function fetchWebsite(url) {
  if (!url.startsWith("http")) url = "https://" + url;
  try {
    var res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LunaMarketing/1.0)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    var html = await res.text();
    return { url: url, html: html, success: true };
  } catch (err) {
    return { url: url, html: "", success: false, error: err.message };
  }
}

/* ── EXTRACT COLOURS FROM HTML ── */
function extractColours(html) {
  var colours = [];

  // 1. Theme-color meta tag
  var themeMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
  if (themeMatch) colours.push({ source: "meta theme-color", value: themeMatch[1] });

  // 2. msapplication-TileColor
  var tileMatch = html.match(/<meta[^>]*name=["']msapplication-TileColor["'][^>]*content=["']([^"']+)["']/i);
  if (tileMatch) colours.push({ source: "meta tile-color", value: tileMatch[1] });

  // 3. Inline style colours on body, header, nav, .header, #header
  var inlineColours = html.match(/(?:background-color|background|color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/gi);
  if (inlineColours) {
    inlineColours.forEach(function (m) {
      var val = m.replace(/.*:\s*/, "").trim();
      if (val && !val.includes("transparent") && !val.includes("inherit")) {
        colours.push({ source: "inline CSS", value: val });
      }
    });
  }

  // 4. CSS custom properties (--primary, --brand, --accent, --main)
  var cssVars = html.match(/--(?:primary|brand|accent|main|secondary|header|nav)[-\w]*\s*:\s*(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/gi);
  if (cssVars) {
    cssVars.forEach(function (m) {
      var parts = m.split(":");
      var name = parts[0].trim();
      var val = parts[1].trim();
      colours.push({ source: "CSS var " + name, value: val });
    });
  }

  // 5. Colours in <style> blocks
  var styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  if (styleBlocks) {
    styleBlocks.forEach(function (block) {
      var hexes = block.match(/#[0-9a-fA-F]{6}/g);
      if (hexes) {
        // Count frequency of each hex
        var freq = {};
        hexes.forEach(function (h) {
          var lower = h.toLowerCase();
          // Skip common whites, blacks, greys
          if (["#ffffff", "#000000", "#f5f5f5", "#eeeeee", "#333333", "#666666", "#999999", "#cccccc", "#fafafa", "#f0f0f0", "#e5e5e5", "#d4d4d4", "#737373", "#404040", "#171717", "#0a0a0a"].indexOf(lower) === -1) {
            freq[lower] = (freq[lower] || 0) + 1;
          }
        });
        // Sort by frequency, take top 5
        var sorted = Object.entries(freq).sort(function (a, b) { return b[1] - a[1]; });
        sorted.slice(0, 5).forEach(function (pair) {
          colours.push({ source: "CSS (used " + pair[1] + "x)", value: pair[0] });
        });
      }
    });
  }

  return colours;
}

/* ── EXTRACT SOCIAL MEDIA LINKS ── */
function extractSocialLinks(html) {
  var socials = {
    facebook: null, instagram: null, twitter: null,
    pinterest: null, tiktok: null, linkedin: null, youtube: null
  };

  // Find all href values
  var hrefs = html.match(/href=["']([^"']+)["']/gi);
  if (!hrefs) return socials;

  hrefs.forEach(function (h) {
    var url = h.replace(/href=["']/i, "").replace(/["']$/, "").toLowerCase();
    if (url.includes("facebook.com/") && !url.includes("sharer") && !socials.facebook) socials.facebook = url;
    if (url.includes("instagram.com/") && !socials.instagram) socials.instagram = url;
    if ((url.includes("twitter.com/") || url.includes("x.com/")) && !url.includes("intent") && !socials.twitter) socials.twitter = url;
    if (url.includes("pinterest.com/") && !url.includes("pin/create") && !socials.pinterest) socials.pinterest = url;
    if (url.includes("tiktok.com/") && !socials.tiktok) socials.tiktok = url;
    if (url.includes("linkedin.com/") && !socials.linkedin) socials.linkedin = url;
    if (url.includes("youtube.com/") && !socials.youtube) socials.youtube = url;
  });

  return socials;
}

/* ── EXTRACT LOGO ── */
function extractLogo(html, baseUrl) {
  // Check og:image first
  var ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1];

  // Check for logo in img tags
  var logoImgs = html.match(/<img[^>]*(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']/gi);
  if (logoImgs && logoImgs.length > 0) {
    var srcMatch = logoImgs[0].match(/src=["']([^"']+)["']/i);
    if (srcMatch) {
      var src = srcMatch[1];
      if (src.startsWith("//")) src = "https:" + src;
      else if (src.startsWith("/")) src = baseUrl + src;
      return src;
    }
  }

  // Check link rel icon / apple-touch-icon
  var iconMatch = html.match(/<link[^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
  if (iconMatch) {
    var href = iconMatch[1];
    if (href.startsWith("//")) href = "https:" + href;
    else if (href.startsWith("/")) href = baseUrl + href;
    return href;
  }

  return "";
}

/* ── PREPARE CONTENT FOR CLAUDE ── */
function prepareContent(html) {
  // Strip scripts, styles, noscript
  var cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");

  // Keep meta tags
  var meta = "";
  var metaMatches = html.match(/<meta[^>]*>/gi);
  if (metaMatches) meta = metaMatches.join("\n");

  // Extract visible text
  var text = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length > 12000) text = text.substring(0, 12000);
  if (meta.length > 3000) meta = meta.substring(0, 3000);

  return { meta: meta, text: text };
}

/* ── ANALYSE WITH CLAUDE ── */
async function analyseWithClaude(siteData, colours, socials, logoUrl) {
  var content = prepareContent(siteData.html);

  var systemMsg = "You are a JSON extraction tool. You MUST return ONLY valid JSON. No markdown fences. No commentary. No text before or after the JSON object. Every string value must have special characters properly escaped: use \\\" for quotes inside strings, \\\\ for backslashes, \\n for newlines. Never use unescaped double quotes inside a JSON string value.";

  var prompt = "Analyse this travel agent website and extract their brand profile.\n\n" +
    "Website URL: " + siteData.url + "\n\n" +
    "META TAGS:\n" + content.meta + "\n\n" +
    "PAGE CONTENT:\n" + content.text + "\n\n" +
    "PRE-EXTRACTED COLOURS (from CSS/meta tags):\n" + JSON.stringify(colours) + "\n\n" +
    "PRE-EXTRACTED SOCIAL LINKS:\n" + JSON.stringify(socials) + "\n\n" +
    "PRE-EXTRACTED LOGO URL: " + (logoUrl || "not found") + "\n\n" +
    "Return this exact JSON structure with values filled in:\n" +
    "{\n" +
    '  "business_name": "",\n' +
    '  "trading_name": "",\n' +
    '  "phone": "",\n' +
    '  "email": "",\n' +
    '  "destinations": "",\n' +
    '  "specialisms": [],\n' +
    '  "tone_keywords": "",\n' +
    '  "formality": "",\n' +
    '  "emoji_usage": "",\n' +
    '  "sentence_style": "",\n' +
    '  "cta_style": "",\n' +
    '  "primary_colour": "",\n' +
    '  "secondary_colour": "",\n' +
    '  "logo_url": "",\n' +
    '  "example_phrases": "",\n' +
    '  "social_facebook": "",\n' +
    '  "social_instagram": "",\n' +
    '  "social_twitter": "",\n' +
    '  "social_pinterest": "",\n' +
    '  "social_tiktok": "",\n' +
    '  "social_linkedin": "",\n' +
    '  "social_youtube": "",\n' +
    '  "confidence": ""\n' +
    "}\n\n" +
    "Rules:\n" +
    "- destinations: comma-separated list of countries and resorts found on site\n" +
    "- specialisms: array of strings from this list only: Beach, Family, Luxury, Cruise, Ski, City Breaks, Weddings, Touring, Long Haul, Short Haul, Adventure, All Inclusive\n" +
    "- tone_keywords: 3-5 comma-separated descriptors\n" +
    "- formality: exactly one of Casual, Balanced, Formal\n" +
    "- emoji_usage: exactly one of None, Light, Heavy\n" +
    "- sentence_style: exactly one of Short and punchy, Longer and descriptive\n" +
    "- cta_style: exactly one of Direct, Soft, Question-based\n" +
    "- primary_colour and secondary_colour: hex codes from the pre-extracted colours\n" +
    "- example_phrases: separate multiple phrases with | pipe character (NOT quotes or colons)\n" +
    "- social URLs: use the pre-extracted values\n" +
    "- confidence: exactly one of High, Medium, Low\n" +
    "- Use empty string if not found. Do not guess.";

  var response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    temperature: 0,
    system: systemMsg,
    messages: [{ role: "user", content: prompt }],
  });

  var text = response.content.map(function (c) { return c.type === "text" ? c.text : ""; }).filter(Boolean).join("");
  var cleaned = text.replace(/```json|```/g, "").trim();

  // Try to parse, with repair if needed
  try {
    return JSON.parse(cleaned);
  } catch (firstErr) {
    // Attempt repair: fix common JSON issues
    var repaired = repairJSON(cleaned);
    try {
      return JSON.parse(repaired);
    } catch (secondErr) {
      console.error("JSON parse failed after repair. Raw:", cleaned.substring(0, 500));
      throw new Error("Failed to parse website analysis. Please try again.");
    }
  }
}

/* ── JSON REPAIR ── */
function repairJSON(str) {
  // Remove any leading/trailing non-JSON content
  var start = str.indexOf("{");
  var end = str.lastIndexOf("}");
  if (start === -1 || end === -1) return str;
  str = str.substring(start, end + 1);

  // Fix unescaped quotes inside string values
  // Strategy: walk through character by character
  var result = "";
  var inString = false;
  var escaped = false;
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === "\\") { result += ch; escaped = true; continue; }
    if (ch === '"') {
      if (!inString) {
        inString = true; result += ch;
      } else {
        // Check if this quote ends the string or is mid-string
        // Look ahead: if followed by : , } ] or whitespace+any of those, it ends the string
        var rest = str.substring(i + 1).trimStart();
        if (rest[0] === ":" || rest[0] === "," || rest[0] === "}" || rest[0] === "]" || rest.startsWith("\n")) {
          inString = false; result += ch;
        } else {
          // Mid-string quote, escape it
          result += '\\"';
        }
      }
    } else {
      result += ch;
    }
  }

  // Fix trailing commas before } or ]
  result = result.replace(/,\s*([}\]])/g, "$1");

  return result;
}

/* ── CREATE CLIENT IN AIRTABLE ── */
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
  if (profile.specialisms && profile.specialisms.length > 0) {
    fields["Specialisms"] = profile.specialisms;
  }

  var res = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali", {
    method: "POST",
    headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: fields }], typecast: true }),
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error("Airtable error: " + res.status + " " + errText);
  }
  var data = await res.json();
  return data.records[0];
}

/* ── HANDLER ── */
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
      return res.status(400).json({ error: "Could not fetch website: " + siteData.error, url: siteData.url });
    }

    // 2. Pre-extract structured data from raw HTML
    var colours = extractColours(siteData.html);
    var socials = extractSocialLinks(siteData.html);
    var baseUrl = siteData.url.match(/^https?:\/\/[^/]+/i);
    var logoUrl = extractLogo(siteData.html, baseUrl ? baseUrl[0] : siteData.url);

    // 3. Analyse with Claude (passing pre-extracted data)
    var profile = await analyseWithClaude(siteData, colours, socials, logoUrl);

    // Merge pre-extracted socials into profile (in case Claude missed them)
    if (!profile.social_facebook && socials.facebook) profile.social_facebook = socials.facebook;
    if (!profile.social_instagram && socials.instagram) profile.social_instagram = socials.instagram;
    if (!profile.social_twitter && socials.twitter) profile.social_twitter = socials.twitter;
    if (!profile.social_pinterest && socials.pinterest) profile.social_pinterest = socials.pinterest;
    if (!profile.social_tiktok && socials.tiktok) profile.social_tiktok = socials.tiktok;
    if (!profile.social_linkedin && socials.linkedin) profile.social_linkedin = socials.linkedin;

    // 4. Optionally save
    var savedRecord = null;
    if (saveToAirtable) {
      savedRecord = await createClient(profile, url);
    }

    return res.status(200).json({
      success: true,
      profile: profile,
      raw_colours: colours,
      raw_socials: socials,
      logo_url: logoUrl,
      saved: !!savedRecord,
      client_id: savedRecord ? savedRecord.id : null,
      url: url,
    });
  } catch (err) {
    console.error("Scan error:", err);
    return res.status(500).json({ error: err.message });
  }
};

