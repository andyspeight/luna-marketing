// api/dashboard-action.js
// Handles user actions from the client portal Dashboard tab.
//
// POST /api/dashboard-action
// Body: { clientId, recordId, action, table?, value? }
//
// Actions:
//   - 'approve': flip Post Queue Status to 'Approved'
//   - 'reject': flip Post Queue Status to 'Rejected'
//   - 'dismiss': flip Post Queue Status to 'Replaced' (effectively dismissed)
//   - 'engage_lead': flip Hot Leads Status to 'Drafted' (manually engaged)
//   - 'dismiss_lead': flip Hot Leads Status to 'Ignored'
//   - 'release_hold': flip Quality Hold post to 'Awaiting Approval' (manual override after review)
//
// No auth required for the same reason as dashboard-data — clientId scoped.

const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const POST_QUEUE_TABLE = "tblbhyiuULvedva0K";
const HOT_LEADS_TABLE = "tblIVV8MVyji3UmUV";

async function airtablePatch(table, recordId, fields) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${recordId}`,
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

async function airtableGet(table, recordId) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${recordId}`,
    { headers: { Authorization: `Bearer ${AIRTABLE_KEY}` } }
  );
  if (!r.ok) throw new Error(`Airtable get failed: ${r.status}`);
  return r.json();
}

// Verify the record actually belongs to the given clientId before mutating it.
// Cheap safety check to stop one client modifying another's records.
async function verifyClientOwnership(table, recordId, clientId) {
  const record = await airtableGet(table, recordId);
  const fields = record.fields || {};
  const clientLink = fields["Client"] || [];
  
  if (table === POST_QUEUE_TABLE) {
    if (!Array.isArray(clientLink) || !clientLink.includes(clientId)) {
      throw new Error("Record does not belong to this client");
    }
  }
  // Hot Leads aren't client-scoped (they're global) — skip ownership check
  
  return record;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    const { clientId, recordId, action } = body;

    if (!clientId || !clientId.startsWith("rec")) {
      return res.status(400).json({ error: "Valid clientId is required" });
    }
    if (!recordId || !recordId.startsWith("rec")) {
      return res.status(400).json({ error: "Valid recordId is required" });
    }
    if (!action) {
      return res.status(400).json({ error: "action is required" });
    }

    let updatedRecord = null;

    switch (action) {
      case "approve": {
        await verifyClientOwnership(POST_QUEUE_TABLE, recordId, clientId);
        updatedRecord = await airtablePatch(POST_QUEUE_TABLE, recordId, {
          "Status": "Approved",
        });
        break;
      }

      case "reject": {
        await verifyClientOwnership(POST_QUEUE_TABLE, recordId, clientId);
        const updateFields = { "Status": "Rejected" };
        if (body.rejectionReason) {
          updateFields["Rejection Reason"] = body.rejectionReason;
        }
        if (body.rejectionNotes) {
          updateFields["Rejection Notes"] = body.rejectionNotes.slice(0, 1000);
        }
        updatedRecord = await airtablePatch(POST_QUEUE_TABLE, recordId, updateFields);
        break;
      }

      case "dismiss": {
        await verifyClientOwnership(POST_QUEUE_TABLE, recordId, clientId);
        updatedRecord = await airtablePatch(POST_QUEUE_TABLE, recordId, {
          "Status": "Replaced",
        });
        break;
      }

      case "release_hold": {
        // Manual override: release a Quality Hold post back to Awaiting Approval
        // Use this only after manual review confirms the content is OK
        await verifyClientOwnership(POST_QUEUE_TABLE, recordId, clientId);
        const record = await airtableGet(POST_QUEUE_TABLE, recordId);
        if (record.fields["Status"] !== "Quality Hold") {
          return res.status(400).json({ error: "Record is not on Quality Hold" });
        }
        updatedRecord = await airtablePatch(POST_QUEUE_TABLE, recordId, {
          "Status": "Awaiting Approval",
        });
        break;
      }

      case "engage_lead": {
        updatedRecord = await airtablePatch(HOT_LEADS_TABLE, recordId, {
          "Status": "Drafted",
        });
        break;
      }

      case "dismiss_lead": {
        updatedRecord = await airtablePatch(HOT_LEADS_TABLE, recordId, {
          "Status": "Ignored",
        });
        break;
      }

      default:
        return res.status(400).json({
          error: `Unknown action: ${action}`,
          availableActions: ["approve", "reject", "dismiss", "release_hold", "engage_lead", "dismiss_lead"],
        });
    }

    return res.status(200).json({
      success: true,
      action,
      recordId,
      recordUpdated: !!updatedRecord,
    });
  } catch (e) {
    console.error("Dashboard action error:", e);
    return res.status(500).json({ error: e.message });
  }
};
