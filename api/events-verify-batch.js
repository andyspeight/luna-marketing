/* ══════════════════════════════════════════
   LUNA MARKETING — EVENTS VERIFY BATCH

   Verifies pending events in chunks. The browser polls this endpoint
   repeatedly with chunk=5 until done=true.

   For each event:
     1. Calls verifyOne() (event-verify.js)
     2. Writes Verified At / Verification Confidence / Verification Notes
     3. Auto-actions:
          high + datesMatch        → Status=approved
          high + dates corrected   → Status=approved + Date Start/End updated
          not_found                → Status=rejected
          medium / low / parse fail → leaves Status=pending for manual review

   Skip rules:
     - Default: only events with Status=pending AND Verified At empty
     - force=true: also re-verify already-verified events (browser warns first)

   Auth: SSO cookie, owner-gated (same pattern as events-admin.js).

   Request:
     POST /api/events-verify-batch
     body: { chunk?: 5, force?: false }
     → {
         success: true,
         processed: [ { id, name, action, confidence, datesMatch } ],
         summary: { ok, errors, total },
         remaining: number,
         done: boolean
       }
   ══════════════════════════════════════════ */

const { verifyOne } = require("./event-verify");

const AIRTABLE_API   = "https://api.airtable.com/v0";
const EVENTS_BASE_ID = "appSoIlSe0sNaJ4BZ";
const EVENTS_TABLE   = "tblQxIYrbzd6YlJYV";
const CLIENTS_TABLE  = "tblUkzvBujc94Yali";
const OWNER_CLIENT_ID = "recFXQY7be6gMr4In";
const ID_HOST = "https://id.travelify.io";

const ALLOWED_ORIGINS = [
  "https://luna-marketing.vercel.app",
  "https://marketing.travelify.io"
];

const FIELDS = {
  name:           "fldeCYUaMLwkWpv2u",
  dateStart:      "fld3kpR4x8CMyN5X5",
  dateEnd:        "fldwec6M9n8vwsLHz",
  countries:      "fldxFYgltX1yU9ks3",
  status:         "fldkJLEulZQJVR0hY",
  verifiedAt:     "fldPRpt68nR72gaxz",
  vConfidence:    "fld8oVlV8dMGWYPJZ",
  vNotes:         "fldkGbSYEimyTqghd"
};

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

function escFormula(s) {
  return String(s || "").replace(/'/g, "\\'");
}

// SSO owner check (same pattern as events-admin.js).
async function verifyOwner(req) {
  const cookie = req.headers.cookie || "";
  if (!cookie.match(/(?:^|;\s*)tg_session=/)) {
    return { ok: false, status: 401, error: "Not signed in" };
  }
  let meData;
  try {
    const meRes = await fetch(ID_HOST + "/api/auth/me", {
      method: "GET", headers: { cookie: cookie }
    });
    if (meRes.status === 401) return { ok: false, status: 401, error: "Session expired" };
    if (!meRes.ok) return { ok: false, status: 502, error: "Auth check failed" };
    meData = await meRes.json();
  } catch (e) { return { ok: false, status: 502, error: "Auth check failed" }; }
  if (!meData || !meData.ok || !meData.user || !meData.user.email) {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const email = String(meData.user.email).trim().toLowerCase();
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
    records = ((await r.json()).records) || [];
  } catch (e) { return { ok: false, status: 502, error: "Client lookup failed" }; }

  if (records.length === 0) return { ok: false, status: 403, error: "No client linked" };
  const isOwner = records.some(function (rec) { return rec.id === OWNER_CLIENT_ID; });
  if (!isOwner) return { ok: false, status: 403, error: "Not authorised" };
  return { ok: true };
}

// ── Airtable helpers ────────────────────────────────

function getPat() {
  return process.env.TG_EVENTS_AIRTABLE_PAT || process.env.AIRTABLE_KEY;
}

async function listToVerify(force, limit) {
  const pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");

  // Always Status=pending. If force=false, also require Verified At empty.
  const formula = force
    ? "{Status}='pending'"
    : "AND({Status}='pending', {Verified At}=BLANK())";

  const params = new URLSearchParams();
  params.set("returnFieldsByFieldId", "true");
  params.set("pageSize", String(Math.max(limit, 10))); // grab a small buffer
  params.set("maxRecords", String(Math.max(limit, 10)));
  params.set("filterByFormula", formula);
  params.append("sort[0][field]", "Date Start");
  params.append("sort[0][direction]", "asc");

  const url = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE
    + "?" + params.toString();
  const r = await fetch(url, { headers: { Authorization: "Bearer " + pat } });
  if (!r.ok) {
    const body = await r.text().catch(function () { return ""; });
    throw new Error("airtable-list-" + r.status + ": " + body.slice(0, 200));
  }
  const data = await r.json();
  return (data.records || []).slice(0, limit).map(function (rec) {
    const f = rec.fields || {};
    return {
      id: rec.id,
      name:      f[FIELDS.name] || "",
      dateStart: f[FIELDS.dateStart] || "",
      dateEnd:   f[FIELDS.dateEnd] || "",
      countries: f[FIELDS.countries] || ""
    };
  });
}

async function countRemaining(force) {
  const pat = getPat();
  const formula = force
    ? "{Status}='pending'"
    : "AND({Status}='pending', {Verified At}=BLANK())";
  const params = new URLSearchParams();
  params.set("filterByFormula", formula);
  params.set("fields[]", "Event Name");
  params.set("pageSize", "100");

  let total = 0;
  let offset = "";
  let pages = 0;
  while (pages < 5) {
    const u = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE
      + "?" + params.toString() + (offset ? "&offset=" + encodeURIComponent(offset) : "");
    const r = await fetch(u, { headers: { Authorization: "Bearer " + pat } });
    if (!r.ok) break;
    const data = await r.json();
    total += (data.records || []).length;
    offset = data.offset || "";
    pages++;
    if (!offset) break;
  }
  return total;
}

function buildNotesText(result) {
  const parts = [];
  parts.push("Confidence: " + (result.confidence || "low"));
  parts.push("Dates match stored: " + (result.datesMatch ? "yes" : "no"));
  if (result.verifiedDateStart) {
    parts.push("Verified start: " + result.verifiedDateStart);
  }
  if (result.verifiedDateEnd) {
    parts.push("Verified end: " + result.verifiedDateEnd);
  }
  parts.push("Action taken: " + result.recommendedAction);
  parts.push("");
  parts.push("Summary:");
  parts.push(result.summary || "(none)");
  if (result.sources && result.sources.length) {
    parts.push("");
    parts.push("Sources:");
    result.sources.forEach(function (s, i) {
      const line = "  " + (i + 1) + ". " + (s.publisher || "(unknown)")
        + (s.url ? " — " + s.url : "")
        + (s.claim ? "\n     " + s.claim : "");
      parts.push(line);
    });
  }
  return parts.join("\n").slice(0, 95000); // long-text safety
}

async function applyResult(eventRecord, result) {
  const pat = getPat();
  if (!pat) throw new Error("airtable PAT not configured");

  const fields = {};
  fields[FIELDS.verifiedAt]  = new Date().toISOString();
  fields[FIELDS.vConfidence] = result.confidence;
  fields[FIELDS.vNotes]      = buildNotesText(result);

  // Auto-actions
  if (result.recommendedAction === "approve") {
    fields[FIELDS.status] = "approved";
  } else if (result.recommendedAction === "update_dates") {
    fields[FIELDS.status] = "approved";
    if (result.verifiedDateStart) fields[FIELDS.dateStart] = result.verifiedDateStart;
    if (result.verifiedDateEnd)   fields[FIELDS.dateEnd]   = result.verifiedDateEnd;
  } else if (result.recommendedAction === "reject") {
    fields[FIELDS.status] = "rejected";
  }
  // manual_review → leave Status=pending

  const url = AIRTABLE_API + "/" + EVENTS_BASE_ID + "/" + EVENTS_TABLE + "/" + eventRecord.id;
  const r = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + pat, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: fields, typecast: true })
  });
  if (!r.ok) {
    const body = await r.text().catch(function () { return ""; });
    throw new Error("airtable-patch-" + r.status + ": " + body.slice(0, 200));
  }
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

  const auth = await verifyOwner(req);
  if (!auth.ok) return res.status(auth.status).json({ success: false, error: auth.error });

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const force = !!body.force;
  const chunk = Math.min(Math.max(parseInt(body.chunk, 10) || 5, 1), 8);

  try {
    const events = await listToVerify(force, chunk);

    const processed = [];
    let ok = 0, errors = 0;

    for (const ev of events) {
      try {
        const result = await verifyOne(ev);
        await applyResult(ev, result);
        processed.push({
          id: ev.id,
          name: ev.name,
          action: result.recommendedAction,
          confidence: result.confidence,
          datesMatch: result.datesMatch
        });
        ok++;
      } catch (err) {
        console.error("verify-batch event error", ev.id, err);
        processed.push({
          id: ev.id,
          name: ev.name,
          action: "error",
          error: String((err && err.message) || err).slice(0, 200)
        });
        errors++;
      }
    }

    const remaining = await countRemaining(force);
    return res.status(200).json({
      success: true,
      processed: processed,
      summary: { ok: ok, errors: errors, total: processed.length },
      remaining: remaining,
      done: events.length === 0 || remaining === 0
    });

  } catch (err) {
    console.error("verify-batch error", err);
    return res.status(500).json({
      success: false,
      error: String((err && err.message) || err).slice(0, 300)
    });
  }
};
