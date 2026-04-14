var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var CLIENTS_TABLE = "tblUkzvBujc94Yali";

function getVal(fields, name) {
  var v = fields[name];
  if (!v) return "";
  if (typeof v === "object" && v.name) return v.name;
  return v;
}

function getMultiVal(fields, name) {
  var v = fields[name];
  if (!v) return [];
  if (Array.isArray(v)) return v.map(function(s) { return typeof s === "object" ? s.name : s; });
  return [];
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var body = req.body || {};
    var email = (body.email || "").trim().toLowerCase();
    var code = (body.code || "").trim();

    if (!email || !code) {
      return res.status(400).json({ error: "Email and access code are required" });
    }

    // Search for client by email
    var formula = encodeURIComponent("LOWER({Monthly Report Email})='" + email.replace(/'/g, "\\'") + "'");
    var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE + "?filterByFormula=" + formula + "&maxRecords=1";
    var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
    var data = await r.json();

    if (!data.records || data.records.length === 0) {
      return res.status(401).json({ error: "No account found for this email address. Please contact your account manager." });
    }

    var record = data.records[0];
    var f = record.fields;
    var storedCode = (f["Access Code"] || "").trim();

    if (!storedCode) {
      return res.status(401).json({ error: "Account not yet activated. Please contact your account manager." });
    }
    if (storedCode !== code) {
      return res.status(401).json({ error: "Incorrect access code" });
    }

    // Return client profile
    var profile = {
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
      // B2B fields
      client_type: getVal(f, "Client Type") || "b2c-travel",
      connected_platforms: getMultiVal(f, "Connected Platforms"),
      content_pillars: getMultiVal(f, "Content Pillars"),
      target_channels: getMultiVal(f, "Target Channels"),
      metricool_blog_id: f["Metricool Blog ID"] || "",
      metricool_blog_id_personal: f["Metricool Blog ID - Personal"] || "",
    };

    return res.status(200).json({ success: true, profile: profile });
  } catch (err) {
    console.error("Client auth error:", err);
    return res.status(500).json({ error: err.message });
  }
};
