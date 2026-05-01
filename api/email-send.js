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
//   - recipientEmail (optional): for transactional sends
//
// Auth: Bearer CRON_SECRET (called from approval UI or cron)

const {
  sendTransactional,
  createCampaign,
  sendCampaignNow,
} = require("./brevo-helper.js");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const EMAIL_QUEUE_TABLE = "Email Queue";
const CRON_SECRET = process.env.CRON_SECRET;

// Resolve a Brevo list ID for a given Audience Segment.
// Accepts multiple env var naming conventions for safety:
//   - BREVO_LIST_TG_CLIENTS (short)
//   - BREVO_LIST_TRAVELGENIX_CLIENTS (full segment name expanded)
// Returns the first non-empty value found.
function resolveListId(segment) {
  const envCandidates = [];
  
  if (segment === "Travelgenix Clients") {
    envCandidates.push("BREVO_LIST_TG_CLIENTS", "BREVO_LIST_TRAVELGENIX_CLIENTS");
  } else if (segment === "Inbound Leads") {
    envCandidates.push("BREVO_LIST_INBOUND", "BREVO_LIST_INBOUND_LEADS");
  } else if (segment === "Demo Requested") {
    envCandidates.push("BREVO_LIST_DEMO_REQUESTED");
  }
  
  // Always also try the auto-derived name (uppercase, underscored)
  const auto = "BREVO_LIST_" + segment.toUpperCase().replace(/\s+/g, "_");
  if (!envCandidates.includes(auto)) envCandidates.push(auto);
  
  for (const name of envCandidates) {
    const value = process.env[name];
    if (value && parseInt(value, 10) > 0) {
      return { listId: parseInt(value, 10), envVar: name };
    }
  }
  return { listId: 0, envVar: null, attempted: envCandidates };
}

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
  const resolved = resolveListId(segment);

  if (!resolved.listId) {
    throw new Error(
      `No Brevo list ID configured for segment "${segment}". Tried env vars: ${(resolved.attempted || []).join(", ")}.`
    );
  }

  const campaign = await createCampaign({
    name: `Luna ${f["Email Type"] || "Email"} ${new Date().toISOString().split("T")[0]} - ${(f["Subject"] || "").slice(0, 40)}`,
    subject: f["Subject"] || "",
    htmlContent: f["Body HTML"] || "",
    previewText: f["Preview Text"] || "",
    listIds: [resolved.listId],
  });

  console.log(`Brevo campaign created: ${campaign.id} (list ${resolved.listId} via ${resolved.envVar})`);

  await sendCampaignNow(campaign.id);

  return {
    method: "campaign",
    brevoCampaignId: campaign.id,
    listId: resolved.listId,
    envVarUsed: resolved.envVar,
  };
}

async function sendDrip(emailRecord, recipientEmail, recipientName) {
  const f = emailRecord.fields;

  // Prefer recipientEmail param, fall back to Recipient Email field on the record (added in Day 5 patch)
  const email = recipientEmail || f["Recipient Email"];
  if (!email) {
    throw new Error("Drip send requires recipient email (pass recipientEmail in body or set Recipient Email field on the record)");
  }
  const name = recipientName || f["Recipient Name"] || "";

  const result = await sendTransactional({
    to: [{ email, name }],
    subject: f["Subject"] || "",
    htmlContent: f["Body HTML"] || "",
    textContent: f["Body Plain"] || "",
    tags: ["luna-marketing", f["Email Type"] || "drip"],
  });

  return {
    method: "transactional",
    brevoMessageId: result.messageId,
    recipient: email,
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

    const record = await airtableGet(EMAIL_QUEUE_TABLE, emailQueueId);
    const f = record.fields;

    if (f["Status"] !== "Approved") {
      return res.status(400).json({
        error: `Email status is "${f["Status"]}" — must be "Approved" to send`,
      });
    }

    const emailType = f["Email Type"] || "";
    const isCampaign = emailType === "Newsletter" || emailType === "One-off Broadcast";

    let sendResult;
    if (isCampaign) {
      sendResult = await sendCampaign(record);
    } else {
      sendResult = await sendDrip(record, body.recipientEmail, body.recipientName);
    }

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
