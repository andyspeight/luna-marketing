// api/brevo-webhook.js
// Day A — Email Suite v1
//
// Receives transactional and marketing event webhooks from Brevo and updates
// the matching Email Queue record. Also writes Audit Log entries for events
// that signal user action (unsubscribed, spam complaints).
//
// POST /api/brevo-webhook
//
// Brevo sends events in this rough shape:
//   {
//     event: "delivered" | "opened" | "click" | "hard_bounce" | "soft_bounce" |
//            "spam" | "unsubscribed" | "complaint" | "request" | "blocked",
//     email: "recipient@example.com",
//     ...timestamps and metadata...
//     "message-id": "<abc@server>" or "X-Mailin-custom" header,
//     "X-Mailin-custom": "...optional custom data..."
//   }
//
// Auth: signature verification via shared secret in BREVO_WEBHOOK_SECRET env var.
//       Brevo sends an Authorization header, OR we use a query string token.
//       For Day A v1 we use a query string token: /api/brevo-webhook?token=XXX
//       This is the simplest reliable approach until we configure Brevo's HMAC.

const crypto = require("crypto");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const BREVO_WEBHOOK_SECRET = process.env.BREVO_WEBHOOK_SECRET;

const EMAIL_QUEUE_TABLE = "Email Queue";
const AUDIT_LOG_TABLE = "Audit Log";

async function airtableFetch(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error ${r.status}: ${err}`);
  }
  return r.json();
}

// Find the email record by Brevo Message ID
async function findEmailByBrevoMessageId(messageId) {
  if (!messageId) return null;
  const safe = String(messageId).replace(/'/g, "\\'");
  const formula = encodeURIComponent(`{Brevo Message ID}='${safe}'`);
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}?filterByFormula=${formula}&maxRecords=1`;
  try {
    const data = await airtableFetch(url);
    return (data.records || [])[0] || null;
  } catch {
    return null;
  }
}

async function patchEmail(emailId, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  return airtableFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  });
}

async function writeAuditLog({ action, subjectId, details }) {
  const eventId = `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`;
  try {
    await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        records: [{
          fields: {
            "Event ID": eventId,
            "Timestamp": new Date().toISOString(),
            "Actor": "brevo-webhook",
            "Action": action,
            "Subject Type": "email",
            "Subject ID": subjectId || "(unknown)",
            "Details": typeof details === "string" ? details : JSON.stringify(details),
          },
        }],
        typecast: true,
      }),
    });
  } catch (e) {
    console.error("Audit log write failed:", e.message);
  }
}

// Map Brevo event to our internal action
function brevoEventToAction(event) {
  const e = String(event || "").toLowerCase().replace(/_/g, "");
  if (e === "unsubscribed" || e === "listunsubscribed") return "unsubscribe";
  if (e === "spam" || e === "complaint") return "suppress";
  return null;  // Others don't write to audit log
}

// Increment numeric fields atomically (best effort — Airtable doesn't support atomic increment)
async function incrementField(emailId, fieldName, delta = 1) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  const current = await airtableFetch(url);
  const currentValue = Number(current.fields[fieldName] || 0);
  return patchEmail(emailId, { [fieldName]: currentValue + delta });
}

// Process a single Brevo event
async function processEvent(event) {
  const eventName = (event.event || "").toLowerCase();
  const messageId = event["message-id"] || event.messageId || event["X-Mailin-custom"] || null;
  const eventDate = event.date || event.ts || new Date().toISOString();

  if (!messageId) {
    return { skipped: true, reason: "no message id" };
  }

  const emailRec = await findEmailByBrevoMessageId(messageId);
  if (!emailRec) {
    return { skipped: true, reason: "email not found", messageId };
  }

  const emailId = emailRec.id;
  const updates = {};

  switch (eventName) {
    case "delivered":
    case "request":
      updates["Send Result"] = "Sent";
      if (!emailRec.fields["Sent At"]) {
        updates["Sent At"] = eventDate;
      }
      break;

    case "opened":
    case "open":
      updates["Last Opened"] = eventDate;
      // Increment is best-effort; we read-then-write.
      // If multiple opens fire simultaneously some may be lost — acceptable for v1.
      await incrementField(emailId, "Open Count", 1);
      break;

    case "click":
    case "clicked":
      updates["Last Clicked"] = eventDate;
      await incrementField(emailId, "Click Count", 1);
      break;

    case "hard_bounce":
    case "hardbounce":
      updates["Send Result"] = "Bounced";
      updates["Status"] = "Failed";
      break;

    case "soft_bounce":
    case "softbounce":
      // Soft bounces don't count as failure unless they keep happening
      updates["Send Result"] = "Bounced";
      break;

    case "blocked":
      updates["Send Result"] = "Failed";
      updates["Status"] = "Failed";
      break;

    case "spam":
    case "complaint":
      updates["Send Result"] = "Suppressed";
      break;

    case "unsubscribed":
    case "listunsubscribed":
      updates["Send Result"] = "Suppressed";
      break;

    case "deferred":
    case "invalid_email":
      // Acknowledge but don't update. Logged in Send Result indirectly.
      break;
  }

  if (Object.keys(updates).length > 0) {
    await patchEmail(emailId, updates);
  }

  // Audit log for user-action events
  const auditAction = brevoEventToAction(eventName);
  if (auditAction) {
    await writeAuditLog({
      action: auditAction,
      subjectId: emailId,
      details: { event: eventName, recipient: event.email, date: eventDate },
    });
  }

  return { processed: true, emailId, event: eventName, updates };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // Auth: shared secret in query string OR Authorization header
  const tokenFromQuery = req.query && req.query.token;
  const authHeader = req.headers.authorization || "";
  const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const providedToken = tokenFromQuery || tokenFromHeader;

  if (!BREVO_WEBHOOK_SECRET) {
    console.error("BREVO_WEBHOOK_SECRET not configured");
    return res.status(503).json({ error: "Webhook not configured" });
  }

  if (!providedToken || providedToken !== BREVO_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Invalid webhook token" });
  }

  try {
    const body = req.body;

    // Brevo can send either a single event or an array of events
    const events = Array.isArray(body) ? body : [body];

    const results = [];
    for (const event of events) {
      try {
        const result = await processEvent(event);
        results.push(result);
      } catch (e) {
        console.error(`Failed to process event:`, e.message);
        results.push({ error: e.message, event: event.event });
      }
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      results,
    });
  } catch (e) {
    console.error("Webhook error:", e);
    return res.status(500).json({ error: e.message });
  }
};
