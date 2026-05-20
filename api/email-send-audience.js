// api/email-send-audience.js
// Email Suite — Stage 2 (20 May 2026)
//
// Sends an Approved email to one or more Brevo lists as a campaign.
// This is the irreversible "real send" — once Brevo accepts the campaign
// and we hit /sendNow, the email is on its way to every subscriber.
//
// Differences from /api/email-send-now:
//   - Multi-list (Brevo dedupes across lists automatically)
//   - Uses Brevo CAMPAIGN API (not transactional) — better deliverability,
//     handles unsubscribes properly, shows up in Brevo UI as a campaign
//   - Requires Status = Approved (no exceptions, no test-mode override)
//
// POST /api/email-send-audience
// Body: { clientId, emailId, listIds: number[] }
// Returns: { success, brevoCampaignId, recipientsCount, listsTargeted, sentAt }

const { createCampaign, sendCampaignNow } = require("./brevo-helper.js");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || "Travelgenix";

// Fallback used when client record has no valid Reply To Email
const SENDER_EMAIL_FALLBACK = "andy.speight@agendas.group";

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

async function getEmail(emailId) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  return airtableFetch(url);
}

async function patchEmail(emailId, fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  return airtableFetch(url, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  });
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

// Resolve sender from client record. Same pattern as email-send-now.
// Falls back to hardcoded constant if Reply To Email missing/invalid.
function resolveSender(client) {
  const replyTo = (client && client["Reply To Email"]) || "";
  const senderName = (client && (client["Sender Name"] || client["Business Name"])) || BREVO_SENDER_NAME;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) ? replyTo : SENDER_EMAIL_FALLBACK;
  return { email, name: senderName };
}

// Brevo campaign API requires the {{ unsubscribe }} merge tag in the HTML or
// it will reject the campaign at create time. Our email-compose.js injects a
// custom unsubscribe link but that's not the Brevo tag — Brevo specifically
// looks for its own merge syntax. This function ensures the tag is present.
//
// Strategy:
//   1. If {{ unsubscribe }} (with or without spaces) is already in the HTML, leave it alone
//   2. Otherwise, append a small Brevo-compliant footer with the tag right
//      before </body> if present, or at the end of the HTML
//
// The visual unsubscribe link injected by email-compose.js stays in place —
// this is purely belt-and-braces to satisfy Brevo's CAN-SPAM check.
function ensureBrevoUnsubTag(html) {
  if (!html || typeof html !== "string") return html;
  // Brevo accepts {{ unsubscribe }}, {{unsubscribe}}, {{ unsubscribe_url }}, etc
  if (/\{\{\s*unsubscribe(_url)?\s*\}\}/i.test(html)) return html;

  // Inject a minimal compliance block. Inline-styled, neutral, sits above
  // any existing footer. The visible link wraps Brevo's merge tag.
  const compliance = `
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11px;color:#94a3b8;line-height:1.5;text-align:center">
  <p style="margin:0">If you no longer wish to receive these emails, <a href="{{ unsubscribe }}" style="color:#0096b7;text-decoration:underline">unsubscribe here</a>.</p>
</div>`.trim();

  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${compliance}\n</body>`);
  }
  return html + "\n" + compliance;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    if (!BREVO_API_KEY) {
      return res.status(503).json({ error: "Brevo API key not configured" });
    }

    const body = req.body || {};
    const { clientId, emailId, listIds } = body;

    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!emailId) return res.status(400).json({ error: "emailId required" });
    if (!Array.isArray(listIds) || listIds.length === 0) {
      return res.status(400).json({ error: "listIds must be a non-empty array of Brevo list IDs" });
    }

    // Coerce to integers, drop anything non-numeric, dedupe
    const cleanListIds = [...new Set(
      listIds
        .map(n => parseInt(n, 10))
        .filter(n => Number.isInteger(n) && n > 0)
    )];
    if (cleanListIds.length === 0) {
      return res.status(400).json({ error: "No valid Brevo list IDs provided" });
    }

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    const actor = client["Business Name"] || "client-portal";
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.connection?.remoteAddress
      || "";

    // Load the email
    const emailRec = await getEmail(emailId);
    if (!emailRec) return res.status(404).json({ error: "Email not found" });
    const f = emailRec.fields;

    // Defensive checks
    if (f["Status"] !== "Approved") {
      return res.status(400).json({
        error: `Cannot send audience email with status "${f["Status"]}". Must be "Approved".`,
      });
    }
    if (!f["Subject"]) {
      return res.status(400).json({ error: "Email has no subject" });
    }
    if (!f["Body HTML"]) {
      return res.status(400).json({ error: "Email has no body HTML" });
    }

    const sender = resolveSender(client);
    const htmlWithUnsub = ensureBrevoUnsubTag(f["Body HTML"]);

    // Campaign name pattern matches the existing cron-driven email-send.js
    const campaignName = `Luna ${f["Email Type"] || "Email"} ${new Date().toISOString().split("T")[0]} - ${(f["Subject"] || "").slice(0, 40)}`;

    console.log("[EMAIL-AUDIENCE] creating campaign:", campaignName, "lists:", cleanListIds, "sender:", sender.email);

    // Create the campaign on Brevo
    let campaign;
    try {
      campaign = await createCampaign({
        name: campaignName,
        subject: f["Subject"],
        htmlContent: htmlWithUnsub,
        previewText: f["Preview Text"] || "",
        listIds: cleanListIds,
        sender: { email: sender.email, name: sender.name },
      });
    } catch (createErr) {
      console.error("[EMAIL-AUDIENCE] campaign create failed:", createErr.message);
      await patchEmail(emailId, {
        "Status": "Failed",
        "Send Result": "Failed",
      });
      await writeAuditLog({
        actor,
        action: "send",
        subjectId: emailId,
        details: {
          result: "failed",
          stage: "create-campaign",
          error: createErr.message,
          listIds: cleanListIds,
        },
        ip,
      });
      return res.status(502).json({
        error: "Brevo rejected the campaign at create time",
        detail: createErr.message,
      });
    }

    const campaignId = campaign && campaign.id;
    if (!campaignId) {
      console.error("[EMAIL-AUDIENCE] campaign returned no id:", campaign);
      await patchEmail(emailId, { "Status": "Failed", "Send Result": "Failed" });
      return res.status(502).json({ error: "Brevo did not return a campaign ID" });
    }

    // Send the campaign immediately
    try {
      await sendCampaignNow(campaignId);
    } catch (sendErr) {
      console.error("[EMAIL-AUDIENCE] sendNow failed:", sendErr.message);
      await patchEmail(emailId, {
        "Status": "Failed",
        "Send Result": "Failed",
        "Brevo Campaign ID": String(campaignId),
      });
      await writeAuditLog({
        actor,
        action: "send",
        subjectId: emailId,
        details: {
          result: "failed",
          stage: "send-now",
          error: sendErr.message,
          campaignId,
          listIds: cleanListIds,
        },
        ip,
      });
      return res.status(502).json({
        error: "Campaign created but send failed",
        detail: sendErr.message,
        brevoCampaignId: campaignId,
      });
    }

    // Recipients count — we received the sum of subscriber counts from the
    // client side via the audiences listing. The client passes them through
    // as `recipientsCount` if it knows; otherwise leave as-is. Brevo dedupes
    // across lists so the actual delivered count may be lower; that's why
    // we store the gross figure as a best-effort estimate.
    const recipientsCount = parseInt(body.recipientsCount, 10) || 0;

    const sentAt = new Date().toISOString();
    await patchEmail(emailId, {
      "Status": "Sent",
      "Send Result": "Sent",
      "Sent At": sentAt,
      "Brevo Campaign ID": String(campaignId),
      ...(recipientsCount > 0 ? { "Recipients Count": recipientsCount } : {}),
    });

    await writeAuditLog({
      actor,
      action: "send",
      subjectId: emailId,
      details: {
        result: "sent",
        method: "campaign-audience",
        campaignId,
        campaignName,
        listIds: cleanListIds,
        recipientsCount,
        sender: sender.email,
      },
      ip,
    });

    return res.status(200).json({
      success: true,
      emailId,
      brevoCampaignId: campaignId,
      listsTargeted: cleanListIds,
      recipientsCount,
      sentAt,
    });
  } catch (e) {
    console.error("[EMAIL-AUDIENCE] unhandled error:", e);
    return res.status(500).json({ error: e.message });
  }
};
