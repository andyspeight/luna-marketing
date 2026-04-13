/* ══════════════════════════════════════════
   LUNA MARKETING — METRICOOL PUBLISH
   Schedules approved posts to Metricool
   ══════════════════════════════════════════ */

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var METRICOOL_KEY = process.env.METRICOOL_KEY;
var METRICOOL_USER = process.env.METRICOOL_USER_ID;
var BASE = "appSoIlSe0sNaJ4BZ";
var QUEUE = "tblbhyiuULvedva0K";
var CLIENTS = "tblUkzvBujc94Yali";
var MC_BASE = "https://app.metricool.com/api";

/* ── Airtable helpers ── */
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

/* ── Metricool helpers ── */
function mcH() { return { "Content-Type": "application/json", "X-Mc-Auth": METRICOOL_KEY }; }

// Upload image to Metricool via normalize endpoint — returns static.metricool.com URL
async function uploadImage(blogId, imageUrl) {
  if (!imageUrl) return { url: null, raw: null };
  try {
    var endpoint = MC_BASE + "/actions/normalize/image/url?url=" + encodeURIComponent(imageUrl) +
      "&blogId=" + blogId + "&userId=" + METRICOOL_USER;
    var r = await fetch(endpoint, { headers: mcH() });
    var raw = await r.text();
    if (!r.ok) return { url: null, raw: "FAIL:" + r.status + ":" + raw.substring(0, 100) };

    // Try to extract a static.metricool.com URL from the response
    var url = null;
    // Could be a quoted string like "https://static.metricool.com/..."
    var cleaned = raw.trim().replace(/^"|"$/g, '');
    if (cleaned.includes("static.metricool.com")) {
      url = cleaned;
    } else {
      // Try JSON parse
      try {
        var d = JSON.parse(raw);
        if (typeof d === "string" && d.includes("metricool")) url = d;
        else if (d && d.url) url = d.url;
        else if (d && d.normalizedUrl) url = d.normalizedUrl;
      } catch (e) {
        // If it's a plain URL starting with http
        if (cleaned.startsWith("http")) url = cleaned;
      }
    }
    return { url: url, raw: raw.substring(0, 200) };
  } catch (e) {
    return { url: null, raw: "ERROR:" + e.message };
  }
}

// Platform config — maps Airtable caption field to Metricool network + extra data
var PLATFORMS = [
  { network: "facebook", caption: "Caption - Facebook", data: { facebookData: { type: "POST" } } },
  { network: "instagram", caption: "Caption - Instagram", data: { instagramData: { autoPublish: true } } },
  { network: "linkedin", caption: "Caption - LinkedIn", data: {} },
  { network: "twitter", caption: "Caption - Twitter", data: { twitterData: { type: "POST" } } },
  { network: "tiktok", caption: "Caption - TikTok", data: {} },
  { network: "pinterest", caption: "Caption - Pinterest", data: {} },
  { network: "google", caption: "Caption - GBP", data: {} }
];

// Schedule a post to ONE platform on Metricool
async function scheduleOne(blogId, dateTime, caption, platform, imageUrl) {
  var body = {
    publicationDate: { dateTime: dateTime, timezone: "Europe/London" },
    text: caption,
    providers: [{ network: platform.network }],
    autoPublish: true,
    creatorUserId: parseInt(METRICOOL_USER)
  };
  // Add platform-specific data
  Object.keys(platform.data).forEach(function(k) { body[k] = platform.data[k]; });
  // Add image
  if (imageUrl) {
    body.media = [imageUrl];
    body.mediaAltText = [null];
    body.saveExternalMediaFiles = true;
  }

  var url = MC_BASE + "/v2/scheduler/posts?blogId=" + blogId + "&userId=" + METRICOOL_USER;
  var r = await fetch(url, { method: "POST", headers: mcH(), body: JSON.stringify(body) });
  var txt = await r.text();
  return { network: platform.network, status: r.status, ok: r.ok, response: txt.substring(0, 150) };
}

// Map Airtable platform names to Metricool network names
var PLATFORM_MAP = {
  "Facebook": "facebook", "Instagram": "instagram", "LinkedIn": "linkedin",
  "X/Twitter": "twitter", "TikTok": "tiktok", "Pinterest": "pinterest", "Google Business": "google"
};

// Schedule a post across connected platforms with per-platform captions
async function schedulePost(blogId, post, imageUrl, connectedPlatforms) {
  var f = post.fields;
  var fbCap = f["Caption - Facebook"] || "";

  // Filter PLATFORMS to only those the client has connected
  var activePlatforms = PLATFORMS.filter(function(p) {
    return connectedPlatforms.indexOf(p.network) !== -1;
  });

  // Build dateTime
  var schedDate = f["Scheduled Date"];
  var schedTime = f["Scheduled Time"] || "10:00";
  var dateTime;
  if (schedDate) {
    dateTime = schedDate + "T" + schedTime + ":00";
  } else {
    var tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    dateTime = tmrw.getFullYear() + "-" + String(tmrw.getMonth() + 1).padStart(2, "0") + "-" + String(tmrw.getDate()).padStart(2, "0") + "T" + schedTime + ":00";
  }

  var results = [];
  for (var i = 0; i < activePlatforms.length; i++) {
    var plat = activePlatforms[i];
    var cap = f[plat.caption] || fbCap;
    if (!cap) continue;

    try {
      var r = await scheduleOne(blogId, dateTime, cap, plat, imageUrl);
      results.push(r);
      if (i < activePlatforms.length - 1) await new Promise(function(resolve) { setTimeout(resolve, 500); });
    } catch (e) {
      results.push({ network: plat.network, status: 0, ok: false, response: e.message });
    }
  }
  return results;
}

/* ── Handler ── */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!METRICOOL_KEY || !METRICOOL_USER) return res.status(500).json({ error: "METRICOOL_KEY and METRICOOL_USER_ID env vars required" });

  try {
    var body = req.body || {};
    var action = body.action || "publish_post";

    // ── Publish single post ──
    if (action === "publish_post") {
      var postId = body.postId;
      if (!postId) return res.status(400).json({ error: "postId required" });

      var post = await atGet(QUEUE, postId);
      var clientId = (post.fields.Client || [])[0];
      if (!clientId) return res.status(400).json({ error: "Post has no client" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      // Get connected platforms and convert to Metricool network names
      var connRaw = client.fields["Connected Platforms"] || [];
      var connNetworks = connRaw.map(function(p) { return PLATFORM_MAP[typeof p === "string" ? p : p.name]; }).filter(Boolean);
      if (!connNetworks.length) return res.status(400).json({ error: "Client has no Connected Platforms set in Airtable" });

      // Pass image URL directly — saveExternalMediaFiles tells Metricool to download it
      var imgUrl = post.fields["Image URL"] || "";

      // Schedule across connected platforms only
      var results = await schedulePost(blogId, post, imgUrl || null, connNetworks);
      var succeeded = results.filter(function(r) { return r.ok; });
      var failed = results.filter(function(r) { return !r.ok; });

      // Update Airtable status
      await atPatch(QUEUE, postId, { Status: "Published" });

      return res.status(200).json({
        success: true, postId: postId,
        platforms: { total: results.length, succeeded: succeeded.length, failed: failed.length },
        results: results,
        imageUrl: imgUrl || null
      });
    }

    // ── Publish all approved posts for a client ──
    if (action === "publish_client") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      var connRaw2 = client.fields["Connected Platforms"] || [];
      var connNetworks2 = connRaw2.map(function(p) { return PLATFORM_MAP[typeof p === "string" ? p : p.name]; }).filter(Boolean);
      if (!connNetworks2.length) return res.status(400).json({ error: "Client has no Connected Platforms" });

      var allPosts = await atList(QUEUE, "AND({Status}='Queued',RECORD_ID()!='')");
      var clientPosts = allPosts.filter(function(p) { return (p.fields.Client || [])[0] === clientId; });
      if (!clientPosts.length) return res.status(200).json({ success: true, published: 0, message: "No approved posts" });

      var published = 0, errors = [];
      for (var i = 0; i < clientPosts.length; i++) {
        try {
          var postImgUrl = clientPosts[i].fields["Image URL"] || null;
          await schedulePost(blogId, clientPosts[i], postImgUrl, connNetworks2);
          await atPatch(QUEUE, clientPosts[i].id, { Status: "Published" });
          published++;
          if (i < clientPosts.length - 1) await new Promise(function(r) { setTimeout(r, 2000); });
        } catch (e) { errors.push({ postId: clientPosts[i].id, error: e.message }); }
      }
      return res.status(200).json({ success: true, published: published, errors: errors });
    }

    // ── List brands (debug) ──
    if (action === "list_brands") {
      var r = await fetch(MC_BASE + "/admin/simpleProfiles?userId=" + METRICOOL_USER + "&blogId=" + (body.blogId || "0"), { headers: mcH() });
      return res.status(200).json({ success: true, brands: await r.json() });
    }

    // ── Test normalize (debug) ──
    if (action === "test_normalize") {
      var result = await uploadImage(body.blogId || "4535234", body.imageUrl || "");
      return res.status(200).json({ success: true, result: result });
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
