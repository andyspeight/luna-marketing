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

      // Extract WL tokens — the response should contain access URLs
      var wlToken = data.whiteLabelToken || data.wlToken || data.token || null;
      var wlUrl = data.whiteLabelUrl || data.wlUrl || null;
      var editUrl = data.whiteLabelEditUrl || null;

      // Build the connections URL
      var connectionUrl = null;
      if (wlToken) {
        connectionUrl = "https://app.metricool.com/autoin/" + wlToken + "?redirect=/connections";
      } else if (wlUrl) {
        // Try to extract token from the URL
        var match = wlUrl.match(/autoin\/([^?]+)/);
        if (match) connectionUrl = "https://app.metricool.com/autoin/" + match[1] + "?redirect=/connections";
        else connectionUrl = wlUrl;
      }

      return res.status(200).json({
        success: true,
        clientId: clientId,
        blogId: blogId,
        connectionUrl: connectionUrl,
        // Include raw response for debugging
        debug: {
          keys: Object.keys(data),
          hasWlToken: !!wlToken,
          hasWlUrl: !!wlUrl,
          rawSnippet: JSON.stringify(data).substring(0, 500)
        }
      });
    }

    // ── Check which platforms are connected for a client ──
    if (action === "check_connections") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      // Get the brand profile which should show connected networks
      var url = MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=true";
      var r = await fetch(url, { headers: mcH() });
      var data = await r.json();

      // Try to extract connected networks from the profile
      var connected = [];
      var networks = data.providers || data.networks || data.connections || data.socialNetworks || [];

      // If it's an array of objects with network names
      if (Array.isArray(networks)) {
        networks.forEach(function(n) {
          var name = n.network || n.provider || n.type || n;
          if (typeof name === "string" && NET_TO_NAME[name.toLowerCase()]) {
            connected.push(NET_TO_NAME[name.toLowerCase()]);
          }
        });
      }

      // If we found connected platforms, update Airtable
      if (connected.length > 0) {
        await atPatch(CLIENTS, clientId, { "Connected Platforms": connected });
      }

      return res.status(200).json({
        success: true,
        clientId: clientId,
        blogId: blogId,
        connectedPlatforms: connected,
        // Debug info to understand the response structure
        debug: {
          keys: Object.keys(data),
          rawSnippet: JSON.stringify(data).substring(0, 500)
        }
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

      var wlToken = data.whiteLabelToken || data.wlToken || data.token || null;
      var connectionUrl = null;
      if (wlToken) {
        connectionUrl = "https://app.metricool.com/autoin/" + wlToken + "?redirect=/connections";
      }

      // Get current connected platforms
      var connRaw = client.fields["Connected Platforms"] || [];
      var currentConnected = connRaw.map(function(p) { return typeof p === "string" ? p : p.name; });

      return res.status(200).json({
        success: true,
        clientName: client.fields["Trading Name"],
        blogId: blogId,
        connectionUrl: connectionUrl,
        connectedPlatforms: currentConnected,
        debug: { keys: Object.keys(data), rawSnippet: JSON.stringify(data).substring(0, 300) }
      });
    }

    return res.status(400).json({ error: "Unknown action. Use: get_connection_url, check_connections, get_connection_url_by_email" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
