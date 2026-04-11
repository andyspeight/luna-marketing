const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
const CLIENTS_TABLE = "tblUkzvBujc94Yali";
const QUEUE_TABLE = "tblbhyiuULvedva0K";

async function fetchAllClients() {
  var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE;
  var res = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!res.ok) throw new Error("Failed to fetch clients: " + res.statusText);
  var data = await res.json();
  return data.records || [];
}

async function fetchPostStats() {
  var allRecords = [];
  var offset = null;
  do {
    var url = "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + QUEUE_TABLE + "?fields%5B%5D=Client&fields%5B%5D=Status&fields%5B%5D=Reach&fields%5B%5D=Likes&fields%5B%5D=Comments&fields%5B%5D=Shares&fields%5B%5D=Clicks&fields%5B%5D=Image%20URL&pageSize=100" + (offset ? "&offset=" + offset : "");
    var res = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
    if (!res.ok) break;
    var data = await res.json();
    allRecords = allRecords.concat(data.records || []);
    offset = data.offset || null;
  } while (offset);
  return allRecords;
}

async function updateClient(clientId, fields) {
  var res = await fetch("https://api.airtable.com/v0/" + AIRTABLE_BASE + "/" + CLIENTS_TABLE + "/" + clientId, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: fields, typecast: true })
  });
  if (!res.ok) throw new Error("Failed to update client: " + res.statusText);
  return res.json();
}

function getStatusName(val) { return typeof val === "object" ? val.name : val || ""; }

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // PATCH: update client settings
    if (req.method === "PATCH") {
      var body = req.body || {};
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId is required" });

      var fields = {};
      if (typeof body.autoPublish === "boolean") fields["Auto Publish"] = body.autoPublish;
      if (body.postingFrequency) fields["Posting Frequency"] = body.postingFrequency;
      if (body.postingDays) fields["Posting Days"] = body.postingDays;
      if (body.toneKeywords) fields["Tone Keywords"] = body.toneKeywords;
      if (body.emojiUsage) fields["Emoji Usage"] = body.emojiUsage;
      if (body.formality) fields["Formality"] = body.formality;
      if (body.sentenceStyle) fields["Sentence Style"] = body.sentenceStyle;
      if (body.ctaStyle) fields["CTA Style"] = body.ctaStyle;

      if (Object.keys(fields).length === 0) return res.status(400).json({ error: "No valid fields to update" });

      var updated = await updateClient(clientId, fields);
      return res.status(200).json({ success: true, clientId: clientId, updated: fields });
    }

    // GET: list all clients with stats
    if (req.method === "GET") {
      var clients = await fetchAllClients();
      var posts = await fetchPostStats();

      var clientStats = {};
      for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        var clientLinks = post.fields.Client || [];
        var cid = clientLinks[0] || "unknown";
        if (!clientStats[cid]) clientStats[cid] = { total_posts: 0, queued: 0, published: 0, suppressed: 0, failed: 0, total_reach: 0, total_likes: 0, total_comments: 0, total_shares: 0, total_clicks: 0, has_images: 0 };
        var s = clientStats[cid];
        s.total_posts++;
        var sn = getStatusName(post.fields.Status);
        if (sn === "Queued") s.queued++;
        else if (sn === "Published") s.published++;
        else if (sn === "Suppressed") s.suppressed++;
        else if (sn === "Failed") s.failed++;
        s.total_reach += post.fields.Reach || 0;
        s.total_likes += post.fields.Likes || 0;
        s.total_comments += post.fields.Comments || 0;
        s.total_shares += post.fields.Shares || 0;
        s.total_clicks += post.fields.Clicks || 0;
        if (post.fields["Image URL"]) s.has_images++;
      }

      var clientList = clients.map(function (c) {
        var f = c.fields;
        var stats = clientStats[c.id] || { total_posts: 0, queued: 0, published: 0, suppressed: 0, failed: 0, total_reach: 0, total_likes: 0, total_comments: 0, total_shares: 0, total_clicks: 0, has_images: 0 };
        return {
          id: c.id,
          business_name: f["Business Name"] || "",
          trading_name: f["Trading Name"] || "",
          website: f["Website URL"] || "",
          status: getStatusName(f.Status),
          package: getStatusName(f.Package),
          destinations: f.Destinations || "",
          specialisms: Array.isArray(f.Specialisms) ? f.Specialisms.map(function (s) { return typeof s === "object" ? s.name : s; }) : [],
          posting_frequency: f["Posting Frequency"] || 3,
          posting_days: f["Posting Days"] || "Mon,Wed,Fri",
          tone: f["Tone Keywords"] || "",
          emoji_usage: getStatusName(f["Emoji Usage"]),
          formality: getStatusName(f.Formality),
          sentence_style: getStatusName(f["Sentence Style"]),
          cta_style: getStatusName(f["CTA Style"]),
          auto_publish: !!f["Auto Publish"],
          fb_connected: !!f["FB Page ID"],
          ig_connected: !!f["IG Account ID"],
          li_connected: !!f["LinkedIn Page ID"],
          stats: stats
        };
      });

      var totals = {
        total_clients: clientList.length,
        active: clientList.filter(function (c) { return c.status === "Active"; }).length,
        paused: clientList.filter(function (c) { return c.status === "Paused"; }).length,
        onboarding: clientList.filter(function (c) { return c.status === "Onboarding"; }).length,
        error: clientList.filter(function (c) { return c.status === "Error"; }).length,
        total_posts: posts.length,
        total_queued: posts.filter(function (p) { return getStatusName(p.fields.Status) === "Queued"; }).length,
        total_published: posts.filter(function (p) { return getStatusName(p.fields.Status) === "Published"; }).length,
        total_suppressed: posts.filter(function (p) { return getStatusName(p.fields.Status) === "Suppressed"; }).length
      };

      return res.status(200).json({ success: true, totals: totals, clients: clientList });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Clients API error:", err);
    return res.status(500).json({ error: err.message });
  }
};
