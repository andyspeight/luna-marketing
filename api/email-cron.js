// api/email-cron.js
// Hourly cron — finds approved emails ready to send and fires them
// Runs via Vercel cron at minute 5 of every hour
//
// Picks up Email Queue records where:
//   - Status = "Approved"
//   - Scheduled Send <= NOW (or Scheduled Send is empty, meaning send ASAP)
//
// For each, calls Brevo to send. Updates record status to Sent or Failed.

const { sendTransactional, createCampaign, sendCampaignNow } = require("./brevo-helper.js");

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const EMAIL_QUEUE_TABLE = "Email Queue";
const CRON_SECRET = process.env.CRON_SECRET;

const LIST_IDS = {
  "Travelgenix Clients": parseInt(process.env.BREVO_LIST_TG_CLIENTS || "0", 10),
  "Inbound Leads": parseInt(process.env.BREVO_LIST_INBOUND || "0", 10),
  "Demo Requested": parseInt(process.env.BREVO_LIST_DEMO_REQUESTED || "0", 10),
};

// ── Airtable ──

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
  // Find approved emails whose Scheduled Send is in the past (or null)
  const formula = encodeURIComponent(
    `AND({Status}='Approved', OR({Scheduled Send}='', IS_BEFORE({Scheduled Send}, NOW())))`
  );
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}?filterByFormula=${formula}&maxRecords=20`;
  const data = await airtableFetch(url);
  return data.records || [];
}

// ── Send ──

async function sendOne(record) {
  const f = record.fields;
  const segment = f["Audience Segment"];
  const emailType = f["Email Type"] || "";
  const isCampaign = emailType === "Newsletter" || emailType === "One-off Broadcast";

  if (isCampaign) {
    const listId = LIST_IDS[segment];
    if (!listId) {
      throw new Error(`No Brevo list ID configured for segment "${segment}"`);
    }
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
    // Drip — but for drip emails we don't have a recipient on the record yet
    // (this version of the system stores the recipient implicitly via the welcome flow).
    // For Day 4 MVP, drips are scheduled per-recipient as separate Email Queue rows.
    // The recipient needs to be retrievable. Since we don't have a "Recipient Email" field,
    // we extract it from a tag in the body. Future improvement: add field.
    
    // For now: extract first email-like address from Body Plain (which we set on creation)
    const bodyPlain = f["Body Plain"] || "";
    const emailMatch = bodyPlain.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (!emailMatch) {
      throw new Error("Drip email has no recoverable recipient. Add a 'Recipient Email' field to Email Queue table for v2.");
    }
    // ABORT — this is a known v1 limitation. Recommend you add Recipient Email field
    // and extend email-drip.js to populate it.
    throw new Error("Drip cron send needs Recipient Email field. See limitations note.");
  }
}

// ── Main handler ──

module.exports = async (req, res) => {
  // Cron auth
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
      // Rate limit: 1s between sends
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
