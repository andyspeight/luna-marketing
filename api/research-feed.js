// api/research-feed.js
// Daily research engine for Luna Marketing
// Pulls signal from RSS, Reddit, Google Trends → scores via Claude → writes top 10 to Research Sparks
// Triggered by Vercel cron: 06:00 UTC daily

const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const SPARKS_TABLE = "Research Sparks";
const CRON_SECRET = process.env.CRON_SECRET;

// ── RSS Sources ──
// Travel industry trade press. Each source must serve a valid RSS feed URL.

const RSS_SOURCES = [
  { name: "TTG", url: "https://www.ttgmedia.com/feeds/news.rss" },
  { name: "Travel Weekly", url: "https://travelweekly.co.uk/feed" },
  { name: "Travolution", url: "https://www.travolution.com/feed" },
  { name: "TravelMole", url: "https://www.travelmole.com/feed/" },
  { name: "PhocusWire", url: "https://www.phocuswire.com/rss" },
  { name: "Skift", url: "https://skift.com/feed/" },
];

// ── Reddit Sources ──
// Public JSON API. No auth required for public subreddits.

const REDDIT_SOURCES = [
  { name: "Reddit", subreddit: "travelagents", url: "https://www.reddit.com/r/travelagents/new.json?limit=15" },
  { name: "Reddit", subreddit: "travel", url: "https://www.reddit.com/r/travel/top.json?limit=10&t=day" },
];

// ── Google Trends keywords ──
// We hit the unofficial daily-trends RSS proxy. Lightweight, no API key.

const TRENDS_KEYWORDS = [
  "travel agent software",
  "travel CRM",
  "travel booking system",
  "travel agency technology",
  "tour operator software",
];

// ── Helpers ──

function nowIso() {
  return new Date().toISOString();
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Minimal RSS parser. We avoid pulling in xml2js to keep cold-start lean.
// Handles both <item> (RSS 2.0) and <entry> (Atom) formats.
function parseRss(xml, sourceName) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  
  const matches = [...xml.matchAll(itemRegex), ...xml.matchAll(entryRegex)];
  
  for (const match of matches) {
    const block = match[1];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    const link = (block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/) || [])[1]
      || (block.match(/<link[^>]*href="([^"]+)"/) || [])[1]
      || "";
    const desc = (block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1]
      || (block.match(/<summary[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/summary>/) || [])[1]
      || (block.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/) || [])[1]
      || "";
    
    if (title && link) {
      items.push({
        source: sourceName,
        headline: stripHtml(title).slice(0, 200),
        url: link.trim(),
        rawSummary: stripHtml(desc).slice(0, 500),
      });
    }
  }
  return items.slice(0, 10);
}

async function fetchRss(source) {
  try {
    const r = await fetch(source.url, {
      headers: { "User-Agent": "LunaMarketing/1.0 Research Feed" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      console.error(`RSS fail ${source.name}: ${r.status}`);
      return [];
    }
    const xml = await r.text();
    return parseRss(xml, source.name);
  } catch (e) {
    console.error(`RSS error ${source.name}:`, e.message);
    return [];
  }
}

async function fetchReddit(source) {
  try {
    const r = await fetch(source.url, {
      headers: { "User-Agent": "LunaMarketing/1.0 Research Feed" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      console.error(`Reddit fail ${source.subreddit}: ${r.status}`);
      return [];
    }
    const json = await r.json();
    const posts = (json.data && json.data.children) || [];
    return posts.slice(0, 10).map((p) => ({
      source: "Reddit",
      headline: `r/${source.subreddit}: ${p.data.title.slice(0, 180)}`,
      url: `https://reddit.com${p.data.permalink}`,
      rawSummary: stripHtml(p.data.selftext || "").slice(0, 500)
        || `${p.data.score} upvotes, ${p.data.num_comments} comments`,
    }));
  } catch (e) {
    console.error(`Reddit error:`, e.message);
    return [];
  }
}

async function fetchGoogleTrends() {
  // Google Trends daily RSS for UK
  const url = "https://trends.google.co.uk/trends/trendingsearches/daily/rss?geo=GB";
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "LunaMarketing/1.0 Research Feed" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const parsed = parseRss(xml, "Google Trends");
    // Filter: only keep items mentioning travel-relevant terms
    const travelTerms = /travel|holiday|flight|hotel|airline|cruise|tour|destination|booking/i;
    return parsed.filter((p) => travelTerms.test(p.headline + " " + p.rawSummary)).slice(0, 5);
  } catch (e) {
    console.error("Google Trends error:", e.message);
    return [];
  }
}

// ── Claude scoring ──

async function scoreItems(items) {
  if (items.length === 0) return [];
  
  const itemsForPrompt = items.map((it, i) => ({
    id: i,
    source: it.source,
    headline: it.headline,
    summary: it.rawSummary.slice(0, 300),
  }));
  
  const systemPrompt = `You are a content strategist for Travelgenix, a UK B2B travel-tech SaaS company. You score industry signals 0-10 for content opportunity for Andy Speight's LinkedIn and Travelgenix's social channels.

Travelgenix audience: UK travel agency owners, tour operators, OTAs, consortia leaders. Andy is the CEO. He posts opinion takes on travel tech, agency operations, AI in travel, supplier dynamics, industry consolidation.

Score 0-10 based on:
- 10: Direct, urgent, specific to travel tech / agency software / supplier tech / industry consolidation. Andy MUST comment.
- 7-9: Highly relevant. Travel agent operations, AI in travel, fraud/security, regulation, big M&A, customer behaviour shifts.
- 4-6: Tangentially relevant. General travel news with a possible angle (e.g. demand patterns).
- 1-3: Low value. Consumer travel content, destination pieces, tourism stats.
- 0: Not relevant at all.

Return ONLY a JSON array. No preamble. No markdown fences. Each object: { "id": number, "score": number, "angle": "one short sentence on the post angle Andy should take, in his voice" }`;

  const userPrompt = `Score these items:\n\n${JSON.stringify(itemsForPrompt, null, 2)}`;
  
  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    
    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const scored = JSON.parse(cleaned);
    
    return items.map((it, i) => {
      const match = scored.find((s) => s.id === i);
      return {
        ...it,
        score: match ? match.score : 0,
        angle: match ? match.angle : "",
      };
    });
  } catch (e) {
    console.error("Scoring failed:", e.message);
    // Default: score everything 5 so it at least populates
    return items.map((it) => ({ ...it, score: 5, angle: "" }));
  }
}

// ── Airtable write ──

async function writeSparks(sparks) {
  if (sparks.length === 0) return { written: 0 };
  
  // Map source name to singleSelect option (must match Airtable choices exactly)
  const sourceMap = {
    "TTG": "TTG",
    "Travel Weekly": "Travel Weekly",
    "Travolution": "Travolution",
    "TravelMole": "TravelMole",
    "PhocusWire": "PhocusWire",
    "Skift": "Skift",
    "Reddit": "Reddit",
    "Quora": "Quora",
    "Google Trends": "Google Trends",
  };
  
  const records = sparks.map((s) => ({
    fields: {
      "Headline": s.headline,
      "URL": s.url,
      "Source": sourceMap[s.source] || "Manual",
      "Summary": s.rawSummary,
      "Score": s.score,
      "Suggested Angle": s.angle || "",
      "Status": "Open",
      "Captured": nowIso(),
    },
  }));
  
  let written = 0;
  // Batch in 10s
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10);
    try {
      const r = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(SPARKS_TABLE)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${AIRTABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ records: batch, typecast: true }),
        }
      );
      if (r.ok) written += batch.length;
      else {
        const err = await r.text();
        console.error(`Sparks write error (batch ${i}):`, err);
      }
    } catch (e) {
      console.error(`Sparks write exception:`, e.message);
    }
  }
  return { written };
}

// ── De-dupe ──
// Pull recent open sparks and skip URLs we've already captured in the last 14 days

async function loadRecentUrls() {
  try {
    const formula = encodeURIComponent(`IS_AFTER({Captured}, DATEADD(NOW(), -14, 'days'))`);
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(SPARKS_TABLE)}?filterByFormula=${formula}&fields%5B%5D=URL`,
      { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
    );
    if (!r.ok) return new Set();
    const data = await r.json();
    return new Set((data.records || []).map((rec) => (rec.fields.URL || "").trim()).filter(Boolean));
  } catch (e) {
    console.error("Recent URLs load failed:", e.message);
    return new Set();
  }
}

// ── Main handler ──

module.exports = async (req, res) => {
  // Verify cron secret if called from Vercel cron
  const isCron = req.headers["user-agent"] && req.headers["user-agent"].includes("vercel-cron");
  if (isCron && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  // Allow manual trigger with secret too
  if (!isCron && req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  try {
    console.log("Research feed started");
    
    // 1. Fetch from all sources in parallel
    const [rssResults, redditResults, trendsResults] = await Promise.all([
      Promise.all(RSS_SOURCES.map(fetchRss)),
      Promise.all(REDDIT_SOURCES.map(fetchReddit)),
      fetchGoogleTrends(),
    ]);
    
    const allItems = [
      ...rssResults.flat(),
      ...redditResults.flat(),
      ...trendsResults,
    ];
    
    console.log(`Fetched ${allItems.length} raw items`);
    
    // 2. De-dupe against recent
    const recentUrls = await loadRecentUrls();
    const deduped = allItems.filter((it) => it.url && !recentUrls.has(it.url.trim()));
    console.log(`${deduped.length} after de-dupe`);
    
    if (deduped.length === 0) {
      return res.status(200).json({
        success: true,
        fetched: allItems.length,
        deduped: 0,
        scored: 0,
        written: 0,
        message: "Nothing new today",
      });
    }
    
    // 3. Score (Claude)
    const scored = await scoreItems(deduped);
    
    // 4. Take top by score, threshold 4+
    const top = scored
      .filter((s) => s.score >= 4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
    
    console.log(`${top.length} sparks scored 4+`);
    
    // 5. Write to Airtable
    const writeResult = await writeSparks(top);
    
    return res.status(200).json({
      success: true,
      fetched: allItems.length,
      deduped: deduped.length,
      scored: scored.length,
      topThreshold: top.length,
      written: writeResult.written,
      sample: top.slice(0, 3).map((s) => ({
        score: s.score,
        source: s.source,
        headline: s.headline.slice(0, 80),
      })),
    });
  } catch (e) {
    console.error("Research feed failed:", e);
    return res.status(500).json({ error: e.message });
  }
};
