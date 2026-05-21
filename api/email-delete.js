// api/email-delete.js
//
// Hard-deletes an email record from the Email Queue. Used to clean up
// duplicates left over from the edit-as-duplicate flow (and any other
// drafts the user wants gone).
//
// POST /api/email-delete
// Body: { clientId, emailId }
//
// Returns: { success: true, generatedAt }
//
// Security guardrails:
//   1. Validate clientId format + authenticate as b2b-saas client
//   2. Validate emailId format
//   3. Verify the email belongs to this client (linked Client field
//      contains the requesting clientId). Without this, any authenticated
//      client could delete any email.
//   4. Block deletion of Sent emails (compliance — once sent, the
//      record is part of an audit trail and must not be hard-deleted)
//   5. Audit-log the delete action BEFORE deletion, so the trail
//      survives the record removal.

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
      ...(options.headers || {}),
    },
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

async function writeAuditLog(emailRec, client) {
  // Write the audit entry BEFORE deletion so it survives. Use a single
  // POST request to the Audit Log table. The Subject ID stays linked
  // to the original email ID even after the email itself is deleted —
  // it's a free-text field, not a linked-record reference.
  const f = emailRec.fields || {};
  const detailLines = [
    `Subject: ${f["Subject"] || "(no subject)"}`,
    `Status at delete: ${f["Status"] || "(unknown)"}`,
    `Audience: ${f["Audience"] || "(none)"}`,
    f["Sent At"] ? `Sent at: ${f["Sent At"]}` : null,
  ].filter(Boolean).join("\n");

  const eventId = `del_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AUDIT_LOG_TABLE)}`;
  try {
    await airtableFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        records: [
          {
            fields: {
              "Event ID": eventId,
              "Timestamp": new Date().toISOString(),
              "Actor": client["Business Name"] || client.id,
              "Action": "delete",
              "Subject Type": "email",
              "Subject ID": emailRec.id,
              "Details": detailLines,
            },
          },
        ],
        typecast: true,
      }),
    });
  } catch (e) {
    // If audit log write fails, abort the delete. Better to leave the
    // record than to delete it without trail.
    throw new Error("Audit log write failed: " + e.message);
  }
}

async function deleteEmail(emailId) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(EMAIL_QUEUE_TABLE)}/${emailId}`;
  await airtableFetch(url, { method: "DELETE" });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { clientId, emailId } = req.body || {};

    if (!clientId) {
      return res.status(400).json({ error: "clientId is required" });
    }
    if (!emailId) {
      return res.status(400).json({ error: "emailId is required" });
    }

    const client = await authenticateClient(clientId);
    if (!client) {
      return res.status(403).json({ error: "Email suite not available for this client" });
    }

    const emailRec = await getEmail(emailId);
    if (!emailRec) {
      return res.status(404).json({ error: "Email not found" });
    }

    // Ownership check — the Client field on the email must include the
    // requesting clientId. Field shape: array of {id, name} objects when
    // returned by GET, single record link.
    const linkedClients = emailRec.fields["Client"] || [];
    const ownerIds = Array.isArray(linkedClients)
      ? linkedClients.map(c => (typeof c === "string" ? c : c.id)).filter(Boolean)
      : [];
    if (!ownerIds.includes(clientId)) {
      // Either the email belongs to another client, or it's an old
      // record with no Client link. Block deletion in either case —
      // the un-linked old records need a backfill before they can be
      // managed via this endpoint.
      return res.status(403).json({ error: "You do not own this email" });
    }

    // Block deletion of Sent emails — compliance audit trail.
    const status = emailRec.fields["Status"] || "";
    if (status === "Sent") {
      return res.status(400).json({
        error: "Cannot delete a Sent email. Sent emails are part of the compliance audit trail.",
      });
    }

    // Write audit log BEFORE the delete so we keep a trail.
    await writeAuditLog(emailRec, client);

    // Delete the record.
    await deleteEmail(emailId);

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Email delete error:", e);
    return res.status(500).json({ error: e.message });
  }
};
