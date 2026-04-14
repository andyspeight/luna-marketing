var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var CLIENTS = "tblUkzvBujc94Yali";
var MC_BASE = "https://app.metricool.com/api";
var METRICOOL_KEY = process.env.METRICOOL_KEY;
var METRICOOL_USER = process.env.METRICOOL_USER_ID || "3429319";

function mcH() {
  return { "x-api-key": METRICOOL_KEY, "Content-Type": "application/json" };
}

async function atGet(table, id) {
  var r = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + table + "/" + id, {
    headers: { Authorization: "Bearer " + AIRTABLE_KEY }
  });
  if (!r.ok) throw new Error("Airtable GET error: " + r.statusText);
  return r.json();
}

async function atList(table, formula) {
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + table;
  if (formula) url += "?filterByFormula=" + encodeURIComponent(formula);
  var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) throw new Error("Airtable list error: " + r.statusText);
  var data = await r.json();
  return data.records || [];
}

// Safe Metricool JSON parser — handles HTML error pages gracefully
async function safeMcFetch(url) {
  var r = await fetch(url, { headers: mcH() });
  var ct = r.headers.get("content-type") || "";
  if (!r.ok || !ct.includes("application/json")) {
    var body = "";
    try { body = await r.text(); } catch(e) {}
    console.error("Metricool error:", r.status, ct, body.substring(0, 200));
    return {};
  }
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

    if (action === "get_connection_url") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = body.blogId || client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      var data = await safeMcFetch(MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=false");

      var wlToken = data.whiteLabelToken || data.wlToken || data.token || null;
      var connectionUrl = null;
      if (wlToken) {
        connectionUrl = "https://app.metricool.com/autoin/" + wlToken + "?redirect=/connections";
      }

      var connRaw = client.fields["Connected Platforms"] || [];
      var currentConnected = connRaw.map(function(p) { return typeof p === "string" ? p : p.name; });

      return res.status(200).json({
        success: true,
        clientName: client.fields["Trading Name"] || client.fields["Business Name"],
        blogId: blogId,
        connectionUrl: connectionUrl,
        connectedPlatforms: currentConnected
      });
    }

    if (action === "check_connections") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = body.blogId || client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "No Metricool Blog ID" });

      var data = await safeMcFetch(MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER);

      return res.status(200).json({ success: true, blogId: blogId, profile: data });
    }

    if (action === "get_connection_url_by_email") {
      var email = (body.email || "").trim().toLowerCase();
      if (!email) return res.status(400).json({ error: "email required" });

      var clients = await atList(CLIENTS, "LOWER({Monthly Report Email})='" + email.replace(/'/g, "\\'") + "'");
      if (!clients.length) return res.status(404).json({ error: "Client not found" });

      var client = clients[0];
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      var data = await safeMcFetch(MC_BASE + "/admin/profile?blogId=" + blogId + "&userId=" + METRICOOL_USER + "&refreshBrandCache=false");

      var wlToken = data.whiteLabelToken || data.wlToken || data.token || null;
      var connectionUrl = null;
      if (wlToken) {
        connectionUrl = "https://app.metricool.com/autoin/" + wlToken + "?redirect=/connections";
      }

      var connRaw = client.fields["Connected Platforms"] || [];
      var currentConnected = connRaw.map(function(p) { return typeof p === "string" ? p : p.name; });

      return res.status(200).json({
        success: true,
        clientName: client.fields["Trading Name"] || client.fields["Business Name"],
        blogId: blogId,
        connectionUrl: connectionUrl,
        connectedPlatforms: currentConnected
      });
    }

    return res.status(400).json({ error: "Unknown action. Use: get_connection_url, check_connections, get_connection_url_by_email" });
  } catch (err) {
    console.error("Connections API error:", err);
    return res.status(500).json({ error: err.message });
  }
};
