/* ══════════════════════════════════════════
   LUNA MARKETING — EVENT POST GENERATOR
   Generate posts for specific events
   ══════════════════════════════════════════ */

var Anthropic = require("@anthropic-ai/sdk").default;
var ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var BASE = "appSoIlSe0sNaJ4BZ";
var CLIENTS = "tblUkzvBujc94Yali";
var QUEUE = "tblbhyiuULvedva0K";
var EVENTS = "tblQxIYrbzd6YlJYV";

function getWeekStr() {
  var now = new Date();
  var start = new Date(now.getFullYear(), 0, 1);
  var week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return now.getFullYear() + "-W" + String(week).padStart(2, "0");
}

async function atGet(table, id) {
  var r = await fetch("https://api.airtable.com/v0/" + BASE + "/" + table + "/" + id, {
    headers: { Authorization: "Bearer " + AIRTABLE_KEY }
  });
  if (!r.ok) throw new Error("Airtable fetch failed: " + r.status);
  return (await r.json()).fields;
}

async function atCreate(table, fields) {
  var r = await fetch("https://api.airtable.com/v0/" + BASE + "/" + table, {
    method: "POST",
    headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: fields }], typecast: true })
  });
  if (!r.ok) throw new Error("Airtable create failed: " + r.status);
  var d = await r.json();
  return d.records[0];
}

// Check if a post already exists for this event+client
async function checkExisting(clientId, eventId) {
  var formula = "AND({Event Source}='" + eventId + "',RECORD_ID(FIRST(Client))='" + clientId + "')";
  var url = "https://api.airtable.com/v0/" + BASE + "/" + QUEUE +
    "?filterByFormula=" + encodeURIComponent(formula) + "&maxRecords=1";
  var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) return false;
  var d = await r.json();
  return d.records && d.records.length > 0;
}

// Get all posted event IDs for a client
async function getPostedEvents(clientId) {
  var formula = "AND({Event Source}!='',RECORD_ID(FIRST(Client))='" + clientId + "')";
  var url = "https://api.airtable.com/v0/" + BASE + "/" + QUEUE +
    "?filterByFormula=" + encodeURIComponent(formula) +
    "&fields%5B%5D=" + encodeURIComponent("Event Source");
  var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) return [];
  var d = await r.json();
  return (d.records || []).map(function(rec) { return rec.fields["Event Source"]; }).filter(Boolean);
}

function buildEventPrompt(client, event) {
  var f = client;
  return "You are Luna, the automated social media content engine for travel agents. Generate ONE social media post themed around a specific upcoming event.\n\n" +
    "## Client Profile\n" +
    "Business Name: " + (f["Business Name"] || f["Trading Name"] || "") + "\n" +
    "Website: " + (f["Website URL"] || "") + "\n" +
    "Tone: " + (f["Tone Keywords"] || "warm, professional") + "\n" +
    "Destinations: " + (f["Destinations"] || "") + "\n" +
    "Specialisms: " + (Array.isArray(f["Specialisms"]) ? f["Specialisms"].join(", ") : f["Specialisms"] || "") + "\n\n" +
    "## Event to Write About\n" +
    "Event: " + event.name + "\n" +
    "Date: " + event.dateStart + (event.dateEnd && event.dateEnd !== event.dateStart ? " to " + event.dateEnd : "") + "\n" +
    "Category: " + event.category + "\n" +
    "Countries: " + event.countries + "\n" +
    "Destinations: " + (event.destinations || "") + "\n" +
    "Travel Angle: " + (event.travelAngle || "") + "\n" +
    "Content Suggestion: " + (event.contentSuggestion || "") + "\n" +
    "Audience: " + (Array.isArray(event.audience) ? event.audience.map(function(a) { return typeof a === "string" ? a : a.name; }).join(", ") : "") + "\n\n" +
    "## Rules\n" +
    "- UK English only. No em dashes. No Oxford comma.\n" +
    "- CRITICAL: The post MUST clearly name the event (e.g. 'Oktoberfest', 'FIFA World Cup', 'Diwali') and state WHEN it takes place (e.g. 'this September', '6-22 February', 'on 31st October'). The reader must know exactly what event you're talking about and when it happens.\n" +
    "- Tie the post directly to this event with a clear travel booking angle.\n" +
    "- Include a call-to-action encouraging the reader to book or enquire.\n" +
    "- Be specific — mention the event by name, the destination, the dates, and what makes it special.\n" +
    "- Never use banned phrases: leverage, seamless, game-changer, deep dive, elevate, unlock, navigate, landscape, robust, cutting-edge, empower, harness, delve, nestled, embark, tapestry, picture this, hidden gem, bucket list, paradise found, sun-kissed.\n\n" +
    "## Output Format\n" +
    "Return a JSON object (no markdown, no preamble). Fields:\n" +
    "content_type, destination, destination_slug, caption_facebook (50-200 words), caption_instagram (50-150 words with 8-15 hashtags), caption_linkedin (50-250 words), caption_twitter (200 chars max), caption_pinterest (300 chars max), caption_tiktok (100 words max), caption_gbp (100 words max), hashtags_instagram (array), image_tags (array of 3), suggested_day, suggested_time";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    var body = req.body || {};
    var action = body.action || req.query.action;

    // GET posted event IDs for a client
    if (action === "posted" || req.method === "GET") {
      var cid = body.clientId || req.query.clientId;
      if (!cid) return res.status(400).json({ error: "clientId required" });
      var posted = await getPostedEvents(cid);
      return res.status(200).json({ success: true, postedEventIds: posted });
    }

    // POST: generate post(s) for event(s)
    if (action === "generate") {
      var clientId = body.clientId;
      var eventIds = body.eventIds; // array of event record IDs
      if (!clientId || !eventIds || !eventIds.length) {
        return res.status(400).json({ error: "clientId and eventIds[] required" });
      }

      // Fetch client profile
      var client = await atGet(CLIENTS, clientId);

      var results = [];
      for (var i = 0; i < eventIds.length; i++) {
        var eventId = eventIds[i];
        try {
          // Check if already posted
          var exists = await checkExisting(clientId, eventId);
          if (exists) {
            results.push({ eventId: eventId, status: "skipped", reason: "already posted" });
            continue;
          }

          // Fetch event
          var eventFields = await atGet(EVENTS, eventId);
          var event = {
            name: eventFields["Event Name"] || "",
            dateStart: eventFields["Date Start"] || "",
            dateEnd: eventFields["Date End"] || "",
            category: eventFields["Category"] || "",
            countries: eventFields["Countries"] || "",
            destinations: eventFields["Destinations"] || "",
            travelAngle: eventFields["Travel Angle"] || "",
            contentSuggestion: eventFields["Content Suggestion"] || "",
            audience: eventFields["Audience"] || []
          };

          // Generate post via Claude
          var prompt = buildEventPrompt(client, event);
          var response = await ai.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2048,
            temperature: 0.7,
            system: prompt,
            messages: [{ role: "user", content: "Generate the event-themed post now." }]
          });

          var text = response.content.map(function(c) { return c.type === "text" ? c.text : ""; }).filter(Boolean).join("");
          var cleaned = text.replace(/```json|```/g, "").trim();
          var post = JSON.parse(cleaned);

          // Auto-fetch image from Pexels using image tags
          var imageUrl = "";
          try {
            var imgQuery = (post.image_tags && post.image_tags.length) ? post.image_tags[0] : event.name + " " + (event.destinations || event.countries);
            var pexRes = await fetch("https://api.pexels.com/v1/search?query=" + encodeURIComponent(imgQuery) + "&orientation=landscape&per_page=3&size=large", {
              headers: { Authorization: process.env.PEXELS_KEY }
            });
            if (pexRes.ok) {
              var pexData = await pexRes.json();
              if (pexData.photos && pexData.photos.length > 0) {
                imageUrl = pexData.photos[0].src.large2x || pexData.photos[0].src.large || "";
              }
            }
          } catch (imgErr) {
            console.error("Pexels image error:", imgErr.message);
          }

          // Queue the post with Event Source
          var record = await atCreate(QUEUE, {
            "Post Title": event.name + " — " + (post.destination || event.countries),
            "Client": [clientId],
            "Content Type": "Seasonal/Event",
            "Caption - Facebook": post.caption_facebook || "",
            "Caption - Instagram": post.caption_instagram || "",
            "Caption - LinkedIn": post.caption_linkedin || "",
            "Caption - Twitter": post.caption_twitter || "",
            "Caption - Pinterest": post.caption_pinterest || "",
            "Caption - TikTok": post.caption_tiktok || "",
            "Caption - GBP": post.caption_gbp || "",
            "Hashtags": (post.hashtags_instagram || []).join(", "),
            "Destination": post.destination || "",
            "Scheduled Time": post.suggested_time || "09:00",
            "Status": "Queued",
            "Generated Week": getWeekStr(),
            "Event Source": eventId,
            "Image URL": imageUrl || ""
          });

          results.push({ eventId: eventId, status: "created", postId: record.id, eventName: event.name });

          // Small delay between generations
          if (i < eventIds.length - 1) await new Promise(function(r) { setTimeout(r, 1500); });

        } catch (err) {
          results.push({ eventId: eventId, status: "error", error: err.message });
        }
      }

      return res.status(200).json({
        success: true,
        generated: results.filter(function(r) { return r.status === "created"; }).length,
        skipped: results.filter(function(r) { return r.status === "skipped"; }).length,
        errors: results.filter(function(r) { return r.status === "error"; }).length,
        results: results
      });
    }

    return res.status(400).json({ error: "Unknown action. Use 'generate' or 'posted'" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
