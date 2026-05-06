/* ══════════════════════════════════════════
   LUNA MARKETING — EVENTS ADMIN API
   Admin-only endpoint for reviewing pending events.

   Auth: Travelgenix JWT (Authorization: Bearer <tg_token>) sent by
   events-admin.html. Role-gated to owner or admin. The page never
   exposes admin keys to the browser — it just forwards the token the
   user already has from the central signin.

   Endpoints (all behind the same auth):
     GET  /api/events-admin?action=list[&status=pending]
          → { success: true, events: [...] }
          status query param defaults to "pending". Use "approved",
          "rejected", or "all" to fetch other slices.

     POST /api/events-admin  body: { action, id, [status] }
          action = approve | reject | delete | set_status
          id = recXXX
          status = required for action=set_status

   Reuses TG_EVENTS_AIRTABLE_PAT (read+write scoped) — same env var the
   events-topup cron uses. Falls back to AIRTABLE_KEY if not set.
   ══════════════════════════════════════════ */

var AIRTABLE_API   = "https://api.airtable.com/v0";
var EVENTS_BASE_ID = "appSoIlSe0sNaJ4BZ";
var EVENTS_TABLE   = "tblQxIYrbzd6YlJYV";

// Field IDs (stable across renames)
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

// Decode a Travelgenix JWT without verifying the signature. We rely on the
// signing service for actual identity assurance; this endpoint only reads
// the role claim to decide whether the request is allowed. For stronger
// guarantees, swap this for a verified decode using the JWT secret.
function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  var parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    var payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    var pad = payload.length % 4;
    if (pad) payload += "=".repeat(4 - pad);
    var json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function checkAuth(req) {
  var hdr = req.headers && req.headers.authorization;
  if (!hdr) return { ok: false, status: 401, error: "missing authorization header" };
  var token = hdr.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, status: 401, error: "missing bearer token" };

  var payload = decodeJwtPayload(token);
  if (!payload) return { ok: false, status: 401, error: "invalid token format" };

  // Optional: enforce expiry if the JWT carries one
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    return { ok: false, status: 401, error: "token expired" };
  }

  // Role gate — owner or admin only
  var role = payload.role;
  if (role && typeof role === "object") role = role.name || "";
  role = String(role || "").toLowerCase();
  if (role !== "owner" && role !== "admin") {
    return { ok: false, status: 403, error: "not authorised" };
  }

  return { ok: true, user: payload };
}

// ── Airtable helpers ────────────────────────────────

function getPat() {
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

  var auth = checkAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  try {
    if (req.method === "GET") {
      var action = (req.query && req.query.action) || "list";
      if (action !== "list") {
        return res.status(400).json({ success: false, error: "unknown GET action" });
      }
      var status = (req.query && req.query.status) || "pending";
      if (["pending", "approved", "rejected", "all"].indexOf(status) === -1) {
        return res.status(400).json({ success: false, error: "invalid status filter" });
      }
      var events = await listByStatus(status);
      return res.status(200).json({ success: true, count: events.length, events: events });
    }

    if (req.method === "POST") {
      var body = req.body || {};
      // Vercel may not parse JSON automatically depending on config — handle both
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      var bAction = (body.action || "").toLowerCase();
      var id = (body.id || "").trim();

      if (!id || !/^rec[A-Za-z0-9]{14}$/.test(id)) {
        return res.status(400).json({ success: false, error: "invalid or missing record id" });
      }

      if (bAction === "approve") {
        await setStatus(id, "approved");
        return res.status(200).json({ success: true, id: id, status: "approved" });
      }
      if (bAction === "reject") {
        await setStatus(id, "rejected");
        return res.status(200).json({ success: true, id: id, status: "rejected" });
      }
      if (bAction === "delete") {
        await deleteRecord(id);
        return res.status(200).json({ success: true, id: id, deleted: true });
      }
      if (bAction === "set_status") {
        var newStatus = (body.status || "").toLowerCase();
        if (ALLOWED_STATUSES.indexOf(newStatus) === -1) {
          return res.status(400).json({ success: false, error: "status must be one of: " + ALLOWED_STATUSES.join(", ") });
        }
        await setStatus(id, newStatus);
        return res.status(200).json({ success: true, id: id, status: newStatus });
      }

      return res.status(400).json({ success: false, error: "action must be approve, reject, delete, or set_status" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ success: false, error: "method not allowed" });

  } catch (err) {
    console.error("events-admin error", err);
    return res.status(500).json({
      success: false,
      error: String((err && err.message) || err).slice(0, 300),
    });
  }
};
