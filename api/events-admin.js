/* ══════════════════════════════════════════
   LUNA MARKETING — EVENTS ADMIN API

   Admin-only endpoint for reviewing pending events from inside the Events
   tab in client.html. Uses Travelgenix SSO — exact same pattern as
   /api/auth-session.

   How auth works:
   1. The browser carries the tg_session cookie set by id.travelify.io.
   2. This endpoint forwards that cookie to id.travelify.io/api/auth/me to
      resolve the signed-in user's email.
   3. We then look up the Luna Marketing client whose Monthly Report Email
      matches that email, and check the resolved client ID equals
      OWNER_CLIENT_ID. Anyone else gets 403.

   No bearer tokens, no email/code body fields. Just the SSO cookie.

   Endpoints:
     POST /api/events-admin
       body: { action: "list", status?: "pending" }
       → { success: true, events: [...] }

     POST /api/events-admin
       body: { action: "approve" | "reject" | "delete" | "set_status",
               id: "recXXX", status?: "pending"|"approved"|"rejected" }
       → { success: true, id, status? }
   ══════════════════════════════════════════ */

const AIRTABLE_API   = "https://api.airtable.com/v0";
const EVENTS_BASE_ID = "appSoIlSe0sNaJ4BZ";
const EVENTS_TABLE   = "tblQxIYrbzd6YlJYV";

// Clients table — same base as Events Calendar — used to resolve the
// signed-in user's email to a client record so we can check OWNER_CLIENT_ID.
const CLIENTS_TABLE  = "tblUkzvBujc94Yali";

// Travelgenix's own client record. Only this account is allowed admin.
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";

const ID_HOST = "https://id.travelify.io";

const ALLOWED_ORIGINS = [
  "https://luna-marketing.vercel.app",
  "https://marketing.travelify.io"
];

// Field IDs on Events Calendar (stable)
const FIELDS = {
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

const ALLOWED_STATUSES = ["pending", "approved", "rejected"];

// ── CORS ────────────────────────────────────────────

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// ── Auth ────────────────────────────────────────────

function escFormula(s) {
  return String(s || "").replace(/'/g, "\\'");
}

// Resolve the SSO session → email → client record. Returns { ok: true, email, clientId }
// when the signed-in user is the Travelgenix owner, otherwise { ok: false, status, error }.
async function verifyOwner(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }

  // 1. Resolve email from the central session.
  let meData;
  try {
    const meRes = await fetch(ID_HOST + "/api/auth/me", {
      method: "GET",
      headers: { cookie: cookie }
    });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    meData = await meRes.json();
  } catch (e) {
    return { ok: false, status: 502, error: "Auth check failed" };
  }
  if (!meData || !meData.ok || !meData.user || !meData.user.email) {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const email = String(meData.user.email).trim().toLowerCase();

  // 2. Look up the client(s) keyed by Monthly Report Email and check one of
  //    them is the Travelgenix owner record.
  const atKey = process.env.AIRTABLE_KEY;
  if (!atKey) return { ok: false, status: 500, error: "Server not configured" };

  const formula = encodeURIComponent(
    "LOWER({Monthly Report Email})='" + escFormula(email) + "'"
  );
  const url = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + CLIENTS_TABLE
    + "?filterByFormula=" + formula + "&maxRecords=10";

  let records = [];
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + atKey } });
    if (!r.ok) return { ok: false, status: 502, error: "Client lookup failed" };
    const data = await r.json();
    records = (data && data.records) || [];
  } catch (e) {
    return { ok: false, status: 502, error: "Client lookup failed" };
  }

  if (records.length === 0) {
    return { ok: false, status: 403, error: "No client linked to your account" };
  }

  const isOwner = records.some(function (rec) { return rec.id === OWNER_CLIENT_ID; });
  if (!isOwner) {
    return { ok: false, status: 403, error: "Not authorised for admin actions" };
  }

  return { ok: true, email: email, clientId: OWNER_CLIENT_ID };
}

// ── Airtable helpers ────────────────────────────────

function getPat() {
  // Prefer the read+write PAT used by the events-topup cron, fall back to the
  // existing AIRTABLE_KEY (typically read-only on this base, so writes will
  // fail but reads still work).
  return process.env.TG_EVENTS_AIRTABLE_PAT || process.env.AIRTABLE_KEY;
}

async function listByStatus(status) {
  const pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");

  const params = new URLSearchParams();
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

  const baseUrl = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE + "?" + params.toString();
  const out = [];
  let offset = "";
  let pages = 0;

  while (pages < 5) {
    const url = offset ? baseUrl + "&offset=" + encodeURIComponent(offset) : baseUrl;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + pat } });
    if (!r.ok) {
      const body = await r.text().catch(function () { return ""; });
      throw new Error("airtable-list-" + r.status + ": " + body.slice(0, 200));
    }
    const data = await r.json();
    (data.records || []).forEach(function (rec) {
      const f = rec.fields || {};
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
  const pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");
  const url = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE + "/" + recordId;
  const body = { fields: {}, typecast: true };
  body.fields[FIELDS.status] = newStatus;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + pat, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const resp = await r.text().catch(function () { return ""; });
    throw new Error("airtable-patch-" + r.status + ": " + resp.slice(0, 200));
  }
  return await r.json();
}

async function deleteRecord(recordId) {
  const pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");
  const url = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE + "/" + recordId;
  const r = await fetch(url, { method: "DELETE", headers: { Authorization: "Bearer " + pat } });
  if (!r.ok) {
    const resp = await r.text().catch(function () { return ""; });
    throw new Error("airtable-delete-" + r.status + ": " + resp.slice(0, 200));
  }
  return await r.json();
}

// ── Handler ─────────────────────────────────────────

module.exports = async function handler(req, res) {
  applyCors(req, res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "method not allowed" });
  }

  // Auth via SSO cookie — must be the Travelgenix owner.
  const auth = await verifyOwner(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }

  try {
    const action = (body.action || "").toLowerCase();

    if (action === "list") {
      const status = (body.status || "pending").toLowerCase();
      if (["pending", "approved", "rejected", "all"].indexOf(status) === -1) {
        return res.status(400).json({ success: false, error: "invalid status filter" });
      }
      const events = await listByStatus(status);
      return res.status(200).json({ success: true, count: events.length, events: events });
    }

    const id = (body.id || "").trim();
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
      const newStatus = (body.status || "").toLowerCase();
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
