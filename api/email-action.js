// api/email-action.js
// Day A — Email Suite v1
//
// Mutating actions on emails. Every action writes to Audit Log.
//
// POST /api/email-action
// Body: {
//   clientId,    // required
//   emailId,     // required
//   action,      // "approve" | "reject" | "edit" | "cancel"
//   ...action-specific fields
// }
//
// Actions:
//   approve      — Status -> "Approved", sets Consent Verified At = now
//   reject       — Status -> "Cancelled", saves rejectionReason
//   edit         — Updates subject, previewText, bodyHTML, bodyPlain, scheduledSend
//   cancel       — Status -> "Cancelled" (use when an Approved email needs pulling back)

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";

const CLIENTS_TABLE = "Clients";
const EMAIL_QUEUE_TABLE = "Email Queue";
const AUDIT_LOG_TABLE = "Audit Log";

// ── Helpers ──

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
  if (!emailId || !/^rec[A-Za-z0-9]{14}$/.test(emailId)) return null;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  try {
    return await airtableFetch(url);
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
    // Audit log failures shouldn't block the main action — just log
    console.error("Audit log write failed:", e.message);
  }
}

// ── Action handlers ──

async function approve(emailId, actor, ip) {
  // Defensive: only allow approve from Awaiting Approval, Draft, or Quality Hold
  const current = await getEmail(emailId);
  if (!current) throw new Error("Email not found");
  const status = current.fields["Status"];
  if (!["Awaiting Approval", "Draft", "Quality Hold"].includes(status)) {
    throw new Error(`Cannot approve email in status: ${status}`);
  }

  await patchEmail(emailId, {
    "Status": "Approved",
    "Consent Verified At": new Date().toISOString(),
  });

  await writeAuditLog({
    actor,
    action: "approve",
    subjectId: emailId,
    details: { previousStatus: status, subject: current.fields["Subject"] },
    ip,
  });

  return { status: "Approved" };
}

async function reject(emailId, actor, ip, rejectionReason) {
  const current = await getEmail(emailId);
  if (!current) throw new Error("Email not found");

  const updates = { "Status": "Cancelled" };
  if (rejectionReason) {
    updates["Rejection Reason"] = String(rejectionReason).slice(0, 5000);
  }

  await patchEmail(emailId, updates);

  await writeAuditLog({
    actor,
    action: "reject",
    subjectId: emailId,
    details: {
      previousStatus: current.fields["Status"],
      subject: current.fields["Subject"],
      reason: rejectionReason || "(no reason given)",
    },
    ip,
  });

  return { status: "Cancelled" };
}

async function edit(emailId, actor, ip, edits) {
  const current = await getEmail(emailId);
  if (!current) throw new Error("Email not found");

  // Don't allow edits to Sent emails
  if (current.fields["Status"] === "Sent") {
    throw new Error("Cannot edit a Sent email");
  }

  // Whitelist of editable fields
  const updates = {};
  if (typeof edits.subject === "string") updates["Subject"] = edits.subject.slice(0, 200);
  if (typeof edits.previewText === "string") updates["Preview Text"] = edits.previewText.slice(0, 200);
  if (typeof edits.bodyHTML === "string") updates["Body HTML"] = edits.bodyHTML;
  if (typeof edits.bodyPlain === "string") updates["Body Plain"] = edits.bodyPlain;
  if (typeof edits.scheduledSend === "string") updates["Scheduled Send"] = edits.scheduledSend;
  if (typeof edits.audience === "string") updates["Audience"] = edits.audience;

  if (Object.keys(updates).length === 0) {
    throw new Error("No editable fields provided");
  }

  await patchEmail(emailId, updates);

  await writeAuditLog({
    actor,
    action: "edit",
    subjectId: emailId,
    details: {
      fieldsChanged: Object.keys(updates),
      subject: updates["Subject"] || current.fields["Subject"],
    },
    ip,
  });

  return { fieldsChanged: Object.keys(updates) };
}

async function cancel(emailId, actor, ip, reason) {
  const current = await getEmail(emailId);
  if (!current) throw new Error("Email not found");
  if (current.fields["Status"] === "Sent") {
    throw new Error("Cannot cancel a Sent email");
  }

  await patchEmail(emailId, { "Status": "Cancelled" });
  await writeAuditLog({
    actor,
    action: "reject",  // No "cancel" enum value, log as reject
    subjectId: emailId,
    details: {
      previousStatus: current.fields["Status"],
      reason: reason || "(cancelled by user)",
    },
    ip,
  });

  return { status: "Cancelled" };
}

// ── Main handler ──

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    const { clientId, emailId, action } = body;

    if (!clientId) return res.status(400).json({ error: "clientId required" });
    if (!emailId) return res.status(400).json({ error: "emailId required" });
    if (!action) return res.status(400).json({ error: "action required" });

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    const actor = client["Business Name"] || "client-portal";
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.connection?.remoteAddress
      || "";

    let result;
    switch (action) {
      case "approve":
        result = await approve(emailId, actor, ip);
        break;
      case "reject":
        result = await reject(emailId, actor, ip, body.rejectionReason);
        break;
      case "edit":
        result = await edit(emailId, actor, ip, body.edits || {});
        break;
      case "cancel":
        result = await cancel(emailId, actor, ip, body.reason);
        break;
      default:
        return res.status(400).json({
          error: `Unknown action: ${action}`,
          validActions: ["approve", "reject", "edit", "cancel"],
        });
    }

    return res.status(200).json({
      success: true,
      action,
      emailId,
      ...result,
    });
  } catch (e) {
    console.error("Email action error:", e);
    return res.status(500).json({ error: e.message });
  }
};
