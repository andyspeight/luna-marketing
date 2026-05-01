// api/email-cron.js
// Hourly cron — finds approved emails ready to send and fires them
// Day 5 patch: drip sends now use Recipient Email field on the record
//
// Picks up Email Queue records where:
//   - Status = "Approved"
//   - Scheduled Send <= NOW (or Scheduled Send is empty, meaning send ASAP)

const { sendTransactional, createCampaign, sendCampaignNow } = require("./brevo-helper.js");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const EMAIL_QUEUE_TABLE = "Email Queue";
const CRON_SECRET = process.env.CRON_SECRET;

// Resolve list ID with fallback naming (matches email-send.js)
function resolveListId(segment) {
  const candidates = [];
  if (segment === "Travelgenix Clients") candidates.push("BREVO_LIST_TG_CLIENTS", "BREVO_LIST_TRAVELGENIX_CLIENTS");
  else if (segment === "Inbound Leads") candidates.push("BREVO_LIST_INBOUND", "BREVO_LIST_INBOUND_LEADS");
  else if (segment === "Demo Requested") candidates.push("BREVO_LIST_DEMO_REQUESTED");
  candidates.push("BREVO_LIST_" + segment.toUpperCase().replace(/\s+/g, "_"));
  for (const name of candidates) {
    const v = process.env[name];
    if (v && parseInt(v, 10) > 0) return parseInt(v, 10);
  }
  return 0;
}

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) throw new Error(`Airtable error: ${r.status}`);
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

async function getDueEmails() {
  const formula = encodeURIComponent(
    `AND({Status}='Approved', OR({Scheduled Send}='', IS_BEFORE({Scheduled Send}, NOW())))`
  );
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}?filterByFormula=${formula}&maxRecords=20`;
  const data = await airtableFetch(url);
  return data.records || [];
}

async function sendOne(record) {
  const f = record.fields;
  const segment = f["Audience Segment"];
  const emailType = f["Email Type"] || "";
  const isCampaign = emailType === "Newsletter" || emailType === "One-off Broadcast";

  if (isCampaign) {
    const listId = resolveListId(segment);
    if (!listId) throw new Error(`No Brevo list ID for segment "${segment}"`);
    
    const campaign = await createCampaign({
      name: `Luna ${emailType} ${new Date().toISOString().split("T")[0]} - ${(f["Subject"] || "").slice(0, 40)}`,
      subject: f["Subject"] || "",
      htmlContent: f["Body HTML"] || "",
      previewText: f["Preview Text"] || "",
      listIds: [listId],
    });
    await sendCampaignNow(campaign.id);
    return { method: "campaign", brevoId: campaign.id };
  } else {
    // Drip / behavioural — use Recipient Email field
    const recipientEmail = f["Recipient Email"];
    if (!recipientEmail) {
      throw new Error("Drip email has no Recipient Email field set");
    }
    const recipientName = f["Recipient Name"] || "";
    
    const result = await sendTransactional({
      to: [{ email: recipientEmail, name: recipientName }],
      subject: f["Subject"] || "",
      htmlContent: f["Body HTML"] || "",
      textContent: f["Body Plain"] || "",
      tags: ["luna-marketing", emailType],
    });
    return { method: "transactional", brevoId: result.messageId, recipient: recipientEmail };
  }
}

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const due = await getDueEmails();
    console.log(`Email cron: ${due.length} emails due to send`);

    const results = [];
    for (const record of due) {
      try {
        const result = await sendOne(record);
        await airtablePatch(EMAIL_QUEUE_TABLE, record.id, {
          "Status": "Sent",
          "Sent At": new Date().toISOString(),
          "Brevo Campaign ID": String(result.brevoId || ""),
        });
        results.push({ id: record.id, status: "sent", ...result });
      } catch (e) {
        console.error(`Send failed for ${record.id}:`, e.message);
        await airtablePatch(EMAIL_QUEUE_TABLE, record.id, {
          "Status": "Failed",
          "Rejection Reason": `Cron send error: ${e.message}`.slice(0, 500),
        });
        results.push({ id: record.id, status: "failed", error: e.message });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    return res.status(200).json({
      success: true,
      processed: results.length,
      sent: results.filter((r) => r.status === "sent").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
    });
  } catch (e) {
    console.error("Email cron failed:", e);
    return res.status(500).json({ error: e.message });
  }
};
