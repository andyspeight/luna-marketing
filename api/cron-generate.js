const Anthropic = require("@anthropic-ai/sdk").default;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const QUEUE_TABLE = "tblbhyiuULvedva0K";
const EVENTS_TABLE = "tblQxIYrbzd6YlJYV";
const CRON_SECRET = process.env.CRON_SECRET;

// Fetch upcoming events from the Events Calendar
async function getUpcomingEvents() {
  var now = new Date();
  var future = new Date();
  future.setDate(future.getDate() + 42); // 6 weeks ahead
  var startStr = now.toISOString().split("T")[0];
  var endStr = future.toISOString().split("T")[0];
  var formula = "AND({Date Start}>='" + startStr + "',{Date Start}<='" + endStr + "')";
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + EVENTS_TABLE +
    "?filterByFormula=" + encodeURIComponent(formula) +
    "&sort%5B0%5D%5Bfield%5D=Date+Start&sort%5B0%5D%5Bdirection%5D=asc";
  try {
    var res = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
    if (!res.ok) return [];
    var data = await res.json();
    return (data.records || []).map(function(r) {
      var f = r.fields;
      return {
        name: f["Event Name"] || "",
        dateStart: f["Date Start"] || "",
        dateEnd: f["Date End"] || "",
        category: f["Category"] || "",
        countries: f["Countries"] || "",
        destinations: f["Destinations"] || "",
        travelAngle: f["Travel Angle"] || "",
        contentSuggestion: f["Content Suggestion"] || "",
        audience: f["Audience"] || [],
        impact: f["Impact"] || "",
        leadTimeWeeks: f["Lead Time Weeks"] || 4
      };
    });
  } catch (e) {
    console.error("Events fetch error:", e.message);
    return [];
  }
}

// Match events to a client based on their destinations and universal events
function matchEventsToClient(events, clientDestinations) {
  if (!events || !events.length) return [];
  var destStr = (clientDestinations || "").toLowerCase();
  var now = new Date();

  return events.filter(function(ev) {
    // Check if event is within its lead time window
    var eventDate = new Date(ev.dateStart);
    var weeksUntil = (eventDate - now) / (7 * 24 * 60 * 60 * 1000);
    if (weeksUntil > ev.leadTimeWeeks) return false;

    // Universal events (apply to all clients regardless of destination)
    var universal = ["Public Holiday", "School Holiday", "Awareness Day"];
    if (universal.indexOf(ev.category) !== -1 && ev.countries && ev.countries.toLowerCase().includes("uk")) return true;
    if (ev.countries && (ev.countries.toLowerCase().includes("global"))) return true;

    // Destination-matched events
    if (!destStr) return false;
    var evCountries = (ev.countries || "").toLowerCase().split(",").map(function(s) { return s.trim(); });
    var evDests = (ev.destinations || "").toLowerCase().split(",").map(function(s) { return s.trim(); });
    var allEvLocs = evCountries.concat(evDests).filter(Boolean);

    for (var i = 0; i < allEvLocs.length; i++) {
      if (destStr.includes(allEvLocs[i])) return true;
      // Also check if any word from the event location appears in destinations
      var words = allEvLocs[i].split(" ");
      for (var j = 0; j < words.length; j++) {
        if (words[j].length > 3 && destStr.includes(words[j])) return true;
      }
    }
    return false;
  });
}

// Fetch all active clients from Airtable
async function getActiveClients() {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${CLIENTS_TABLE}?filterByFormula={Status}='Active'`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!res.ok) throw new Error("Failed to fetch clients: " + res.statusText);
  const data = await res.json();
  return data.records || [];
}

// Build events context section for the prompt
function buildEventsSection(events) {
  if (!events || !events.length) return "";
  var section = "\n## Upcoming Events & Seasonal Hooks\n\nThe following events are coming up and are relevant to this client's destinations. Where possible, tie at least ONE post to an upcoming event. Use the travel angle and content suggestions provided. If an event is marked as a booking driver, it's especially important to create content around it.\n\n";
  events.forEach(function(ev) {
    var dateStr = ev.dateStart;
    if (ev.dateEnd && ev.dateEnd !== ev.dateStart) dateStr += " to " + ev.dateEnd;
    section += "### " + ev.name + " (" + dateStr + ")\n";
    section += "Category: " + ev.category + " | Impact: " + (ev.impact || "Moderate") + "\n";
    if (ev.countries) section += "Where: " + ev.countries + (ev.destinations ? " — " + ev.destinations : "") + "\n";
    if (ev.travelAngle) section += "Travel Angle: " + ev.travelAngle + "\n";
    if (ev.contentSuggestion) section += "Content Idea: " + ev.contentSuggestion + "\n";
    if (ev.audience && ev.audience.length) {
      var names = ev.audience.map(function(a) { return typeof a === "string" ? a : a.name; });
      section += "Best For: " + names.join(", ") + "\n";
    }
    section += "\n";
  });
  return section;
}

// Build system prompt for a single client
function buildSystemPrompt(f, matchedEvents) {
  return `You are Luna, the automated social media content engine for travel agents. You generate social media posts that will be published to Facebook, Instagram and LinkedIn without human review. Because no human checks your output before it goes live, accuracy and brand safety are paramount.

You are writing on behalf of a specific travel agent. Their brand profile is provided below. Every post must sound like it came from this agent, not from an AI or a generic marketing tool.

## Client Profile

Business Name: ${f["Business Name"] || ""}
Trading Name: ${f["Trading Name"] || ""}
Website: ${f["Website URL"] || ""}
Phone: ${f["Phone"] || ""}

## Brand Voice

Tone: ${f["Tone Keywords"] || "warm, professional"}
Emoji usage: ${f["Emoji Usage"] || "Light"}
Formality: ${f["Formality"] || "Balanced"}
Sentence style: ${f["Sentence Style"] || "Short and punchy"}
CTA style: ${f["CTA Style"] || "Question-based"}
Example phrases from their brand: ${f["Example Phrases"] || ""}

## What This Agent Sells

Destinations: ${f["Destinations"] || ""}
Specialisms: ${Array.isArray(f["Specialisms"]) ? f["Specialisms"].join(", ") : f["Specialisms"] || ""}

## Content Request

Generate ${f["Posting Frequency"] || 3} social media posts for the week beginning ${getNextMonday()}.

The content mix should follow these weightings:
- Destination Inspiration: 40%
- Offer Highlight: 20%
- Travel Tips: 15%
- Social Proof: 10%
- Seasonal/Event: 10%
- Behind the Scenes: 5%

Round to the nearest whole post. For 3 posts per week, a typical mix is 2 Destination Inspiration and 1 rotating type. Vary the rotating type week to week.
` + buildEventsSection(matchedEvents) + `
## Content Rules (Non-Negotiable)

### Language
- UK English only. Colour not color. Favourite not favorite. Centre not center.
- No em dashes. Use commas, full stops or colons instead.
- No Oxford comma.

### Banned Phrases
Never use any of these: leverage, seamless, game-changer, deep dive, elevate, unlock, navigate, landscape, robust, cutting-edge, empower, harness, at the end of the day, in today's world, it's important to note, it's worth noting, delve, nestled, embark, tapestry, picture this, ever-changing, testament to, whether you're, there's something for everyone, the world is waiting, adventure awaits, escape the ordinary, hidden gem, bucket list, wander, paradise found, sun-kissed

### Safety
- No political content. No religious content. No controversial opinions.
- No health claims or medical advice.
- No pricing unless explicitly provided. Never invent, estimate or round prices.
- No competitor mentions.
- No negative content about any destination, country, culture or people.
- No content about destinations not in this agent's destination list.

### Structure
- Every post must include a call-to-action.
- Facebook: 50-200 words. Conversational, storytelling, question-based engagement.
- Instagram: 50-150 words. Visual-first, emoji-friendly, hashtag-rich (8-15 hashtags).
- LinkedIn: 50-250 words. Professional, insight-driven, thought-leadership tone.
- Twitter/X: 200 characters max. Punchy, conversational, includes CTA link. No hashtags in caption.
- Pinterest: 300 characters max. SEO-rich, keyword-heavy, inspirational. Focus on searchability.
- TikTok: 100 words max. Casual, trend-aware, hook-first opening line. Include 3-5 hashtags.
- Google Business Profile: 100 words max. Local SEO focused, includes business CTA and location relevance.
- Hashtags: 8-15 for Instagram, 3-5 for Facebook, 3-5 for LinkedIn, 3-5 for TikTok. None for Twitter, Pinterest, or GBP.
- Never use the same opening word for two posts.
- Never start a post with a hashtag.
- Be specific to the destination.

### CTA Links
- Format: ${f["Website URL"] || ""}/destinations/destination-slug?utm_source=social&utm_medium=platform&utm_campaign=luna_marketing

### Image Tags
For each post, provide 3 image search tags that describe the ideal image. Be specific.

## Output Format

Return a JSON array. No markdown, no commentary, no preamble. Only valid JSON.

Each post object: post_number, content_type, destination, destination_slug, caption_facebook, caption_instagram, caption_linkedin, caption_twitter, caption_pinterest, caption_tiktok, caption_gbp, hashtags_facebook (array), hashtags_instagram (array), hashtags_linkedin (array), hashtags_tiktok (array), cta_url_facebook, image_tags (array of 3), image_orientation, suggested_day, suggested_time`;
}

function getNextMonday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getWeekString() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now - start;
  const week = Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

// Generate posts for one client
async function generateForClient(record, allEvents) {
  const f = record.fields;
  var matched = matchEventsToClient(allEvents || [], f["Destinations"] || "");
  console.log("  Events matched: " + matched.length + (matched.length ? " (" + matched.map(function(e) { return e.name; }).join(", ") + ")" : ""));
  const systemPrompt = buildSystemPrompt(f, matched);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    temperature: 0.7,
    system: systemPrompt,
    messages: [
      { role: "user", content: "Generate this week's social media posts." },
    ],
  });

  const text = response.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .filter(Boolean)
    .join("");

  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// Write posts to the queue
async function queuePosts(posts, clientId) {
  const created = [];
  for (const post of posts) {
    const record = {
      fields: {
        "Post Title": `${post.destination} ${post.content_type} - ${post.suggested_day}`,
        Client: [clientId],
        "Content Type": post.content_type,
        "Caption - Facebook": post.caption_facebook,
        "Caption - Instagram": post.caption_instagram,
        "Caption - LinkedIn": post.caption_linkedin || "",
        "Caption - Twitter": post.caption_twitter || "",
        "Caption - Pinterest": post.caption_pinterest || "",
        "Caption - TikTok": post.caption_tiktok || "",
        "Caption - GBP": post.caption_gbp || "",
        Hashtags: [
          ...(post.hashtags_facebook || []),
          ...(post.hashtags_instagram || []),
        ]
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(", "),
        "CTA URL": post.cta_url_facebook || "",
        Destination: post.destination || "",
        "Scheduled Time": post.suggested_time || "09:00",
        Status: "Queued",
        "Generated Week": getWeekString(),
      },
    };

    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: [record], typecast: true }),
      }
    );
    if (res.ok) {
      const data = await res.json();
      created.push(data.records[0]);
    }
  }
  return created;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Security: verify cron secret (Vercel sends this automatically)
  const authHeader = req.headers.authorization;
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const results = {
    week: getWeekString(),
    started: new Date().toISOString(),
    clients: [],
    errors: [],
    totalPosts: 0,
    eventsLoaded: 0,
  };

  try {
    // 1. Get all active clients
    const clients = await getActiveClients();
    console.log(`Found ${clients.length} active clients`);

    // 1b. Fetch upcoming events once for all clients
    const allEvents = await getUpcomingEvents();
    console.log(`Found ${allEvents.length} upcoming events`);
    results.eventsLoaded = allEvents.length;

    // 2. Generate posts for each client sequentially
    for (const clientRecord of clients) {
      const name = clientRecord.fields["Business Name"] || "Unknown";
      try {
        console.log(`Generating for: ${name}`);
        const posts = await generateForClient(clientRecord, allEvents);
        const queued = await queuePosts(posts, clientRecord.id);

        // Auto-publish if client has auto_publish enabled
        var autoPublished = 0;
        if (clientRecord.fields["Auto Publish"] && queued.length > 0) {
          try {
            console.log(`Auto-publishing for: ${name}`);
            var pubRes = await fetch((process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://luna-marketing.vercel.app') + '/api/publish', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'publish_client', clientId: clientRecord.id })
            });
            var pubData = await pubRes.json();
            autoPublished = pubData.published || 0;
            console.log(`Auto-published ${autoPublished} posts for ${name}`);
          } catch (pubErr) {
            console.error(`Auto-publish error for ${name}: ${pubErr.message}`);
          }
        }

        results.clients.push({
          name,
          id: clientRecord.id,
          postsGenerated: posts.length,
          postsQueued: queued.length,
          autoPublished: autoPublished,
          status: "success",
        });
        results.totalPosts += queued.length;
      } catch (err) {
        console.error(`Error for ${name}: ${err.message}`);
        results.errors.push({
          name,
          id: clientRecord.id,
          error: err.message,
        });
        results.clients.push({
          name,
          id: clientRecord.id,
          postsGenerated: 0,
          postsQueued: 0,
          status: "error",
          error: err.message,
        });
      }

      // Small delay between clients to avoid rate limits
      await new Promise((r) => setTimeout(r, 2000));
    }

    results.completed = new Date().toISOString();
    results.success = true;

    return res.status(200).json(results);
  } catch (err) {
    console.error("Batch generation error:", err);
    return res.status(500).json({ error: err.message, results });
  }
};
