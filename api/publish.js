/* ══════════════════════════════════════════
   LUNA MARKETING — METRICOOL PUBLISH
   Schedules approved posts to Metricool
   across all 7 platforms per client brand
   ══════════════════════════════════════════ */

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var METRICOOL_KEY = process.env.METRICOOL_KEY;
var METRICOOL_USER = process.env.METRICOOL_USER_ID;
var BASE = "appSoIlSe0sNaJ4BZ";
var QUEUE = "tblbhyiuULvedva0K";
var CLIENTS = "tblUkzvBujc94Yali";

var MC_BASE = "https://app.metricool.com/api";

/* ── Airtable helpers ── */
async function atGet(table, recordId) {
  var r = await fetch("https://api.airtable.com/v0/" + BASE + "/" + table + "/" + recordId, {
    headers: { Authorization: "Bearer " + AIRTABLE_KEY }
  });
  if (!r.ok) throw new Error("Airtable GET " + r.status);
  return r.json();
}

async function atPatch(table, recordId, fields) {
  var r = await fetch("https://api.airtable.com/v0/" + BASE + "/" + table + "/" + recordId, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + AIRTABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: fields, typecast: true })
  });
  if (!r.ok) throw new Error("Airtable PATCH " + r.status);
  return r.json();
}

async function atList(table, formula) {
  var url = "https://api.airtable.com/v0/" + BASE + "/" + table + "?filterByFormula=" + encodeURIComponent(formula);
  var r = await fetch(url, { headers: { Authorization: "Bearer " + AIRTABLE_KEY } });
  if (!r.ok) throw new Error("Airtable LIST " + r.status);
  var d = await r.json();
  return d.records || [];
}

/* ── Metricool helpers ── */
function mcHeaders() {
  return { "Content-Type": "application/json", "X-Mc-Auth": METRICOOL_KEY };
}

// Normalize image — uploads to Metricool servers so URL doesn't expire
async function normalizeImage(blogId, imageUrl) {
  if (!imageUrl) return null;
  try {
    var url = MC_BASE + "/actions/normalize/image/url?url=" + encodeURIComponent(imageUrl) +
      "&blogId=" + blogId + "&userId=" + METRICOOL_USER;
    console.log("Normalizing image:", imageUrl.substring(0, 80));
    var r = await fetch(url, { headers: mcHeaders() });
    var responseText = await r.text();
    console.log("Normalize response:", r.status, responseText.substring(0, 200));
    if (!r.ok) {
      console.error("Normalize failed, using original URL");
      return imageUrl;
    }
    // Response might be JSON or plain URL string
    try {
      var d = JSON.parse(responseText);
      return d.url || d.normalizedUrl || d.mediaUrl || imageUrl;
    } catch (e) {
      // Might be a plain URL string
      if (responseText.startsWith("http")) return responseText.trim();
      return imageUrl;
    }
  } catch (e) {
    console.error("Normalize error:", e.message);
    return imageUrl;
  }
}

// Schedule a post on Metricool
async function schedulePost(blogId, post, normalizedImageUrl) {
  var f = post.fields;
  var fbCap = f["Caption - Facebook"] || "";

  // Schedule time
  var schedDate = f["Scheduled Date"];
  var schedTime = f["Scheduled Time"] || "10:00";
  var dateTime;
  if (schedDate) {
    dateTime = schedDate + "T" + schedTime + ":00";
  } else {
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    var y = tomorrow.getFullYear();
    var m = String(tomorrow.getMonth() + 1).padStart(2, "0");
    var d = String(tomorrow.getDate()).padStart(2, "0");
    dateTime = y + "-" + m + "-" + d + "T" + schedTime + ":00";
  }

  // Minimal body — only fields proven in Metricool docs
  var body = {
    publicationDate: {
      dateTime: dateTime,
      timezone: "Europe/London"
    },
    text: fbCap,
    providers: [{ network: "facebook" }],
    autoPublish: true,
    facebookData: { type: "POST" },
    creatorUserId: parseInt(METRICOOL_USER)
  };

  // Add image if available
  var debugImg = { original: null, normalized: null, added: false };
  if (normalizedImageUrl) {
    debugImg.original = normalizedImageUrl.substring(0, 100);
    debugImg.normalized = normalizedImageUrl.substring(0, 100);
    debugImg.added = true;
    body.media = [{ url: normalizedImageUrl }];
  }

  var url = MC_BASE + "/v2/scheduler/posts?blogId=" + blogId + "&userId=" + METRICOOL_USER;
  console.log("Metricool request:", url, JSON.stringify(body).substring(0, 500));

  var r = await fetch(url, {
    method: "POST",
    headers: mcHeaders(),
    body: JSON.stringify(body)
  });

  var responseText = await r.text();
  console.log("Metricool response:", r.status, responseText.substring(0, 300));
  if (!r.ok) throw new Error("Metricool: " + r.status + " " + responseText.substring(0, 200));

  var result;
  try { result = JSON.parse(responseText); } catch (e) { result = { raw: responseText }; }
  return { metricool: result, imageDebug: debugImg };
}

/* ── Main handler ── */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!METRICOOL_KEY || !METRICOOL_USER) {
    return res.status(500).json({ error: "METRICOOL_KEY and METRICOOL_USER_ID env vars required" });
  }

  try {
    var body = req.body || {};
    var action = body.action || "publish_post";

    // ── Publish a single post ──
    if (action === "publish_post") {
      var postId = body.postId;
      if (!postId) return res.status(400).json({ error: "postId is required" });

      // Get the post
      var post = await atGet(QUEUE, postId);
      if (!post.fields) return res.status(404).json({ error: "Post not found" });

      // Get the client to find their Metricool blogId
      var clientId = (post.fields.Client || [])[0];
      if (!clientId) return res.status(400).json({ error: "Post has no linked client" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID. Set it in Airtable first." });

      // Normalize image
      var imgUrl = post.fields["Image URL"] || "";
      var normalizedImg = await normalizeImage(blogId, imgUrl);
      console.log("Normalized image:", normalizedImg ? "yes" : "no");

      // Schedule on Metricool
      var result = await schedulePost(blogId, post, normalizedImg);
      console.log("Published post " + postId + " to Metricool");

      // Update status in Airtable
      await atPatch(QUEUE, postId, { Status: "Published" });

      return res.status(200).json({
        success: true, action: "publish_post", postId: postId,
        metricool: result.metricool,
        imageDebug: result.imageDebug,
        originalImageUrl: imgUrl ? imgUrl.substring(0, 80) : null,
        normalizedImageUrl: normalizedImg ? normalizedImg.substring(0, 80) : null
      });
    }

    // ── Publish all approved posts for a client ──
    if (action === "publish_client") {
      var clientId = body.clientId;
      if (!clientId) return res.status(400).json({ error: "clientId is required" });

      var client = await atGet(CLIENTS, clientId);
      var blogId = client.fields["Metricool Blog ID"];
      if (!blogId) return res.status(400).json({ error: "Client has no Metricool Blog ID" });

      // Find all approved (Queued) posts for this client
      var formula = "AND({Status}='Queued',RECORD_ID()!='')";
      var allPosts = await atList(QUEUE, formula);
      var clientPosts = allPosts.filter(function(p) {
        return (p.fields.Client || [])[0] === clientId;
      });

      if (!clientPosts.length) {
        return res.status(200).json({ success: true, action: "publish_client", published: 0, message: "No approved posts to publish" });
      }

      var published = 0;
      var errors = [];

      for (var i = 0; i < clientPosts.length; i++) {
        var p = clientPosts[i];
        try {
          var imgUrl = p.fields["Image URL"] || "";
          var normImg = await normalizeImage(blogId, imgUrl);
          await schedulePost(blogId, p, normImg);
          await atPatch(QUEUE, p.id, { Status: "Published" });
          published++;
          console.log("Published " + p.id);
          // 2 second delay between posts to avoid rate limiting
          if (i < clientPosts.length - 1) await new Promise(function(r) { setTimeout(r, 2000); });
        } catch (e) {
          console.error("Error publishing " + p.id + ":", e.message);
          errors.push({ postId: p.id, error: e.message });
        }
      }

      return res.status(200).json({
        success: true, action: "publish_client", clientId: clientId,
        published: published, errors: errors
      });
    }

    // ── List brands (debug/setup helper) ──
    if (action === "list_brands") {
      var url = MC_BASE + "/admin/simpleProfiles?userId=" + METRICOOL_USER + "&blogId=" + (body.blogId || "0");
      var r = await fetch(url, { headers: mcHeaders() });
      var d = await r.json();
      return res.status(200).json({ success: true, brands: d });
    }

    return res.status(400).json({ error: "Unknown action: " + action });

  } catch (err) {
    console.error("Publish error:", err);
    return res.status(500).json({ error: err.message });
  }
};
