const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";

async function findClientByEmail(email) {
  var formula = encodeURIComponent("{Monthly Report Email}='" + email.replace(/'/g, "\\'") + "'");
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE + "?filterByFormula=" + formula;
  var res = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!res.ok) throw new Error("Airtable error: " + res.statusText);
  var data = await res.json();
  return data.records && data.records.length > 0 ? data.records[0] : null;
}

function getVal(f, key) {
  var v = f[key];
  if (typeof v === "object" && v !== null && v.name) return v.name;
  return v || "";
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

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!code) return res.status(400).json({ error: "Access code is required" });

    // Find client by email
    var record = await findClientByEmail(email);
    if (!record) return res.status(401).json({ error: "No account found with this email address" });

    // Validate access code
    var storedCode = record.fields["Access Code"] || "";
    if (!storedCode) return res.status(401).json({ error: "No access code set for this account. Please contact your account manager." });
    if (storedCode !== code) return res.status(401).json({ error: "Incorrect access code" });

    // Return client profile
    var f = record.fields;
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
      specialisms: Array.isArray(f["Specialisms"]) ? f["Specialisms"].map(function(s) { return typeof s === "object" ? s.name : s; }) : [],
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
    };

    return res.status(200).json({ success: true, profile: profile });
  } catch (err) {
    console.error("Client auth error:", err);
    return res.status(500).json({ error: err.message });
  }
};
