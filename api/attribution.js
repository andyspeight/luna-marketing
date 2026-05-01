// api/attribution.js
// Attribution event handler
// Receives webhooks from Calendly + ad-hoc POSTs from Knowledge Bot, popups, and the website
// Writes every event to the Attribution table for later analysis
//
// Endpoints (POST):
//   /api/attribution                          - generic event capture
//   /api/attribution?type=calendly            - Calendly webhook
//   /api/attribution?type=kb                  - Knowledge Bot conversation
//   /api/attribution?type=visit               - page visit / popup
//
// Auth:
//   - Calendly: signed webhook (X-Calendly-Webhook-Signature)
//   - Internal (KB, popup): Bearer token (CRON_SECRET reused)

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const ATTRIBUTION_TABLE = "Attribution";
const QUEUE_TABLE = "tblbhyiuULvedva0K";
const INTERNAL_SECRET = process.env.CRON_SECRET; // re-used for simplicity
const CALENDLY_WEBHOOK_SECRET = process.env.CALENDLY_WEBHOOK_SECRET; // signing secret

// ── Helpers ──

function nowIso() {
  return new Date().toISOString();
}

async function airtableCreate(table, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable create failed: ${r.status} ${err}`);
  }
  return r.json();
}

// Find a Post Queue record by its Airtable record ID (utm_content = "post-recXXX")
async function findPostByUtmContent(utmContent) {
  if (!utmContent || !utmContent.startsWith("post-")) return null;
  const recordId = utmContent.slice(5);
  if (!recordId.startsWith("rec")) return null;
  
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${QUEUE_TABLE}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data.id ? data.id : null;
  } catch (e) {
    console.error("Post lookup failed:", e.message);
    return null;
  }
}

// Parse UTM params from a URL string
function parseUtmsFromUrl(url) {
  if (!url) return {};
  try {
    const parsed = new URL(url);
    return {
      utmSource: parsed.searchParams.get("utm_source") || "",
      utmMedium: parsed.searchParams.get("utm_medium") || "",
      utmCampaign: parsed.searchParams.get("utm_campaign") || "",
      utmContent: parsed.searchParams.get("utm_content") || "",
      utmTerm: parsed.searchParams.get("utm_term") || "",
    };
  } catch (e) {
    return {};
  }
}

// ── Event handlers ──

async function handleCalendlyEvent(body) {
  // Calendly v2 webhook format. We care about invitee.created (booking made)
  // and invitee.canceled (booking cancelled - we may flag but not delete).
  const eventType = body.event;
  const payload = body.payload || {};
  
  if (eventType !== "invitee.created" && eventType !== "invitee.canceled") {
    return { skipped: true, reason: `event type ${eventType} ignored` };
  }
  
  const inviteeName = payload.name || "";
  const inviteeEmail = payload.email || "";
  const tracking = payload.tracking || {};
  // Calendly stores UTMs in tracking.utm_* fields when you pass them as query params on the embed
  const utmSource = tracking.utm_source || "";
  const utmMedium = tracking.utm_medium || "";
  const utmCampaign = tracking.utm_campaign || "";
  const utmContent = tracking.utm_content || "";
  const utmTerm = tracking.utm_term || "";
  
  // Calendly stores the meeting URL too
  const eventUri = payload.event && payload.event.uri ? payload.event.uri : "";
  const inviteeUri = payload.uri || "";
  const eventId = `calendly-${(inviteeUri.split("/").pop() || nowIso())}`;
  
  // Try to link back to the originating post if utm_content references one
  const originatingPostId = await findPostByUtmContent(utmContent);
  
  const fields = {
    "Event ID": eventId,
    "Event Type": eventType === "invitee.created" ? "Calendly Booking" : "Calendly Booking",
    "Event Date": payload.event && payload.event.start_time ? payload.event.start_time : nowIso(),
    "UTM Source": utmSource,
    "UTM Medium": utmMedium,
    "UTM Campaign": utmCampaign,
    "UTM Content": utmContent,
    "Referrer URL": eventUri,
    "Identifier": inviteeEmail,
    "Notes": eventType === "invitee.canceled"
      ? `CANCELLED. ${inviteeName} (${inviteeEmail})`
      : `${inviteeName} booked via Calendly`,
  };
  
  if (originatingPostId) {
    fields["Originating Post"] = [originatingPostId];
  }
  
  const result = await airtableCreate(ATTRIBUTION_TABLE, fields);
  return { saved: true, recordId: result.records[0].id, linkedToPost: !!originatingPostId };
}

async function handleKbConversation(body) {
  // Knowledge Bot sends: { sessionId, firstMessage, referrer, identifier? }
  const referrer = body.referrer || "";
  const utms = parseUtmsFromUrl(referrer);
  const originatingPostId = await findPostByUtmContent(utms.utmContent);
  
  const fields = {
    "Event ID": `kb-${body.sessionId || Date.now()}`,
    "Event Type": "KB Conversation",
    "Event Date": nowIso(),
    "UTM Source": utms.utmSource || "",
    "UTM Medium": utms.utmMedium || "",
    "UTM Campaign": utms.utmCampaign || "",
    "UTM Content": utms.utmContent || "",
    "Referrer URL": referrer,
    "Identifier": body.identifier || "",
    "Notes": (body.firstMessage || "").slice(0, 500),
  };
  
  if (originatingPostId) fields["Originating Post"] = [originatingPostId];
  
  const result = await airtableCreate(ATTRIBUTION_TABLE, fields);
  return { saved: true, recordId: result.records[0].id, linkedToPost: !!originatingPostId };
}

async function handlePageVisit(body) {
  // Popup or website JS sends: { url, referrer, identifier? }
  const url = body.url || "";
  const utms = parseUtmsFromUrl(url);
  const originatingPostId = await findPostByUtmContent(utms.utmContent);
  
  // Only log visits that have a UTM source — otherwise we'd flood with organic
  if (!utms.utmSource) {
    return { skipped: true, reason: "no utm_source" };
  }
  
  const fields = {
    "Event ID": `visit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    "Event Type": "Page Visit",
    "Event Date": nowIso(),
    "UTM Source": utms.utmSource,
    "UTM Medium": utms.utmMedium || "",
    "UTM Campaign": utms.utmCampaign || "",
    "UTM Content": utms.utmContent || "",
    "Referrer URL": body.referrer || "",
    "Identifier": body.identifier || "",
    "Notes": `Visited ${url.slice(0, 200)}`,
  };
  
  if (originatingPostId) fields["Originating Post"] = [originatingPostId];
  
  const result = await airtableCreate(ATTRIBUTION_TABLE, fields);
  return { saved: true, recordId: result.records[0].id, linkedToPost: !!originatingPostId };
}

async function handleGenericEvent(body) {
  // Fully generic — caller provides the fields directly. Used for manual entries.
  const allowedTypes = ["Page Visit", "KB Conversation", "Calendly Booking", "Demo Held", "Signed Client"];
  if (!allowedTypes.includes(body.eventType)) {
    throw new Error(`eventType must be one of: ${allowedTypes.join(", ")}`);
  }
  
  const originatingPostId = body.utmContent ? await findPostByUtmContent(body.utmContent) : null;
  
  const fields = {
    "Event ID": body.eventId || `generic-${Date.now()}`,
    "Event Type": body.eventType,
    "Event Date": body.eventDate || nowIso(),
    "UTM Source": body.utmSource || "",
    "UTM Medium": body.utmMedium || "",
    "UTM Campaign": body.utmCampaign || "",
    "UTM Content": body.utmContent || "",
    "Referrer URL": body.referrerUrl || "",
    "Identifier": body.identifier || "",
    "Notes": body.notes || "",
  };
  
  if (body.revenueValue !== undefined) fields["Revenue Value"] = Number(body.revenueValue);
  if (originatingPostId) fields["Originating Post"] = [originatingPostId];
  
  const result = await airtableCreate(ATTRIBUTION_TABLE, fields);
  return { saved: true, recordId: result.records[0].id, linkedToPost: !!originatingPostId };
}

// ── Main handler ──

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Calendly-Webhook-Signature");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  
  const type = (req.query && req.query.type) || "generic";
  
  try {
    // Auth
    if (type === "calendly") {
      // Calendly signs webhooks — we verify via shared secret in the path or signature header
      // For MVP: validate by checking the body has expected Calendly v2 structure.
      // Production: implement HMAC verification using CALENDLY_WEBHOOK_SECRET
      if (!req.body || !req.body.event || !req.body.payload) {
        return res.status(400).json({ error: "Invalid Calendly webhook payload" });
      }
    } else {
      // Internal (KB, popup, generic): require Bearer token
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${INTERNAL_SECRET}`) {
        return res.status(401).json({ error: "Unauthorized" });
      }
    }
    
    let result;
    switch (type) {
      case "calendly":
        result = await handleCalendlyEvent(req.body);
        break;
      case "kb":
        result = await handleKbConversation(req.body);
        break;
      case "visit":
        result = await handlePageVisit(req.body);
        break;
      default:
        result = await handleGenericEvent(req.body);
    }
    
    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    console.error("Attribution error:", e);
    return res.status(500).json({ error: e.message });
  }
};
