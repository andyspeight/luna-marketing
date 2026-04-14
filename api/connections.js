var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var CLIENTS = "tblUkzvBujc94Yali";
var MC_BASE = "https://app.metricool.com/api";
var METRICOOL_KEY = process.env.METRICOOL_KEY;
var METRICOOL_USER = process.env.METRICOOL_USER_ID || "3429319";

function mcH() {
  return { "x-api-key": METRICOOL_KEY, "Content-Type": "application/json" };
}

async function atList(table, formula) {
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + table;
  if (formula) url += "?filterByFormula=" + encodeURIComponent(formula);
  var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) throw new Error("Airtable error: " + r.statusText);
  var data = await r.json();
  return data.records || [];
}

async function atGet(table, recordId) {
  var r = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + table + "/" + recordId, {
    headers: { Authorization: "Bearer " + AIRTABLE_KEY }
  });
  if (!r.ok) throw new Error("Airtable error: " + r.statusText);
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var body = req.body || {};
    var action = body.action;

    // ── get_connection_url: get Metricool WL connection URL for a client ──
    if (action === "get_connection_url") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);

      // Allow blogId override (for B2B personal accounts)
      var blogId = body.blogId || client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      // Get WL connection URL from Metricool
      var url = MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=false";
      var r = await fetch(url, { headers: mcH() });
      var data = await r.json();

      var wlToken = data.whiteLabelToken || data.wlToken || data.token || null;
      var connectionUrl = null;
      if (wlToken) {
        connectionUrl = "https://app.metricool.com/autoin/" + wlToken + "?redirect=/connections";
      }

      // Get current connected platforms from Airtable
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

    // ── check_connections: check which platforms are connected in Metricool ──
    if (action === "check_connections") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = body.blogId || client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "No Metricool Blog ID" });

      var url = MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER;
      var r = await fetch(url, { headers: mcH() });
      var data = await r.json();

      return res.status(200).json({
        success: true,
        blogId: blogId,
        profile: data
      });
    }

    // ── get_connection_url_by_email: look up client by email ──
    if (action === "get_connection_url_by_email") {
      var email = (body.email || "").trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "email required" });

      var clients = await atList(CLIENTS, "{Email}='" + email.replace(/'/g, "\\'") + "'");
      if (!clients.length) return res.status(404).json({ error: "Client not found" });

      var client = clients[0];
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      var url = MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=false";
      var r = await fetch(url, { headers: mcH() });
      var data = await r.json();

      var wlToken = data.whiteLabelToken || data.wlToken || data.token || null;
      var connectionUrl = null;
      if (wlToken) {
        connectionUrl = "https://app.metricool.com/autoin/" + wlToken + "?redirect=/connections";
      }

      var connRaw = client.fields["Connected Platforms"] || [];
      var currentConnected = connRaw.map(function(p) { return typeof p === "string" ? p : p.name; });

      return res.status(200).json({
        success: true,
        clientName: client.fields["Trading Name"],
        blogId: blogId,
        connectionUrl: connectionUrl,
        connectedPlatforms: currentConnected
      });
    }

    return res.status(400).json({ error: "Unknown action. Use: get_connection_url, check_connections, get_connection_url_by_email" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
