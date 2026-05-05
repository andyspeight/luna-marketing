// api/email-compose.js
// Day B — Email Suite v1
//
// Creates a new email in the queue from the compose form in the client portal.
// Always creates with Status="Awaiting Approval" so it must be reviewed before send.
//
// POST /api/email-compose
// Body: {
//   clientId,        // required
//   subject,         // required
//   previewText,     // optional, max 200 chars
//   bodyHTML,        // required (one of bodyHTML or bodyPlain)
//   bodyPlain,       // optional but recommended
//   audience,        // required: "Cold" | "Nurture" | "Client" | "Drip"
//   audienceSegment, // optional: human-readable label
//   recipientEmail,  // optional: for single-recipient sends (overrides audience)
//   scheduledSend,   // optional ISO datetime
//   emailType        // optional: "Newsletter" | "Promotion" | "Update" | "Drip"
// }
//
// Returns: { success, emailId, status, ...email summary }

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const CLIENTS_TABLE = "Clients";
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

async function authenticateClient(clientId) {
  if (!clientId || !/^rec[A-Za-z0-9]{14}$/.test(clientId)) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(CLIENTS_TABLE)}/${clientId}`;
  try {
    const data = await airtableFetch(url);
    if (!data || !data.fields) return null;
    const clientType = (data.fields["Client Type"] || "").toLowerCase();
    if (clientType !== "b2b-saas") return null;
    return { id: data.id, ...data.fields };
  } catch {
    return null;
  }
}

async function writeAuditLog({ actor, action, subjectId, details, ip }) {
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
            "Actor": actor || "system",
            "Action": action,
            "Subject Type": "email",
            "Subject ID": subjectId,
            "Details": typeof details === "string" ? details : JSON.stringify(details),
            "IP": ip || "",
          },
        }],
        typecast: true,
      }),
    });
  } catch (e) {
    console.error("Audit log write failed:", e.message);
  }
}

// Sanitise HTML. Very simple approach: strip script/style/iframe tags.
// Full sanitisation is Day D's compliance work.
function sanitiseHTML(html) {
  if (!html || typeof html !== "string") return "";
  // Remove dangerous tags entirely (with content)
  let clean = html.replace(/<(script|style|iframe|object|embed|form)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "");
  // Remove javascript: URLs
  clean = clean.replace(/javascript:/gi, "blocked:");
  // Remove on* event handlers
  clean = clean.replace(/\son\w+\s*=\s*"[^"]*"/gi, "");
  clean = clean.replace(/\son\w+\s*=\s*'[^']*'/gi, "");
  return clean;
}

// Build the unsubscribe footer that gets injected into HTML emails
function buildUnsubFooter(token) {
  const baseURL = "https://luna-marketing.vercel.app";
  const unsubURL = `${baseURL}/unsubscribe?token=${encodeURIComponent(token)}`;
  return `
<div style="margin-top:32px;padding-top:24px;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;color:#64748b;line-height:1.6;text-align:center">
  <p style="margin:0 0 8px">You're receiving this because you subscribed to Travelgenix updates.</p>
  <p style="margin:0"><a href="${unsubURL}" style="color:#0096b7;text-decoration:underline">Unsubscribe</a> &middot; <a href="https://travelgenix.io" style="color:#0096b7;text-decoration:underline">Visit Travelgenix</a></p>
</div>`.trim();
}

// Generate a unique unsubscribe token for this email
function generateUnsubToken() {
  return `unsub_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    const {
      clientId,
      subject,
      previewText,
      bodyHTML,
      bodyPlain,
      audience,
      audienceSegment,
      recipientEmail,
      scheduledSend,
      emailType,
    } = body;

    // Validation
    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!subject || !subject.trim()) return res.status(400).json({ error: "subject required" });
    if ((!bodyHTML || !bodyHTML.trim()) && (!bodyPlain || !bodyPlain.trim())) {
      return res.status(400).json({ error: "bodyHTML or bodyPlain required" });
    }
    if (!audience) return res.status(400).json({ error: "audience required" });
    if (!["Cold", "Nurture", "Client", "Drip"].includes(audience)) {
      return res.status(400).json({ error: "audience must be Cold, Nurture, Client, or Drip" });
    }

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    const actor = client["Business Name"] || "client-portal";
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.connection?.remoteAddress
      || "";

    // Sanitise HTML and inject unsub footer
    const unsubToken = generateUnsubToken();
    let cleanHTML = sanitiseHTML(bodyHTML || "");
    if (cleanHTML) {
      cleanHTML = cleanHTML + buildUnsubFooter(unsubToken);
    }

    // Build the record
    const fields = {
      "Subject": String(subject).slice(0, 200).trim(),
      "Preview Text": String(previewText || "").slice(0, 200).trim(),
      "Body HTML": cleanHTML,
      "Body Plain": String(bodyPlain || "").trim(),
      "Status": "Awaiting Approval",
      "Audience": audience,
      "Audience Segment": String(audienceSegment || "").trim(),
      "Email Type": emailType || "Newsletter",
      "Send Result": "Pending",
      "Unsub URL Token": unsubToken,
    };
    if (recipientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      fields["Recipient Email"] = recipientEmail.trim();
      fields["Recipients Count"] = 1;
    }
    if (scheduledSend) {
      const d = new Date(scheduledSend);
      if (!isNaN(d.getTime()) && d.getTime() > Date.now()) {
        fields["Scheduled Send"] = d.toISOString();
      }
    }

    // Create the record
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}`;
    const created = await airtableFetch(url, {
      method: "POST",
      body: JSON.stringify({
        records: [{ fields }],
        typecast: true,
      }),
    });

    const emailId = created.records[0].id;

    // Audit log
    await writeAuditLog({
      actor,
      action: "edit",  // No "compose" action enum, log as edit (creation = first edit)
      subjectId: emailId,
      details: {
        type: "compose",
        subject: fields["Subject"],
        audience: fields["Audience"],
        recipient: fields["Recipient Email"] || fields["Audience Segment"] || "(audience-based)",
      },
      ip,
    });

    return res.status(200).json({
      success: true,
      emailId,
      status: fields["Status"],
      subject: fields["Subject"],
      audience: fields["Audience"],
    });
  } catch (e) {
    console.error("Email compose error:", e);
    return res.status(500).json({ error: e.message });
  }
};
