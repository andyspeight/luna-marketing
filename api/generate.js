// api/generate.js
//
// On-demand "Generate Posts" endpoint, fired by the My Posts button in the
// client portal. Builds a week of posts, validates them, queues them to
// Airtable.
//
// HARDENED 21 May 2026 after a hallucination incident on the on-demand path:
// the previous version of this file built its own un-guardrailed system prompt
// inline, while the cron path used the hardened buildB2BSystemPrompt. The
// inline prompt has been DELETED. Every generation now flows through
// lib/generation-pipeline.js, which:
//   1. Builds the system prompt from the canonical brand-guardrails +
//      buildB2BSystemPrompt / buildB2CSystemPrompt modules.
//   2. Hard-asserts the guardrail sentinel is present before calling the model.
//   3. Validates every generated post and tags failures as Quality Hold.
//
// AUTO-PUBLISH KILL SWITCH:
// Even if a client record has Auto Publish enabled, this endpoint will only
// honour it when process.env.AUTO_PUBLISH_ENABLED === "true". Default is OFF.

var {
  buildSystemPrompt,
  callModel,
  validateAndTagPosts,
  parsePostsJson,
} = require("../lib/generation-pipeline.js");

var AIRTABLE_KEY = process.env.AIRTABLE_KEY;
var AIRTABLE_BASE = "appSoIlSe0sNaJ4BZ";
var PEXELS_KEY = process.env.PEXELS_KEY;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function getClient(clientId) {
  var res = await fetch(
    "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblUkzvBujc94Yali/" + clientId,
    { headers: { Authorization: "Bearer " + AIRTABLE_KEY } }
  );
  if (!res.ok) throw new Error("Failed to fetch client: " + res.statusText);
  return res.json();
}

async function checkFCDO(country) {
  if (!country || country === "General") return { safe: true, level: "none" };
  try {
    var slug = country.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    var url = "https://www.gov.uk/foreign-travel-advice/" + slug;
    var response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) return { safe: true, level: "not_found" };
    var data = await response.json();
    var content = JSON.stringify(data).toLowerCase();
    if (content.includes("advise against all travel")) {
      return { safe: false, level: "against_all_travel", reason: "FCDO advises against all travel to " + country };
    }
    if (content.includes("advise against all but essential travel")) {
      return { safe: false, level: "against_all_but_essential", reason: "FCDO advises against all but essential travel to " + country };
    }
    return { safe: true, level: "no_warning" };
  } catch (err) {
    return { safe: true, level: "check_failed", reason: err.message };
  }
}

async function searchImage(query, orientation) {
  if (!PEXELS_KEY) return null;
  try {
    var url = "https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) +
      "&orientation=" + (orientation || "landscape") + "&per_page=1&size=large";
    var res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    if (data.photos && data.photos.length > 0) {
      return data.photos[0].src.large2x || data.photos[0].src.large;
    }
    return null;
  } catch (err) { return null; }
}

async function searchVideo(query) {
  if (!PEXELS_KEY) return null;
  try {
    var url = "https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) +
      "&orientation=portrait&per_page=1&size=medium";
    var res = await fetch(url, { headers: { Authorization: PEXELS_KEY } });
    if (!res.ok) return null;
    var data = await res.json();
    if (data.videos && data.videos.length > 0) {
      var v = data.videos[0];
      var files = v.video_files || [];
      var best = files.filter(function(f) { return f.quality === "hd"; })
        .sort(function(a,b) { return (b.width||0) - (a.width||0); })[0];
      if (!best) best = files[0];
      return best ? best.link : null;
    }
    return null;
  } catch (err) { return null; }
}

function getWeekString() {
  var d = new Date();
  var oneJan = new Date(d.getFullYear(), 0, 1);
  var weekNum = Math.ceil(((d - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return d.getFullYear() + "-W" + (weekNum < 10 ? "0" : "") + weekNum;
}

function getClientType(clientRecord) {
  var ct = clientRecord.fields["Client Type"];
  if (!ct) return "b2c-travel";
  var name = typeof ct === "object" ? ct.name : ct;
  return (name || "b2c-travel").toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// Queue Posts to Airtable
//
// Takes the validated-and-tagged posts from the pipeline. If a post failed
// validation (statusOverride === "Quality Hold"), it's saved with that status
// and the issues report; it cannot reach Approved/Published until a human
// resolves it.
// ─────────────────────────────────────────────────────────────

async function queuePosts(taggedPosts, clientId, clientAutoPublish, isB2B) {
  // Hard kill switch — defence in depth. Auto-publish only honoured when
  // AUTO_PUBLISH_ENABLED is the literal string "true". Default = OFF.
  var killSwitchEnabled = process.env.AUTO_PUBLISH_ENABLED !== "true";
  var effectiveAutoPublish = clientAutoPublish && !killSwitchEnabled;
  if (clientAutoPublish && killSwitchEnabled) {
    console.warn("[generate.js] Auto Publish is set on client but AUTO_PUBLISH_ENABLED env is not 'true' — forcing manual review.");
  }

  var created = [];
  for (var i = 0; i < taggedPosts.length; i++) {
    var tagged = taggedPosts[i];
    var post = tagged.post;
    var dest = post.destination || "General";

    // FCDO check (skip for B2B since destinations are "General")
    var fcdo = { safe: true };
    if (!isB2B && dest !== "General") {
      fcdo = await checkFCDO(dest);
    }

    // Decide status. Precedence (highest to lowest):
    //   1. Validation failure → Quality Hold (NEVER published, regardless of auto-publish)
    //   2. FCDO unsafe → Suppressed
    //   3. Auto-publish ON + kill switch OFF → Approved
    //   4. Default → Queued
    var status;
    if (tagged.statusOverride === "Quality Hold") {
      status = "Quality Hold";
    } else if (!fcdo.safe) {
      status = "Suppressed";
    } else if (effectiveAutoPublish) {
      status = "Approved";
    } else {
      status = "Queued";
    }

    // Image / video search — skip for Quality Hold posts (no point spending Pexels quota)
    var imageUrl = null;
    var pinterestImageUrl = null;
    var videoUrl = null;
    if (status !== "Quality Hold") {
      var imageQuery = post.image_search_query || (isB2B ? "travel technology" : dest + " travel");
      imageUrl = await searchImage(imageQuery, "landscape");
      pinterestImageUrl = await searchImage(imageQuery, "portrait");
      if (!isB2B) {
        videoUrl = await searchVideo(imageQuery);
      }
    }

    // Build Airtable record. Use model-supplied post_title when present
    // (B2B always emits one); otherwise compose from destination/type/day.
    var composedTitle = (post.destination || "General") + " " +
      (post.content_type || (isB2B ? "Post" : "")) +
      " - " + (post.suggested_day || "Mon");
    var fields = {
      "Post Title": post.post_title || composedTitle,
      "Client": [clientId],
      "Content Type": post.content_type || "",
      "Caption - Facebook": post.caption_facebook || "",
      "Caption - Instagram": post.caption_instagram || "",
      "Caption - LinkedIn": post.caption_linkedin || "",
      "Caption - Twitter": post.caption_twitter || "",
      "Caption - Pinterest": post.caption_pinterest || "",
      "Caption - TikTok": post.caption_tiktok || "",
      "Caption - GBP": post.caption_gbp || "",
      "Hashtags": post.hashtags || "",
      "CTA URL": post.cta_url || "",
      "Destination": dest,
      "Scheduled Time": post.suggested_time || "09:00",
      "Status": status,
      "Generated Week": getWeekString(),
      "Image URL": imageUrl || "",
      "Pinterest Image URL": pinterestImageUrl || "",
      "Video URL": videoUrl || ""
    };

    // Quality Issues field — populated whenever validation produced anything.
    if (tagged.qualityIssues) {
      fields["Quality Issues"] = tagged.qualityIssues;
    }

    // Suppression reason
    if (!fcdo.safe) {
      fields["Suppression Reason"] = fcdo.reason || "FCDO advisory";
    }

    // B2B-specific fields
    if (isB2B) {
      if (post.target_channel) fields["Target Channel"] = post.target_channel;
      if (post.content_pillar) fields["Content Pillar"] = post.content_pillar;
      if (post.first_comment) fields["First Comment"] = post.first_comment;
    }

    var res = await fetch(
      "https://api.airtable.com/v0/" + AIRTABLE_BASE + "/tblbhyiuULvedva0K",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + AIRTABLE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ records: [{ fields: fields }], typecast: true })
      }
    );
    if (res.ok) {
      var data = await res.json();
      var rec = data.records[0];
      rec._status = status;
      rec._qualityHold = (status === "Quality Hold");
      rec._suppressed = (status === "Suppressed");
      created.push(rec);
    } else {
      console.error("Failed to create post:", (await res.text()).substring(0, 200));
    }
  }
  return created;
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  console.log(
    "[generate.js] called. ANTHROPIC_API_KEY:", !!process.env.ANTHROPIC_API_KEY,
    "PEXELS_KEY:", !!PEXELS_KEY,
    "AIRTABLE_KEY:", !!AIRTABLE_KEY,
    "AUTO_PUBLISH_ENABLED:", process.env.AUTO_PUBLISH_ENABLED || "(unset, treated as false)"
  );

  try {
    var body = req.body || {};
    var clientId = body.clientId;
    var dryRun = body.dryRun;

    if (!clientId) return res.status(400).json({ error: "clientId is required" });

    // 1. Fetch client from Airtable
    var clientRecord = await getClient(clientId);
    var clientAutoPublish = !!clientRecord.fields["Auto Publish"];
    var clientType = getClientType(clientRecord);
    var isB2B = clientType === "b2b-saas";

    // 2. Build the hardened system prompt via the shared pipeline.
    //    There is no other path through this function — the inline weak
    //    prompt that used to live here was deleted on 21 May 2026.
    var systemPrompt = buildSystemPrompt({
      clientFields: clientRecord.fields,
      clientType: clientType,
      events: [],
      sparks: [], // on-demand path doesn't pre-load sparks; cron does
    });

    // 3. Call the model through the pipeline. callModel() asserts that the
    //    guardrail sentinel is present and throws if not.
    var rawText = await callModel({
      systemPrompt: systemPrompt,
      userMessage: isB2B
        ? "Generate this week's B2B content. Return ONLY a JSON array. Remember: never name competitors, never invent client names, never invent statistics."
        : "Generate this week's social media posts. Return ONLY a JSON array.",
      maxTokens: 8192,
      temperature: 0.7,
    });

    // 4. Parse posts JSON
    var posts;
    try {
      posts = parsePostsJson(rawText);
    } catch (e) {
      return res.status(500).json({
        error: "Failed to parse model response as JSON: " + e.message,
        raw: (rawText || "").substring(0, 500),
      });
    }

    // 5. Validate every generated post BEFORE writing to Airtable.
    //    validateAndTagPosts marks bad posts with statusOverride="Quality Hold".
    var tagged = validateAndTagPosts(posts);

    var blockedCount = tagged.filter(function(t) { return t.statusOverride === "Quality Hold"; }).length;
    var warnCount = tagged.filter(function(t) { return t.validation.severity === "warn"; }).length;

    if (blockedCount > 0) {
      console.warn("[generate.js] " + blockedCount + " of " + tagged.length + " posts blocked by validator (saved as Quality Hold).");
    }

    // 6. Queue to Airtable (unless dry-run)
    var queued = [];
    var qualityHold = 0;
    var suppressed = 0;
    var approved = 0;
    if (!dryRun) {
      queued = await queuePosts(tagged, clientId, clientAutoPublish, isB2B);
      qualityHold = queued.filter(function(q) { return q._qualityHold; }).length;
      suppressed = queued.filter(function(q) { return q._suppressed; }).length;
      approved = queued.filter(function(q) { return q._status === "Approved"; }).length;
    }

    return res.status(200).json({
      success: true,
      posts: posts,
      queued: queued.length,
      qualityHold: qualityHold,
      suppressed: suppressed,
      approved: approved,
      validationWarnings: warnCount,
      validationBlocked: blockedCount,
      autoPublishHonoured: clientAutoPublish && process.env.AUTO_PUBLISH_ENABLED === "true",
      autoPublishKillSwitch: process.env.AUTO_PUBLISH_ENABLED !== "true",
      clientType: clientType,
      isB2B: isB2B,
      client: clientRecord.fields["Business Name"],
      week: getWeekString(),
    });
  } catch (err) {
    console.error("[generate.js] error:", err);
    // GUARDRAILS_MISSING is the runtime assertion from the pipeline. Surface
    // it explicitly so Andy can see when it fires.
    var msg = err && err.message ? err.message : String(err);
    return res.status(500).json({ error: msg, guardrails_failed: msg.indexOf("GUARDRAILS_MISSING") !== -1 });
  }
};
