/* ══════════════════════════════════════════
   LUNA MARKETING — CONNECTIONS
   White-label Metricool platform connections
   ══════════════════════════════════════════ */

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var METRICOOL_KEY = process.env.METRICOOL_KEY;
var METRICOOL_USER = process.env.METRICOOL_USER_ID;
var BASE = "appSoIlSe0sNaJ4BZ";
var CLIENTS = "tblUkzvBujc94Yali";
var MC_BASE = "https://app.metricool.com/api";

function mcH() { return { "Content-Type": "application/json", "X-Mc-Auth": METRICOOL_KEY }; }

async function atGet(table, id) {
  var r = await fetch("https://api.airtable.com/v0/" + BASE + "/" + table + "/" + id, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) throw new Error("Airtable GET " + r.status);
  return r.json();
}

async function atPatch(table, id, fields) {
  var r = await fetch("https://api.airtable.com/v0/" + BASE + "/" + table + "/" + id, { method: "PATCH", headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ fields: fields, typecast: true }) });
  if (!r.ok) throw new Error("Airtable PATCH " + r.status);
  return r.json();
}

async function atList(table, formula) {
  var r = await fetch("https://api.airtable.com/v0/" + BASE + "/" + table + "?filterByFormula=" + encodeURIComponent(formula), { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) throw new Error("Airtable LIST " + r.status);
  return (await r.json()).records || [];
}

// Map Metricool network keys to our platform names
var NET_TO_NAME = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn",
  twitter: "X/Twitter", tiktok: "TikTok", pinterest: "Pinterest",
  google: "Google Business", youtube: "YouTube", threads: "Threads"
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    var body = req.body || {};
    var action = body.action;

    // ── Get white-label connection URL for a client ──
    if (action === "get_connection_url") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      // Get the white-label profile which includes the WL token/URL
      var url = MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=false";
      var r = await fetch(url, { headers: mcH() });
      var data = await r.json();

      // Extract the white-label link
      var wlLink = data.whiteLabelLink || null;
      var connectionUrl = null;
      if (wlLink) {
        // Replace the redirect to go to connections page
        if (wlLink.includes("autoin/")) {
          var token = wlLink.split("autoin/")[1].split("?")[0];
          connectionUrl = "https://app.metricool.com/autoin/" + token + "?redirect=/connections";
        } else {
          connectionUrl = wlLink;
        }
      }

      // Detect connected platforms from individual fields
      var connected = [];
      if (data.facebook) connected.push("Facebook");
      if (data.instagram) connected.push("Instagram");
      if (data.linkedinCompany || data.linkedInCompanyName) connected.push("LinkedIn");
      if (data.twitter) connected.push("X/Twitter");
      if (data.tiktok) connected.push("TikTok");
      if (data.pinterest) connected.push("Pinterest");
      if (data.gmb || data.gmbAccountName) connected.push("Google Business");

      return res.status(200).json({
        success: true,
        clientId: clientId,
        blogId: blogId,
        connectionUrl: connectionUrl,
        connectedPlatforms: connected,
        brandName: data.label || null
      });
    }

    // ── Check which platforms are connected for a client ──
    if (action === "check_connections") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      // Get the brand profile to check connected networks
      var url = MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=true";
      var r = await fetch(url, { headers: mcH() });
      var data = await r.json();

      // Detect connected platforms from individual fields
      var connected = [];
      if (data.facebook) connected.push("Facebook");
      if (data.instagram) connected.push("Instagram");
      if (data.linkedinCompany || data.linkedInCompanyName) connected.push("LinkedIn");
      if (data.twitter) connected.push("X/Twitter");
      if (data.tiktok) connected.push("TikTok");
      if (data.pinterest) connected.push("Pinterest");
      if (data.gmb || data.gmbAccountName) connected.push("Google Business");

      // Update Airtable with detected platforms
      if (connected.length > 0) {
        await atPatch(CLIENTS, clientId, { "Connected Platforms": connected });
      }

      return res.status(200).json({
        success: true,
        clientId: clientId,
        blogId: blogId,
        connectedPlatforms: connected
      });
    }

    // ── Get connection URL by email (for client portal login) ──
    if (action === "get_connection_url_by_email") {
      var email = body.email;
      if (!email) return res.status(400).json({ error: "email required" });

      var clients = await atList(CLIENTS, "{Email}='" + email.replace(/'/g, "\\'") + "'");
      if (!clients.length) return res.status(404).json({ error: "Client not found" });

      var client = clients[0];
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      // Get WL connection URL
      var url = MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=false";
      var r = await fetch(url, { headers: mcH() });
      var data = await r.json();

      var wlLink2 = data.whiteLabelLink || null;
      var connectionUrl = null;
      if (wlLink2) {
        if (wlLink2.includes("autoin/")) {
          var token2 = wlLink2.split("autoin/")[1].split("?")[0];
          connectionUrl = "https://app.metricool.com/autoin/" + token2 + "?redirect=/connections";
        } else {
          connectionUrl = wlLink2;
        }
      }

      // Detect connected platforms
      var detectedPlatforms = [];
      if (data.facebook) detectedPlatforms.push("Facebook");
      if (data.instagram) detectedPlatforms.push("Instagram");
      if (data.linkedinCompany || data.linkedInCompanyName) detectedPlatforms.push("LinkedIn");
      if (data.twitter) detectedPlatforms.push("X/Twitter");
      if (data.tiktok) detectedPlatforms.push("TikTok");
      if (data.pinterest) detectedPlatforms.push("Pinterest");
      if (data.gmb || data.gmbAccountName) detectedPlatforms.push("Google Business");

      return res.status(200).json({
        success: true,
        clientName: client.fields["Trading Name"],
        blogId: blogId,
        connectionUrl: connectionUrl,
        connectedPlatforms: detectedPlatforms
      });
    }

    return res.status(400).json({ error: "Unknown action. Use: get_connection_url, check_connections, get_connection_url_by_email" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
