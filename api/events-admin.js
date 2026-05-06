/* ══════════════════════════════════════════
   LUNA MARKETING — EVENTS ADMIN API

   Admin-only endpoint for reviewing pending events from inside the Events
   tab in client.html. Auth piggybacks on the existing client-auth flow.

   How auth works:
   1. The Luna Marketing client portal stores { email, code } in
      sessionStorage when the user logs in.
   2. The "Pending" sub-tab calls this endpoint with email + code in the
      request body (POST) or signed via the same headers your other admin
      endpoints use.
   3. Server verifies email + code by re-running the same Airtable lookup
      that /api/client-auth does, then checks the resolved client ID matches
      OWNER_CLIENT_ID. Anyone else gets 403.

   This means there's no separate admin password and no JWT —
   the Travelgenix owner record is the source of truth.

   Endpoints:
     POST /api/events-admin
       body: { email, code, action: "list", status?: "pending" }
       → { success: true, events: [...] }

     POST /api/events-admin
       body: { email, code, action: "approve" | "reject" | "delete", id: "recXXX" }
       → { success: true, id, status? }
   ══════════════════════════════════════════ */

var AIRTABLE_API   = "https://api.airtable.com/v0";
var EVENTS_BASE_ID = "appSoIlSe0sNaJ4BZ";
var EVENTS_TABLE   = "tblQxIYrbzd6YlJYV";

// Travelgenix's own client record. Only this account is allowed admin
// privileges. To grant access to additional users, add them as collaborators
// on this client record (so they share the access code) — or extend the
// auth check below to consult an "admin emails" list.
var OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

// Clients table — same base as Events Calendar, used for auth verification
var CLIENTS_TABLE = "Clients"; // Or update if your Clients table ID is different

// Field IDs on Events Calendar (stable)
var FIELDS = {
  name:              "fldeCYUaMLwkWpv2u",
  dateStart:         "fld3kpR4x8CMyN5X5",
  dateEnd:           "fldwec6M9n8vwsLHz",
  category:          "fldNLLFPH91s604GB",
  countries:         "fldxFYgltX1yU9ks3",
  destinations:      "fldCDWRuWhFr71WUf",
  travelAngle:       "fldyQhl1FiHk23fAN",
  audience:          "fldrSxFITuFdeiBUz",
  recurring:         "fldVnfmglfOfjnLqS",
  impact:            "fldpvhsssthzhTO36",
  contentSuggestion: "fld3r8C281SlFUd7X",
  leadTimeWeeks:     "fldikCV1FNGgxZOys",
  status:            "fldkJLEulZQJVR0hY",
};

var ALLOWED_STATUSES = ["pending", "approved", "rejected"];

// ── Auth ────────────────────────────────────────────

// Verify the email + access code match a real client by calling the existing
// /api/client-auth route. We do this server-side so the user's code is never
// trusted by the admin endpoint without a fresh check, and we don't have to
// duplicate the client-auth lookup logic here.
async function verifyClientAuth(email, code, host) {
  if (!email || !code) {
    return { ok: false, status: 401, error: "missing email or access code" };
  }

  // Build the URL to call our own client-auth endpoint. In Vercel, request the
  // local function via the same host/protocol.
  var protocol = "https://";
  var url = protocol + host + "/api/client-auth";

  try {
    var r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, code: code }),
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok || !data || !data.profile) {
      return { ok: false, status: 401, error: "invalid email or access code" };
    }
    if (data.profile.id !== OWNER_CLIENT_ID) {
      return { ok: false, status: 403, error: "not authorised for admin actions" };
    }
    return { ok: true, profile: data.profile };
  } catch (err) {
    return { ok: false, status: 500, error: "auth verification failed" };
  }
}

// ── Airtable helpers ────────────────────────────────

function getPat() {
  // Prefer the read+write PAT used by the events-topup cron, fall back to the
  // existing AIRTABLE_KEY (typically read-only on this base, so writes will
  // fail but reads still work).
  return process.env.TG_EVENTS_AIRTABLE_PAT || process.env.AIRTABLE_KEY;
}

async function listByStatus(status) {
  var pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");

  var params = new URLSearchParams();
  params.set("returnFieldsByFieldId", "true");
  params.set("pageSize", "100");
  if (status === "pending") {
    params.set("filterByFormula", "{Status}='pending'");
  } else if (status === "approved") {
    params.set("filterByFormula", "OR({Status}='approved',{Status}='',{Status}=BLANK())");
  } else if (status === "rejected") {
    params.set("filterByFormula", "{Status}='rejected'");
  }
  // status === 'all' → no filter
  params.append("sort[0][field]", "Date Start");
  params.append("sort[0][direction]", "asc");

  var baseUrl = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE + "?" + params.toString();
  var out = [];
  var offset = "";
  var pages = 0;

  while (pages < 5) {
    var url = offset ? baseUrl + "&offset=" + offset : baseUrl;
    var r = await fetch(url, { headers: { Authorization: "Bearer " + pat } });
    if (!r.ok) {
      var body = await r.text().catch(function () { return ""; });
      throw new Error("airtable-list-" + r.status + ": " + body.slice(0, 200));
    }
    var data = await r.json();
    (data.records || []).forEach(function (rec) {
      var f = rec.fields || {};
      out.push({
        id: rec.id,
        name:              f[FIELDS.name] || "",
        dateStart:         f[FIELDS.dateStart] || "",
        dateEnd:           f[FIELDS.dateEnd] || "",
        category:          f[FIELDS.category] || "",
        countries:         f[FIELDS.countries] || "",
        destinations:      f[FIELDS.destinations] || "",
        travelAngle:       f[FIELDS.travelAngle] || "",
        audience:          f[FIELDS.audience] || [],
        recurring:         f[FIELDS.recurring] || "",
        impact:            f[FIELDS.impact] || "",
        contentSuggestion: f[FIELDS.contentSuggestion] || "",
        leadTimeWeeks:     f[FIELDS.leadTimeWeeks] || null,
        status:            f[FIELDS.status] || "",
      });
    });
    offset = data.offset || "";
    pages++;
    if (!offset) break;
  }
  return out;
}

async function setStatus(recordId, newStatus) {
  var pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");
  var url = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE + "/" + recordId;
  var body = { fields: {}, typecast: true };
  body.fields[FIELDS.status] = newStatus;
  var r = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + pat, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    var resp = await r.text().catch(function () { return ""; });
    throw new Error("airtable-patch-" + r.status + ": " + resp.slice(0, 200));
  }
  return await r.json();
}

async function deleteRecord(recordId) {
  var pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");
  var url = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE + "/" + recordId;
  var r = await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer " + pat } });
  if (!r.ok) {
    var resp = await r.text().catch(function () { return ""; });
    throw new Error("airtable-delete-" + r.status + ": " + resp.slice(0, 200));
  }
  return await r.json();
}

// ── Handler ─────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "method not allowed" });
  }

  var body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  // Verify auth via client-auth round-trip
  var host = (req.headers && req.headers.host) || "";
  var auth = await verifyClientAuth(body.email, body.code, host);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  try {
    var action = (body.action || "").toLowerCase();

    if (action === "list") {
      var status = (body.status || "pending").toLowerCase();
      if (["pending", "approved", "rejected", "all"].indexOf(status) === -1) {
        return res.status(400).json({ success: false, error: "invalid status filter" });
      }
      var events = await listByStatus(status);
      return res.status(200).json({ success: true, count: events.length, events: events });
    }

    var id = (body.id || "").trim();
    if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
      return res.status(400).json({ success: false, error: "invalid or missing record id" });
    }

    if (action === "approve") {
      await setStatus(id, "approved");
      return res.status(200).json({ success: true, id: id, status: "approved" });
    }
    if (action === "reject") {
      await setStatus(id, "rejected");
      return res.status(200).json({ success: true, id: id, status: "rejected" });
    }
    if (action === "delete") {
      await deleteRecord(id);
      return res.status(200).json({ success: true, id: id, deleted: true });
    }
    if (action === "set_status") {
      var newStatus = (body.status || "").toLowerCase();
      if (ALLOWED_STATUSES.indexOf(newStatus) === -1) {
        return res.status(400).json({ success: false, error: "status must be one of: " + ALLOWED_STATUSES.join(", ") });
      }
      await setStatus(id, newStatus);
      return res.status(200).json({ success: true, id: id, status: newStatus });
    }

    return res.status(400).json({ success: false, error: "action must be list, approve, reject, delete, or set_status" });

  } catch (err) {
    console.error("events-admin error", err);
    return res.status(500).json({
      success: false,
      error: String((err && err.message) || err).slice(0, 300),
    });
  }
};
