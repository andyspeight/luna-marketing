// api/email-send.js
// Sends approved emails via Brevo
//
// Two modes:
//   - Newsletter / One-off broadcast: creates a Brevo campaign, sends to a list
//   - Drip / Behavioural / Specific: transactional send to a specific recipient or small list
//
// Body params:
//   - emailQueueId: Airtable record ID of the email to send (required)
//   - sendNow: boolean, default true. If false, schedules for the Scheduled Send time.
//
// Auth: Bearer CRON_SECRET (called from approval UI or cron)

const {
  sendTransactional,
  createCampaign,
  sendCampaignNow,
  upsertContact,
  listLists,
} = require("./brevo-helper.js");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const EMAIL_QUEUE_TABLE = "Email Queue";
const CRON_SECRET = process.env.CRON_SECRET;

// Map Audience Segment → Brevo list ID
// Set these as env vars to avoid hardcoding numeric IDs that may differ per Brevo account
const LIST_IDS = {
  "Travelgenix Clients": parseInt(process.env.BREVO_LIST_TG_CLIENTS || "0", 10),
  "Inbound Leads": parseInt(process.env.BREVO_LIST_INBOUND || "0", 10),
  "Demo Requested": parseInt(process.env.BREVO_LIST_DEMO_REQUESTED || "0", 10),
};

// ── Airtable ──

async function airtableGet(table, id) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${id}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
  );
  if (!r.ok) throw new Error(`Airtable get failed: ${r.status}`);
  return r.json();
}

async function airtablePatch(table, id, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${AIRTABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields, typecast: true }),
    }
  );
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable patch failed: ${r.status} ${err}`);
  }
  return r.json();
}

// ── Send logic ──

async function sendCampaign(emailRecord) {
  const f = emailRecord.fields;
  const segment = f["Audience Segment"];
  const listId = LIST_IDS[segment];

  if (!listId) {
    throw new Error(`No Brevo list ID configured for segment "${segment}". Set BREVO_LIST_${segment.toUpperCase().replace(/\s+/g, "_")} env var.`);
  }

  // 1. Create the Brevo campaign
  const campaign = await createCampaign({
    name: `Luna ${f["Email Type"] || "Email"} ${new Date().toISOString().split("T")[0]} - ${(f["Subject"] || "").slice(0, 40)}`,
    subject: f["Subject"] || "",
    htmlContent: f["Body HTML"] || "",
    previewText: f["Preview Text"] || "",
    listIds: [listId],
  });

  console.log(`Brevo campaign created: ${campaign.id}`);

  // 2. Trigger send
  await sendCampaignNow(campaign.id);

  return {
    method: "campaign",
    brevoCampaignId: campaign.id,
    listId,
  };
}

async function sendDrip(emailRecord, recipientEmail, recipientName) {
  const f = emailRecord.fields;

  if (!recipientEmail) {
    throw new Error("Drip send requires recipient email (pass recipientEmail in body)");
  }

  const result = await sendTransactional({
    to: [{ email: recipientEmail, name: recipientName || "" }],
    subject: f["Subject"] || "",
    htmlContent: f["Body HTML"] || "",
    textContent: f["Body Plain"] || "",
    tags: ["luna-marketing", f["Email Type"] || "drip"],
  });

  return {
    method: "transactional",
    brevoMessageId: result.messageId,
    recipient: recipientEmail,
  };
}

// ── Main handler ──

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const body = req.body || {};
    const emailQueueId = body.emailQueueId;
    if (!emailQueueId) return res.status(400).json({ error: "emailQueueId required" });

    // 1. Load the email
    const record = await airtableGet(EMAIL_QUEUE_TABLE, emailQueueId);
    const f = record.fields;

    // Safety: only send Approved emails
    if (f["Status"] !== "Approved") {
      return res.status(400).json({
        error: `Email status is "${f["Status"]}" — must be "Approved" to send`,
      });
    }

    // 2. Decide send method based on Email Type
    const emailType = f["Email Type"] || "";
    const isCampaign = emailType === "Newsletter" || emailType === "One-off Broadcast";

    let sendResult;
    if (isCampaign) {
      sendResult = await sendCampaign(record);
    } else {
      // Drip / behavioural — caller must provide recipient
      sendResult = await sendDrip(record, body.recipientEmail, body.recipientName);
    }

    // 3. Update the Email Queue record with send status
    await airtablePatch(EMAIL_QUEUE_TABLE, emailQueueId, {
      "Status": "Sent",
      "Sent At": new Date().toISOString(),
      "Brevo Campaign ID": String(sendResult.brevoCampaignId || sendResult.brevoMessageId || ""),
    });

    return res.status(200).json({
      success: true,
      emailQueueId,
      ...sendResult,
    });
  } catch (e) {
    console.error("Email send failed:", e);

    // Try to mark the record as Failed so we don't get stuck
    if (req.body && req.body.emailQueueId) {
      try {
        await airtablePatch(EMAIL_QUEUE_TABLE, req.body.emailQueueId, {
          "Status": "Failed",
          "Rejection Reason": `Send error: ${e.message}`.slice(0, 500),
        });
      } catch (e2) {
        // Best effort
      }
    }

    return res.status(500).json({ error: e.message });
  }
};
