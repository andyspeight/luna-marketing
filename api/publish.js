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

// Schedule a post on Metricool — Facebook only for now
async function schedulePost(blogId, post, metricoolImageUrl) {
  var f = post.fields;
  var caption = f["Caption - Facebook"] || "";

  // Schedule time — use post date or default to tomorrow 10:00
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

  var body = {
    publicationDate: { dateTime: dateTime, timezone: "Europe/London" },
    text: caption,
    providers: [{ network: "facebook" }],
    autoPublish: true,
    facebookData: { type: "POST" },
    creatorUserId: parseInt(METRICOOL_USER)
  };

  // Add image — must be a plain URL string array (from Metricool's own format)
  if (metricoolImageUrl) {
    body.media = [metricoolImageUrl];
    body.mediaAltText = [null];
    body.saveExternalMediaFiles = false;
  }

  var url = MC_BASE + "/v2/scheduler/posts?blogId=" + blogId + "&userId=" + METRICOOL_USER;
  var r = await fetch(url, { method: "POST", headers: mcH(), body: JSON.stringify(body) });
  var txt = await r.text();
  if (!r.ok) throw new Error("Metricool " + r.status + ": " + txt.substring(0, 200));
  try { return JSON.parse(txt); } catch (e) { return { raw: txt }; }
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

      // Upload image to Metricool servers
      var imgUrl = post.fields["Image URL"] || "";
      var imgResult = await uploadImage(blogId, imgUrl);

      // Schedule post
      var mcResult = await schedulePost(blogId, post, imgResult.url);

      // Update Airtable status
      await atPatch(QUEUE, postId, { Status: "Published" });

      return res.status(200).json({
        success: true, postId: postId,
        metricool: mcResult,
        image: {
          original: imgUrl ? imgUrl.substring(0, 80) : null,
          metricoolUrl: imgResult.url ? imgResult.url.substring(0, 100) : null,
          normalizeResponse: imgResult.raw,
          addedToPost: !!imgResult.url
        }
      });
    }

    // ── Publish all approved posts for a client ──
    if (action === "publish_client") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      var allPosts = await atList(QUEUE, "AND({Status}='Queued',RECORD_ID()!='')");
      var clientPosts = allPosts.filter(function(p) { return (p.fields.Client || [])[0] === clientId; });
      if (!clientPosts.length) return res.status(200).json({ success: true, published: 0, message: "No approved posts" });

      var published = 0, errors = [];
      for (var i = 0; i < clientPosts.length; i++) {
        try {
          var imgR = await uploadImage(blogId, clientPosts[i].fields["Image URL"] || "");
          await schedulePost(blogId, clientPosts[i], imgR.url);
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
