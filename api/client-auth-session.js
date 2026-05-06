/**
 * POST /api/client-auth-session
 *
 * Modern auth: validates the central Travelgenix session (cookie scoped
 * to .travelify.io), then returns the Luna Marketing client profile(s)
 * linked to the user's email address.
 *
 * Replaces the legacy email+access-code flow for users who have signed
 * in via id.travelify.io. Multiple profiles may match (Andy, for example,
 * has both Travelgenix and a demo client) — the front-end shows a picker
 * if so, and posts back with the chosen profileId.
 *
 * Request body (optional):
 *   { profileId?: 'recXXXXXX' }   // pre-select a specific profile
 *
 * Response:
 *   { ok: true, profile: {...}, candidates: [{id, name}] }
 *
 * Authorisation: requires a valid central session. No product permission
 * check enforced here — clients may view their own marketing dashboard
 * regardless of role. The owner/admin gating is handled server-side in
 * write endpoints.
 */

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var CLIENTS_TABLE = "tblUkzvBujc94Yali";

// Where to validate the central session. We trust this host because
// the cookie is scoped to .travelify.io and only id.travelify.io issues it.
var ID_HOST = "https://id.travelify.io";

function getVal(fields, name) {
  var v = fields[name];
  if (!v) return "";
  if (typeof v === "object" && v.name) return v.name;
  return v;
}

function getMultiVal(fields, name) {
  var v = fields[name];
  if (!v) return [];
  if (Array.isArray(v)) return v.map(function (s) { return typeof s === "object" ? s.name : s; });
  return [];
}

function buildProfile(record) {
  var f = record.fields;
  return {
    id: record.id,
    business_name: f["Business Name"] || "",
    trading_name: f["Trading Name"] || "",
    website: f["Website URL"] || "",
    phone: f["Phone"] || "",
    email: f["Monthly Report Email"] || "",
    status: getVal(f, "Status"),
    package: getVal(f, "Package"),
    destinations: f["Destinations"] || "",
    specialisms: getMultiVal(f, "Specialisms"),
    posting_frequency: f["Posting Frequency"] || 3,
    posting_days: f["Posting Days"] || "Mon,Wed,Fri",
    tone: f["Tone Keywords"] || "",
    emoji_usage: getVal(f, "Emoji Usage"),
    formality: getVal(f, "Formality"),
    sentence_style: getVal(f, "Sentence Style"),
    cta_style: getVal(f, "CTA Style"),
    primary_colour: f["Primary Colour"] || "",
    secondary_colour: f["Secondary Colour"] || "",
    logo_url: f["Logo URL"] || "",
    auto_publish: !!f["Auto Publish"],
    fb_connected: !!f["FB Page ID"],
    ig_connected: !!f["IG Account ID"],
    li_connected: !!f["LinkedIn Page ID"],
    client_type: getVal(f, "Client Type") || "b2c-travel",
    connected_platforms: getMultiVal(f, "Connected Platforms"),
    content_pillars: getMultiVal(f, "Content Pillars"),
    target_channels: getMultiVal(f, "Target Channels"),
    metricool_blog_id: f["Metricool Blog ID"] || "",
    metricool_blog_id_personal: f["Metricool Blog ID - Personal"] || ""
  };
}

module.exports = async function handler(req, res) {
  // CORS — this endpoint is called from marketing.travelify.io front-end,
  // same-origin so no special handling required, but be polite.
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // 1. Validate the central session by forwarding the cookie to id.travelify.io
    var cookie = req.headers.cookie || "";
    if (!cookie.indexOf("tg_session=") === -1 && !cookie.match(/(?:^|;\s*)tg_session=/)) {
      return res.status(401).json({ error: "Not signed in" });
    }

    var meRes = await fetch(ID_HOST + "/api/auth/me", {
      method: "GET",
      headers: {
        // Forward the cookie so id.travelify.io can recognise the session
        cookie: cookie
      }
    });
    if (meRes.status === 401) {
      return res.status(401).json({ error: "Session expired" });
    }
    if (!meRes.ok) {
      return res.status(502).json({ error: "Auth check failed" });
    }
    var meData = await meRes.json();
    if (!meData || !meData.ok || !meData.user || !meData.user.email) {
      return res.status(401).json({ error: "Invalid session" });
    }

    var email = String(meData.user.email).trim().toLowerCase();
    var body = req.body || {};
    var requestedProfileId = body.profileId ? String(body.profileId) : null;

    // 2. Find every Luna Marketing profile linked to this email
    var formula = encodeURIComponent("LOWER({Monthly Report Email})='" + email.replace(/'/g, "\\'") + "'");
    var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE +
              "?filterByFormula=" + formula + "&maxRecords=10";
    var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
    if (!r.ok) {
      return res.status(502).json({ error: "Profile lookup failed" });
    }
    var data = await r.json();
    var records = (data && data.records) || [];

    if (records.length === 0) {
      return res.status(404).json({
        error: "No Luna Marketing profile linked to your account. Contact your account manager."
      });
    }

    // Build candidate list (id + display name) for the picker
    var candidates = records.map(function (rec) {
      var f = rec.fields;
      return {
        id: rec.id,
        name: f["Trading Name"] || f["Business Name"] || rec.id,
        package: getVal(f, "Package")
      };
    });

    // 3. If a specific profile was requested, return that one (if it matches);
    //    otherwise if there's only one, return it; otherwise return candidates only.
    var chosen = null;
    if (requestedProfileId) {
      chosen = records.find(function (r) { return r.id === requestedProfileId; });
      if (!chosen) {
        return res.status(403).json({ error: "Requested profile not linked to your account" });
      }
    } else if (records.length === 1) {
      chosen = records[0];
    }

    return res.status(200).json({
      ok: true,
      candidates: candidates,
      profile: chosen ? buildProfile(chosen) : null,
      // Echo back basic identity so the page header can render immediately
      account: {
        email: meData.user.email,
        fullName: meData.user.fullName || ""
      }
    });
  } catch (err) {
    console.error("client-auth-session error:", err);
    return res.status(500).json({ error: err.message });
  }
};
