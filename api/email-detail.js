// api/email-detail.js
// Day A — Email Suite v1
//
// Returns full details for a single email plus its audit trail.
//
// GET /api/email-detail?clientId=recXXX&emailId=recYYY
//
// Returns: { success, email: {...full fields...}, auditTrail: [...] }

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const CLIENTS_TABLE = "Clients";
const EMAIL_QUEUE_TABLE = "Email Queue";
const AUDIT_LOG_TABLE = "Audit Log";

async function airtableFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_KEY}` },
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Airtable error: ${r.status} ${err}`);
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
  if (!emailId || !/^rec[A-Za-z0-9]{14}$/.test(emailId)) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  try {
    return await airtableFetch(url);
  } catch {
    return null;
  }
}

async function getAuditTrail(emailId) {
  // Pull audit log entries where Subject ID matches this email
  const formula = encodeURIComponent(
    `AND({Subject Type}='email', {Subject ID}='${emailId}')`
  );
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}?filterByFormula=${formula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=50`;
  try {
    const data = await airtableFetch(url);
    return (data.records || []).map(r => ({
      id: r.id,
      timestamp: r.fields["Timestamp"] || null,
      actor: r.fields["Actor"] || "",
      action: r.fields["Action"] || "",
      details: r.fields["Details"] || "",
    }));
  } catch {
    return [];
  }
}

function shapeEmail(rec) {
  const f = rec.fields || {};
  return {
    id: rec.id,
    subject: f["Subject"] || "(no subject)",
    previewText: f["Preview Text"] || "",
    bodyHTML: f["Body HTML"] || "",
    bodyPlain: f["Body Plain"] || "",
    status: f["Status"] || "Draft",
    audience: f["Audience"] || "",
    audienceSegment: f["Audience Segment"] || "",
    emailType: f["Email Type"] || "",
    scheduledSend: f["Scheduled Send"] || null,
    sentAt: f["Sent At"] || null,
    consentVerifiedAt: f["Consent Verified At"] || null,
    sendResult: f["Send Result"] || null,
    brevoMessageId: f["Brevo Message ID"] || "",
    brevoCampaignId: f["Brevo Campaign ID"] || "",
    recipientEmail: f["Recipient Email"] || "",
    recipientName: f["Recipient Name"] || "",
    recipientsCount: f["Recipients Count"] || 0,
    opens: f["Opens"] || 0,
    clicks: f["Clicks"] || 0,
    openCount: f["Open Count"] || 0,
    clickCount: f["Click Count"] || 0,
    lastOpened: f["Last Opened"] || null,
    lastClicked: f["Last Clicked"] || null,
    qualityIssues: f["Quality Issues"] || null,
    rejectionReason: f["Rejection Reason"] || "",
    unsubURLToken: f["Unsub URL Token"] || "",
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    const clientId = req.query && req.query.clientId;
    const emailId = req.query && req.query.emailId;

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    if (!emailId) {
      return res.status(400).json({ error: "emailId is required" });
    }

    const [emailRec, auditTrail] = await Promise.all([
      getEmail(emailId),
      getAuditTrail(emailId),
    ]);

    if (!emailRec) {
      return res.status(404).json({ error: "Email not found" });
    }

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      email: shapeEmail(emailRec),
      auditTrail,
    });
  } catch (e) {
    console.error("Email detail error:", e);
    return res.status(500).json({ error: e.message });
  }
};
