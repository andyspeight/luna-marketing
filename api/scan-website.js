const Anthropic = require("@anthropic-ai/sdk").default;

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

/* ══════════════════════════════════════════════
   1. FETCH WEBSITE
   ══════════════════════════════════════════════ */
async function fetchWebsite(url) {
  if (!url.startsWith("http")) url = "https://" + url;
  try {
    var res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LunaMarketing/1.0)", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return { url: url, html: await res.text(), success: true };
  } catch (err) {
    return { url: url, html: "", success: false, error: err.message };
  }
}

/* ══════════════════════════════════════════════
   2. EXTRACT STRUCTURED DATA FROM RAW HTML
   ══════════════════════════════════════════════ */
function extractSocialLinks(html) {
  var socials = { facebook: null, instagram: null, twitter: null, pinterest: null, tiktok: null, linkedin: null, youtube: null };
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

function extractImages(html, baseUrl) {
  // og:image - often a hero/banner image showing the full site design
  var ogMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if (!ogMatch) ogMatch = html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  var ogImage = ogMatch ? ogMatch[1] : "";

  // Logo from img tags
  var logoUrl = "";
  var logoImgs = html.match(/<img[^>]*(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]*>/gi);
  if (logoImgs && logoImgs.length > 0) {
    var srcMatch = logoImgs[0].match(/src=["']([^"']+)["']/i);
    if (srcMatch) logoUrl = srcMatch[1];
  }
  // Fallback: first large image in header area
  if (!logoUrl) {
    var headerArea = html.match(/<header[\s\S]*?<\/header>/i);
    if (headerArea) {
      var headerImgs = headerArea[0].match(/src=["']([^"']+\.(png|jpg|jpeg|svg|webp))[^"']*["']/i);
      if (headerImgs) logoUrl = headerImgs[1];
    }
  }
  // Fallback: apple-touch-icon
  if (!logoUrl) {
    var iconMatch = html.match(/<link[^>]*rel=["'](?:apple-touch-icon|icon)["'][^>]*href=["']([^"']+)["']/i);
    if (iconMatch) logoUrl = iconMatch[1];
  }

  // Normalise URLs
  [logoUrl, ogImage].forEach(function (_, idx) {
    var v = idx === 0 ? logoUrl : ogImage;
    if (v && v.startsWith("//")) v = "https:" + v;
    else if (v && v.startsWith("/")) v = baseUrl + v;
    if (idx === 0) logoUrl = v; else ogImage = v;
  });

  return { logoUrl: logoUrl, ogImageUrl: ogImage };
}

function extractColours(html) {
  var colours = [];
  var themeMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
  if (themeMatch) colours.push({ source: "theme-color", value: themeMatch[1] });
  var cssVars = html.match(/--(?:primary|brand|accent|main|secondary)[-\w]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi);
  if (cssVars) cssVars.forEach(function (m) { colours.push({ source: "CSS var", value: m.split(":")[1].trim() }); });
  var styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  if (styleBlocks) {
    var freq = {};
    styleBlocks.forEach(function (block) {
      var hexes = block.match(/#[0-9a-fA-F]{6}/g);
      if (hexes) hexes.forEach(function (h) {
        var l = h.toLowerCase();
        if (["#ffffff","#000000","#f5f5f5","#eeeeee","#333333","#666666","#999999","#cccccc","#fafafa","#f0f0f0","#e5e5e5","#d4d4d4","#171717","#0a0a0a","#404040","#737373"].indexOf(l) === -1)
          freq[l] = (freq[l] || 0) + 1;
      });
    });
    Object.entries(freq).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5).forEach(function (p) {
      colours.push({ source: "CSS (" + p[1] + "x)", value: p[0] });
    });
  }
  return colours;
}

function prepareContent(html) {
  var cleaned = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  var meta = (html.match(/<meta[^>]*>/gi) || []).join("\n").substring(0, 3000);
  var text = cleaned.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 12000);
  return { meta: meta, text: text };
}

/* ══════════════════════════════════════════════
   3. ANALYSE WITH CLAUDE VISION
   Sends logo + og:image as visual inputs so
   Claude can SEE the actual brand colours
   ══════════════════════════════════════════════ */
async function analyseWithClaude(siteData, colours, socials, logoUrl, ogImageUrl) {
  var content = prepareContent(siteData.html);

  var systemMsg = "You are a brand analysis tool with vision. Return ONLY valid JSON. No markdown. No commentary. Escape special characters in strings.";

  var textPrompt = "Analyse this travel agent website.\n\n" +
    "I have provided images of their logo and/or website hero image. LOOK AT THESE IMAGES to identify the brand colours.\n\n" +
    "URL: " + siteData.url + "\n" +
    "META:\n" + content.meta + "\n" +
    "CONTENT:\n" + content.text + "\n" +
    "SOCIAL LINKS:\n" + JSON.stringify(socials) + "\n" +
    "CSS COLOURS (may be inaccurate):\n" + JSON.stringify(colours) + "\n\n" +
    "COLOUR INSTRUCTIONS:\n" +
    "Look at the images. The PRIMARY colour is the most prominent brand colour (header backgrounds, large UI areas, buttons). The SECONDARY colour is the accent/contrast colour. Return exact hex codes from what you SEE.\n\n" +
    "Return JSON:\n" +
    '{"business_name":"","trading_name":"","phone":"","email":"","destinations":"","specialisms":[],' +
    '"tone_keywords":"","formality":"","emoji_usage":"","sentence_style":"","cta_style":"",' +
    '"primary_colour":"","secondary_colour":"","logo_url":"' + (logoUrl || "").replace(/"/g, '\\"') + '",' +
    '"example_phrases":"","social_facebook":"","social_instagram":"","social_twitter":"",' +
    '"social_pinterest":"","social_tiktok":"","social_linkedin":"","social_youtube":"","confidence":""}\n\n' +
    "Rules:\n" +
    "- primary_colour + secondary_colour: hex codes from the IMAGES, not CSS\n" +
    "- specialisms: array from Beach|Family|Luxury|Cruise|Ski|City Breaks|Weddings|Touring|Long Haul|Short Haul|Adventure|All Inclusive\n" +
    "- formality: Casual|Balanced|Formal\n" +
    "- emoji_usage: None|Light|Heavy\n" +
    "- sentence_style: Short and punchy|Longer and descriptive\n" +
    "- cta_style: Direct|Soft|Question-based\n" +
    "- example_phrases: separate with | pipe\n" +
    "- confidence: High|Medium|Low";

  // Build multimodal content: images first (Claude best practice)
  var contentBlocks = [];
  if (logoUrl) contentBlocks.push({ type: "image", source: { type: "url", url: logoUrl } });
  if (ogImageUrl && ogImageUrl !== logoUrl) contentBlocks.push({ type: "image", source: { type: "url", url: ogImageUrl } });
  contentBlocks.push({ type: "text", text: textPrompt });

  var response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    temperature: 0,
    system: systemMsg,
    messages: [{ role: "user", content: contentBlocks }],
  });

  var text = response.content.map(function (c) { return c.type === "text" ? c.text : ""; }).filter(Boolean).join("");
  var cleaned = text.replace(/```json|```/g, "").trim();

  try { return JSON.parse(cleaned); }
  catch (e) {
    var repaired = repairJSON(cleaned);
    try { return JSON.parse(repaired); }
    catch (e2) { throw new Error("Failed to parse analysis. Please try again."); }
  }
}

/* ══════════════════════════════════════════════
   4. JSON REPAIR
   ══════════════════════════════════════════════ */
function repairJSON(str) {
  var s = str.indexOf("{"); var e = str.lastIndexOf("}");
  if (s === -1 || e === -1) return str;
  str = str.substring(s, e + 1);
  var r = ""; var inStr = false; var esc = false;
  for (var i = 0; i < str.length; i++) {
    var c = str[i];
    if (esc) { r += c; esc = false; continue; }
    if (c === "\\") { r += c; esc = true; continue; }
    if (c === '"') {
      if (!inStr) { inStr = true; r += c; }
      else {
        var rest = str.substring(i + 1).trimStart();
        if (rest[0] === ":" || rest[0] === "," || rest[0] === "}" || rest[0] === "]" || rest.startsWith("\n")) { inStr = false; r += c; }
        else { r += '\\"'; }
      }
    } else { r += c; }
  }
  return r.replace(/,\s*([}\]])/g, "$1");
}

/* ══════════════════════════════════════════════
   5. SAVE CLIENT TO AIRTABLE
   ══════════════════════════════════════════════ */
function generateAccessCode(tradingName) {
  // Format: TRAVEL-XXX-NNNN where XXX = 3-letter abbreviation, NNNN = random 4 digits
  var name = (tradingName || "CLIENT").toUpperCase().replace(/[^A-Z]/g, "");
  var abbr = name.substring(0, 3).padEnd(3, "X");
  var num = String(Math.floor(1000 + Math.random() * 9000));
  return "TRAVEL-" + abbr + "-" + num;
}

async function createClient(profile, websiteUrl) {
  var accessCode = generateAccessCode(profile.trading_name || profile.business_name);
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
    "Access Code": accessCode,
  };
  if (profile.specialisms && profile.specialisms.length > 0) fields["Specialisms"] = profile.specialisms;
  var res = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali", {
    method: "POST",
    headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: fields }], typecast: true }),
  });
  if (!res.ok) throw new Error("Airtable: " + res.status);
  var record = (await res.json()).records[0];
  record._accessCode = accessCode; // pass back for the response
  return record;
}

/* ══════════════════════════════════════════════
   6. HANDLER
   ══════════════════════════════════════════════ */
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

    // 1. Fetch
    var siteData = await fetchWebsite(url);
    if (!siteData.success) return res.status(400).json({ error: "Could not fetch: " + siteData.error });

    // 2. Extract from HTML
    var colours = extractColours(siteData.html);
    var socials = extractSocialLinks(siteData.html);
    var baseUrl = (siteData.url.match(/^https?:\/\/[^/]+/i) || [siteData.url])[0];
    var images = extractImages(siteData.html, baseUrl);

    console.log("Scanner: logo=" + images.logoUrl + " og=" + images.ogImageUrl + " colours=" + colours.length);

    // 3. Analyse with Claude Vision
    var profile = await analyseWithClaude(siteData, colours, socials, images.logoUrl, images.ogImageUrl);

    // Merge socials
    ["facebook","instagram","twitter","pinterest","tiktok","linkedin"].forEach(function(p) {
      if (!profile["social_" + p] && socials[p]) profile["social_" + p] = socials[p];
    });

    // 4. Save
    var saved = null;
    if (saveToAirtable) saved = await createClient(profile, url);

    return res.status(200).json({
      success: true, profile: profile,
      raw_colours: colours, raw_socials: socials,
      logo_url: images.logoUrl, og_image_url: images.ogImageUrl,
      saved: !!saved, client_id: saved ? saved.id : null,
      access_code: saved ? saved._accessCode : null, url: url,
    });
  } catch (err) {
    console.error("Scan error:", err);
    return res.status(500).json({ error: err.message });
  }
};
